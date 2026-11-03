const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const ExcelJS = require('exceljs');
const { execute, scanScenario, root } = require('./validation/scanner.cjs');

const args = process.argv.slice(2);
const selected = args[0] || 'all';
const reportRoot = path.join(root, 'reports/validation');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const config = number => read(path.join(root, `config/validation/issue-${number}.json`));
const relative = file => path.relative(root, file).replaceAll('\\', '/');
const resolve = file => path.resolve(root, file);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unique = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const suites = {
    33: ['sourceProject', 'publishOutputs'],
    36: ['sourceProject', 'libraryAnalysis', 'versionReports', 'versionReferences', 'versionBranches.integration', 'componentSelection'],
};

function context(number, directory = path.join(reportRoot, `issue-${number}`)) {
    fs.mkdirSync(directory, { recursive: true });
    const checks = [];
    const add = (name, expected, observed, status, evidence = '') => {
        checks.push({ name, expected, observed, status, evidence });
        console.log(`#${number} ${status} : ${name}`);
    };
    const check = (name, expected, observed, pass, evidence) => add(name, expected, observed, pass ? 'PASS' : 'FAIL', evidence);
    const blocked = (name, expected, observed, evidence) => add(name, expected, observed, 'BLOCKED', evidence);
    return { number, directory, checks, add, check, blocked };
}

