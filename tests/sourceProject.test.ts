import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { scanDirectory } from '../src/scanner/scanDirectory';
import { nodes, nodesFiltered } from '../src/graph/nodeManager';
import { dependencies, dependenciesFiltered } from '../src/graph/dependencyManager';
import { createRecursivedTGF } from '../src/graph/graphBuilder';
import { writeTgfFile } from '../src/output/writeTgf';
import { TgfParser } from '../src/graph/parsers/TgfParser';
import { GraphQueries } from '../src/graph/queries/GraphQueries';

const projectTools = createRequire(__filename)('../src/sourceProject.cjs');

test('le parsing distingue TypeScript et JSX selon l’extension du fichier (#6)', () => {
    const assertion = 'export const target = <HTMLElement>event.target;';
    assert.equal(projectTools.parseSource(assertion, 'useOutsideClick.ts').exports[0].name, 'target');
    assert.equal(projectTools.parseSource(assertion, 'legacy.cts').exports[0].name, 'target');
    const generic = 'export const identity = <T>(value: T): T => value;';
    assert.equal(projectTools.parseSource(generic, 'generic.ts').exports[0].name, 'identity');
    for (const extension of ['js', 'jsx', 'tsx']) {
        const source = extension === 'tsx'
            ? 'export const Component = (props: { title: string }) => <div>{props.title}</div>;'
            : 'export const Component = () => <div>Hello</div>;';
        assert.equal(projectTools.parseSource(source, `Component.${extension}`).exports[0].name, 'Component');
    }
    assert.throws(() => projectTools.parseSource(assertion, 'invalid.tsx'), /Syntaxe invalide/);
    assert.throws(() => projectTools.parseSource('export const Component = () => <div>', 'broken.tsx'), /Syntaxe invalide/);
    assert.throws(() => projectTools.parseSource('export const value: string = "TS in JS";', 'invalid.js'), /Syntaxe invalide/);
});

test('imports par chemin, alias et barrels : les composants homonymes restent distincts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-sources-'));
    const write = (file: string, content: string) => {
        const absolute = path.join(root, file);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content);
        return absolute;
    };
    try {
        write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@ui/*': ['src/*'] } } }));
        const left = write('src/left/Button.tsx', '/** @visibleName 🧩 Button */\nexport default function Button() { return null; }');
        write('src/right/Button.tsx', 'export default function Button() { return null; }');
        const barrel = write('src/barrel.ts', "export { default as Renamed } from './left/Button';");
        write('src/namespace.ts', "export * as buttons from './barrel';");
        write('src/App.tsx', "import { Renamed as Local } from '@ui/barrel';\nimport type { Missing } from './not-present';\nexport const App = Local;");
        write('src/types.ts', 'export interface OnlyAType { name: string }; export type Alias = string;');
        const project = projectTools.createSourceProject(root);
        assert.equal(project.resolveExport(barrel, 'Renamed').file, left);
        assert.equal(project.resolveExport(path.join(root, 'src/namespace.ts'), 'buttons').file, barrel);
        write('independent/package.json', '{"name":"independent"}');
        const independent = write('independent/component.ts', 'export const Component = 1;');
        const isolatedProject = projectTools.createSourceProject(path.join(root, 'independent'));
        assert.equal(isolatedProject.resolve(independent, '@ui/barrel'), null);
        const svg = write('src/Icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
        const assetBarrel = write('src/icons.ts', "export { default as Icon } from './Icon.svg';");
        const assetProject = projectTools.createSourceProject(root, { assetExtensions: ['.svg'] });
        assert.equal(assetProject.resolveExport(assetBarrel, 'Icon').file, svg);
        assert.equal(assetProject.resolveExport(assetBarrel, 'Icon').asset, true);
        scanDirectory(path.join(root, 'src'), root);
        const id = (name: string) => `${encodeURIComponent(name)}#default`;
        assert.ok(nodes[id('src/left/Button.tsx')]);
        assert.equal(nodes[id('src/left/Button.tsx')].icone, '🧩');
        assert.ok(nodes[id('src/right/Button.tsx')]);
        assert.equal(Object.keys(nodes).some(key => key.includes('OnlyAType')), false);
        const app = `${encodeURIComponent('src/App.tsx')}#App`;
        const reexport = `${encodeURIComponent('src/barrel.ts')}#Renamed`;
        assert.deepEqual([...dependencies[app]], [reexport]);
        assert.deepEqual([...dependencies[reexport]], [id('src/left/Button.tsx')]);
        createRecursivedTGF();
        const output = path.join(root, 'out/graph.tgf');
        writeTgfFile(nodesFiltered, dependenciesFiltered, output);
        const graph = new TgfParser().parse(fs.readFileSync(output, 'utf8'));
        const query = new GraphQueries(graph);
        assert.equal(query.findByComponentName('Button').length, 2);
        assert.ok(query.getRequiredComponents([app]).includes(id('src/left/Button.tsx')));
        assert.equal(query.getRequiredComponents([app]).includes(id('src/right/Button.tsx')), false);

        const before = Object.keys(nodes);
        write('src/Broken.ts', "import { Missing } from './absent'; export const Broken = Missing;");
        assert.throws(() => scanDirectory(path.join(root, 'src'), root), /non résolu/);
        assert.deepEqual(Object.keys(nodes), before);
        assert.throws(() => projectTools.parseSource('export const = broken', 'invalid.ts'), /Syntaxe invalide/);
    } finally {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(root).startsWith('repo-tools-sources-'));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('le fingerprint invalide le cache quand les règles d’analyse changent', () => {
    const config = { srcDir: 'src', excludeFilePatterns: ['test'] };
    assert.equal(projectTools.analysisFingerprint(config), projectTools.analysisFingerprint({ ...config }));
    assert.notEqual(projectTools.analysisFingerprint(config), projectTools.analysisFingerprint({ ...config, excludeFilePatterns: ['test', 'mock'] }));
});
