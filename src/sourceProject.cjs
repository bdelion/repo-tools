const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const parser = require('@babel/parser');
const { createHash } = require('node:crypto');

function parseSource(content, file) {
  const extension = path.extname(file).toLowerCase();
  const isTypeScript = ['.ts', '.tsx', '.mts', '.cts'].includes(extension);
  const plugins = [];
  if (isTypeScript) plugins.push(['typescript', { disallowAmbiguousJSXLike: extension === '.mts' }]);
  if (!isTypeScript || extension === '.tsx') plugins.push('jsx');
  let ast;
  try {
    ast = parser.parse(content, { sourceType: 'unambiguous', plugins });
  } catch (error) {
    throw new Error(`Syntaxe invalide dans ${file}: ${error.message}`, { cause: error });
  }
  const imports = [];
  const exports = [];
  const bindingNames = node => {
    if (!node) return [];
    if (node.type === 'Identifier') return [node.name];
    if (node.type === 'RestElement') return bindingNames(node.argument);
    if (node.type === 'AssignmentPattern') return bindingNames(node.left);
    if (node.type === 'ObjectPattern') return node.properties.flatMap(p => bindingNames(p.value ?? p.argument));
    if (node.type === 'ArrayPattern') return node.elements.flatMap(bindingNames);
    return [];
  };
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration' && node.importKind !== 'type') {
      for (const spec of node.specifiers) {
        if (spec.importKind === 'type') continue;
        imports.push({ source: node.source.value, local: spec.local.name,
          imported: spec.type === 'ImportDefaultSpecifier' ? 'default' :
            spec.type === 'ImportNamespaceSpecifier' ? '*' : spec.imported.name ?? spec.imported.value });
      }
      if (!node.specifiers.length) imports.push({ source: node.source.value, imported: '*', local: '' });
    }
    if (node.type === 'ExportDefaultDeclaration' && !['TSInterfaceDeclaration', 'TSDeclareFunction'].includes(node.declaration.type)) {
      exports.push({ name: 'default', local: node.declaration.id?.name ?? node.declaration.name ?? 'default' });
    }
    if (node.type === 'ExportAllDeclaration' && node.exportKind !== 'type') {
      exports.push({ name: '*', source: node.source.value, imported: '*' });
    }
    if (node.type !== 'ExportNamedDeclaration' || node.exportKind === 'type') continue;
    const declaration = node.declaration;
    if (declaration && !declaration.declare && !['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'].includes(declaration.type)) {
      const names = declaration.type === 'VariableDeclaration' ? declaration.declarations.flatMap(d => bindingNames(d.id)) : bindingNames(declaration.id);
      for (const name of names) exports.push({ name, local: name });
    }
    for (const spec of node.specifiers ?? []) {
      if (spec.exportKind === 'type') continue;
      const name = spec.exported.name ?? spec.exported.value;
      exports.push({ name, local: spec.local?.name ?? name,
        ...(node.source ? { source: node.source.value, imported: spec.local?.name ?? '*' } : {}) });
    }
  }
  for (const exp of exports) {
    const imported = imports.find(item => item.local === exp.local);
    if (!exp.source && imported) Object.assign(exp, { source: imported.source, imported: imported.imported });
    const displayName = exp.name === 'default' ? exp.local : exp.name;
    const visibleNames = [...content.matchAll(/@visibleName\s+([^\w]+)\s+(\w+)/g)];
    exp.icone = visibleNames.find(match => match[2] === displayName)?.[1].trim() ?? '';
  }
  return { imports, exports, ast: ast.program.body };
}

