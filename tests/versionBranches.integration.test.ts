import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('cycle Git complet : develop, release, hotfix, nouveaux commits, suppressions et publication', { timeout: 120000 }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-branches-'));
    const source = path.join(root, 'source');
    const analyses = path.join(root, 'analyses');
    const reports = path.join(root, 'reports');
    const script = path.resolve(__dirname, '../src/analyse-component-versions.js');
    const git = (...args: string[]) => execFileSync('git', args, {
        cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty.gitconfig') },
    }).trim();
    const commitVersion = (version: string, content = version) => {
        fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'fixture', version }));
        fs.writeFileSync(path.join(source, 'src/Widget.js'), `export default function Widget() { return '${content}'; }\n`);
        git('add', '.');
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', `Version ${content}`);
    };
    const run = () => spawnSync(process.execPath, [script, `--config=${path.join(root, 'config.json')}`], {
        cwd: root, encoding: 'utf8', timeout: 25000,
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty.gitconfig') },
    });
    const success = () => {
        const result = run();
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${String(result.error)}`);
        return JSON.parse(fs.readFileSync(path.join(reports, 'fixture_summary.json'), 'utf8')).tags;
    };
    try {
        fs.mkdirSync(path.join(source, 'src'), { recursive: true });
        fs.writeFileSync(path.join(root, 'empty.gitconfig'), '');
        git('init', '--initial-branch=main');
        fs.writeFileSync(path.join(source, 'src/index.js'), "export { default as Widget } from './Widget';\n");
        commitVersion('1.0.0');
        git('tag', '1.0.0');
        git('switch', '-c', 'develop');
        commitVersion('1.8.0');
        git('switch', '-c', 'hotfix/1.0.1', 'main');
        commitVersion('1.0.1');
        git('switch', 'main');
        fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
            repos: [{ name: 'fixture', url: source }],
            tmpDir: path.join(root, 'clones'), analysisDir: analyses, reportsDir: reports,
            shaIndexPath: path.join(analyses, 'sha_index.json'),
            gitDiffCachePath: path.join(analyses, 'git_diff_cache.json'),
        }));
        let tags = success();
        assert.deepEqual(tags.map((item: {tag: string}) => item.tag), [
            '1.0.0', '1.0.1 (hotfix candidate)', '1.8.0 (develop)',
        ]);
        const obsolete = 'fixture_1.8.0__develop_.json';
        assert.ok(fs.existsSync(path.join(analyses, obsolete)));
        // Ancien format des comparaisons, et fichiers tiers à préserver.
        fs.writeFileSync(path.join(analyses, 'fixture_1.0.0_to_1.8.0 (develop)_rapport.md'), 'old');
        fs.writeFileSync(path.join(analyses, 'other_1.8.0__develop_.json'), 'keep');
        fs.writeFileSync(path.join(analyses, 'fixture_notes.md'), 'keep');

        git('switch', '-c', 'release/1.8.0', 'develop');
        git('switch', 'develop');
        commitVersion('1.9.0');
        tags = success();
        assert.deepEqual(tags.map((item: {tag: string}) => item.tag), [
            '1.0.0', '1.0.1 (hotfix candidate)', '1.8.0 (release candidate)', '1.9.0 (develop)',
        ]);
        assert.equal(fs.existsSync(path.join(analyses, obsolete)), false);
        assert.equal(fs.existsSync(path.join(analyses, 'fixture_1.0.0_to_1.8.0 (develop)_rapport.md')), false);
        assert.equal(fs.readFileSync(path.join(analyses, 'fixture_notes.md'), 'utf8'), 'keep');
        assert.equal(fs.readFileSync(path.join(analyses, 'other_1.8.0__develop_.json'), 'utf8'), 'keep');

        const releaseFile = path.join(analyses, 'fixture_1.8.0__release_candidate_.json');
        const before = JSON.parse(fs.readFileSync(releaseFile, 'utf8'));
        git('switch', 'release/1.8.0');
        commitVersion('1.8.0', 'changed candidate');
        success();
        const after = JSON.parse(fs.readFileSync(releaseFile, 'utf8'));
        assert.notEqual(after.sha, before.sha);
        assert.notEqual(after.components[0].contentHash, before.components[0].contentHash);
        const markdown = fs.readFileSync(path.join(reports, 'fixture_component_comparison.md'), 'utf8');
        assert.ok(markdown.includes('/blob/'));
        assert.equal(markdown.includes('/blob/1.9.0 (develop)/'), false);
        const index = JSON.parse(fs.readFileSync(path.join(analyses, 'sha_index.json'), 'utf8'));
        assert.equal(Object.keys(index).some(key => key.endsWith(before.sha)), false);

        git('switch', 'main');
        git('branch', '-D', 'release/1.8.0', 'hotfix/1.0.1');
        tags = success();
        assert.deepEqual(tags.map((item: {tag: string}) => item.tag), ['1.0.0', '1.9.0 (develop)']);
        assert.equal(fs.existsSync(releaseFile), false);
        assert.equal(fs.readdirSync(analyses).some(file => /candidate/.test(file)), false);
        git('tag', '1.9.0', 'develop');
        tags = success();
        assert.deepEqual(tags.map((item: {tag: string}) => item.tag), ['1.0.0', '1.9.0']);
        assert.equal(fs.existsSync(path.join(analyses, 'fixture_1.9.0__develop_.json')), false);

        const summaryBefore = fs.readFileSync(path.join(reports, 'fixture_summary.json'), 'utf8');
        git('switch', '-c', 'release/1.10.0', 'develop');
        commitVersion('1.11.0');
        const mismatch = run();
        assert.equal(mismatch.status, 1);
        assert.match(mismatch.stderr, /Version incohérente.*release\/1\.10\.0.*1\.11\.0/);
        assert.equal(fs.readFileSync(path.join(reports, 'fixture_summary.json'), 'utf8'), summaryBefore);

        // Sans tag ni develop, une branche hotfix suffit à produire les rapports.
        git('switch', 'main');
        git('branch', '-D', 'release/1.10.0', 'develop');
        git('tag', '-d', '1.0.0', '1.9.0');
        git('switch', '-c', 'hotfix/2.0.1');
        commitVersion('2.0.1');
        git('switch', 'main');
        // Nouveau clone : les tags supprimés ne sont pas purgés par fetch --prune.
        const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
        config.tmpDir = path.join(root, 'fresh-clones');
        fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config));
        tags = success();
        assert.deepEqual(tags.map((item: {tag: string}) => item.tag), ['2.0.1 (hotfix candidate)']);
    } finally {
        // Seul le répertoire temporaire créé par ce test peut être supprimé.
        const temporaryBase = path.resolve(os.tmpdir()) + path.sep;
        assert.ok(path.resolve(root).startsWith(temporaryBase));
        assert.ok(path.basename(root).startsWith('repo-tools-branches-'));
        fs.rmSync(root, { recursive: true, force: true });
    }
});
