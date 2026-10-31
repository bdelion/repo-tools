import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const load = createRequire(__filename);
const { matchComponents } = load('../src/reports/componentHistory.cjs');
const { createVersionReports } = load('../src/reports/versionReports.cjs');
const ExcelJS = load('exceljs');
const { createGitHistoryReader } = load('../src/reports/gitHistory.cjs');
const component = (name: string, file: string, sourcefile = file, contentHash = 'hash', sourceExport = 'default') =>
    ({ id: `${file}#${name}`, name, file, sourcefile, contentHash, sourceExport });

test('historique : symbole source, déplacement Git, contenu unique et ambiguïtés', () => {
    const old = component('Old', 'old/index.js', 'source.svg');
    const renamed = component('New', 'new/index.js', 'source.svg', 'changed');
    assert.equal(matchComponents([old], [renamed], new Map()).get(old.id), renamed.id);
    const moved = component('New', 'new/index.js', 'new.svg', 'changed');
    assert.equal(matchComponents([old], [moved], new Map([['source.svg', 'new.svg']])).get(old.id), moved.id);
    assert.equal(matchComponents([old], [component('New', 'new.js')], new Map()).size, 1);
    assert.equal(matchComponents([old, component('Other', 'other.js')], [component('New', 'new.js')], new Map()).size, 0);
    assert.equal(matchComponents([old], [component('New', 'new.js', 'source.svg', 'hash', 'otherSymbol')], new Map()).size, 0);
    assert.equal(matchComponents([old], [component('Oldish', 'new.js', 'new.js', 'different')], new Map()).size, 0);
    // Un renommage du barrel ne départage pas deux symboles différents du même module.
    assert.equal(matchComponents([old], [component('Old', 'new.js', 'source.svg', 'hash', 'otherSymbol')], new Map([['old/index.js', 'new.js']])).size, 0);
});

test('migration JS vers TS : même chemin et symbole, sans rapprochement des ambiguïtés', () => {
    for (const before of ['js', 'jsx']) {
        for (const after of ['ts', 'tsx']) {
            const old = component('Button', `src/Button.${before}`, `src/Button.${before}`, 'old');
            const next = component('Button', `src/Button.${after}`, `src/Button.${after}`, 'new');
            assert.equal(matchComponents([old], [next], new Map()).get(old.id), next.id);
        }
    }
    const old = component('Button', 'src/Button.jsx', 'src/Button.jsx', 'old');
    const next = component('Button', 'src/Button.tsx', 'src/Button.tsx', 'new');
    assert.equal(matchComponents([old], [next, component('Button', 'src/Button.ts', 'src/Button.ts', 'new')], new Map()).size, 0);
    assert.equal(matchComponents([old, component('Button', 'src/Button.js', 'src/Button.js', 'old')], [next], new Map()).size, 0);
    assert.equal(matchComponents([old], [component('Button', 'other/Button.tsx', 'other/Button.tsx', 'new')], new Map()).size, 0);
    assert.equal(matchComponents([old], [component('Button', next.file, next.sourcefile, 'new', 'Other')], new Map()).size, 0);
    assert.equal(matchComponents([old], [{ ...next, sourceExport: undefined }], new Map()).size, 0);
    assert.equal(matchComponents([next], [old], new Map()).size, 0);
    const windows = { ...old, sourcefile: 'src\\Button.jsx', file: 'src\\Button.jsx' };
    assert.equal(matchComponents([windows], [next], new Map()).get(old.id), next.id);
});

