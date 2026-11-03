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
        scanDirectory(path.join(root, 'src'), root, 'detailed');
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

test('un alias global ne transforme pas les dépendances externes en imports locaux (#23)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-issue23-'));
    const write = (file: string, content: string) => {
        const absolute = path.join(root, file);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content);
        return absolute;
    };
    try {
        write('tsconfig.json', JSON.stringify({ compilerOptions: {
            module: 'NodeNext', moduleResolution: 'NodeNext',
            paths: { '*': ['/*'], '@local/*': ['./src/*'] },
        } }));
        const hook = write('src/hook.ts', "import { useEffect } from 'react'; export const hook = () => useEffect(() => {});");
        const local = write('src/local.ts', 'export const local = 1;');
        write('src/types.d.ts', 'export declare const value: number;');
        const project = projectTools.createSourceProject(root);
        assert.equal(project.resolve(hook, 'react'), null);
        assert.equal(project.resolve(hook, '@local/local'), local);
        assert.equal(project.resolve(hook, './types'), null);
        assert.throws(() => project.resolve(hook, './absent'), /Import local non résolu/);
        assert.throws(() => project.resolve(hook, '@local/absent'), /Import local non résolu/);
        for (const extension of ['js', 'd.ts', 'd.mts', 'd.cts']) {
            write('node_modules/react/package.json', JSON.stringify({
                name: 'react', main: 'index.js', ...(extension !== 'js' ? { types: `index.${extension}` } : {}),
            }));
            write(`node_modules/react/index.${extension}`, extension === 'js'
                ? 'exports.useEffect = () => {};'
                : 'export declare function useEffect(callback: () => void): void;');
            const installedProject = projectTools.createSourceProject(root);
            assert.equal(installedProject.resolve(hook, 'react'), null);
            const graph = projectTools.buildSourceGraph(root, [hook]);
            assert.equal(graph.nodes.length, 1);
            assert.equal(graph.nodes[0].visibleName, 'hook');
            assert.deepEqual(graph.edges, []);
        }
    } finally {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('repo-tools-issue23-'));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('les imports ordinaires de types et leurs réexports ne créent pas de dépendances (#24)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-issue24-'));
    const write = (file: string, content: string) => {
        const absolute = path.join(root, file);
        fs.writeFileSync(absolute, content);
        return absolute;
    };
    try {
        write('package.json', '{"name":"fixture"}');
        write('coords.ts', `
            export interface Coords { x: number; y: number }
            export type Position = Coords;
            export const origin: Coords = { x: 0, y: 0 };
            interface Local { x: number }
            export { Local as Renamed };
            export interface Merged { x: number }
            export const Merged = { x: 0 };
        `);
        write('barrel.ts', "export { Coords, Position, Renamed, origin, Merged } from './coords';");
        write('star.ts', "export * from './barrel';");
        write('cycle.ts', "export * from './star'; export * from './cycle';");
        write('imported.ts', "import { Coords } from './coords'; export { Coords as ImportedCoords };");
        write('explicit.ts', "export type { Coords as ExplicitCoords } from './coords';");
        const hook = write('hook.ts', `
            import { Coords, Position, Renamed, origin, Merged } from './cycle';
            import { ImportedCoords } from './imported';
            import { ExplicitCoords } from './explicit';
            export const hook = (coords: Coords, position: Position, renamed: Renamed,
                imported: ImportedCoords, explicit: ExplicitCoords) => [origin, Merged, coords];
        `);
        const graph = projectTools.buildSourceGraph(root, [hook]);
        assert.ok(graph.nodes.some((node: { visibleName: string }) => node.visibleName === 'origin'));
        assert.ok(graph.nodes.some((node: { visibleName: string }) => node.visibleName === 'Merged'));
        assert.equal(graph.nodes.some((node: { visibleName: string }) =>
            ['Coords', 'Position', 'Renamed', 'ImportedCoords', 'ExplicitCoords'].includes(node.visibleName)), false);
        const edges = graph.edges.find(([source]: [string]) => source === 'hook.ts#hook')[1];
        assert.deepEqual(edges, ['cycle.ts#origin', 'cycle.ts#Merged']);
        write('broken.ts', "import { Missing } from './coords'; export const broken = Missing;");
        assert.throws(() => projectTools.buildSourceGraph(root, [path.join(root, 'broken.ts')]), /Export introuvable : Missing/);
    } finally {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('repo-tools-issue24-'));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('les assets réexportés sont ignorés à travers les barrels sans masquer les exports absents (#25)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-issue25-'));
    const write = (file: string, content: string) => {
        const absolute = path.join(root, file);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content);
        return absolute;
    };
    try {
        write('package.json', '{"name":"fixture"}');
        write('svg/bureau.svg', '<svg/>');
        write('svg/logo.svg', '<svg/>');
        write('svg/local.jsx', 'export const LocalIcon = () => <svg/>;');
        write('svg/index.js', `
            export { default as BureauCentralFrancais } from './bureau.svg';
            import { ReactComponent as Logo } from './logo.svg';
            export { Logo };
            export { LocalIcon } from './local';
            export { default as External } from 'external-package';
        `);
        write('renamed.js', "export { BureauCentralFrancais as Renamed, Logo, LocalIcon, External } from './svg';");
        write('star.js', "export * from './renamed';");
        const app = write('app.jsx', `
            import { BureauCentralFrancais } from './svg';
            import { Renamed, Logo, LocalIcon, External } from './star';
            export const App = () => <LocalIcon/>;
        `);
        const graph = projectTools.buildSourceGraph(root, [app]);
        assert.deepEqual(graph.nodes.map((node: { visibleName: string }) => node.visibleName).sort(),
            ['App', 'LocalIcon', 'LocalIcon', 'LocalIcon', 'LocalIcon']);
        assert.deepEqual(graph.edges.find(([source]: [string]) => source === 'app.jsx#App')[1], ['star.js#LocalIcon']);
        write('broken.jsx', "import { Missing } from './svg'; export const Broken = Missing;");
        assert.throws(() => projectTools.buildSourceGraph(root, [path.join(root, 'broken.jsx')]), /Export introuvable : Missing/);
    } finally {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('repo-tools-issue25-'));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('les imports et réexports hors du périmètre ne sont pas parcourus (#26)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-issue26-'));
    const write = (file: string, content: string) => {
        const absolute = path.join(root, file);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content);
        return absolute;
    };
    try {
        write('package.json', '{"name":"fixture"}');
        write('tsconfig.json', JSON.stringify({ compilerOptions: {
            baseUrl: '.', paths: { '@tools/*': ['tools/*'] },
        } }));
        // Une syntaxe invalide prouve que les fichiers exclus ne sont pas parsés.
        const external = write('tools/tests/isFullySelected.ts', 'export const = invalid;');
        write('src/excluded/helper.ts', 'export const = invalid;');
        write('src/local.ts', 'export const local = 1;');
        write('src/barrel.ts', `
            export { isFullySelected } from '../tools/tests/isFullySelected';
            export * from '../tools/tests/isFullySelected';
            export { helper } from './excluded/helper';
            export { local } from './local';
        `);
        const app = write('src/App.ts', `
            import { isFullySelected } from '../tools/tests/isFullySelected';
            import { isFullySelected as aliased } from '@tools/tests/isFullySelected';
            import * as tools from '../tools/tests/isFullySelected';
            import { isFullySelected as reexported, helper, local } from './barrel';
            export const App = local;
        `);
        const origin = path.join(root, 'src');
        const graph = projectTools.buildSourceGraph(origin, [app], (file: string) => file.startsWith('excluded/'));
        assert.deepEqual(graph.nodes.map((node: { id: string }) => node.id).sort(),
            ['App.ts#App', 'barrel.ts#local', 'local.ts#local']);
        assert.deepEqual(graph.edges, [
            ['App.ts#App', ['barrel.ts#local']],
            ['barrel.ts#local', ['local.ts#local']],
        ]);
        assert.throws(() => projectTools.buildSourceGraph(origin, [external]), /Source hors du périmètre/);
        write('src/broken.ts', "import { missing } from '../tools/absent'; export const broken = missing;");
        assert.throws(() => projectTools.buildSourceGraph(origin, [path.join(origin, 'broken.ts')]), /Import local non résolu/);
    } finally {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('repo-tools-issue26-'));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('un composant React dans assets reste accessible via le barrel racine (#27)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-issue27-'));
    const write = (file: string, content: string) => {
        const absolute = path.join(root, file);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content);
        return absolute;
    };
    try {
        write('package.json', '{"name":"fixture"}');
        write('src/assets/svg/svg.tsx', `
            import './svg.scss';
            export type SvgProps = { title?: string };
            const Svg = (props: SvgProps) => <svg/>;
            export default Svg;
        `);
        write('src/assets/svg/index.ts', "export { default as Svg } from './svg'; export type { SvgProps } from './svg';");
        write('src/assets/svg/icon.svg', '<svg/>');
        write('src/assets/svg/svg.scss', '.svg {}');
        write('src/index.ts', "export * from './assets/svg'; export * from './components/layout/stepper';");
        write('src/components/layout/stepper/index.ts', "export { default as Stepper } from './stepper';");
        write('src/components/layout/stepper/stepper.tsx', `
            import { Svg } from '../../..';
            const Stepper = () => <Svg/>;
            export default Stepper;
        `);
        scanDirectory(path.join(root, 'src'), path.join(root, 'src'), 'detailed');
        createRecursivedTGF();
        const svg = `${encodeURIComponent('assets/svg/svg.tsx')}#default`;
        const stepper = `${encodeURIComponent('components/layout/stepper/stepper.tsx')}#default`;
        assert.ok(nodesFiltered[svg]);
        assert.ok(dependenciesFiltered[stepper].has('index.ts#Svg'));
        assert.ok(dependenciesFiltered['index.ts#Svg'].has(`${encodeURIComponent('assets/svg/index.ts')}#Svg`));
        assert.ok(dependenciesFiltered[`${encodeURIComponent('assets/svg/index.ts')}#Svg`].has(svg));
        assert.equal(Object.values(nodesFiltered).some(node => /\.(svg|scss)$/.test(node.fileName)), false);
    } finally {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('repo-tools-issue27-'));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('les réexports ne créent pas de produit cartésien et la vue composants conserve les dépendances réelles', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tools-views-'));
    const write = (file: string, content: string) => {
        const absolute = path.join(root, file);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content);
        return absolute;
    };
    try {
        write('package.json', '{"name":"fixture"}');
        const files = [];
        for (let i = 0; i < 43; i++) files.push(write(`impl/C${i}.tsx`, `export const C${i} = () => null;`));
        files.push(write('index.ts', files.map((_, i) => `export * from './impl/C${i}';`).join('\n')));
        const app = write('App.tsx', "import { C0 as Local } from './index'; export const App = () => <Local/>;");
        files.push(app);
        files.push(write('aliases.ts', "export { C0 as Renamed } from './index';"));
        files.push(write('Other.tsx', "import { Renamed } from './aliases'; export const Other = () => <Renamed/>;"));
        files.push(write('other/C0.tsx', 'export const C0 = () => null;'));
        const detailed = projectTools.buildSourceGraph(root, files);
        const barrelEdges = detailed.edges.filter(([source]: [string]) => source.startsWith('index.ts#'));
        assert.equal(barrelEdges.length, 43);
        assert.equal(barrelEdges.reduce((sum: number, [, targets]: [string, string[]]) => sum + targets.length, 0), 43);
        for (let i = 0; i < 43; i++) {
            assert.deepEqual(barrelEdges.find(([source]: [string]) => source === `index.ts#C${i}`)[1],
                [`impl%2FC${i}.tsx#C${i}`]);
        }
        const components = projectTools.buildSourceGraph(root, files, undefined, { view: 'components' });
        assert.equal(components.nodes.length, 46);
        assert.equal(components.nodes.filter((node: { visibleName: string }) => node.visibleName === 'C0').length, 2);
        assert.deepEqual(components.edges, [
            ['Other.tsx#Other', ['impl%2FC0.tsx#C0']],
            ['App.tsx#App', ['impl%2FC0.tsx#C0']],
        ]);
        scanDirectory(root, root);
        assert.equal(Object.keys(nodes).length, 46);
        assert.ok(dependencies['App.tsx#App'].has('impl%2FC0.tsx#C0'));
    } finally {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('repo-tools-views-'));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('le fingerprint invalide le cache quand les règles d’analyse changent', () => {
    const config = { srcDir: 'src', excludeFilePatterns: ['test'] };
    assert.equal(projectTools.analysisFingerprint(config), projectTools.analysisFingerprint({ ...config }));
    assert.notEqual(projectTools.analysisFingerprint(config), projectTools.analysisFingerprint({ ...config, excludeFilePatterns: ['test', 'mock'] }));
});
