import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeLibrary, selectLibrary } from '../src/graph/libraryAnalysis';
import { libraryArtifacts, parseLibraryArgs } from '../src/commands/library-generate';
import { TgfParser } from '../src/graph/parsers/TgfParser';
import { writeTgfFile } from '../src/output/writeTgf';

function fixture(run: (root: string, write: (file: string, content: string) => void) => void) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-library-'));
    const write = (file: string, content: string) => {
        const target = path.join(root, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    };
    try {
        write('package.json', '{"name":"fixture"}');
        write('tsconfig.json', JSON.stringify({ compilerOptions: { jsx: 'react', moduleResolution: 'node', target: 'ES2020' } }));
        run(root, write);
    } finally {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('repo-tools-library-'));
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test('les trois vues distinguent UI publique, types publics, éléments privés et packages externes', () => fixture((root, write) => {
    write('src/helper.ts', 'export const helper = () => 1; export const unused = () => 0;');
    write('src/Private.tsx', 'export const Private = () => <span/>;');
    write('src/PrivateWrapper.tsx', "import Button from './Button'; export const PrivateWrapper = () => <Button/>;");
    write('src/Button.tsx', `
        import React from 'react';
        import { helper, unused } from './helper';
        export interface ButtonProps { title?: string }
        const Button = (props: ButtonProps) => <button>{helper()}</button>;
        export default Button;
    `);
    write('src/Panel.tsx', "import { PrivateWrapper } from './PrivateWrapper'; export const Panel = () => <PrivateWrapper/>;");
    write('src/index.ts', `
        export { default as Button, default as Action } from './Button';
        export type { ButtonProps } from './Button';
        export { Panel } from './Panel';
        export { helper as format } from './helper';
    `);
    const ui = analyzeLibrary({ source: path.join(root, 'src'), view: 'public-ui' });
    assert.deepEqual(ui.nodes.map(node => node.name).sort(), ['Button', 'Panel']);
    const button = ui.nodes.find(node => node.name === 'Button')!;
    const panel = ui.nodes.find(node => node.name === 'Panel')!;
    assert.deepEqual(button.publicNames, ['Action', 'Button']);
    assert.ok(ui.edges.some(edge => edge.source === panel.id && edge.target === button.id));
    assert.ok(ui.analysis.nodes.some(node => node.name === 'Private'));
    assert.equal(ui.nodes.some(node => node.name === 'Private'), false);
    const required = selectLibrary(ui, ['Panel'], 'required');
    assert.ok(required.components.some(node => node.name === 'PrivateWrapper'));
    assert.ok(required.components.some(node => node.name === 'helper'));
    assert.equal(required.components.some(node => node.name === 'unused'), false);
    const impact = selectLibrary(ui, ['format'], 'impact');
    assert.ok(impact.components.some(node => node.name === 'Panel'));
    assert.equal(impact.components.filter(node => node.id === button.id).length, 1);
    const api = analyzeLibrary({ source: path.join(root, 'src'), view: 'public-api' });
    assert.ok(api.nodes.some(node => node.name === 'ButtonProps' && node.kind === 'type'));
    assert.ok(api.nodes.some(node => node.name === 'helper'));
    assert.equal(api.nodes.some(node => node.name === 'Private'), false);
    const deps = analyzeLibrary({ source: path.join(root, 'src'), view: 'dependencies', external: true });
    // Le JSX introduit une dépendance React même sans référence explicite à React.
    assert.ok(deps.edges.some(edge => deps.analysis.nodes.find(node => node.id === edge.target)?.package === 'react'));
    write('src/reactHook.ts', "import { useState } from 'react'; export const hook = () => useState(0);");
    const external = analyzeLibrary({ source: path.join(root, 'src'), view: 'dependencies', external: true });
    assert.ok(external.nodes.some(node => node.package === 'react'));
    assert.ok(external.edges.some(edge => edge.target === 'package:react'));
    const noExternal = analyzeLibrary({ source: path.join(root, 'src'), view: 'dependencies' });
    assert.equal(noExternal.nodes.some(node => node.kind === 'external'), false);
    const artifacts = libraryArtifacts(ui, path.join(root, 'graph.tgf'));
    const parsed = new TgfParser().parse(artifacts.get(path.join(root, 'graph.tgf'))!);
    assert.equal(parsed.getNodes().length, ui.nodes.length);
    assert.equal(artifacts.size, 6);
}));

test('les entrées publiques sont explicites, multiples et indépendantes du nom du dossier', () => fixture((root, write) => {
    write('src/a.ts', 'export const a = 1;');
    write('src/b.ts', 'export const b = 2;');
    write('src/internal.ts', 'export const hidden = 3;');
    write('package.json', JSON.stringify({ name: 'fixture', exports: { '.': './src/a.ts', './b': './src/b.ts' } }));
    const api = analyzeLibrary({ source: path.join(root, 'src'), view: 'public-api' });
    assert.deepEqual(api.exports.map(exp => exp.name).sort(), ['a', 'b']);
    write('package.json', JSON.stringify({ name: 'fixture', exports: { '.': './dist/index.js' } }));
    assert.throws(() => analyzeLibrary({ source: path.join(root, 'src'), view: 'public-api' }), /--entry/);
    const explicit = analyzeLibrary({ source: path.join(root, 'src'), view: 'public-api', entries: ['a.ts'] });
    assert.deepEqual(explicit.exports.map(exp => exp.name), ['a']);
}));

test('les cycles sont regroupés, les feuilles précèdent leurs dépendants et les homonymes sont ambigus', () => fixture((root, write) => {
    write('src/a.ts', "import { b } from './b'; export const a = () => b();");
    write('src/b.ts', "import { a } from './a'; export const b = () => a();");
    write('src/left.ts', 'export const Same = 1;');
    write('src/right.ts', 'export const Same = 2;');
    write('src/index.ts', "export { a } from './a'; export { b } from './b';");
    const graph = analyzeLibrary({ source: path.join(root, 'src'), view: 'dependencies' });
    assert.equal(graph.cyclicGroups.length, 1);
    assert.equal(graph.cyclicGroups[0].length, 2);
    const ids = graph.cyclicGroups[0];
    assert.ok(graph.levels.some(group => ids.every(id => group.components.includes(id))));
    assert.throws(() => selectLibrary(graph, ['Same'], 'impact'), /ambigu/);
    assert.throws(() => selectLibrary(graph, ['Missing'], 'required'), /inconnu/);
}));

test('les imports locaux cassés échouent et la classification UI peut être corrigée', () => fixture((root, write) => {
    write('src/index.ts', 'export const Wrapped = () => null; export interface Props { x: number }');
    const ui = analyzeLibrary({ source: path.join(root, 'src'), view: 'public-ui', uiInclude: ['Wrapped'] });
    assert.equal(ui.nodes.length, 1);
    assert.equal(ui.nodes[0].name, 'Wrapped');
    assert.throws(() => analyzeLibrary({ source: path.join(root, 'src'), view: 'public-ui', uiInclude: ['Props'] }), /type/);
    write('src/broken.ts', "import { missing } from './absent'; export const broken = missing;");
    assert.throws(() => analyzeLibrary({ source: path.join(root, 'src'), view: 'dependencies' }), /Import local non résolu/);
}));

test('les options sont validées et les chemins de configuration sont relatifs à son fichier', () => fixture((root, write) => {
    write('config/library.json', JSON.stringify({ source: '../src', entries: ['index.ts'], view: 'public-api', output: '../output/api.tgf' }));
    const parsed = parseLibraryArgs(['--config', path.join(root, 'config/library.json')]);
    assert.equal(parsed.options.source, path.join(root, 'src'));
    assert.equal(parsed.output, path.join(root, 'output/api.tgf'));
    assert.throws(() => parseLibraryArgs(['--view', 'oops']), /Vue inconnue/);
    assert.throws(() => parseLibraryArgs(['--external']), /dependencies/);
    assert.throws(() => parseLibraryArgs(['--source']), /Valeur manquante/);
    assert.throws(() => parseLibraryArgs(['--view', 'public-api', '--view', 'public-ui']), /répétée/);
    const cli = spawnSync(process.execPath, ['--require', 'ts-node/register', 'src/generate-component-dependency-graph.ts', '--help'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /public-ui\|public-api\|dependencies/);
}));

test('une bibliothèque mixte JS/JSX/TS/TSX conserve les exports publics et les liens entre langages', () => fixture((root, write) => {
    write('src/util.js', 'export function format(value) { return String(value); }');
    write('src/Legacy.jsx', "import { format } from './util'; const Legacy = () => <span>{format(1)}</span>; export default Legacy;");
    write('src/Modern.tsx', "import Legacy from './Legacy'; export const Modern = () => <Legacy/>;");
    write('src/components.ts', "export { default as Legacy } from './Legacy'; export { Modern } from './Modern'; export interface Options { enabled: boolean }");
    write('src/index.js', "export * from './components'; export { format } from './util';");
    const result = analyzeLibrary({ source: path.join(root, 'src'), view: 'public-ui' });
    assert.deepEqual(result.nodes.map(node => node.name).sort(), ['Legacy', 'Modern']);
    const modern = result.nodes.find(node => node.name === 'Modern')!;
    const legacy = result.nodes.find(node => node.name === 'Legacy')!;
    assert.ok(result.edges.some(edge => edge.source === modern.id && edge.target === legacy.id));
    assert.ok(selectLibrary(result, ['Modern'], 'required').components.some(node => node.name === 'format'));
    const api = analyzeLibrary({ source: path.join(root, 'src'), view: 'public-api' });
    assert.deepEqual(api.exports.map(exp => exp.name).sort(), ['Legacy', 'Modern', 'Options', 'format']);
}));

test('les namespaces, ressources publiques et déclarations locales sont inventoriés sans devenir de fausses UI', () => fixture((root, write) => {
    write('src/icons/Check.jsx', 'export const Check = () => <svg/>;');
    write('src/icons/index.js', "export { Check } from './Check';");
    write('src/logo.svg', '<svg/>');
    write('src/types.d.ts', 'export interface LocalType { id: string }');
    write('src/helper.ts', 'export const helper = () => 1;');
    write('src/namespace.tsx', "import { helper } from './helper'; export namespace Widgets { export const Box = () => <span>{helper()}</span>; }");
    write('src/index.ts', "export * as Icons from './icons'; export { Widgets } from './namespace'; export { default as Logo } from './logo.svg'; export type { LocalType } from './types'; export { useState } from 'react';");
    const api = analyzeLibrary({ source: path.join(root, 'src'), view: 'public-api' });
    assert.ok(api.exports.some(exp => exp.name === 'Icons.Check'));
    assert.ok(api.nodes.some(node => node.kind === 'asset' && node.publicNames.includes('Logo')));
    assert.ok(api.nodes.some(node => node.kind === 'external' && node.publicNames.includes('useState')));
    assert.ok(api.nodes.some(node => node.kind === 'type' && node.publicNames.includes('LocalType')));
    const ui = analyzeLibrary({ source: path.join(root, 'src'), view: 'public-ui' });
    assert.deepEqual(ui.nodes.map(node => node.name), ['Check', 'Box']);
    assert.ok(selectLibrary(ui, ['Widgets.Box'], 'required').components.some(node => node.name === 'helper'));
}));

test('la CLI publie les vues et leurs rapports puis permet impact et prérequis sur une bibliothèque JS', () => fixture((root, write) => {
    write('src/helper.js', 'export const helper = () => 1;');
    write('src/Button.jsx', "import { helper } from './helper'; export const Button = () => <span>{helper()}</span>;");
    write('src/index.js', "export { Button } from './Button';");
    const output = path.join(root, 'out/ui.tgf');
    const cli = (script: string, args: string[]) => {
        const result = spawnSync(process.execPath, ['--require', 'ts-node/register', script, ...args], { encoding: 'utf8', timeout: 60000 });
        assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
        return result.stdout;
    };
    cli('src/generate-component-dependency-graph.ts', ['--source', path.join(root, 'src'), '--entry', 'index.js', '--output', output]);
    assert.equal(new TgfParser().parse(fs.readFileSync(output, 'utf8')).getNodes().length, 1);
    const analysis = output.replace('.tgf', '.analysis.json');
    const required = JSON.parse(cli('src/commands/required-components.ts', ['--analysis', analysis, 'Button']));
    assert.ok(required.components.some((node: { name: string }) => node.name === 'helper'));
    const impact = JSON.parse(cli('src/commands/library-impact.ts', [analysis, 'helper']));
    assert.ok(impact.components.some((node: { name: string }) => node.name === 'Button'));
    for (const suffix of ['.catalog.json', '.catalog.md', '.summary.json', '.plan.json']) assert.ok(fs.existsSync(output.replace('.tgf', suffix)));
}));

test('les listes et arcs sont triés naturellement par noms, indépendamment des chemins et identifiants', () => fixture((root, write) => {
    write('src/a.tsx', 'export const Component10 = () => <div/>;');
    write('src/z.tsx', 'export const Component2 = () => <div/>;');
    write('src/b.tsx', "import { Component10 } from './a'; import { Component2 } from './z'; export const Source10 = () => <><Component10/><Component2/></>;");
    write('src/y.tsx', "import { Component10 } from './a'; import { Component2 } from './z'; export const Source2 = () => <><Component10/><Component2/></>;");
    write('src/index.ts', "export * from './a'; export * from './z'; export * from './b'; export * from './y';");
    const result = analyzeLibrary({ source: path.join(root, 'src'), view: 'public-ui' });
    const expected = ['Component2', 'Component10', 'Source2', 'Source10'];
    assert.deepEqual(result.nodes.map(node => node.name), expected);
    assert.deepEqual(result.exports.map(exp => exp.name), expected);
    const names = new Map(result.nodes.map(node => [node.id, node.name]));
    assert.deepEqual(result.edges.map(edge => `${names.get(edge.source)} -> ${names.get(edge.target)}`), [
        'Source2 -> Component2', 'Source2 -> Component10', 'Source10 -> Component2', 'Source10 -> Component10',
    ]);
    const file = path.join(root, 'graph.tgf');
    const artifacts = libraryArtifacts(result, file);
    const tgf = artifacts.get(file)!;
    const [nodeLines, edgeLines] = tgf.trim().split('\n#\n');
    assert.deepEqual(nodeLines.split('\n').map(line => line.split(' ')[1]), expected);
    assert.deepEqual(edgeLines.split('\n'), result.edges.map(edge => `${edge.source} ${edge.target}`));
    const catalogue = JSON.parse(artifacts.get(file.replace('.tgf', '.catalog.json'))!);
    assert.deepEqual(catalogue.nodes.map((node: { name: string }) => node.name), expected);
    const legacyNodes = Object.fromEntries(result.nodes.map(node => [node.id, { visibleName: node.name, fileName: node.path, icone: '' }]));
    const legacyDependencies: Record<string, Set<string>> = {};
    for (const edge of [...result.edges].reverse()) (legacyDependencies[edge.source] ??= new Set()).add(edge.target);
    writeTgfFile(legacyNodes, legacyDependencies, file);
    const [legacyNodeLines, legacyEdgeLines] = fs.readFileSync(file, 'utf8').trim().split('\n#\n');
    assert.deepEqual(legacyNodeLines.split('\n').map(line => line.split(' ')[1]), expected);
    assert.deepEqual(legacyEdgeLines.split('\n'), edgeLines.split('\n'));
}));