test('migration JS vers TS : une ligne par export dans JSON, Markdown et Excel malgré un contenu différent', async () => {
    const oldDirect = component('Button', 'src/Button.jsx', 'src/Button.jsx', 'javascript');
    const newDirect = component('Button', 'src/Button.tsx', 'src/Button.tsx', 'typescript');
    const oldAlias = component('PublicButton', 'src/index.js', oldDirect.file, 'javascript');
    const newAlias = component('PublicButton', 'src/index.ts', newDirect.file, 'typescript');
    const stableAlias = component('StableButton', 'src/stable.js', oldDirect.file, 'javascript');
    const migratedAlias = { ...stableAlias, sourcefile: newDirect.file, contentHash: 'typescript' };
    const snapshots = [
        { reference: { kind: 'tag', label: '1.0.0', sha: 'before' }, result: { components: [oldDirect, oldAlias, stableAlias] } },
        { reference: { kind: 'tag', label: '2.0.0', sha: 'after' }, result: { components: [newDirect, newAlias, migratedAlias] } },
    ];
    const outputs = new Map<string, string | Buffer>();
    const reports = createVersionReports({
        config: { tmpDir: '.', analysisDir: 'analyses', reportsDir: 'reports', githubBaseUrl: 'https://example.org',
            preferredComponentNames: { fixture: { 'src/Button.jsx#default': 'Button', 'src/Button.tsx#default': 'Button' } } },
        logDebug: () => {}, hasGitDiff: async () => false,
        collectJson: (target: typeof outputs, file: string, value: unknown) => target.set(path.resolve(file), JSON.stringify(value)),
        createHistoryReader: () => ({ files: async (sha: string) => new Set(snapshots[sha === 'before' ? 0 : 1].result.components
            .flatMap(item => [item.file, item.sourcefile])), renames: async () => new Map() }),
    });
    await reports.generateReports('fixture', snapshots[0], snapshots[1], outputs, snapshots);
    await reports.generateComponentComparisonReports('fixture', snapshots, outputs);
    const json = JSON.parse([...outputs.entries()].find(([file]) => file.endsWith('.json'))![1].toString());
    assert.equal(json.added.length, 0);
    assert.equal(json.removed.length, 0);
    assert.equal(json.changed.length, 1);
    assert.equal(json.changed[0].exports.length, 3);
    for (const changed of json.changed) {
        assert.ok(changed.changeReasons.includes('typescriptMigration'));
        assert.ok(changed.changeReasons.includes('diffContentHash'));
        assert.ok(changed.changeReasons.includes('sourceMoved'));
    }
    assert.equal(json.changed[0].historyMatch, 'typescriptMigration');
    assert.equal(json.changed[0].previous.sourcefile, oldDirect.file);
    const markdown = outputs.get(path.resolve('reports/fixture_component_comparison.md'))!.toString();
    assert.match(markdown, /typescriptMigration/);
    assert.equal((markdown.match(/\|Button\|/g) ?? []).length, 1);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(outputs.get(path.resolve('reports/fixture_component_comparison.xlsx')));
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.rowCount, 2);
    assert.equal(sheet.getCell('A2').value, 'Button');
    assert.match(sheet.getCell('J2').value, /^~\n.*typescriptMigration/s);
    assert.equal(sheet.getCell('J2').value.split('typescriptMigration').length - 1, 1);
    assert.match(sheet.getCell('F2').value.hyperlink, /blob\/2.0.0\/src\/Button.tsx/);
});

test('une source R100 exportée directement et par un barrel conserve les deux historiques', async () => {
    const oldSource = 'src/utils/phones/type.js';
    const newSource = 'src/contacts/phones/type.js';
    const oldAlias = component('PersonnePhysiquePhoneType', 'src/components/functionalFragments/personnePhysiqueFragment/index.js', oldSource, 'same', 'Type');
    const newAlias = component('PersonnePhysiquePhoneType', 'src/functionalContextFrames/personnePhysiqueFragment/index.js', newSource, 'same', 'Type');
    const oldDirect = component('Type', oldSource, oldSource, 'same', 'Type');
    const newDirect = component('Type', newSource, newSource, 'same', 'Type');
    const renames = new Map([[oldSource, newSource]]);
    for (const previous of [[oldAlias, oldDirect], [oldDirect, oldAlias]]) {
        for (const current of [[newAlias, newDirect], [newDirect, newAlias]]) {
            const matches = matchComponents(previous, current, renames);
            assert.equal(matches.size, 2);
            assert.equal(matches.get(oldAlias.id), newAlias.id);
            assert.equal(matches.get(oldDirect.id), newDirect.id);
        }
    }
    // Le déplacement de l'export direct ancre aussi le rapprochement si l'alias change.
    const renamedAlias = component('PhoneType', newAlias.file, newSource, 'same', 'Type');
    const matches = matchComponents([oldAlias, oldDirect], [renamedAlias, newDirect], renames);
    assert.equal(matches.get(oldAlias.id), renamedAlias.id);
    assert.equal(matches.get(oldDirect.id), newDirect.id);
    // Deux alias renommés sans autre indice restent réellement ambigus.
    assert.equal(matchComponents([
        oldAlias, component('OtherAlias', 'other/old.js', oldSource, 'same', 'Type'),
    ], [renamedAlias, component('AnotherAlias', 'other/new.js', newSource, 'same', 'Type')], renames).size, 0);
    const snapshots = [
        { reference: { kind: 'tag', label: '0.2.0', sha: 'before' }, result: { components: [oldDirect, oldAlias] } },
        { reference: { kind: 'tag', label: '0.3.0', sha: 'after' }, result: { components: [newDirect, newAlias] } },
    ];
    const outputs = new Map<string, string | Buffer>();
    const reports = createVersionReports({
        config: { tmpDir: '.', analysisDir: 'analyses', reportsDir: 'reports', githubBaseUrl: 'https://example.org' },
        logDebug: () => {}, hasGitDiff: async () => false,
        collectJson: (target: typeof outputs, file: string, value: unknown) => target.set(path.resolve(file), JSON.stringify(value)),
        createHistoryReader: () => ({ files: async (sha: string) => new Set(sha === 'before'
            ? [oldSource, oldAlias.file] : [newSource, newAlias.file]), renames: async () => renames }),
    });
    await reports.generateReports('fixture', snapshots[0], snapshots[1], outputs, snapshots);
    await reports.generateComponentComparisonReports('fixture', snapshots, outputs);
    const json = JSON.parse([...outputs.entries()].find(([file]) => file.endsWith('.json'))![1].toString());
    assert.equal(json.added.length, 0);
    assert.equal(json.removed.length, 0);
    assert.deepEqual(json.changed.map((item: {name: string}) => item.name), ['PersonnePhysiquePhoneType']);
    assert.deepEqual(json.changed[0].publicNames, ['PersonnePhysiquePhoneType', 'Type']);
    assert.ok(json.changed.every((item: {historyMatch: string}) => item.historyMatch === 'gitSourceRename'));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(outputs.get(path.resolve('reports/fixture_component_comparison.xlsx')));
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.rowCount, 2);
    assert.equal(sheet.getCell('A2').value, 'PersonnePhysiquePhoneType');
    assert.equal(sheet.getCell('G2').value, 'Type');
    assert.match(sheet.getCell('J2').value, /^~\n/);
});

