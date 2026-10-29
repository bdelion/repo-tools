import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { publishOutputs } = createRequire(__filename)('../src/publishOutputs.cjs');

async function fixture(run: (root: string) => Promise<void>) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-tools-publish-'));
    try { await run(root); }
    finally {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(root).startsWith('repo-tools-publish-'));
        await fs.rm(root, { recursive: true, force: true });
    }
}

test('publie textes et fichiers binaires puis retire les seules sorties obsolètes', async () => fixture(async root => {
    const existing = path.join(root, 'report.md');
    const binary = path.join(root, 'report.xlsx');
    const obsolete = path.join(root, 'obsolete.json');
    const manual = path.join(root, 'notes.txt');
    await fs.writeFile(existing, 'old');
    await fs.writeFile(obsolete, 'obsolete');
    await fs.writeFile(manual, 'keep');
    await publishOutputs(new Map<string, string | Buffer>([[existing, 'new'], [binary, Buffer.from([0, 255, 12])]]), [obsolete]);
    assert.equal(await fs.readFile(existing, 'utf8'), 'new');
    assert.deepEqual(await fs.readFile(binary), Buffer.from([0, 255, 12]));
    assert.equal(await fs.readFile(manual, 'utf8'), 'keep');
    assert.deepEqual((await fs.readdir(root)).sort(), ['notes.txt', 'report.md', 'report.xlsx']);
}));

test('un échec de préparation ne modifie aucune sortie et nettoie les fichiers temporaires', async () => fixture(async root => {
    const target = path.join(root, 'report.md');
    const obsolete = path.join(root, 'obsolete.json');
    await fs.writeFile(target, 'old');
    await fs.writeFile(obsolete, 'keep');
    const io = { ...fs, writeFile: async () => { throw new Error('disk full'); } };
    await assert.rejects(publishOutputs(new Map([[target, 'new']]), [obsolete], io), /disk full/);
    assert.equal(await fs.readFile(target, 'utf8'), 'old');
    assert.equal(await fs.readFile(obsolete, 'utf8'), 'keep');
    assert.deepEqual((await fs.readdir(root)).sort(), ['obsolete.json', 'report.md']);
}));

test('restaure les fichiers remplacés et supprime les nouveaux après un échec de renommage', async () => fixture(async root => {
    const existing = path.join(root, 'a.json');
    const added = path.join(root, 'b.json');
    const failing = path.join(root, 'c.json');
    await fs.writeFile(existing, 'old');
    let count = 0;
    const io = { ...fs, rename: async (from: string, to: string) => {
        if (++count === 3) throw new Error('rename failed');
        await fs.rename(from, to);
    } };
    await assert.rejects(publishOutputs(new Map([[existing, 'new'], [added, 'new'], [failing, 'new']]), [], io), /rename failed/);
    assert.equal(await fs.readFile(existing, 'utf8'), 'old');
    assert.deepEqual(await fs.readdir(root), ['a.json']);
}));

test('restaure aussi les sorties obsolètes si leur suppression échoue', async () => fixture(async root => {
    const report = path.join(root, 'report.md');
    const first = path.join(root, 'obsolete1.json');
    const second = path.join(root, 'obsolete2.json');
    for (const file of [report, first, second]) await fs.writeFile(file, 'old');
    const io = { ...fs, unlink: async (file: string) => {
        if (file === second) throw new Error('delete failed');
        await fs.unlink(file);
    } };
    await assert.rejects(publishOutputs(new Map([[report, 'new']]), [first, second], io), /delete failed/);
    for (const file of [report, first, second]) assert.equal(await fs.readFile(file, 'utf8'), 'old');
    assert.equal((await fs.readdir(root)).length, 3);
}));

test('refuse les répertoires cibles avant de modifier les fichiers existants', async () => fixture(async root => {
    const report = path.join(root, 'report.md');
    const directory = path.join(root, 'directory');
    await fs.writeFile(report, 'old');
    await fs.mkdir(directory);
    await assert.rejects(publishOutputs(new Map([[report, 'new'], [directory, 'invalid']])), /fichier ordinaire/);
    assert.equal(await fs.readFile(report, 'utf8'), 'old');
    assert.deepEqual((await fs.readdir(root)).sort(), ['directory', 'report.md']);
}));
