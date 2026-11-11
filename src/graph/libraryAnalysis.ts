import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { Graph } from './model/Graph';
import { analyzeTopology } from './topology';
import { naturalCompare, libraryDisplayName } from './naturalOrder';

export type LibraryView = 'public-ui' | 'public-api' | 'dependencies';
export interface LibraryOptions {
    source: string;
    entries?: string[];
    view: LibraryView;
    external?: boolean;
    uiInclude?: string[];
    uiExclude?: string[];
}
export interface LibraryNode {
    id: string;
    name: string;
    path: string;
    kind: 'ui' | 'type' | 'value' | 'module' | 'external' | 'asset';
    publicNames: string[];
    package?: string;
    uiReason?: string;
}
export interface PublicExport { entry: string; name: string; id: string; typeOnly: boolean }
export interface LibraryEdge { source: string; target: string; kind: 'runtime' | 'type' }
export interface LibraryResult {
    schemaVersion: number;
    source: string;
    entries: string[];
    view: LibraryView;
    nodes: LibraryNode[];
    edges: LibraryEdge[];
    exports: PublicExport[];
    analysis: { nodes: LibraryNode[]; edges: LibraryEdge[] };
    levels: { level: number; components: string[] }[];
    cyclicGroups: string[][];
    metrics: { id: string; directDependencies: number; directDependents: number; sourceLines: number; branches: number }[];
    diagnostics: string[];
}

const slash = (value: string) => value.replace(/\\/g, '/');
const packageName = (value: string) => value.startsWith('@') ? value.split('/').slice(0, 2).join('/') : value.split('/')[0];
const isResource = (value: string) => /\.(css|scss|sass|less|svg|png|jpe?g|gif|ico|json|woff2?)(?:\?.*)?$/i.test(value);

