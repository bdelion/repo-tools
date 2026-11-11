import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { execute, scanScenario } = createRequire(__filename)('../scripts/validation/scanner.cjs');
const { context, finish } = createRequire(__filename)('../scripts/validate-issues.cjs');

test('le kit scanner appelle le vrai script sur une API locale et relit Excel', { timeout: 40000 }, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-validation-'));
    try {
        const result = await scanScenario(directory, { branch: 'release-test' });
        assert.equal(result.code, 0, result.stderr);
        assert.deepEqual(result.unexpected, []);
        assert.equal(result.dependencies.length, 1);
        assert.equal(result.dependencies[0].resolved_version, '19.0.0');
        assert.equal(result.dependencies[0].default_branch, 'release-test');
        assert.equal(result.excel[0].resolved_version, '19.0.0');
        assert.ok(result.calls.some((call: { path: string }) => call.path.endsWith('/branches/release-test')));
        // A rerun must never use the preceding successful JSON or workbook as evidence.
        const rerun = await scanScenario(directory, { repositories: [] });
        assert.equal(rerun.code, 0, rerun.stderr);
        assert.deepEqual(rerun.dependencies, []);
        assert.deepEqual(rerun.excel, []);
    } finally {
        const resolved = fs.realpathSync(directory);
        assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
        assert.ok(path.basename(resolved).startsWith('repo-tools-validation-'));
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('le kit distingue une commande introuvable d’un succès', async () => {
    const result = await execute('repo-tools-nonexistent-validation-executable', [], { timeout: 1000 });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /ENOENT|not found/i);
});

test('les rapports conservent les preuves et donnent priorité à FAIL puis BLOCKED', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-validation-'));
    try {
        const ctx = context(999, directory);
        ctx.check('Cas conforme', 'A', 'A', true, 'preuve.json');
        assert.equal(finish(ctx).status, 'PASS');
        ctx.blocked('Prérequis manquant', 'Python utilisable', 'Absent');
        assert.equal(finish(ctx).status, 'BLOCKED');
        ctx.check('Écart détecté', 3, 0, false, 'observed.json');
        const report = finish(ctx);
        assert.equal(report.status, 'FAIL');
        const saved = JSON.parse(fs.readFileSync(path.join(directory, 'recette-resultat.json'), 'utf8'));
        assert.equal(saved.status, 'FAIL');
        assert.equal(saved.checks.length, 3);
        assert.equal(saved.checks[2].evidence, 'observed.json');
        const markdown = fs.readFileSync(path.join(directory, 'recette-resultat.md'), 'utf8');
        assert.match(markdown, /Écart détecté \| 3 \| 0 \| FAIL \| observed.json/);
        assert.match(markdown, /Prérequis manquant/);
    } finally {
        const resolved = fs.realpathSync(directory);
        assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
        assert.ok(path.basename(resolved).startsWith('repo-tools-validation-'));
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