function createSourceProject(root, { assetExtensions = [] } = {}) {
  root = path.resolve(root);
  let directory = root;
  let configFile;
  while (true) {
    const candidate = path.join(directory, 'tsconfig.json');
    if (fs.existsSync(candidate)) { configFile = candidate; break; }
    // Ne pas hériter accidentellement du tsconfig de repo-tools pour ses clones.
    if (fs.existsSync(path.join(directory, 'package.json')) || fs.existsSync(path.join(directory, '.git'))) break;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  let options = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Node10 };
  if (configFile) {
    const loaded = ts.readConfigFile(configFile, ts.sys.readFile);
    if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configFile));
    const errors = parsed.errors.filter(error => error.code !== 18003);
    if (errors.length) throw new Error(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
    options = { ...options, ...parsed.options, allowJs: true };
  }
  const cache = new Map();
  const read = file => {
    file = path.resolve(file);
    if (!cache.has(file)) cache.set(file, parseSource(fs.readFileSync(file, 'utf8'), file));
    return cache.get(file);
  };
  const isAsset = file => assetExtensions.some(extension => file.endsWith(extension));
  const resolve = (from, source) => {
    if (/\.(css|scss|sass|less|svg|png|jpe?g|gif|json)$/.test(source)) {
      if (isAsset(source) && source.startsWith('.')) {
        const target = path.resolve(path.dirname(from), source);
        if (!fs.existsSync(target)) throw new Error(`Asset local non résolu : ${source} depuis ${from}`);
        return target;
      }
      return null;
    }
    const resolution = ts.resolveModuleName(source, from, options, ts.sys).resolvedModule;
    if (resolution && !resolution.isExternalLibraryImport && !resolution.resolvedFileName.endsWith('.d.ts')) {
      return path.resolve(resolution.resolvedFileName);
    }
    const local = source.startsWith('.') || path.isAbsolute(source) || Object.keys(options.paths ?? {}).some(pattern => {
      const [prefix, suffix = ''] = pattern.split('*');
      return pattern.includes('*') ? source.startsWith(prefix) && source.endsWith(suffix) : source === pattern;
    });
    if (local) throw new Error(`Import local non résolu : ${source} depuis ${from}`);
    return null;
  };
  const resolveExport = (file, name, visiting = new Set()) => {
    const key = `${file}#${name}`;
    if (visiting.has(key)) return null;
    const next = new Set(visiting).add(key);
    const exports = read(file).exports;
    const explicit = exports.find(item => item.name === name);
    if (explicit) {
      if (!explicit.source) return { file, name, local: explicit.local };
      const target = resolve(file, explicit.source);
      if (target && isAsset(target)) return { file: target, name: explicit.imported, asset: true };
      if (target && explicit.imported === '*') return { file: target, name: '*', local: explicit.name };
      return target ? resolveExport(target, explicit.imported, next) : null;
    }
    if (name === 'default') return null;
    const matches = exports.filter(item => item.name === '*').flatMap(item => {
      const target = resolve(file, item.source);
      const found = target && resolveExport(target, name, next);
      return found ? [found] : [];
    });
    const unique = new Map(matches.map(item => [`${item.file}#${item.name}`, item]));
    if (unique.size > 1) throw new Error(`Réexport ambigu : ${name} dans ${file}`);
    return [...unique.values()][0] ?? null;
  };
  const exportedNames = (file, visited = new Set()) => {
    if (visited.has(file)) return [];
    const next = new Set(visited).add(file);
    return [...new Set(read(file).exports.flatMap(exp => {
      if (exp.name !== '*') return [exp.name];
      const target = resolve(file, exp.source);
      return target ? exportedNames(target, next).filter(name => name !== 'default') : [];
    }))];
  };
  return { read, resolve, resolveExport, exportedNames, options };
}

function analysisFingerprint(config) {
  const files = ['sourceProject.cjs', 'versionReferences.cjs', 'analyse-component-versions.js'];
  const hash = createHash('sha256');
  // Les paramètres d'affichage et chemins ne modifient pas les données analysées.
  for (const key of ['srcDir', 'includeExportAll', 'excludeDefaultNameEverywhere', 'excludeDirNames',
    'excludeFilePatterns', 'validCodeExtensions', 'validAssetExtensions']) hash.update(JSON.stringify([key, config[key]]));
  for (const file of files) hash.update(fs.readFileSync(path.join(__dirname, file)));
  hash.update(require('@babel/parser/package.json').version);
  hash.update(ts.version);
  return hash.digest('hex');
}

function buildSourceGraph(root, files, excluded = () => false) {
  root = path.resolve(root);
  const project = createSourceProject(root);
  const nodes = new Map();
  const edges = new Map();
  const relative = file => path.relative(root, file).replace(/\\/g, '/');
  const id = (file, name) => `${encodeURIComponent(relative(file))}#${encodeURIComponent(name)}`;
  const exportNames = (file, visited = new Set()) => {
    if (visited.has(file)) return [];
    const next = new Set(visited).add(file);
    return [...new Set(project.read(file).exports.flatMap(exp => {
      if (exp.name !== '*') return [exp.name];
      const target = project.resolve(file, exp.source);
      return target ? exportNames(target, next).filter(name => name !== 'default') : [];
    }))];
  };
  const pending = [...files];
  const visited = new Set();
  while (pending.length) {
    const file = path.resolve(pending.pop());
    if (visited.has(file) || excluded(relative(file))) continue;
    visited.add(file);
    if (relative(file).startsWith('../')) throw new Error(`Source hors du périmètre : ${file}`);
    const source = project.read(file);
    const names = exportNames(file).filter(name => {
      const declaration = source.exports.find(item => item.name === name);
      if (declaration?.source && !project.resolve(file, declaration.source)) return false;
      if (!project.resolveExport(file, name)) throw new Error(`Export local non résolu : ${name} dans ${file}`);
      return true;
    });
    for (const name of names) {
      const exp = source.exports.find(item => item.name === name);
      nodes.set(id(file, name), { id: id(file, name), visibleName: name === 'default' ? exp?.local ?? name : name,
        icone: exp?.icone ?? '', fileName: relative(file) });
    }
    const requests = [...source.imports, ...source.exports.filter(exp => exp.source)];
    for (const request of requests) {
      const target = project.resolve(file, request.source);
      if (!target || excluded(relative(target))) continue;
      pending.push(target);
      const requested = request.imported === '*' ? exportNames(target) : [request.imported];
      for (const name of requested) {
        const resolved = project.resolveExport(target, name);
        if (!resolved) throw new Error(`Export introuvable : ${name} depuis ${request.source} dans ${file}`);
        const targetNames = exportNames(target);
        if (!targetNames.includes(name)) throw new Error(`Export introuvable : ${name} dans ${target}`);
        for (const ownName of names) {
          const ownId = id(file, ownName);
          if (!edges.has(ownId)) edges.set(ownId, new Set());
          edges.get(ownId).add(id(target, name));
        }
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges].map(([source, targets]) => [source, [...targets]]) };
}

module.exports = { parseSource, createSourceProject, analysisFingerprint, buildSourceGraph };
