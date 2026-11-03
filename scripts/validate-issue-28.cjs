const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
require('ts-node/register');
const { runLibraryGeneration, runLibrarySelection } = require('../src/commands/library-generate');
const { TgfParser } = require('../src/graph/parsers/TgfParser');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'reports/validation/issue-28');
const checks = [];
const read = name => JSON.parse(fs.readFileSync(path.join(output, name), 'utf8'));
const verify = (description, run) => {
    run();
    checks.push({ description, status: 'PASS' });
    console.log(`PASS : ${description}`);
};
const names = nodes => nodes.map(node => node.name);
const report = (status, error) => {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'recette-resultat.json'), JSON.stringify({
        status, scope: 'Bibliothèque témoin uniquement ; ne valide pas une bibliothèque réelle ni les issues #29 à #37.',
        checks, ...(error ? { error } : {}),
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'recette-resultat.md'), [
        '# Résultat de la démonstration — issue #28', '', `**Résultat : ${status}**`, '',
        'Cette démonstration ne valide pas votre bibliothèque réelle et ne clôture pas l’issue #28.', '',
        '| Contrôle | Résultat |', '| --- | --- |',
        ...checks.map(check => `| ${check.description} | ${check.status} |`),
        ...(error ? ['', `Échec : ${error}`] : []), '',
        'Pour le contrôle visuel, suivre docs/recette/issue-28.md et ouvrir les catalogues dans ce dossier.', '',
    ].join('\n'));
};

async function main() {
    process.chdir(root);
    report('EN COURS');
    for (const view of ['public-ui', 'public-api', 'dependencies']) {
        console.log(`\nGénération : ${view}`);
        await runLibraryGeneration(['--config', `config/validation/issue-28/${view}.json`]);
    }
    verify('UI publique : exactement Button2, Button10, Panel dans cet ordre', () => {
        assert.deepEqual(names(read('public-ui.catalog.json').nodes), ['Button2', 'Button10', 'Panel']);
    });
    verify('API publique : 6 définitions, dont hook, fonction et type ; aucun helper privé', () => {
        assert.deepEqual(names(read('public-api.catalog.json').nodes), ['Button2', 'Button10', 'formatDate', 'Panel', 'PublicOptions', 'useTheme']);
    });
    verify('PrimaryButton est un alias de Button2, sans nouvelle définition', () => {
        const nodes = read('public-api.catalog.json').nodes;
        assert.deepEqual(nodes.find(node => node.name === 'Button2').publicNames, ['Button2', 'PrimaryButton']);
        assert.equal(nodes.filter(node => node.publicNames.includes('PrimaryButton')).length, 1);
    });
    verify('Dépendances : 8 définitions, avec internalHelper et React', () => {
        assert.deepEqual(names(read('dependencies.catalog.json').nodes), ['Button2', 'Button10', 'formatDate', 'internalHelper', 'Panel', 'PublicOptions', 'react', 'useTheme']);
    });
    verify('TGF UI : noms triés naturellement et arcs Panel vers Button2 puis Button10', () => {
        const text = fs.readFileSync(path.join(output, 'public-ui.tgf'), 'utf8').trim();
        const [nodeLines, edgeLines] = text.split('\n#\n');
        assert.deepEqual(nodeLines.split('\n').map(line => line.split(' ')[1]), ['Button2', 'Button10', 'Panel']);
        const graph = new TgfParser().parse(text);
        assert.deepEqual(edgeLines.split('\n').map(line => line.split(' ').map(id => graph.getLabel(id).split(' ')[0])), [['Panel', 'Button2'], ['Panel', 'Button10']]);
    });
    await runLibrarySelection([path.join(output, 'public-ui.analysis.json'), 'Panel', '--output', path.join(output, 'prerequis-Panel.json')], 'required');
    await runLibrarySelection([path.join(output, 'public-ui.analysis.json'), 'formatDate', '--output', path.join(output, 'impact-formatDate.json')], 'impact');
    verify('Prérequis de Panel : 6 éléments uniques, dont le helper et le type internes au graphe UI', () => {
        assert.deepEqual(names(read('prerequis-Panel.json').components), ['Button2', 'Button10', 'formatDate', 'internalHelper', 'Panel', 'PublicOptions']);
    });
    verify('Impact de formatDate : formatDate, internalHelper, Button2 et Panel uniquement', () => {
        assert.deepEqual(names(read('impact-formatDate.json').components), ['Button2', 'formatDate', 'internalHelper', 'Panel']);
    });
    verify('Ordre de traitement : feuilles avant helper, Button2, puis Panel ; aucun cycle', () => {
        const plan = read('public-ui.plan.json');
        const analysis = read('public-ui.analysis.json');
        const byId = new Map(analysis.analysis.nodes.map(node => [node.id, node.name]));
        assert.deepEqual(plan.levels.map(level => ({ level: level.level, components: level.components.map(id => byId.get(id)) })), [
            { level: 0, components: ['Button10', 'formatDate', 'PublicOptions', 'useTheme'] },
            { level: 1, components: ['internalHelper'] },
            { level: 2, components: ['Button2'] },
            { level: 3, components: ['Panel'] },
        ]);
        assert.deepEqual(plan.cyclicGroups, []);
    });
    report('PASS');
    console.log(`\nDémonstration réussie : ${checks.length} contrôles. Ouvrir reports/validation/issue-28/recette-resultat.md`);
}

main().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    report('FAIL', message);
    console.error(message);
    process.exitCode = 1;
});
