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
    assert.match(pair, /blob\/develop\//);
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

test('Git réel : renommage avec espaces, fichiers supprimés et liens Markdown/Excel', async () => {
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
        fs.writeFileSync(path.join(directory, 'index.js'), "export { default as Old } from './old icon.svg';\n");
        const first = commit('first');
        git('tag', '1.0.0');
        git('mv', 'old icon.svg', 'new icon.svg');
        fs.writeFileSync(path.join(directory, 'index.js'), "export { default as New } from './new icon.svg';\n");
        const second = commit('rename');
        git('tag', '1.1.0');
        git('rm', 'new icon.svg');
        fs.writeFileSync(path.join(directory, 'index.js'), '// removed export\n');
        const third = commit('remove');
        const reader = createGitHistoryReader(directory);
        assert.equal((await reader.renames(first, second)).get('old icon.svg'), 'new icon.svg');
        assert.ok((await reader.files(first)).has('old icon.svg'));
        assert.equal((await reader.files(third)).has('new icon.svg'), false);
        const snapshots = [
            { reference: { kind: 'tag', label: '1.0.0', sha: first }, result: { components: [component('Old', 'index.js', 'old icon.svg')] } },
            { reference: { kind: 'tag', label: '1.1.0', sha: second }, result: { components: [component('New', 'index.js', 'new icon.svg')] } },
            { reference: { kind: 'develop', label: '1.2.0 (develop)', sha: third, branch: 'develop' }, result: { components: [] } },
        ];
        const outputs = new Map<string, string | Buffer>();
        const reports = createVersionReports({ config: { tmpDir: root, reportsDir: root, analysisDir: root, githubBaseUrl: 'https://example.org' },
            hasGitDiff: async () => false, logDebug: () => {},
            collectJson: (target: typeof outputs, file: string, value: unknown) => target.set(path.resolve(file), JSON.stringify(value)) });
        await reports.generateReports('fixture', snapshots[0], snapshots[1], outputs, snapshots);
        await reports.generateComponentComparisonReports('fixture', snapshots, outputs);
        const markdown = outputs.get(path.join(root, 'fixture_component_comparison.md'))!.toString();
        assert.match(markdown, /gitSourceRename/);
        assert.match(markdown, /blob\/1.1.0\/new%20icon.svg/);
        assert.match(markdown, /blob\/develop\/index.js/);
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
