import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const { proposeHistoryMappings, mergeProposals, proposalMarkdown } = createRequire(__filename)('../src/reports/historyMappingProposals.cjs');
const component = (file: string, hash = file, name = 'Button', sourceExport = 'default') => ({ name, sourcefile: file, sourceExport, contentHash: hash });
const comparison = (repository = 'one', removed = [component('old.js')], added = [component('new.tsx')]) =>
    ({ repository, from: '1.0.0', to: '2.0.0 (develop)', removed, added });
const config = { repos: [{ name: 'one' }, { name: 'two' }, { name: 'missing' }], analysisDir: 'analyses', reportsDir: 'reports', debug: true };

test('propositions : dépôts séparés, versions candidates, marqueurs, indices et absences de rapports', () => {
    const result = proposeHistoryMappings([comparison(), comparison('two')], config);
    assert.equal(result.componentHistoryMappings.one.length, 1);
    assert.equal(result.componentHistoryMappings.two.length, 1);
    assert.equal(result.componentHistoryMappings.one[0].to.version, '2.0.0');
    assert.equal(result.componentHistoryMappings.one[0].reviewRequired, true);
    assert.ok(result.candidates[0].reasons.includes('samePublicName'));
    assert.equal(result.candidates[0].status, 'proposed');
    assert.deepEqual(result.repositoriesWithoutComparisons, ['missing']);
    assert.match(proposalMarkdown('missing', result), /Aucune comparaison disponible/);
    assert.equal(proposeHistoryMappings([comparison(), comparison('two')], config, 'one').candidates.length, 1);
    assert.throws(() => proposeHistoryMappings([], config, 'unknown'), /absent/);
});

test('propositions : ambiguïtés exclues, default seul insuffisant et identités manquantes signalées', () => {
    const result = proposeHistoryMappings([comparison('one', [component('old.js')], [component('left.ts'), component('right.ts')])], config);
    assert.equal(result.candidates.length, 2);
    assert.ok(result.candidates.every((item: {status: string}) => item.status === 'ambiguous'));
    assert.equal(result.componentHistoryMappings.one.length, 0);
    assert.equal(proposeHistoryMappings([comparison('one', [component('old.js', 'a', 'Old')], [component('new.js', 'b', 'New')])], config).candidates.length, 0);
    const incomplete = { ...comparison(), removed: [{ name: 'Button' }] };
    assert.equal(proposeHistoryMappings([incomplete], config).diagnostics[0].reason, 'missingSourceIdentity');
});

test('fusion : idempotence, conservation des règles validées et rejet des conflits avant écriture', () => {
    assert.deepEqual(mergeProposals(config, { componentHistoryMappings: { one: [] } }), config);
    const result = proposeHistoryMappings([comparison()], config);
    const merged = mergeProposals(config, result);
    assert.equal(merged.debug, true);
    assert.equal(merged.componentHistoryMappings.one[0].reviewRequired, true);
    assert.deepEqual(mergeProposals(merged, result), merged);
    const confirmed = { ...merged, componentHistoryMappings: { one: [{ ...merged.componentHistoryMappings.one[0], reviewRequired: false }] } };
    assert.equal(mergeProposals(confirmed, result).componentHistoryMappings.one[0].reviewRequired, false);
    assert.equal(proposeHistoryMappings([comparison()], confirmed).candidates.length, 0);
    const conflicting = structuredClone(result);
    conflicting.componentHistoryMappings.one[0].to.sourcefile = 'other.js';
    assert.throws(() => mergeProposals(merged, conflicting), /incompatibles/);
    assert.throws(() => mergeProposals(config, { componentHistoryMappings: { unknown: result.componentHistoryMappings.one } }), /absent/);
    assert.throws(() => mergeProposals(config, { componentHistoryMappings: { one: [{}] } }), /invalide/);
    assert.equal('componentHistoryMappings' in config, false);
});

test('CLI : génération sans modification, application sauvegardée et idempotente, conflit sans écriture', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-proposals-'));
    try {
        const analyses = path.join(root, 'analyses');
        const reports = path.join(root, 'reports');
        fs.mkdirSync(analyses);
        const configFile = path.join(root, 'config.json');
        const original = JSON.stringify({ ...config, analysisDir: analyses, reportsDir: reports });
        fs.writeFileSync(configFile, original);
        fs.writeFileSync(path.join(analyses, 'one_rapport.json'), JSON.stringify(comparison()));
        const cli = path.resolve(__dirname, '../src/commands/component-history-mappings.cjs');
        const run = (...args: string[]) => spawnSync(process.execPath, [cli, '--config', configFile, ...args], { encoding: 'utf8' });
        const generation = run();
        assert.equal(generation.status, 0, generation.stderr);
        assert.equal(fs.readFileSync(configFile, 'utf8'), original);
        const proposedFile = path.join(reports, 'component-history-mappings/one.proposed.json');
        assert.ok(fs.existsSync(proposedFile));
        const emptyFile = path.join(reports, 'empty.json');
        fs.writeFileSync(emptyFile, JSON.stringify({ componentHistoryMappings: { one: [] } }));
        assert.equal(run('--apply', emptyFile).status, 0);
        assert.equal(fs.readFileSync(configFile, 'utf8'), original);
        assert.equal(fs.readdirSync(root).filter(file => file.includes('history-backup')).length, 0);
        const application = run('--apply', proposedFile);
        assert.equal(application.status, 0, application.stderr);
        assert.equal(fs.readdirSync(root).filter(file => file.includes('history-backup')).length, 1);
        const applied = fs.readFileSync(configFile, 'utf8');
        assert.equal(JSON.parse(applied).componentHistoryMappings.one[0].reviewRequired, true);
        assert.equal(run('--apply', proposedFile).status, 0);
        assert.equal(fs.readdirSync(root).filter(file => file.includes('history-backup')).length, 1);
        const conflicting = JSON.parse(fs.readFileSync(proposedFile, 'utf8'));
        conflicting.componentHistoryMappings.one[0].to.sourcefile = 'different.js';
        fs.writeFileSync(proposedFile, JSON.stringify(conflicting));
        assert.equal(run('--apply', proposedFile).status, 1);
        assert.equal(fs.readFileSync(configFile, 'utf8'), applied);
        assert.equal(run('--unknown').status, 1);
    } finally {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(root, { recursive: true, force: true });
    }
});