export function analyzeLibrary(input: LibraryOptions): LibraryResult {
    const source = path.resolve(input.source);
    if (!fs.statSync(source).isDirectory()) throw new Error(`Dossier source invalide : ${source}`);
    const relative = (file: string) => slash(path.relative(source, file));
    const inside = (file: string) => {
        const rel = path.relative(source, file);
        return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
    };
    const files: string[] = [];
    const visit = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => naturalCompare(a.name, b.name))) {
            if (entry.isSymbolicLink()) continue;
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!['node_modules', '.git', 'dist', 'build', '__tests__', 'tests', 'reports'].includes(entry.name)) visit(file);
            } else if (/\.[cm]?[jt]sx?$/.test(file) && !/\.(test|spec|e2e)\./.test(file)) files.push(file);
        }
    };
    visit(source);
    const diagnostics: string[] = [];
    let configDirectory = source;
    let configPath: string | undefined;
    while (true) {
        const candidate = ['tsconfig.json', 'jsconfig.json']
            .map(name => path.join(configDirectory, name))
            .find(fs.existsSync);
        if (candidate) { configPath = candidate; break; }
        if (fs.existsSync(path.join(configDirectory, 'package.json')) || fs.existsSync(path.join(configDirectory, '.git'))) break;
        const parent = path.dirname(configDirectory);
        if (parent === configDirectory) break;
        configDirectory = parent;
    }
    let compilerOptions: ts.CompilerOptions = {
        module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.ReactJSX,
    };
    if (configPath) {
        const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
        if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
        const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath));
        const errors = parsed.errors.filter(error => error.code !== 18003);
        if (errors.length) throw new Error(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
        compilerOptions = { ...compilerOptions, ...parsed.options };
    }
    // Certaines bibliothèques JavaScript n'ont aucun fichier de configuration,
    // mais écrivent `src/...` pour désigner leur propre dossier src. Dans ce cas
    // précis, appliquer la convention sans demander une option supplémentaire.
    const sourceIsNamedSrc = path.basename(source).toLowerCase() === 'src';
    const sourceConvention = !configPath && sourceIsNamedSrc ? {
        baseUrl: source,
        paths: { 'src': ['.'], 'src/*': ['*'] },
    } : {};
    compilerOptions = { ...compilerOptions, ...sourceConvention, allowJs: true, noEmit: true, skipLibCheck: true };
    const fileSet = new Set(files);
    const sourceCandidate = (file: string): string | undefined => {
        const candidates = [file, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map(ext => file + ext),
            ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map(name => path.join(file, name))];
        return candidates.find(candidate => fileSet.has(path.resolve(candidate)));
    };
    let entries = input.entries?.map(entry => sourceCandidate(path.resolve(source, entry)) ?? '');
    if (entries?.some(entry => !entry)) throw new Error('Point d’entrée introuvable dans --source. Utiliser --entry avec un fichier source existant.');
    if (!entries?.length) {
        // Le périmètre public est explicite : aucune découverte des composants par nom de dossier.
        let packageDirectory = source;
        while (!fs.existsSync(path.join(packageDirectory, 'package.json')) && path.dirname(packageDirectory) !== packageDirectory) {
            packageDirectory = path.dirname(packageDirectory);
        }
        const packageFile = path.join(packageDirectory, 'package.json');
        const manifest = fs.existsSync(packageFile) ? JSON.parse(fs.readFileSync(packageFile, 'utf8')) : {};
        if (manifest.exports) {
            const exportsMap = typeof manifest.exports === 'object' && Object.keys(manifest.exports).some(key => key.startsWith('.'))
                ? manifest.exports : { '.': manifest.exports };
            entries = [];
            const targets = (value: unknown): string[] => typeof value === 'string' ? [value]
                : value && typeof value === 'object' ? Object.values(value).flatMap(targets) : [];
            for (const [subpath, value] of Object.entries(exportsMap)) {
                if (value === null || subpath === './package.json') continue;
                if (subpath.includes('*')) {
                    if (input.view === 'dependencies') { diagnostics.push(`Périmètre public non déterminé pour ${subpath} : fournir --entry pour le catalogue.`); continue; }
                    throw new Error('Exports publics avec joker : préciser les points d’entrée source avec --entry (répétable).');
                }
                const candidates = targets(value).map(target => sourceCandidate(path.resolve(packageDirectory, target))).filter(Boolean) as string[];
                if (candidates.length) entries.push(...candidates);
                else if (input.view === 'dependencies') diagnostics.push(`Périmètre public non déterminé pour ${subpath} : fournir --entry pour les sources compilées.`);
                else throw new Error(`Export public ${subpath} dirigé vers des fichiers compilés ou absents. Préciser les sources avec --entry (répétable).`);
            }
        } else {
            const entry = sourceCandidate(path.join(source, 'index')) ?? sourceCandidate(path.join(source, 'src/index'));
            if (entry) entries = [entry];
            diagnostics.push('Points d’entrée déduits de index.* : vérifier ce périmètre ou utiliser --entry pour chaque entrée publique.');
        }
    }
    entries = [...new Set(entries ?? [])].sort(naturalCompare);
    if (!entries.length && input.view !== 'dependencies') throw new Error('Aucun point d’entrée public. Utiliser --entry index.ts (répétable), relatif à --source.');
    const program = ts.createProgram(files, compilerOptions);
    const syntaxErrors = program.getSyntacticDiagnostics().filter(error => error.file && fileSet.has(path.resolve(error.file.fileName)));
    if (syntaxErrors.length) throw new Error(syntaxErrors.map(error => `${error.file?.fileName}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`).join('\n'));
    const checker = program.getTypeChecker();
    const unalias = (symbol: ts.Symbol): ts.Symbol => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const nodes = new Map<string, LibraryNode>();
    const symbols = new Map<ts.Symbol, string>();
    const bodies = new Map<string, ts.Node[]>();
    const fileNodes = new Map<string, Set<string>>();
    const edgeMap = new Map<string, LibraryEdge>();
    const addEdge = (from: string, to: string, kind: 'runtime' | 'type' = 'runtime') => {
        if (from !== to) edgeMap.set(`${from}\0${to}\0${kind}`, { source: from, target: to, kind });
    };
    const hasUi = (node: ts.Node): boolean => {
        let found = false;
        const walk = (child: ts.Node) => {
            if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) found = true;
            if (ts.isCallExpression(child) && /(?:^|\.)createElement$/.test(child.expression.getText())) found = true;
            ts.forEachChild(child, walk);
        };
        walk(node);
        return found;
    };
    const register = (symbol: ts.Symbol): string | undefined => {
        symbol = unalias(symbol);
        const assignment = symbol.valueDeclaration;
        if (assignment && ts.isExportAssignment(assignment) && ts.isIdentifier(assignment.expression)) {
            const implementation = checker.getSymbolAtLocation(assignment.expression);
            if (implementation && implementation !== symbol) return register(implementation);
        }
        if (symbols.has(symbol)) return symbols.get(symbol);
        const declarations = symbol.getDeclarations() ?? [];
        const declaration = symbol.valueDeclaration ?? declarations[0];
        if (!declaration) return undefined;
        const file = declaration.getSourceFile();
        if (!fileSet.has(path.resolve(file.fileName))) return undefined;
        const name = ts.isSourceFile(declaration) ? path.basename(file.fileName).replace(/\.[^.]+$/, '') : symbol.getName() === 'default' && 'name' in declaration && declaration.name && ts.isIdentifier(declaration.name as ts.Node)
            ? (declaration.name as ts.Identifier).text : symbol.getName() === 'default' ? path.basename(file.fileName).replace(/\.[^.]+$/, '') : symbol.getName();
        const typeOnly = !(symbol.flags & ts.SymbolFlags.Value);
        const ui = !typeOnly && (/^[A-Z]/.test(name) || symbol.getName() === 'default') && declarations.some(hasUi);
        const id = `${encodeURIComponent(relative(file.fileName))}#${encodeURIComponent(symbol.getName())}`;
        nodes.set(id, { id, name, path: relative(file.fileName), kind: ts.isSourceFile(declaration) || ts.isModuleDeclaration(declaration) ? 'module' : typeOnly ? 'type' : ui ? 'ui' : 'value', publicNames: [],
            ...(ui ? { uiReason: 'Déclaration avec nom majuscule et JSX/createElement.' } : {}) });
        symbols.set(symbol, id);
        bodies.set(id, declarations);
        if (!fileNodes.has(path.resolve(file.fileName))) fileNodes.set(path.resolve(file.fileName), new Set());
        fileNodes.get(path.resolve(file.fileName))!.add(id);
        return id;
    };
    const collectBindings = (name: ts.BindingName): void => {
        if (ts.isIdentifier(name)) {
            const symbol = checker.getSymbolAtLocation(name);
            if (symbol) register(symbol);
        } else for (const binding of name.elements) if (ts.isBindingElement(binding)) collectBindings(binding.name);
    };
    for (const file of program.getSourceFiles().filter(file => fileSet.has(path.resolve(file.fileName)))) {
        for (const statement of file.statements) {
            if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) collectBindings(declaration.name);
            else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) ||
                ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) && statement.name) {
                const symbol = checker.getSymbolAtLocation(statement.name);
                if (symbol) register(symbol);
            }
        }
        const module = checker.getSymbolAtLocation(file);
        if (module) for (const exported of checker.getExportsOfModule(module)) register(exported);
        if (module && !fileNodes.get(path.resolve(file.fileName))?.size && file.statements.some(statement =>
            ts.isExpressionStatement(statement) || (ts.isImportDeclaration(statement) && !statement.importClause))) register(module);
    }
    const externalNode = (pkg: string): string => {
        const id = `package:${encodeURIComponent(pkg)}`;
        if (!nodes.has(id)) nodes.set(id, { id, name: pkg, path: '', kind: 'external', publicNames: [], package: pkg });
        return id;
    };
    const imports = new Map<ts.Symbol, { target?: string; package?: string; typeOnly: boolean }>();
    for (const file of program.getSourceFiles().filter(file => fileSet.has(path.resolve(file.fileName)))) {
        for (const statement of file.statements) {
            if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
            const specifier = statement.moduleSpecifier.text;
            if (isResource(specifier)) continue;
            const resolution = ts.resolveModuleName(specifier, file.fileName, compilerOptions, ts.sys).resolvedModule;
            const isLocal = specifier.startsWith('.') || path.isAbsolute(specifier) ||
                Object.keys(compilerOptions.paths ?? {}).some(pattern => pattern !== '*' && new RegExp('^' + pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(specifier));
            if (!resolution && isLocal) throw new Error(`Import local non résolu : ${specifier} depuis ${file.fileName}`);
            const local = resolution && fileSet.has(path.resolve(resolution.resolvedFileName));
            if (resolution && !resolution.isExternalLibraryImport && !inside(resolution.resolvedFileName)) {
                diagnostics.push(`Source hors périmètre ignorée : ${specifier} depuis ${relative(file.fileName)}`);
                continue;
            }
            const pkg = !local && (!isLocal || resolution?.isExternalLibraryImport) ? packageName(specifier) : undefined;
            const bindings: { name: ts.Identifier; typeOnly: boolean }[] = [];
            const clause = statement.importClause;
            if (clause?.name) bindings.push({ name: clause.name, typeOnly: clause.isTypeOnly });
            if (clause?.namedBindings) {
                if (ts.isNamespaceImport(clause.namedBindings)) bindings.push({ name: clause.namedBindings.name, typeOnly: clause.isTypeOnly });
                else for (const binding of clause.namedBindings.elements) bindings.push({ name: binding.name, typeOnly: clause.isTypeOnly || binding.isTypeOnly });
            }
            for (const binding of bindings) {
                const symbol = checker.getSymbolAtLocation(binding.name);
                if (!symbol) continue;
                const target = register(symbol);
                if (local && !target && !ts.isNamespaceImport(binding.name.parent)) throw new Error(`Export non résolu : ${binding.name.text} depuis ${specifier}`);
                imports.set(symbol, { target, package: pkg, typeOnly: binding.typeOnly });
            }
            // Les imports à effets de bord concernent le module entier.
            if (!clause) for (const owner of fileNodes.get(path.resolve(file.fileName)) ?? []) {
                if (local) for (const target of fileNodes.get(path.resolve(resolution!.resolvedFileName)) ?? []) addEdge(owner, target);
                else if (pkg && input.external) addEdge(owner, externalNode(pkg));
            }
        }
    }
    // Références par déclaration : les imports inutilisés ne deviennent pas des dépendances.
    const collectReferences = () => {
    for (const [owner, declarations] of bodies) {
        const walk = (node: ts.Node, inType = false) => {
            const type = inType || ts.isTypeNode(node);
            if (ts.isIdentifier(node)) {
                const symbol = checker.getSymbolAtLocation(node);
                if (symbol) {
                    const imported = imports.get(symbol);
                    let target = imported?.target ?? symbols.get(unalias(symbol));
                    if (!target && imported?.package && input.external) target = externalNode(imported.package);
                    if (target) addEdge(owner, target, type || imported?.typeOnly || nodes.get(owner)?.kind === 'type' ? 'type' : 'runtime');
                }
            }
            ts.forEachChild(node, child => walk(child, type));
        };
        for (const declaration of declarations) walk(declaration);
        if (input.external && declarations.some(hasUi)) {
            const jsxPackage = compilerOptions.jsxImportSource ??
                (compilerOptions.jsx === ts.JsxEmit.React || compilerOptions.jsx === ts.JsxEmit.ReactJSX || compilerOptions.jsx === ts.JsxEmit.ReactJSXDev ? 'react' : undefined);
            if (jsxPackage) addEdge(owner, externalNode(packageName(jsxPackage)));
        }
    }
    };
    const exports: PublicExport[] = [];
    for (const entry of entries) {
        const file = program.getSourceFile(entry)!;
        const module = checker.getSymbolAtLocation(file);
        if (!module) throw new Error(`Point d’entrée sans exports ESM : ${entry}`);
        const pendingExports = checker.getExportsOfModule(module).map(symbol => ({ symbol, name: symbol.getName(), typeOnly: false, seen: new Set<ts.Symbol>() }));
        while (pendingExports.length) {
            const item = pendingExports.shift()!;
            const exported = item.symbol;
            let id = register(exported);
            if (!id) {
                const declaration = exported.declarations?.[0];
                const exportDeclaration = declaration && ts.isExportSpecifier(declaration) && ts.isExportDeclaration(declaration.parent.parent) ? declaration.parent.parent : undefined;
                const specifier = exportDeclaration?.moduleSpecifier && ts.isStringLiteral(exportDeclaration.moduleSpecifier) ? exportDeclaration.moduleSpecifier.text : undefined;
                const externalDeclaration = unalias(exported).declarations?.[0]?.getSourceFile().fileName;
                const modulePackage = externalDeclaration && slash(externalDeclaration).split('/node_modules/').at(-1);
                const pkg = specifier && !specifier.startsWith('.') && !path.isAbsolute(specifier) ? packageName(specifier)
                    : externalDeclaration?.includes('node_modules') && modulePackage ? packageName(modulePackage) : undefined;
                if (specifier && isResource(specifier)) {
                    const asset = path.resolve(path.dirname(declaration!.getSourceFile().fileName), specifier);
                    if (!fs.existsSync(asset)) throw new Error(`Ressource publique absente : ${asset}`);
                    id = `asset:${encodeURIComponent(relative(asset))}`;
                    if (!nodes.has(id)) nodes.set(id, { id, name: exported.getName(), path: relative(asset), kind: 'asset', publicNames: [] });
                } else if (pkg) {
                    id = `package:${encodeURIComponent(pkg)}#${encodeURIComponent(exported.getName())}`;
                    if (!nodes.has(id)) nodes.set(id, { id, name: exported.getName(), path: '', kind: 'external', package: pkg, publicNames: [] });
                } else throw new Error(`Export public non résolu : ${relative(entry)}:${exported.getName()}. Vérifier la déclaration et ses réexports.`);
            }
            const name = item.name;
            const declaration = exported.declarations?.[0];
            const typeOnly = item.typeOnly || nodes.get(id)!.kind === 'type' || Boolean(declaration && ts.isExportSpecifier(declaration) &&
                (declaration.isTypeOnly || (ts.isExportDeclaration(declaration.parent.parent) && declaration.parent.parent.isTypeOnly)));
            exports.push({ entry: relative(entry), name, id, typeOnly });
            nodes.get(id)!.publicNames.push(name);
            if (!typeOnly && nodes.get(id)!.kind !== 'module' && /^[A-Z]/.test(name.split('.').at(-1)!) && (bodies.get(id) ?? []).some(hasUi)) {
                nodes.get(id)!.kind = 'ui';
                nodes.get(id)!.uiReason = 'Export public majuscule avec JSX/createElement dans la définition.';
            }
            const namespace = unalias(exported);
            if (nodes.get(id)!.kind === 'module' && !item.seen.has(namespace)) {
                const seen = new Set(item.seen).add(namespace);
                for (const member of checker.getExportsOfModule(namespace)) pendingExports.push({
                    symbol: member, name: `${name}.${member.getName()}`, typeOnly, seen,
                });
            }
        }
    }
    for (const name of [...(input.uiInclude ?? []), ...(input.uiExclude ?? [])]) {
        const matches = [...nodes.values()].filter(node => node.publicNames.includes(name) || node.id === name);
        if (!matches.length) throw new Error(`Classification UI inconnue : ${name}`);
        if (matches.length > 1) throw new Error(`Classification UI ambiguë : ${name}. Utiliser un identifiant.`);
    }
    for (const node of nodes.values()) {
        node.publicNames = [...new Set(node.publicNames)].sort(naturalCompare);
        if (input.uiInclude?.some(name => node.publicNames.includes(name) || node.id === name)) {
            if (node.kind === 'type') throw new Error(`Un type ne peut pas être classé UI : ${node.name}`);
            node.kind = 'ui'; node.uiReason = 'Classification explicite --ui-include.';
        }
        if (input.uiExclude?.some(name => node.publicNames.includes(name) || node.id === name)) {
            if (node.kind === 'ui') node.kind = 'value';
            node.uiReason = 'Exclusion explicite --ui-exclude.';
        }
    }
    collectReferences();
    const compareIds = (a: string, b: string) => naturalCompare(libraryDisplayName(nodes.get(a)!), libraryDisplayName(nodes.get(b)!)) || naturalCompare(a, b);
    const compareEdges = (a: LibraryEdge, b: LibraryEdge) => compareIds(a.source, b.source) || compareIds(a.target, b.target) || naturalCompare(a.kind, b.kind);
    const allNodes = [...nodes.values()].sort((a, b) => compareIds(a.id, b.id));
    const allEdges = [...edgeMap.values()].sort(compareEdges);
    const selected = new Set(allNodes.filter(node => input.view === 'dependencies' ||
        exports.some(exp => exp.id === node.id && (input.view === 'public-api' || (!exp.typeOnly && node.kind === 'ui')))).map(node => node.id));
    const adjacent = new Map<string, LibraryEdge[]>();
    for (const edge of allEdges) {
        if (!adjacent.has(edge.source)) adjacent.set(edge.source, []);
        adjacent.get(edge.source)!.push(edge);
    }
    // Les éléments internes restent dans analysis et servent de pont entre les éléments publics.
    const projected = new Map<string, LibraryEdge>();
    for (const owner of selected) {
        const pending = (adjacent.get(owner) ?? []).map(edge => ({ target: edge.target, kind: edge.kind }));
        const seen = new Set<string>();
        while (pending.length) {
            const { target, kind } = pending.pop()!;
            if (input.view === 'public-ui' && kind === 'type') continue;
            const key = `${target}\0${kind}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (selected.has(target)) {
                if (target !== owner) projected.set(`${owner}\0${target}\0${kind}`, { source: owner, target, kind });
            } else pending.push(...(adjacent.get(target) ?? []).map(edge => ({ target: edge.target,
                kind: kind === 'type' ? 'type' as const : edge.kind })));
        }
    }
    const viewEdges = input.view === 'dependencies' ? allEdges : [...projected.values()].sort(compareEdges);
    const deps = new Map(allNodes.map(node => [node.id, new Set<string>()]));
    const reverse = new Map(allNodes.map(node => [node.id, new Set<string>()]));
    for (const edge of allEdges) { deps.get(edge.source)!.add(edge.target); reverse.get(edge.target)!.add(edge.source); }
    const topology = analyzeTopology(new Graph(deps, reverse));
    const metrics = allNodes.map(node => {
        let sourceLines = 0;
        let branches = 0;
        for (const declaration of bodies.get(node.id) ?? []) {
            sourceLines += declaration.getText().split(/\r?\n/).length;
            const count = (child: ts.Node) => {
                if (ts.isIfStatement(child) || ts.isConditionalExpression(child) || ts.isCaseClause(child) ||
                    ts.isForStatement(child) || ts.isForInStatement(child) || ts.isForOfStatement(child) ||
                    ts.isWhileStatement(child) || ts.isDoStatement(child) || ts.isCatchClause(child)) branches++;
                ts.forEachChild(child, count);
            };
            count(declaration);
        }
        return { id: node.id, directDependencies: deps.get(node.id)!.size,
            directDependents: reverse.get(node.id)!.size, sourceLines, branches };
    });
    const levels = [...new Set(topology.levels.values())].sort((a, b) => a - b).map(level => ({
        level, components: allNodes.filter(node => topology.levels.get(node.id) === level).map(node => node.id),
    }));
    diagnostics.push('UI : détection syntaxique (nom majuscule et JSX/createElement), à vérifier ; ajuster avec --ui-include/--ui-exclude.');
    diagnostics.push('Analyse statique ESM : imports dynamiques, require calculés et comportement runtime non garantis. Les types sont des nœuds distincts et les relations typées sont identifiées.');
    return { schemaVersion: 1, source, entries: entries.map(relative), view: input.view,
        nodes: allNodes.filter(node => selected.has(node.id)), edges: viewEdges,
        exports: exports.sort((a, b) => naturalCompare(a.name, b.name) || naturalCompare(a.entry, b.entry) || naturalCompare(a.id, b.id)),
        analysis: { nodes: allNodes, edges: allEdges }, levels,
        cyclicGroups: topology.cyclicGroups.map(group => group.sort(compareIds)).sort((a, b) => compareIds(a[0], b[0])), metrics,
        diagnostics: [...new Set(diagnostics)].sort(naturalCompare) };
}

export function selectLibrary(result: LibraryResult, names: string[], direction: 'required' | 'impact') {
    const nodes = result.analysis.nodes;
    const roots = new Set<string>();
    for (const name of names) {
        const matches = nodes.filter(node => node.id === name || node.publicNames.includes(name) || node.name === name);
        if (!matches.length) throw new Error(`Composant inconnu : ${name}`);
        if (matches.length > 1) throw new Error(`Nom ambigu : ${name}. Utiliser un identifiant : ${matches.map(node => node.id).join(', ')}`);
        roots.add(matches[0].id);
    }
    const selected = new Set(roots);
    const pending = [...roots];
    const adjacency = new Map<string, string[]>();
    for (const edge of result.analysis.edges) {
        const from = direction === 'required' ? edge.source : edge.target;
        const to = direction === 'required' ? edge.target : edge.source;
        if (!adjacency.has(from)) adjacency.set(from, []);
        adjacency.get(from)!.push(to);
    }
    while (pending.length) for (const target of adjacency.get(pending.pop()!) ?? []) {
        if (!selected.has(target)) { selected.add(target); pending.push(target); }
    }
    const compareIds = (a: string, b: string) => naturalCompare(libraryDisplayName(nodes.find(node => node.id === a)!), libraryDisplayName(nodes.find(node => node.id === b)!)) || naturalCompare(a, b);
    return { direction, requested: [...roots].sort(compareIds), components: nodes.filter(node => selected.has(node.id)),
        metrics: result.metrics.filter(metric => selected.has(metric.id)),
        levels: result.levels.map(group => ({ ...group, components: group.components.filter(id => selected.has(id)) })).filter(group => group.components.length),
        cyclicGroups: result.cyclicGroups.filter(group => group.some(id => selected.has(id))) };
}