function finish(ctx) {
    const status = ctx.checks.some(c => c.status === 'FAIL') ? 'FAIL' : ctx.checks.some(c => c.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
    const result = { issue: ctx.number, status, date: new Date().toISOString(), node: process.version,
        scope: 'Contrôles indiqués uniquement. PASS ne clôture pas automatiquement une issue.', checks: ctx.checks };
    const escape = value => String(typeof value === 'string' ? value : JSON.stringify(value)).replaceAll('|', '\\|').replaceAll('\n', '<br>');
    fs.writeFileSync(path.join(ctx.directory, 'recette-resultat.json'), JSON.stringify(result, null, 2) + '\n');
    fs.writeFileSync(path.join(ctx.directory, 'recette-resultat.md'), [
        `# Validation de l’issue #${ctx.number}`, '', `**Résultat : ${status}**`, '',
        result.scope, '', `Guide : docs/recette/issue-${ctx.number}.md`, '',
        '| Contrôle | Attendu | Observé | Statut | Preuve |', '| --- | --- | --- | --- | --- |',
        ...ctx.checks.map(c => `| ${[c.name, c.expected, c.observed, c.status, c.evidence].map(escape).join(' | ')} |`), '',
        'FAIL : comparer attendu/observé et joindre ce rapport au ticket. Le défaut reste à corriger.',
        'BLOCKED : suivre le guide pour fournir le prérequis manquant ; ce n’est pas une validation réussie.', '',
    ].join('\n'));
    return result;
}

async function testSuite(ctx, names) {
    const result = await execute(process.execPath, ['--require', 'ts-node/register', '--test', '--test-concurrency=1',
        ...names.map(name => `tests/${name}.test.ts`)], { cwd: root, timeout: 240000 });
    fs.writeFileSync(path.join(ctx.directory, 'tests.txt'), result.stdout + '\n' + result.stderr);
    ctx.check('Tests de référence', 'Code 0, aucun test échoué', { code: result.code, timedOut: result.timedOut, suites: names }, result.code === 0 && !result.timedOut, relative(path.join(ctx.directory, 'tests.txt')));
}

async function scannerKit(ctx) {
    for (const item of config(ctx.number).cases) {
        if (!/^[a-z0-9-]+$/i.test(item.name)) throw new Error('Nom de scénario invalide : ' + item.name);
        const directory = path.join(ctx.directory, item.name);
        const result = await scanScenario(directory, item);
        const evidence = relative(directory);
        ctx.check(`${item.name} : serveur simulé`, 'Aucune route API inconnue, pas de timeout', result.unexpected, !result.unexpected.length && !result.timedOut, evidence + '/api-calls.json');
        if (ctx.number === 29) {
            const expected = { branch: item.expectedBranch, version: item.version, sha: (item.expectedBranch === 'main' ? 'a' : 'b').repeat(40) };
            const dependency = result.dependencies.find(d => d.dependency === 'react');
            const observed = dependency ? { branch: dependency.default_branch, version: dependency.resolved_version, sha: dependency.commit_sha_scanned } : null;
            ctx.check(`${item.name} : branche et version`, expected, observed, result.code === 0 && same(expected, observed), evidence + '/dependencies.json');
            ctx.check(`${item.name} : Excel cohérent`, 'Même ligne React que le JSON', result.excel.length,
                !!dependency && result.excel.some(row => row.dependency === 'react' && row.default_branch === dependency.default_branch && row.resolved_version === dependency.resolved_version), evidence + '/scan.xlsx');
        } else if (ctx.number === 30) {
            const failure = item.expectedExit === 'failure';
            ctx.check(`${item.name} : code de sortie`, failure ? 'Non nul' : '0', result.code, !result.timedOut && (failure ? result.code !== 0 && result.code !== null : result.code === 0), evidence + '/terminal.txt');
            if (item.preserve) ctx.check(`${item.name} : derniers rapports conservés`, 'JSON et Excel complets inchangés', result.preserved, result.preserved, evidence);
            if (!failure) {
                const repos = unique(result.dependencies.map(d => d.repo));
                ctx.check(`${item.name} : périmètre`, `${item.expectedRepos} dépôts avec dépendances`, repos, repos.length === item.expectedRepos, evidence + '/dependencies.json');
            }
            const summary = path.join(directory, 'scan-summary.json');
            ctx.check(`${item.name} : bilan exploitable`, 'scan-summary.json : status + compteurs discovered/scanned/ignored/failed', fs.existsSync(summary) ? read(summary) : 'Absent',
                fs.existsSync(summary) && ['discovered', 'scanned', 'ignored', 'failed'].every(key => Number.isInteger(read(summary)[key])) && typeof read(summary).status === 'string', evidence);
        } else {
            ctx.check(`${item.name} : exécution`, 0, result.code, result.code === 0 && !result.timedOut, evidence + '/terminal.txt');
            const deps = unique(result.dependencies.map(d => d.dependency));
            ctx.check(`${item.name} : dépendances`, item.dependencies, deps, same(deps, item.dependencies), evidence + '/dependencies.json');
            const identity = rows => rows.map(row => [row.org, row.repo, row.package_path, row.dependency, row.declared_range ?? null, row.resolved_version ?? null, row.default_branch, row.commit_sha_scanned]);
            ctx.check(`${item.name} : contrat JSON/Excel`, 'Mêmes dépendances, versions, branches et SHA', { json: result.dependencies.length, excel: result.excel.length }, same(identity(result.dependencies), identity(result.excel)), evidence + '/scan.xlsx');
            if (item.resolved) ctx.check(`${item.name} : version résolue`, item.resolved, result.dependencies.map(d => d.resolved_version), result.dependencies.some(d => d.resolved_version === item.resolved), evidence);
            if (item.project) ctx.check(`${item.name} : projet détecté`, item.project, result.projects.map(p => p.name), result.projects.some(p => p.name === item.project), evidence + '/projects.json');
            if (item.expectedRepos) ctx.check(`${item.name} : dépôts`, item.expectedRepos, unique(result.dependencies.map(d => d.repo)).length, unique(result.dependencies.map(d => d.repo)).length === item.expectedRepos, evidence);
            if (item.pagination) ctx.check('Pagination : deuxième page appelée', true, result.calls.some(c => c.page === '2'), result.calls.some(c => c.page === '2'), evidence + '/api-calls.json');
        }
    }
    if (ctx.number === 31) ctx.blocked('Intégration à npm test et préfiltrages', 'Suite scanner intégrée aux tests courants, cas tree/code et lockfiles Yarn/pnpm', 'Ce kit fournit npm/workspace/Maven/Gradle/pagination/filtres ; ces contrats complémentaires restent à livrer.');
}

async function pythonKit(ctx) {
    const settings = config(32);
    const base = JSON.parse(fs.readFileSync(resolve(settings.input), 'utf8'));
    fs.writeFileSync(path.join(ctx.directory, 'dependencies.json'), JSON.stringify(base, null, 2));
    fs.writeFileSync(path.join(ctx.directory, 'dependencies.jsonl'), base.map(row => JSON.stringify(row)).join('\n') + '\n');
    fs.writeFileSync(path.join(ctx.directory, 'dependencies.json.gz'), zlib.gzipSync(JSON.stringify(base)));
    fs.writeFileSync(path.join(ctx.directory, 'invalid.json'), '{ invalid json');
    const candidates = settings.pythonExecutable ? [[settings.pythonExecutable, []]] : [['py', ['-3']], ['python3', []], ['python', []]];
    let python;
    for (const [command, prefix] of candidates) {
        const probe = await execute(command, [...prefix, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { cwd: root, timeout: 5000 });
        const version = probe.stdout.trim().match(/^(\d+)\.(\d+)$/);
        const [major, minor] = settings.minimumVersion;
        if (probe.code === 0 && version && (+version[1] > major || (+version[1] === major && +version[2] >= minor))) { python = { command, prefix, version: version[0] }; break; }
    }
    if (!python) {
        ctx.blocked('Interpréteur Python', 'Python >= 3.9 exécutable', 'Aucun interpréteur utilisable. Renseigner pythonExecutable dans config/validation/issue-32.json après installation.');
        return;
    }
    ctx.check('Interpréteur Python', '>= 3.9', python.version, true);
    const run = async (name, input, extra = []) => {
        const output = path.join(ctx.directory, name + '.md');
        // Remove only this runner-owned report to prevent an old success masking a failure.
        if (fs.existsSync(output)) fs.unlinkSync(output);
        const execution = await execute(python.command, [...python.prefix, resolve('src/generate_deps_report.py'), '--in', path.join(ctx.directory, input), '--out', output, ...extra], { cwd: root, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
        fs.writeFileSync(path.join(ctx.directory, name + '.terminal.txt'), execution.stdout + '\n' + execution.stderr);
        return { ...execution, output, text: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
    };
    const total = text => Number(text.match(/Lignes \(dépendances\) analysées\s*\|\s*(\d+)/)?.[1] ?? NaN);
    for (const [name, input] of [['json', 'dependencies.json'], ['jsonl', 'dependencies.jsonl'], ['gzip', 'dependencies.json.gz']]) {
        const result = await run(name, input);
        ctx.check(`${name} : trois lignes et cas particuliers`, { rows: settings.expectedRows, unresolved: settings.expectedUnresolved, rc: settings.expectedPrerelease },
            { code: result.code, rows: total(result.text) }, result.code === 0 && total(result.text) === settings.expectedRows && result.text.includes(settings.expectedPrerelease)
                && new RegExp(`Lignes non résolues\\s*\\|\\s*${settings.expectedUnresolved}\\s*\\|`).test(result.text), relative(result.output));
    }
    const filtered = await run('react-only', 'dependencies.json', ['--libs', 'react']);
    ctx.check('Filtre React', settings.expectedReactRows, total(filtered.text), filtered.code === 0 && total(filtered.text) === settings.expectedReactRows && !filtered.text.includes('`lodash`'), relative(filtered.output));
    const invalid = await run('invalid-output', 'invalid.json');
    ctx.check('JSON invalide', 'Code non nul, pas de rapport', { code: invalid.code, report: fs.existsSync(invalid.output) }, invalid.code !== null && invalid.code !== 0 && !fs.existsSync(invalid.output), relative(path.join(ctx.directory, 'invalid-output.terminal.txt')));
}

async function ciKit(ctx) {
    const settings = config(33);
    const listing = await execute(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--listFilesOnly'], { cwd: root, timeout: 60000 });
    fs.writeFileSync(path.join(ctx.directory, 'typescript-files.txt'), listing.stdout + listing.stderr);
    const files = listing.stdout.split(/\r?\n/).map(file => file.replaceAll('\\', '/'));
    const logs = files.filter(file => file.startsWith(root.replaceAll('\\', '/') + '/logs/'));
    ctx.check('Références exclues du typage', 'Aucun fichier logs/', logs, listing.code === 0 && logs.length === 0, relative(path.join(ctx.directory, 'typescript-files.txt')));
    ctx.check('Sources et tests actifs inclus', 'src/ et tests/', { src: files.some(f => f.includes('/src/')), tests: files.some(f => f.includes('/tests/')) }, files.some(f => f.startsWith(root.replaceAll('\\', '/') + '/src/')) && files.some(f => f.startsWith(root.replaceAll('\\', '/') + '/tests/')));
    const jenkins = fs.readFileSync(resolve('Jenkinsfile'), 'utf8');
    const declarations = [...jenkins.matchAll(/Stage\s+(\w+)\s*=/g)].map(m => m[1]);
    ctx.check('Déclarations Jenkins distinctes', 'Aucun nom Stage dupliqué', declarations, new Set(declarations).size === declarations.length, 'Jenkinsfile');
    ctx.check('Étape Python déclarée', 'Commande de validation Python dans Jenkinsfile', /validate:issue-32|generate_deps_report|python.*test/i.test(jenkins), /validate:issue-32|generate_deps_report|python.*test/i.test(jenkins), 'Jenkinsfile');
    await testSuite(ctx, suites[33]);
    ctx.blocked('Exécution Jenkins et matrice Node', settings.externalEvidenceRequired, 'Le contrôle local ne lance pas la bibliothèque Jenkins externe ; joindre les liens CI.');
}

async function realKit(ctx) {
    const settings = config(34);
    const missing = ['dependenciesJson', 'workbook', 'markdown'].filter(key => !settings[key] || !fs.existsSync(resolve(settings[key])));
    if (missing.length || !settings.expected.length) {
        ctx.blocked('Rapports réels et référence métier', '3 chemins existants et expected rempli dans config/validation/issue-34.json', { missing, expectedRows: settings.expected.length }, 'config/validation/issue-34.json');
        return;
    }
    const fields = ['org', 'repo', 'default_branch', 'package_path', 'dependency', 'declared_range', 'resolved_version', 'commit_sha_scanned'];
    const canonical = rows => rows.map(row => fields.map(field => row[field] ?? null)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const dependencies = read(resolve(settings.dependenciesJson));
    const valid = Array.isArray(dependencies) && settings.expected.every(row => /^[a-f0-9]{40}$/i.test(row.commit_sha_scanned));
    ctx.check('Périmètre et versions exacts', 'Même multiensemble que expected, SHA réels de 40 caractères', { expectedRows: settings.expected.length, observedRows: dependencies.length }, valid && same(canonical(dependencies), canonical(settings.expected)), settings.dependenciesJson);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(resolve(settings.workbook));
    const sheet = workbook.getWorksheet('Dependencies');
    const excel = [];
    if (sheet) {
        const headers = sheet.getRow(1).values;
        sheet.eachRow((row, i) => { if (i > 1) excel.push(Object.fromEntries(headers.slice(1).map((h, index) => [h, row.getCell(index + 1).value]))); });
    }
    ctx.check('Excel = JSON', canonical(dependencies), canonical(excel), same(canonical(dependencies), canonical(excel)), settings.workbook);
    const markdown = fs.readFileSync(resolve(settings.markdown), 'utf8');
    const count = Number(markdown.match(/Lignes \(dépendances\) analysées\s*\|\s*(\d+)/)?.[1]);
    ctx.check('Markdown : même total', dependencies.length, count, count === dependencies.length, settings.markdown);
    const evidence = settings.evidence;
    const ready = evidence.ghesVersion && ['prefilterComparisons', 'accessDeniedProof'].every(key => evidence[key] && fs.existsSync(resolve(evidence[key])));
    if (!ready) ctx.blocked('Preuves GHES complémentaires', 'Version GHES, comparaison off/tree/code et preuve de refus de droits', evidence, 'config/validation/issue-34.json');
    else ctx.blocked('Acceptation humaine des preuves GHES', 'Référent confirme SHA, modes off/tree/code et refus de droits', 'Pièces fournies ; leur présence ne prouve pas leur validité. Joindre la décision du référent à #34.');
}

async function documentationKit(ctx) {
    const settings = config(35);
    const findings = [];
    const broken = [];
    for (const name of settings.pages) {
        const text = fs.readFileSync(resolve(name), 'utf8');
        for (const match of text.matchAll(/npm\s+(?:run\s+)?(start|init)\b/g)) findings.push({ file: name, obsolete: match[0] });
        for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
            const link = match[1].split('#')[0];
            if (!link || /^(https?:|mailto:|\/)/.test(link) || link.includes(' ')) continue;
            const target = path.resolve(path.dirname(resolve(name)), link);
            if (!fs.existsSync(target)) broken.push({ file: name, target: link });
        }
    }
    fs.writeFileSync(path.join(ctx.directory, 'documentation-findings.json'), JSON.stringify({ findings, broken }, null, 2));
    ctx.check('Commandes obsolètes dans les pages courantes', 'Aucun npm start/init dans les parcours', findings, findings.length === 0, relative(path.join(ctx.directory, 'documentation-findings.json')));
    ctx.check('Liens locaux Markdown', 'Cibles existantes', broken, broken.length === 0, relative(path.join(ctx.directory, 'documentation-findings.json')));
    const pkg = read(resolve('package.json'));
    const missing = settings.commands.filter(command => !pkg.scripts[command]);
    ctx.check('Commandes des parcours disponibles', settings.commands, { missing }, !missing.length, 'package.json');
    fs.writeFileSync(path.join(ctx.directory, 'lecture-utilisateur.md'), '# Lecture par une personne nouvelle\n\nPour chaque ligne : indiquer la commande suivie, le fichier trouvé et toute aide demandée.\n\n- [ ] Catalogue public : docs/recette/issue-28.md\n- [ ] Dépendances et impact : même guide\n- [ ] Versions : docs/analyse-component-versions.md\n- [ ] Scanner et Python : docs/recette/issue-31.md puis issue-32.md\n\nNom/date et décision : à remplir après essai.\n');
    ctx.blocked('Recette par un nouveau lecteur', 'Un lecteur indépendant réalise les 4 parcours et consigne les ambiguïtés', 'Compléter lecture-utilisateur.md et joindre à #35.', relative(path.join(ctx.directory, 'lecture-utilisateur.md')));
}

async function isolationKit(ctx) {
    await testSuite(ctx, suites[36]);
    const sandbox = path.join(ctx.directory, 'cache-sandbox');
    fs.mkdirSync(sandbox, { recursive: true });
    for (const name of ['sourceProject.cjs', 'versionReferences.cjs', 'analyse-component-versions.js']) fs.copyFileSync(resolve('src/' + name), path.join(sandbox, name));
    const modulePath = path.join(sandbox, 'sourceProject.cjs');
    delete require.cache[require.resolve(modulePath)];
    const before = require(modulePath).analysisFingerprint({ srcDir: 'src' });
    const text = fs.readFileSync(modulePath, 'utf8');
    const marker = "function buildSourceGraph(root, files, excluded = () => false, { view = 'detailed' } = {}) {";
    if (!text.includes(marker)) ctx.blocked('Sonde de cache', 'Point de mutation historique connu', 'La structure du moteur a changé ; adapter cette sonde au module graphique isolé.');
    else {
        fs.writeFileSync(modulePath, text.replace(marker, marker + '\n  // Validation: presentation-only comment, isolated copy.'));
        delete require.cache[require.resolve(modulePath)];
        const after = require(modulePath).analysisFingerprint({ srcDir: 'src' });
        fs.writeFileSync(path.join(ctx.directory, 'cache-comparison.json'), JSON.stringify({ before, after, mutation: 'Commentaire dans buildSourceGraph, copie uniquement' }, null, 2));
        ctx.check('Cache versions indépendant du graphe historique', 'Empreinte identique après commentaire dans le graphe', { before, after }, before === after, relative(path.join(ctx.directory, 'cache-comparison.json')));
    }
    ctx.blocked('Contrat TGF/métadonnées croisées', config(36).manualContract, 'Le kit ne prouve pas encore ce contrat ; ne pas fermer #36 sur les seuls tests de référence.');
}

async function cleanupKit(ctx) {
    const pkg = read(resolve('package.json'));
    const lock = read(resolve('package-lock.json'));
    const files = [];
    const visit = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) visit(file); else if (/\.(?:[cm]?js|tsx?|md)$/.test(file)) files.push(file); } };
    for (const dir of ['src', 'tests', 'scripts', 'docs']) visit(resolve(dir));
    const contents = files.map(file => ({ file: relative(file), text: fs.readFileSync(file, 'utf8') }));
    const inventory = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort().map(name => ({
        dependency: name, version: pkg.dependencies[name] || pkg.devDependencies[name],
        references: contents.filter(item => item.text.includes(name)).map(item => item.file),
        decision: 'À examiner ; une absence textuelle ne justifie pas un retrait',
    }));
    fs.writeFileSync(path.join(ctx.directory, 'dependency-inventory.json'), JSON.stringify(inventory, null, 2));
    const aligned = ['dependencies', 'devDependencies'].every(key => {
        const declared = pkg[key] || {};
        const locked = lock.packages[''][key] || {};
        return Object.keys(declared).length === Object.keys(locked).length
            && Object.entries(declared).every(([name, range]) => locked[name] === range);
    });
    ctx.check('Lockfile aligné sur package.json', 'Mêmes dépendances directes et contraintes, indépendamment de leur ordre', { aligned }, aligned, 'package-lock.json');
    const settings = config(37);
    if (!settings.removals.length) ctx.blocked('Proposition de nettoyage', 'removals : élément, justification, commandes affectées et preuve', 'Inventaire généré ; aucune suppression proposée ni effectuée.', relative(path.join(ctx.directory, 'dependency-inventory.json')));
    else {
        const complete = settings.removals.every(item => item.element && item.reason && Array.isArray(item.commands) && item.commands.length && item.evidence && fs.existsSync(resolve(item.evidence)));
        ctx.check('Justification des retraits', 'Chaque retrait documenté et preuve existante', settings.removals, complete, 'config/validation/issue-37.json');
        ctx.blocked('Acceptation des retraits', 'Référent accepte les retraits et résultats avant/après', 'Les champs renseignés ne remplacent pas la revue de leur contenu.');
    }
    if (args.includes('--clean-install')) {
        const directory = path.join(ctx.directory, 'clean-install');
        fs.mkdirSync(directory, { recursive: true });
        for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(resolve(name), path.join(directory, name));
        const npm = process.env.npm_execpath;
        if (!npm || !fs.existsSync(npm)) ctx.blocked('Installation propre', 'Lancer via npm.cmd run validate:issue-37 -- --clean-install', 'npm_execpath indisponible');
        else {
            const install = await execute(process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, timeout: 240000 });
            fs.writeFileSync(path.join(ctx.directory, 'clean-install.txt'), install.stdout + install.stderr);
            ctx.check('Installation du lockfile dans un dossier isolé', 0, install.code, install.code === 0 && !install.timedOut, relative(path.join(ctx.directory, 'clean-install.txt')));
        }
    } else ctx.blocked('Installation propre', 'npm.cmd run validate:issue-37 -- --clean-install', 'Non exécutée par défaut : télécharge les dépendances dans reports/validation/issue-37/clean-install.');
    if (!settings.securityDecision || !fs.existsSync(resolve(settings.securityDecision))) ctx.blocked('Décision sécurité', 'Chemin du compte rendu dans securityDecision', 'Aucune décision fournie ; pas de mise à jour automatique.');
    ctx.blocked('Non-régression complète après nettoyage', 'Comparer les kits et les références avant/après les retraits', 'Aucun retrait exécuté par ce kit.');
}

const handlers = { 29: scannerKit, 30: scannerKit, 31: scannerKit, 32: pythonKit, 33: ciKit, 34: realKit, 35: documentationKit, 36: isolationKit, 37: cleanupKit };

async function run(number) {
    if (number === 28) {
        const started = Date.now();
        const execution = await execute(process.execPath, [resolve('scripts/validate-issue-28.cjs')], { cwd: root, timeout: 60000 });
        const file = path.join(reportRoot, 'issue-28/recette-resultat.json');
        if (!fs.existsSync(file) || fs.statSync(file).mtimeMs < started - 1000) throw new Error('Kit #28 sans rapport actualisé : ' + execution.stderr);
        const result = read(file);
        if (execution.code !== 0 && result.status === 'PASS') throw new Error('Kit #28 interrompu malgré un ancien rapport PASS : ' + execution.stderr);
        return { ...result, issue: 28 };
    }
    const ctx = context(number);
    try { await handlers[number](ctx); }
    catch (error) { ctx.add('Exécution du kit', 'Aucune erreur inattendue', error.message, 'FAIL'); }
    return finish(ctx);
}

async function main() {
    process.chdir(root);
    if (args.slice(1).some(arg => arg !== '--clean-install')) throw new Error('Option inconnue. Seule --clean-install est disponible.');
    if (!['all', '38', 'status', '28'].includes(selected) && !handlers[Number(selected)]) throw new Error('Usage : node scripts/validate-issues.cjs all|status|28..38 [--clean-install]');
    const results = [];
    if (['all', '38', 'status'].includes(selected)) {
        for (const number of config(38).issues) {
            try {
                if (selected === 'status') {
                    const file = path.join(reportRoot, `issue-${number}/recette-resultat.json`);
                    if (!fs.existsSync(file)) {
                        const ctx = context(number);
                        ctx.blocked('Kit non exécuté', `npm.cmd run validate:issue-${number}`, 'Aucun rapport local disponible.');
                        results.push(finish(ctx));
                    } else {
                        const previous = read(file);
                        results.push({ ...previous, issue: number, date: previous.date || fs.statSync(file).mtime.toISOString(),
                            status: ['PASS', 'FAIL', 'BLOCKED'].includes(previous.status) ? previous.status : 'BLOCKED' });
                    }
                } else results.push(await run(number));
            }
            catch (error) { const ctx = context(number); ctx.add('Exécution du kit', 'Rapport disponible', error.message, 'FAIL'); results.push(finish(ctx)); }
        }
        const ctx = context(38);
        for (const result of results) ctx.add(`Issue #${result.issue}`, 'PASS sur tous les critères du ticket', result.status, result.status, `reports/validation/issue-${result.issue}/recette-resultat.md`);
        results.push(finish(ctx));
        fs.writeFileSync(path.join(reportRoot, 'index.md'), ['# Bilan des kits de validation', '',
            selected === 'status' ? 'Derniers rapports disponibles ; aucun test relancé par cette commande.' : 'Résultats de cette exécution des kits.', '',
            '| Issue | Résultat | Date UTC | Rapport |', '| --- | --- | --- | --- |', ...results.map(r => `| #${r.issue} | ${r.status} | ${r.date || 'Voir le fichier'} | [Ouvrir](issue-${r.issue}/recette-resultat.md) |`), '',
            'PASS = contrôles du kit réussis ; FAIL = écart détecté ; BLOCKED = prérequis ou validation humaine manquant.',
            'Les kits ne ferment aucune issue. Les défauts connus peuvent provoquer FAIL dès la première exécution.', '',
        ].join('\n'));
    } else results.push(await run(Number(selected)));
    process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : results.some(r => r.status === 'BLOCKED') ? 2 : 0;
    console.log('\nRapports : reports/validation/ ; code 0=PASS, 1=FAIL, 2=BLOCKED.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { context, finish };