test('rapports : tri naturel visible, historique unique, liens nommés et repli indépendant sur les tags', async () => {
    const old = component('OldIcon', 'old/index.js', 'old/icon.svg');
    const renamed = component('NewIcon', 'new/index.js', 'new/icon.svg', 'changed');
    const two = component('Component2', 'z/index.js', 'z/source with space.svg', 'two');
    const ten = component('Component10', 'a/index.js', 'a/source.svg', 'ten');
    const homonym = component('Component2', 'other/index.js', 'other/source.svg', 'other');
    const reference = (kind: string, label: string, sha: string, branch?: string) => ({ kind, label, sha, branch });
    const snapshots = [
        { reference: reference('tag', '1.0.0', 'sha1'), result: { components: [old, ten, two, homonym] } },
        { reference: reference('tag', '1.1.0', 'sha2'), result: { components: [renamed, ten, two, homonym] } },
        { reference: reference('develop', '1.2.0 (develop)', 'sha3', 'develop'), result: { components: [ten, two, homonym] } },
    ];
    const trees = new Map([
        ['sha1', new Set([old.file, old.sourcefile, two.file, two.sourcefile, ten.file, ten.sourcefile, homonym.file, homonym.sourcefile])],
        ['sha2', new Set([renamed.file, renamed.sourcefile, two.file, two.sourcefile, ten.file, ten.sourcefile, homonym.file, homonym.sourcefile])],
        // Le barrel reste présent après suppression de son export, mais pas l'asset.
        ['sha3', new Set([renamed.file, two.file, two.sourcefile, ten.file, ten.sourcefile, homonym.file, homonym.sourcefile])],
    ]);
    const outputs = new Map<string, string | Buffer>();
    const reports = createVersionReports({
        config: { tmpDir: '.', analysisDir: 'analyses', reportsDir: 'reports', githubBaseUrl: 'https://github.example/org' },
        logDebug: () => {}, hasGitDiff: async () => false,
        collectJson: (target: typeof outputs, file: string, value: unknown) => target.set(path.resolve(file), JSON.stringify(value)),
        createHistoryReader: () => ({ files: async (sha: string) => trees.get(sha),
            renames: async (from: string) => from === 'sha1' ? new Map([['old/icon.svg', 'new/icon.svg']]) : new Map() }),
    });
    await reports.generateReports('fixture', snapshots[0], snapshots[1], outputs, snapshots);
    await reports.generateComponentComparisonReports('fixture', snapshots, outputs);
    const json = JSON.parse([...outputs.entries()].find(([file]) => file.endsWith('.json'))![1].toString());
    assert.equal(json.added.length, 0);
    assert.equal(json.removed.length, 0);
    assert.equal(json.changed.length, 1);
    assert.equal(json.changed[0].previous.name, 'OldIcon');
    assert.equal(json.changed[0].historyMatch, 'gitSourceRename');
    const markdown = outputs.get(path.resolve('reports/fixture_component_comparison.md'))!.toString();
    assert.ok(markdown.indexOf('|Component2') < markdown.indexOf('|Component10'));
    assert.match(markdown, /nameChanged: OldIcon -> NewIcon/);
    assert.match(markdown, /blob\/develop\/new\/index.js/);
    assert.match(markdown, /blob\/1.1.0\/new\/icon.svg/);
    assert.match(markdown, /blob\/develop\/z\/source%20with%20space.svg/);
    assert.doesNotMatch(markdown, /blob\/sha[123]\//);
    const pair = [...outputs.entries()].find(([file]) => file.endsWith('.md') && !file.includes('component_comparison'))![1].toString();
    assert.match(pair, /blob\/1.1.0\/new\/index.js/);
    assert.match(pair, /blob\/1.1.0\/new\/icon.svg/);
    assert.doesNotMatch(pair, /blob\/(develop|1.0.0|sha[123])\//);
    assert.match(pair, /gitSourceRename/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(outputs.get(path.resolve('reports/fixture_component_comparison.xlsx')));
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.rowCount, 5); // Deux homonymes distincts et une seule ligne pour Old/NewIcon.
    assert.match(sheet.getCell('A2').value, /^Component2/);
    assert.match(sheet.getCell('A3').value, /^Component2/);
    assert.equal(sheet.getCell('A4').value, 'Component10');
    assert.equal(sheet.getCell('A5').value, 'NewIcon');
    assert.match(sheet.getCell('E5').value.hyperlink, /blob\/develop\/new\/index.js/);
    assert.match(sheet.getCell('F5').value.hyperlink, /blob\/1.1.0\/new\/icon.svg/);
});

test('comparaison pair-à-pair : liens exclusivement vers la cible, chemins historiques et fichiers supprimés (#10)', async () => {
    for (const target of [
        { kind: 'tag', label: '2.0.0', sha: 'target' },
        { kind: 'release', label: '2.0.0 (release candidate)', branch: 'release/2.0.0', sha: 'target' },
    ]) {
        const removed = component('Removed', 'removed.js', 'removed.js', 'removed');
        const unexported = component('Unexported', 'retained.js', 'retained.js', 'retained');
        const before = component('Moved', 'before.js', 'before.js', 'moved');
        const middle = component('Moved', 'middle.js', 'middle.js', 'moved');
        const later = component('Moved', 'future.js', 'future.js', 'moved');
        const added = component('Added', 'added.js', 'added.js', 'added');
        const unchanged = component('Unchanged', 'unchanged.js', 'unchanged.js', 'unchanged');
        const snapshots = [
            { reference: { kind: 'tag', label: '1.0.0', sha: 'old' }, result: { components: [removed, unexported, before, unchanged] } },
            { reference: target, result: { components: [middle, added, unchanged] } },
            { reference: { kind: 'develop', label: '3.0.0 (develop)', branch: 'develop', sha: 'future' }, result: { components: [later, added, unchanged] } },
        ];
        const outputs = new Map<string, string | Buffer>();
        const reports = createVersionReports({
            config: { tmpDir: '.', analysisDir: 'analyses', reportsDir: 'reports', githubBaseUrl: 'https://example.org' },
            logDebug: () => {}, hasGitDiff: async () => false,
            collectJson: (map: typeof outputs, file: string, value: unknown) => map.set(path.resolve(file), JSON.stringify(value)),
            createHistoryReader: () => ({ files: async (sha: string) => new Set(snapshots.find(snapshot => snapshot.reference.sha === sha)!.result.components
                .map(item => item.file).concat(sha === 'target' ? ['retained.js'] : [])),
            renames: async (sha: string) => new Map(sha === 'old' ? [['before.js', 'middle.js']] : [['middle.js', 'future.js']]) }),
        });
        await reports.generateReports('fixture', snapshots[0], snapshots[1], outputs, snapshots);
        const markdown = [...outputs.entries()].find(([file]) => file.endsWith('.md'))![1].toString();
        const reference = encodeURIComponent(target.branch ?? target.label);
        const links = [...markdown.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]);
        assert.equal(links.length, 8); // Added, Moved, Unchanged et Unexported : export + source.
        assert.ok(links.every(link => link.includes(`/blob/${reference}/`)));
        assert.ok(links.some(link => link.endsWith('/middle.js')));
        assert.ok(links.some(link => link.endsWith('/retained.js')));
        assert.ok(links.every(link => !/\/(before|future|removed)\.js$/.test(link)));
        assert.match(markdown, /\|Removed\|[^\n]*\|removed.js\|removed.js\|/);
    }
});

test('Git réel : source R100, ancien barrel supprimé, nouveau barrel ajouté et liens Markdown/Excel', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-history-'));
    const directory = path.join(root, 'fixture');
    fs.mkdirSync(directory);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty.gitconfig') } }).trim();
    const commit = (message: string) => {
        git('add', '.');
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', message);
        return git('rev-parse', 'HEAD');
    };
    try {
        fs.writeFileSync(path.join(root, 'empty.gitconfig'), '');
        git('init', '--initial-branch=develop');
        fs.writeFileSync(path.join(directory, 'old icon.svg'), '<svg><path d="M0 0"/></svg>');
        fs.writeFileSync(path.join(directory, 'old-index.js'), "// ancient barrel\n".repeat(20) + "export { default as Old } from './old icon.svg';\n");
        const first = commit('first');
        git('tag', '1.0.0');
        git('mv', 'old icon.svg', 'new icon.svg');
        git('rm', 'old-index.js');
        fs.writeFileSync(path.join(directory, 'new-index.js'), "// completely new exports\n".repeat(20) + "export { default as New } from './new icon.svg';\n");
        const second = commit('rename');
        git('tag', '1.1.0');
        git('rm', 'new icon.svg');
        fs.writeFileSync(path.join(directory, 'new-index.js'), '// removed export\n');
        const third = commit('remove');
        const reader = createGitHistoryReader(directory);
        assert.equal((await reader.renames(first, second)).get('old icon.svg'), 'new icon.svg');
        assert.equal((await reader.renames(first, second)).has('old-index.js'), false);
        const diff = git('diff', '--name-status', '--find-renames=50%', first, second);
        assert.match(diff, /R100\s+old icon.svg\s+new icon.svg/);
        assert.match(diff, /D\s+old-index.js/);
        assert.match(diff, /A\s+new-index.js/);
        assert.ok((await reader.files(first)).has('old icon.svg'));
        assert.equal((await reader.files(third)).has('new icon.svg'), false);
        const snapshots = [
            { reference: { kind: 'tag', label: '1.0.0', sha: first }, result: { components: [component('Old', 'old-index.js', 'old icon.svg')] } },
            { reference: { kind: 'tag', label: '1.1.0', sha: second }, result: { components: [component('New', 'new-index.js', 'new icon.svg')] } },
            { reference: { kind: 'develop', label: '1.2.0 (develop)', sha: third, branch: 'develop' }, result: { components: [] } },
        ];
        const outputs = new Map<string, string | Buffer>();
        const reports = createVersionReports({ config: { tmpDir: root, reportsDir: root, analysisDir: root, githubBaseUrl: 'https://example.org' },
            hasGitDiff: async () => false, logDebug: () => {},
            collectJson: (target: typeof outputs, file: string, value: unknown) => target.set(path.resolve(file), JSON.stringify(value)) });
        await reports.generateReports('fixture', snapshots[0], snapshots[1], outputs, snapshots);
        const comparison = JSON.parse([...outputs.entries()].find(([file]) => file.endsWith('.json'))![1].toString());
        assert.equal(comparison.added.length, 0);
        assert.equal(comparison.removed.length, 0);
        assert.equal(comparison.changed.length, 1);
        assert.equal(comparison.changed[0].historyMatch, 'gitSourceRename');
        assert.ok(comparison.changed[0].changeReasons.includes('exportMoved'));
        assert.ok(comparison.changed[0].changeReasons.includes('sourceMoved'));
        await reports.generateComponentComparisonReports('fixture', snapshots, outputs);
        const markdown = outputs.get(path.join(root, 'fixture_component_comparison.md'))!.toString();
        assert.match(markdown, /gitSourceRename/);
        assert.match(markdown, /blob\/1.1.0\/new%20icon.svg/);
        assert.match(markdown, /blob\/develop\/new-index.js/);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(outputs.get(path.join(root, 'fixture_component_comparison.xlsx')));
        assert.equal(workbook.worksheets[0].rowCount, 2);
        assert.match(workbook.worksheets[0].getCell('F2').value.hyperlink, /blob\/1.1.0\/new%20icon.svg/);
    } finally {
        const resolved = path.resolve(root);
        assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(resolved, { recursive: true, force: true });
    }
});
