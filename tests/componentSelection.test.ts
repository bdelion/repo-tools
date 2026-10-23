import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TgfParser } from '../src/graph/parsers/TgfParser';
import { GraphQueries } from '../src/graph/queries/GraphQueries';
import { selectComponentNames } from '../src/commands/componentSelection';

const graph = new TgfParser().parse('A Button src/Button.tsx\nB Dialog src/Dialog.tsx\nC Button legacy/Button.tsx\nD Isolated src/Isolated.tsx\n#\nB A');

test('--all sélectionne chaque nom, y compris les composants isolés', () => {
    const names = selectComponentNames(['--all'], graph);
    assert.deepEqual(names, ['Button', 'Dialog', 'Isolated']);
    const report = new GraphQueries(graph).getRequiredComponentsByNameDetailed(names);
    assert.equal(report.foundComponents.length, 4);
    assert.deepEqual(report.missingNames, []);
});

test('la sélection explicite reste disponible et supprime les doublons', () => {
    assert.deepEqual(selectComponentNames(['Dialog', 'Button', 'Dialog'], graph), ['Dialog', 'Button']);
});

test('les modes exclusifs et les options invalides sont rejetés', () => {
    for (const args of [[], ['--unknown'], ['--all', 'Button'], ['Button', '--all'],
        ['--components-file'], ['--components-file', '--all'], ['--all', '--components-file', 'list.txt']]) {
        assert.throws(() => selectComponentNames(args, graph));
    }
});

test('un graphe vide est rejeté avec --all', () => {
    assert.throws(() => selectComponentNames(['--all'], new TgfParser().parse('#')), /aucun composant/);
});

test('le fichier accepte UTF-8 avec BOM, CRLF, commentaires, espaces et doublons', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-selection-'));
    const file = path.join(directory, 'mes composants.txt');
    try {
        fs.writeFileSync(file, '\uFEFF# Migration\r\n Dialog \r\n\r\nButton\r\nDialog\r\nMissing\r\n');
        const names = selectComponentNames(['--components-file', file], graph);
        assert.deepEqual(names, ['Dialog', 'Button', 'Missing']);
        const report = new GraphQueries(graph).getRequiredComponentsByNameDetailed(names);
        assert.deepEqual(report.missingNames, ['Missing']);

        fs.writeFileSync(file, '# Commentaire uniquement\n');
        assert.throws(() => selectComponentNames(['--components-file', file], graph), /aucun composant/);
        fs.writeFileSync(file, 'Button Dialog\n');
        assert.throws(() => selectComponentNames(['--components-file', file], graph), /un seul nom/);
    } finally {
        fs.unlinkSync(file);
        fs.rmdirSync(directory);
    }
    assert.throws(() => selectComponentNames(['--components-file', file], graph), /ENOENT/);
});
