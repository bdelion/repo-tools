#!/usr/bin/env node

// ==========================
// Analyse & Comparaison d'exports multi-tags pour libs UI
// Version complète – Option B + Tables Markdown minifiées – 2025-10-20
// ==========================

/**
 * Points clés :
 * - Scan de src/** (walk récursif) avec exclusions
 * - Détection d'exports via AST Babel :
 *    - export { default as X } from './y'
 *    - export { X } from './y'
 *    - export * from './y' (exclu par défaut)
 * - Association composant -> fichier source (JS/TS/JSX/TSX ou .svg/.component.svg)
 * - Calcul hash, AST “nettoyé”, métadonnées (visibleName, declarationName, forwardRef, memo, default export)
 * - Comparaison entre tags consécutifs : hash, AST, git diff
 * - Rapports: JSON/MD pair-à-pair + Excel/MD global
 * - Exclusions globales : exportAll, name === "default" (Option B)
 * - Tri par nom (insensible à la casse) dans analyses & rapports pair-à-pair
 * - Tables Markdown compactes/minifiées (padding off), suppression auto des colonnes 100% vides (config)
 * - Caches: sha_index.json (tags déjà analysés), git_diff_cache.json (diffs)
 * - CLI et config externe optionnelle
 */

// --------------------------
// Imports
// --------------------------
const simpleGit = require('simple-git');
const fs = require('fs-extra');
const path = require('path');
const semverSort = require('semver/functions/sort');
const ExcelJS = require('exceljs');
const nodeCrypto = require('node:crypto');
const babelParser = require('@babel/parser');
const {
  branchReference, inVersionRange, selectReferences, analysisFileName,
  comparisonFileName, isGeneratedAnalysisFile,
} = require('./versionReferences.cjs');

// --------------------------
// CLI & Config
// --------------------------

// CLI minimaliste sans dépendance externe
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.split('=');
      const key = k.replace(/^--/, '');
      args[key] = v !== undefined ? v : true;
    }
  }
  return args;
}
const args = parseArgs(process.argv);

// Fichier de config externe optionnel (JSON)
const CONFIG_PATH = args.config ?? `${__dirname}/config.analyse-component-versions.json`;

// Valeurs par défaut (surchageables par config externe et/ou CLI)
const DEFAULT_CONFIG = {
  repos: [
    // Exemple :
    { name: 'repo-react', url: 'git@github.enterprise.io:commons/repo-react.git' },
    { name: 'repo-react-enterprise', url: 'git@github.enterprise.io:commons/repo-react-enterprise.git' },
    { name: 'enterprise-assets', url: 'git@github.enterprise.io:commons/enterprise-assets.git' }
  ],
  githubBaseUrl: 'https://github.enterprise.io/commons', // base pour les liens
  tmpDir: '.tmp',
  analysisDir: './analyses',
  reportsDir: './reports',
  shaIndexPath: './analyses/sha_index.json',
  gitDiffCachePath: './analyses/git_diff_cache.json',
  srcDir: 'src',

  // Exclusions globales
  includeExportAll: false,                // on exclut export * par défaut
  excludeDefaultNameEverywhere: true,     // Option B : on exclut toujours name === "default"
  excludeDirNames: ['node_modules', 'dist', 'build', '.git'],
  excludeFilePatterns: ['test', 'spec', 'mock', 'stub', 'e2e', 'style', '.md', '.markdown'],
  validCodeExtensions: ['.js', '.jsx', '.ts', '.tsx'],
  validAssetExtensions: ['.svg', '.component.svg'],

  // Filtrage des tags
  ignorePrereleaseTags: ['-SNAPSHOT', '-rc.', '-hc.'],
  tagMin: args.tagMin || null,
  tagMax: args.tagMax || null,

  // Contrôle de l’analyse
  parallel: Number(args.parallel || 4),
  debug: Boolean(args.debug || false),

  // Affichage Markdown
  markdownShowFullPathLabels: true,   // global report: libellé = chemin complet si true, sinon basename
  markdownCompactTables: true,        // minifier/compacter les tableaux Markdown (padding off)
  markdownDropEmptyColumns: true      // supprimer colonnes 100% vides dans les tableaux
};

// Charge config externe si présente
function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const cfg = fs.readJsonSync(CONFIG_PATH);
      return { ...DEFAULT_CONFIG, ...cfg };
    } catch (e) {
      console.warn(`⚠️ Impossible de lire ${CONFIG_PATH}, utilisation de la config par défaut.`, e.message);
    }
  }
  return DEFAULT_CONFIG;
}
const CFG = loadConfig();
const DEBUG = !!CFG.debug;

// --------------------------
// Utils
// --------------------------

// 🧼 Sanitize des résultats relus depuis disque
function sanitizeResult(result) {
  if (!result?.components) return result;
  return {
    ...result,
    components: result.components.filter(
      c => c?.exportType !== 'exportAll' && c?.name !== 'default'
    )
  };
}

function logDebug(...args) {
  if (DEBUG) console.log('🪵[debug]', ...args);
}

function ensureDirs() {
  fs.ensureDirSync(CFG.tmpDir);
  fs.ensureDirSync(CFG.analysisDir);
  fs.ensureDirSync(CFG.reportsDir);
}

function nowIso() {
  return new Date().toISOString();
}

function isPrereleaseTag(tag) {
  return CFG.ignorePrereleaseTags.some((p) => tag.includes(p));
}

function inTagRange(tag) {
  return inVersionRange(tag, CFG.tagMin, CFG.tagMax);
}

function filterAndSortTags(tags) {
  const clean = tags.filter(
    (t) => !isPrereleaseTag(t) && /^\d+\.\d+\.\d+$/.test(t) && inTagRange(t)
  );
  return semverSort(clean);
}

function githubLink(repoName, ref, filePath) {
  return `${CFG.githubBaseUrl}/${repoName}/blob/${encodeURIComponent(ref)}/${String(filePath).replace(/\\/g, '/')}`;
}

// Helper lien Markdown sûr
function mdLink(label, url) {
  return label && url ? `[${label}](${url})` : '';
}

// Walk récursif (sans dépendance) + filtres
async function walkDir(dir) {
  const list = [];
  async function walk(d) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (CFG.excludeDirNames.includes(e.name)) continue;
        await walk(p);
      } else {
        list.push(p);
      }
    }
  }
  await walk(dir);
  return list;
}

// Limiteur de parallélisme sans dépendance (p-limit light)
function pLimit(concurrency) {
  const queue = [];
  let activeCount = 0;
  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      const { fn, resolve, reject } = queue.shift();
      run(fn).then(resolve, reject);
    }
  };
  const run = async (fn) => {
    activeCount++;
    try {
      const result = await fn();
      next();
      return result;
    } catch (err) {
      next();
      throw err;
    }
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      if (activeCount < concurrency) {
        run(fn).then(resolve, reject);
      } else {
        queue.push({ fn, resolve, reject });
      }
    });
}

// Nettoyage d'AST (enlève loc/start/end/comments/etc.)
function cleanAST(ast) {
  const clone = JSON.parse(JSON.stringify(ast));
  const removeMeta = (node) => {
    if (node && typeof node === 'object') {
      delete node.loc;
      delete node.start;
      delete node.end;
      delete node.comments;
      for (const k of Object.keys(node)) removeMeta(node[k]);
    }
  };
  removeMeta(clone);
  return clone;
}

function areASTsEqualFromJSON(astJson1, astJson2) {
  try {
    if (!astJson1 || !astJson2) return false;
    const a1 = JSON.parse(astJson1);
    const a2 = JSON.parse(astJson2);
    return JSON.stringify(a1) === JSON.stringify(a2);
  } catch {
    return false;
  }
}

// Métadonnées robustes
function extractMetadata(content) {
  const declFromConst = content.match(/^\s*const\s+(\w+)\s*=/m);
  const declFromFunc = content.match(/^\s*function\s+(\w+)\s*\(/m);
  const declarationName = (declFromConst?.[1] ?? declFromFunc?.[1]) ?? null;

  const usesForwardRef = /\bforwardRef\s*\(/.test(content);
  const usesMemo = /\bmemo\s*\(/.test(content);
  const isDefaultExport = /\bexport\s+default\b/.test(content);

  // @visibleName: tolérance : "@visibleName MyNiceName" OU "@visibleName: MyNiceName"
  let visibleName = null;
  const v1 = content.match(/@visibleName\s*[:=]\s*([^\r\n]+)/);
  const v2 = content.match(/@visibleName\s+([^\r\n]+)/);
  if (v1?.[1]) visibleName = v1[1].trim();
  else if (v2?.[1]) visibleName = v2[1].trim();

  return { visibleName, declarationName, usesForwardRef, usesMemo, isDefaultExport };
}

function isInvalidAssetExt(p) {
  const ext = path.extname(p).toLowerCase();
  const invalids = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.css', '.scss', '.less', '.md', '.markdown', '.json', '.yml', '.yaml'];
  return invalids.includes(ext);
}

// Sélection du label à afficher dans le Markdown
function labelOf(p) {
  if (!p) return '';
  const normalized = String(p).replace(/\\/g, '/');
  return CFG.markdownShowFullPathLabels ? normalized : path.basename(normalized);
}

// Recherche des fichiers liés à un export (priorise code > assets)
function matchCandidateFiles(allRelativeFiles, exportName, relativeImportPath) {
  // On tente par priorité : 1) baseName du chemin d'import 2) nom de l'export
  const candidates = new Set();
  const ext = path.extname(relativeImportPath);
  const importBase = path.basename(relativeImportPath, ext).toLowerCase();
  const nameBase = String(exportName || '').toLowerCase();

  const tryMatch = (target) => {
    for (const f of allRelativeFiles) {
      const base = path.basename(f, path.extname(f)).toLowerCase();
      if (base === target) candidates.add(f);
    }
  };
  if (importBase) tryMatch(importBase);
  if (nameBase && nameBase !== importBase) tryMatch(nameBase);

  // Classement : code d’abord, puis .component.svg, puis .svg
  const codeExts = new Set(CFG.validCodeExtensions.map((e) => e.toLowerCase()));
  const assetPriority = (f) => {
    const e = path.extname(f).toLowerCase();
    if (codeExts.has(e)) return 0;
    if (e === '.component.svg') return 1;
    if (e === '.svg') return 2;
    return 10;
  };
  return Array.from(candidates).sort((a, b) => assetPriority(a) - assetPriority(b));
}

// --------------------------
// Caches
// --------------------------
ensureDirs();
let shaIndex = fs.existsSync(CFG.shaIndexPath) ? fs.readJsonSync(CFG.shaIndexPath) : {};
let gitDiffCache = fs.existsSync(CFG.gitDiffCachePath) ? fs.readJsonSync(CFG.gitDiffCachePath) : {};

// --------------------------
// Git helpers
// --------------------------

async function prepareRepo(repo) {
  const repoPath = path.join(CFG.tmpDir, repo.name);
  const git = simpleGit();
  if (!fs.existsSync(repoPath)) {
    console.log(`\t📥 Clonage de ${repo.name}...`);
    await git.clone(repo.url, repoPath);
  } else {
    console.log(`\t🔄 Mise à jour de ${repo.name}...`);
    const repoGit = simpleGit(repoPath);
    await repoGit.fetch(['--all', '--prune']);
    await repoGit.reset(['--hard', 'origin/HEAD']);
  }
  return repoPath;
}

/**
 * Date ISO fiable du tag (commit ou tag annoté).
 * prefer = 'commit' => date du commit pointé (déréférencement ^{})
 * prefer = 'tag'    => date du tag (taggerdate) si annoté
 */
async function getTagDate(repoPath, tag, prefer = 'commit') {
  const git = simpleGit(repoPath);
  const isIsoStrict = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/.test(s?.trim());

  const tryCommitDate = async () => {
    const out = await git.raw(['show', '-s', '--format=%cI', `${tag}^{}`]);
    const date = out.trim().split('\n').pop().trim();
    return isIsoStrict(date) ? date : null;
  };
  const tryTaggerDate = async () => {
    const out = await git.raw(['for-each-ref', `refs/tags/${tag}`, '--format=%(taggerdate:iso-strict)']);
    const date = out.trim().split('\n').pop().trim();
    return isIsoStrict(date) ? date : null;
  };
  const tryLog = async () => {
    const out = await git.raw(['log', '-1', '--format=%cI', tag]);
    const date = out.trim().split('\n').pop().trim();
    return isIsoStrict(date) ? date : null;
  };

  const pipelines = prefer === 'tag' ? [tryTaggerDate, tryCommitDate, tryLog] : [tryCommitDate, tryTaggerDate, tryLog];
  for (const fn of pipelines) {
    try {
      const d = await fn();
      if (d) return d;
    } catch { /* ignore */ }
  }
  return nowIso();
}

async function hasGitDiff(repoName, tag1, tag2, filePath) {
  const repoPath = path.join(CFG.tmpDir, repoName);
  const git = simpleGit(repoPath);
  try {
    gitDiffCache[repoName] = gitDiffCache[repoName] ?? {};
    gitDiffCache[repoName][tag1] = gitDiffCache[repoName][tag1] ?? {};
    gitDiffCache[repoName][tag1][tag2] = gitDiffCache[repoName][tag1][tag2] ?? {};

    if (gitDiffCache[repoName][tag1][tag2][filePath] !== undefined) {
      logDebug(`🔁 diff cache ${repoName} ${tag1}..${tag2} ${filePath}`);
      return gitDiffCache[repoName][tag1][tag2][filePath];
    }

    logDebug(`🔎 git diff ${repoName} ${tag1}..${tag2} -- ${filePath}`);
    const diff = await git.diff([tag1, tag2, '--find-renames', '-w', '--ignore-blank-lines', '--', filePath]);
    const changed = !!(diff && diff.trim().length > 0);
    gitDiffCache[repoName][tag1][tag2][filePath] = changed;
    return changed;
  } catch (err) {
    console.warn(`⚠️ git diff error for ${filePath} between ${tag1} and ${tag2} of ${repoName}:`, err.message);
    return false;
  }
}

// --------------------------
// Parsing exports (AST)
// --------------------------

function parseExportsFromFile(content) {
  // Renvoie une liste d’objets { type, name, source }
  // - type: 'default-named' pour { default as X } from '...'
  // - type: 'named' pour { X } from '...'
  // - type: 'exportAll' pour export * from '...'
  const results = [];
  let ast;
  try {
    ast = babelParser.parse(content, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  } catch {
    // fichier non code (ou TS très avancé), on renvoie vide
    return results;
  }
  const body = ast.program.body || [];
  for (const node of body) {
    if (node.type === 'ExportNamedDeclaration' && node.source && Array.isArray(node.specifiers)) {
      for (const s of node.specifiers) {
        if (s.type === 'ExportSpecifier') {
          const localName = s.local?.name;
          const exportedName = s.exported?.name;
          const src = node.source.value;
          if (localName === 'default' && exportedName) {
            results.push({ type: 'default-named', name: exportedName, source: src });
          } else if (exportedName) {
            results.push({ type: 'named', name: exportedName, source: src });
          }
        }
      }
    } else if (node.type === 'ExportAllDeclaration' && node.source) {
      results.push({ type: 'exportAll', name: '*', source: node.source.value });
    }
  }
  return results;
}

// --------------------------
// Analyse d’un tag
// --------------------------

async function getValidSourceFiles(srcPath) {
  if (!await fs.pathExists(srcPath)) return [];
  const all = await walkDir(srcPath);
  const validExts = new Set([...CFG.validCodeExtensions, ...CFG.validAssetExtensions].map((e) => e.toLowerCase()));
  return all
    .filter((f) => {
      const rel = path.relative(srcPath, f);
      const ext = path.extname(f).toLowerCase();
      const lower = rel.toLowerCase();
      return validExts.has(ext) && !CFG.excludeFilePatterns.some((p) => lower.includes(p));
    })
    .map((abs) => path.relative(srcPath, abs)); // relatif à src
}

/** Découvre et valide toutes les branches candidates avant de modifier les sorties. */
async function discoverReferences(repoPath) {
  const git = simpleGit(repoPath);
  const references = [];
  for (const tag of filterAndSortTags((await git.tags()).all)) {
    const sha = (await git.revparse([`${tag}^{commit}`])).trim();
    references.push({ kind: 'tag', version: tag, label: tag, sha });
  }
  const remoteRefs = await git.raw(['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin/']);
  for (const branch of remoteRefs.trim().split('\n').map(value => value.trim())) {
    if (branch !== 'develop' && !/^(release|hotfix)\//.test(branch)) continue;
    const sha = (await git.revparse([`refs/remotes/origin/${branch}^{commit}`])).trim();
    const packageJson = JSON.parse(await git.show([`${sha}:package.json`]));
    const reference = branchReference(branch, packageJson.version, sha);
    if (inTagRange(reference.version)) references.push(reference);
  }
  return selectReferences(references);
}

async function analyzeTag(repo, repoPath, gitRef, displayName, tagSha, reference) {
  const git = simpleGit(repoPath);
  await git.checkout(gitRef);

  const srcPath = path.join(repoPath, CFG.srcDir);
  const allFiles = await getValidSourceFiles(srcPath);

  // Parallélise le parsing (limité)
  const limit = pLimit(CFG.parallel);
  const components = [];
  const visitedFiles = new Set(); // éviter double parsing

  async function processFile(relFile) {
    if (visitedFiles.has(relFile)) return;
    visitedFiles.add(relFile);

    const abs = path.join(srcPath, relFile);
    const ext = path.extname(abs).toLowerCase();
    const isCode = CFG.validCodeExtensions.includes(ext);
    if (!isCode) return; // on parse l'AST uniquement sur les fichiers code

    const content = await fs.readFile(abs, 'utf8');
    const exportsFound = parseExportsFromFile(content);
    if (exportsFound.length === 0) return;

    for (const ex of exportsFound) {
      // ⛔️ On exclut export * (ExportAllDeclaration), sauf si explicitement autorisé
      if (ex.type === 'exportAll' && !CFG.includeExportAll) continue;

      if (!ex.source || isInvalidAssetExt(ex.source)) {
        // on ignore les assets interdits via isInvalidAssetExt (gif/png/css/md/json/yml…)
        continue;
      }

      // Résout les fichiers candidats pour la source
      const candidates = matchCandidateFiles(allFiles, ex.name, ex.source);

      // Calcul hash/AST/metadata sur le meilleur candidat (si présent)
      let sourceRel = null;
      let contentHash = null;
      let sourceAST = null;
      let metadata = { visibleName: null, declarationName: null, usesForwardRef: false, usesMemo: false, isDefaultExport: false };

      if (candidates.length > 0) {
        sourceRel = candidates[0]; // choisi par priorité
        const sourceAbs = path.join(srcPath, sourceRel);
        const sExt = path.extname(sourceAbs).toLowerCase();
        const sIsCode = CFG.validCodeExtensions.includes(sExt);
        try {
          const srcContent = await fs.readFile(sourceAbs, 'utf8');
          if (sIsCode) {
            contentHash = nodeCrypto.createHash('sha256').update(srcContent).digest('hex');
            try {
              const rawAST = babelParser.parse(srcContent, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
              sourceAST = JSON.stringify(cleanAST(rawAST.program.body));
            } catch (e) {
              console.warn(`⚠️ AST parse failed for ${sourceAbs}: ${e.message}`);
            }
            metadata = extractMetadata(srcContent);
          }
        } catch (e) {
          console.warn(`⚠️ Lecture échouée: ${sourceAbs}: ${e.message}`);
        }
      } else {
        logDebug(`⚠️ Aucun fichier candidat pour export "${ex.name}" depuis "${ex.source}" (${relFile})`);
      }

      // Enregistre le "composant"
      components.push({
        name: ex.name,
        exportType: ex.type,     // 'default-named' | 'named' | 'exportAll'
        file: path.relative(repoPath, path.join(srcPath, relFile)), // fichier d'export (barrel)
        sourcefile: sourceRel ? path.relative(repoPath, path.join(srcPath, sourceRel)) : null,
        from: ex.source,
        visibleName: metadata.visibleName,
        declarationName: metadata.declarationName,
        usesForwardRef: metadata.usesForwardRef,
        usesMemo: metadata.usesMemo,
        isDefaultExport: metadata.isDefaultExport,
        contentHash,
        sourceAST
      });
    }
  }

  await Promise.all(allFiles.map((rel) => limit(() => processFile(rel))));

  // 🧹 Option B : supprimer tous les "default"
  let filtered = components.filter(c => !CFG.excludeDefaultNameEverywhere || c.name !== 'default');

  // 🔤 Tri par nom (insensible à la casse) pour les fichiers d'analyse
  filtered.sort((a, b) =>
    String(a?.name || '').localeCompare(String(b?.name || ''), 'fr', { sensitivity: 'base' })
  );

  // Date du tag (ici on préfère la date du tag annoté)
  const commitDate = await getTagDate(repoPath, reference.kind === 'tag' ? displayName : tagSha, 'tag');

  const result = {
    repo: repo.name,
    sha: tagSha,
    tag: displayName,
    version: reference.version,
    kind: reference.kind,
    branch: reference.branch ?? null,
    isDevelop: reference.kind === 'develop',
    dateTag: commitDate,
    date: new Date().toISOString(),
    components: filtered
  };

  return result;
}

// --------------------------
// Comparaison & Rapports
// --------------------------

async function compareComponents(repoName, tag1, tag2, prev, next, gitRefs) {
  const prevMap = new Map(prev.map((c) => [c.name, c]));
  const nextMap = new Map(next.map((c) => [c.name, c]));

  const added = [...nextMap.keys()].filter((x) => !prevMap.has(x));
  const removed = [...prevMap.keys()].filter((x) => !nextMap.has(x));
  const unchanged = [];
  const changed = [];

  for (const name of nextMap.keys()) {
    if (!prevMap.has(name)) continue;

    const prevComp = prevMap.get(name);
    const nextComp = nextMap.get(name);

    let compChanged = false;
    const reasons = [];

    if (prevComp.contentHash && nextComp.contentHash && prevComp.contentHash !== nextComp.contentHash) {
      compChanged = true; reasons.push('diffContentHash');
    }
    if (prevComp.sourceAST && nextComp.sourceAST) {
      const sameAst = areASTsEqualFromJSON(prevComp.sourceAST, nextComp.sourceAST);
      if (!sameAst) { compChanged = true; reasons.push('diffAST'); }
    }
    if (prevComp.sourcefile && nextComp.sourcefile && prevComp.sourcefile === nextComp.sourcefile) {
      const gitRef1 =gitRefs?.[tag1] ?? tag1;
      const gitRef2 = gitRefs?.[tag2] ?? tag2;
      const gitChanged =await hasGitDiff(repoName, gitRef1, gitRef2, prevComp.sourcefile);
      if (gitChanged) {
        compChanged = true;
        reasons.push('diffGit');
      }
    }

    if (compChanged) {
      nextMap.set(name, { ...nextComp, changeReasons: reasons });
      changed.push(name);
    } else {
      unchanged.push(name);
    }
  }

  return { added, removed, changed, unchanged, nextMap };
}

// ——— Minification / formatage Markdown ———

// Supprimer les colonnes 100% vides (optionnel)
function dropEmptyColumns(rows) {
  if (!rows || rows.length < 2) return rows;
  const header = rows[0];
  const body = rows.slice(1);

  // Colonnes vides = toutes cellules nulles/vides/whitespace
  const emptyIdx = header.map((_, i) =>
    body.every(r => !r[i] || String(r[i]).trim() === '')
  );

  // Préserve toujours la première colonne (Component/Nom)
  if (emptyIdx.length > 0) emptyIdx[0] = false;

  return rows.map(r => r.filter((_, i) => !emptyIdx[i]));
}

function minifyMarkdownString(md) {
  return md
    .replace(/[ \t]+$/gm, '')  // trim fin de ligne
    .replace(/\n{3,}/g, '\n\n');
}

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br/>');
}

function formatMarkdownTable(rows, { dropEmpty = false } = {}) {
  if (!rows || rows.length === 0) return '';

  const src = dropEmpty ? dropEmptyColumns(rows) : rows;

  const normalizeRow = (cells) =>
    '|' + cells.map(escapeCell).join('|') + '|';

  const header = normalizeRow(src[0]);
  const separator =
    '|' + src[0].map(() => '---').join('|') + '|';

  const body = src.slice(1).map(normalizeRow);

  return [header, separator, ...body].join('\n');
}

// ✅ Pair-à-pair : libellé = basename (comme ton ancien script)
function generateMarkdownTable(components, repoName, tag1, tag2, type) {
  if (!components || components.length === 0) return '';

  const headers = ['Nom', 'Visible Name', 'Reasons', 'Export File', 'Source File'];
  const rows = [headers];

  // Pour les liens : tag2 sauf pour "removed" (tag1)
  const tag = type === 'removed' ? tag1 : tag2;

  for (const c of components) {
    const exportLabel = c?.file ? path.basename(String(c.file).replace(/\\/g, '/')) : '';
    const exportUrl = c?.file ? githubLink(repoName, tag, c.file) : '';
    const exportLink = mdLink(exportLabel, exportUrl);

    const sourceLabel = c?.sourcefile ? path.basename(String(c.sourcefile).replace(/\\/g, '/')) : '';
    const sourceUrl = c?.sourcefile ? githubLink(repoName, tag, c.sourcefile) : '';
    const sourceLink = mdLink(sourceLabel, sourceUrl);

    rows.push([
      c.name ?? '',
      c.visibleName ?? '',
      Array.isArray(c.changeReasons) ? c.changeReasons.join(', ') : '',
      exportLink,
      sourceLink
    ]);
  }

  return formatMarkdownTable(rows, {
    dropEmpty: CFG.markdownDropEmptyColumns
  });
}

async function generateReports(repoName, tag1, tag2, result1, result2, gitRefs) {
  console.log(`\t⚖️ Génération du rapport entre ${tag1} et ${tag2}...`);

  // Option B: exclure exportAll et name === 'default' des comparaisons
  const previous = result1.components.filter(c => c.exportType !== 'exportAll' && c.name !== 'default');
  const next = result2.components.filter(c => c.exportType !== 'exportAll' && c.name !== 'default');

  const comparison =   await compareComponents(repoName, tag1, tag2, previous, next, gitRefs);

  // Tri par nom dans chaque section du rapport
  const sortByName = (arr) =>
    [...(arr || [])].sort((a, b) =>
      String(a?.name || '').localeCompare(String(b?.name || ''), 'fr', { sensitivity: 'base' })
    );

  const jsonReport = {
    repository: repoName,
    from: tag1,
    to: tag2,
    added: sortByName(comparison.added.map((n) => comparison.nextMap.get(n))),
    removed: sortByName(comparison.removed.map((n) => result1.components.find((c) => c.name === n))),
    changed: sortByName(comparison.changed.map((n) => comparison.nextMap.get(n))),
    unchanged: sortByName(comparison.unchanged.map((n) => comparison.nextMap.get(n)))
  };

  const jsonPath = path.join(CFG.analysisDir, comparisonFileName(repoName, tag1, tag2, 'json'));
  await fs.writeJson(jsonPath, jsonReport, { spaces: 2 });

  const md = `
# Rapport de comparaison des composants
**Repository** : ${repoName}
**De** : ${tag1}
**À** : ${tag2}

## ✅ Nouveaux composants
${generateMarkdownTable(jsonReport.added, repoName, gitRefs[tag1], gitRefs[tag2], 'added') || '_Aucun_'}

## ❌ Composants supprimés
${generateMarkdownTable(jsonReport.removed, repoName, gitRefs[tag1], gitRefs[tag2], 'removed') || '_Aucun_'}

## 🔄 Composants modifiés
${generateMarkdownTable(jsonReport.changed, repoName, gitRefs[tag1], gitRefs[tag2], 'changed') || '_Aucun_'}

## 🔁 Composants inchangés
${generateMarkdownTable(jsonReport.unchanged, repoName, gitRefs[tag1], gitRefs[tag2], 'unchanged') || '_Aucun_'}
`.trim();

  const outMd = CFG.markdownCompactTables ? minifyMarkdownString(md) : md;
  const mdPath = path.join(CFG.analysisDir, comparisonFileName(repoName, tag1, tag2, 'md'));
  await fs.writeFile(mdPath, outMd, 'utf8');

  console.log(`\t\t✅ Rapport enregistré : ${mdPath}`);
}

function getLastComponentData(compName, tags, resultsByTag) {
  const lastTag = [...tags].reverse().find((t) => resultsByTag[t]?.components.find((c) => c.name === compName));
  const data = resultsByTag[lastTag]?.components.find((c) => c.name === compName);
  return { sha: resultsByTag[lastTag]?.sha, data };
}

// ✅ Global : on tient compte de diffGit (async) + exclus exportAll & default
async function buildComparisonMatrix(repoName, components, tags, resultsByTag, gitRefs) {
  const matrix = {};
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];

    const current = (resultsByTag[tag]?.components ?? [])
      .filter(c => c.exportType !== 'exportAll' && c.name !== 'default');
    const currentMap = new Map(current.map((c) => [c.name, c]));
    const currentSet = new Set(currentMap.keys());

    const prevTag = i > 0 ? tags[i - 1] : null;
    const prev = prevTag
      ? ((resultsByTag[prevTag]?.components ?? [])
        .filter(c => c.exportType !== 'exportAll' && c.name !== 'default'))
      : [];
    const prevMap = new Map(prev.map((c) => [c.name, c]));
    const prevSet = new Set(prevMap.keys());

    for (const comp of components) {
      if (!matrix[comp]) matrix[comp] = {};
      if (i === 0) {
        matrix[comp][tag] = currentSet.has(comp) ? '+' : '';
        continue;
      }

      const inCurrent = currentSet.has(comp);
      const inPrevious = prevSet.has(comp);

      if (inCurrent && inPrevious) {
        let compChanged = false;
        const reasons = [];
        const prevItem = prevMap.get(comp);
        const currItem = currentMap.get(comp);

        // Hash
        const prevHash = prevItem?.contentHash;
        const currHash = currItem?.contentHash;
        if (prevHash && currHash && prevHash !== currHash) {
          compChanged = true; reasons.push('diffContentHash');
        }

        // AST
        const prevAST = prevItem?.sourceAST;
        const currAST = currItem?.sourceAST;
        if (prevAST && currAST && !areASTsEqualFromJSON(prevAST, currAST)) {
          compChanged = true; reasons.push('diffAST');
        }

        // Git diff (même fichier source)
        const prevFile = prevItem?.sourcefile;
        const currFile = currItem?.sourcefile;
        if (prevTag && prevFile && currFile && prevFile === currFile) {
          try {
            const gitRef1 = gitRefs?.[prevTag] ?? prevTag;
            const gitRef2 = gitRefs?.[tag] ?? tag;
            const gitChanged = await hasGitDiff(repoName, gitRef1, gitRef2, prevFile);
            if (gitChanged) { compChanged = true; reasons.push('diffGit'); }
          } catch (e) {
            console.warn(`⚠️ git diff check failed for ${comp} ${prevTag}..${tag}:`, e.message);
          }
        }

        matrix[comp][tag] = compChanged ? `~\n${reasons.join('\n')}` : '=';
      } else if (inCurrent && !inPrevious) {
        matrix[comp][tag] = '+';
      } else if (!inCurrent && inPrevious) {
        matrix[comp][tag] = '-';
      } else {
        matrix[comp][tag] = '';
      }
    }
  }
  return matrix;
}

async function generateExcelReport(repoName, tags, components, matrix, resultsByTag, duplicates) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Component Comparison');

  const tagsWithBreaking = tags.map((t) => {
    const hasBreaking = components.some((c) => matrix[c]?.[t] === '-');
    return hasBreaking ? `${t} 💥` : t;
  });

  sheet.addRow(['Component', 'Visible Name', 'Uses ForwardRef', 'Default Export', 'Export File', 'Source File', ...tagsWithBreaking]);

  components.forEach((comp) => {
    const { sha, data } = getLastComponentData(comp, tags, resultsByTag);
    const exportFile = data?.file ? githubLink(repoName, sha, data.file) : '';
    const sourceFile = data?.sourcefile ? githubLink(repoName, sha, data.sourcefile) : '';
    const displayName = duplicates.has(comp.toLowerCase()) ? `${comp} ⚠️` : comp;

    const row = [
      displayName,
      data?.visibleName ?? '',
      data?.usesForwardRef ?? false,
      data?.isDefaultExport ?? false,
      { text: labelOf(data?.file), hyperlink: exportFile },
      { text: labelOf(data?.sourcefile), hyperlink: sourceFile },
      ...tags.map((t) => matrix[comp][t] ?? '')
    ];
    sheet.addRow(row);
  });

  sheet.columns.forEach((col) => (col.width = 30));
  const excelPath = path.join(CFG.reportsDir, `${repoName}_component_comparison.xlsx`);
  await workbook.xlsx.writeFile(excelPath);
  console.log(`📊 Rapport Excel généré : ${excelPath}`);
}

// ✅ Global : libellé = chemin complet
async function generateMarkdownReport(repoName, tags, components, matrix, resultsByTag, duplicates) {
  const emojiMap = { '+': '🟢', '-': '🔴', '=': '⚪', '~': '🟡' };
  const getEmoji = (value) => (typeof value === 'string' ? (emojiMap[value.charAt(0)] || '') : '');
  const getDetails = (value) => (typeof value === 'string' && value.startsWith('~')
    ? value.split('\n').slice(1).join(', ')
    : '');

  const tagsWithBreaking = tags.map((t) =>
    components.some((c) => matrix[c]?.[t] === '-') ? `${t} 💥` : t
  );

  const rows = [['Component', 'Visible Name', 'Uses ForwardRef', 'Default Export', 'Export File', 'Source File', ...tagsWithBreaking]];

  components.forEach((comp) => {
    const { sha, data } = getLastComponentData(comp, tags, resultsByTag);

    const exportLabel = data?.file ? String(data.file).replace(/\\/g, '/') : '';
    const exportUrl = data?.file ? githubLink(repoName, sha, data.file) : '';
    const exportFile = mdLink(exportLabel, exportUrl);

    const sourceLabel = data?.sourcefile ? String(data.sourcefile).replace(/\\/g, '/') : '';
    const sourceUrl = data?.sourcefile ? githubLink(repoName, sha, data.sourcefile) : '';
    const sourceFile = mdLink(sourceLabel, sourceUrl);

    const displayName = duplicates.has(comp.toLowerCase()) ? `${comp} ⚠️` : comp;

    const statusCells = tags.map((t) => {
      const e = getEmoji(matrix[comp][t]);
      const d = getDetails(matrix[comp][t]);
      return d ? `${e} ${d}` : e;
    });

    rows.push([
      displayName,
      data?.visibleName ?? '',
      String(data?.usesForwardRef ?? ''),
      String(data?.isDefaultExport ?? ''),
      exportFile,
      sourceFile,
      ...statusCells
    ]);
  });

  const table = formatMarkdownTable(rows, {
    dropEmpty: CFG.markdownDropEmptyColumns
  });

  const md = `# Component Comparison Report for ${repoName}\n\n${table}`;
  const outMd = CFG.markdownCompactTables ? minifyMarkdownString(md) : md;

  const mdPath = path.join(CFG.reportsDir, `${repoName}_component_comparison.md`);
  await fs.writeFile(mdPath, outMd, 'utf8');
  console.log(`📝 Rapport Markdown généré : ${mdPath}`);
}

async function generateComponentComparisonReports(repoName, tags, resultsByTag, gitRefs) {
  // set global unique component names
  const all = new Set();
  tags.forEach((t) => {
    resultsByTag[t]?.components
      .filter(c => c.exportType !== 'exportAll' && c.name !== 'default')
      .forEach((c) => all.add(c.name));
  });

  // Tri alphabétique insensible à la casse
  const sorted = Array.from(all).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const lowerSeen = {};
  const duplicates = new Set();
  sorted.forEach((n) => {
    const lower = n.toLowerCase();
    if (lowerSeen[lower]) duplicates.add(lower);
    else lowerSeen[lower] = n;
  });

  const matrix = await buildComparisonMatrix(repoName, sorted, tags, resultsByTag, gitRefs);
  await generateExcelReport(repoName, tags, sorted, matrix, resultsByTag, duplicates);
  await generateMarkdownReport(repoName, tags, sorted, matrix, resultsByTag, duplicates);
}

// --------------------------
// Analyse d’un repo complet
// --------------------------

async function analyzeRepo(repo) {
  console.log(`📁 Analyse du repository ${repo.name} en cours...`);
  const repoPath = await prepareRepo(repo);

  const references = await discoverReferences(repoPath);
  const refs = references.map(reference => reference.label);
  const resultsByTag = {};
  const gitRefs = {};
  const activeCacheKeys = new Set();

  // Les diffs sont indexés par SHA, et non par branche mutable.
  const activeShas = new Set(references.map(reference => reference.sha));
  const repoDiffs = gitDiffCache[repo.name] ?? {};
  for (const from of Object.keys(repoDiffs)) {
    if (!activeShas.has(from)) {
      delete repoDiffs[from];
    } else {
      for (const to of Object.keys(repoDiffs[from])) {
        if (!activeShas.has(to)) delete repoDiffs[from][to];
      }
    }
  }
  gitDiffCache[repo.name] = repoDiffs;
  for (const reference of references) {
    const { label, sha } = reference;
    console.log(`\t🔖 ${label}...`);
    gitRefs[label] = sha;
    const shaKey = `${repo.name}_${label}_${sha}`;
    activeCacheKeys.add(shaKey);
    const outputFile = path.join(CFG.analysisDir, analysisFileName(repo.name, label));
    if (shaIndex[shaKey] && fs.existsSync(outputFile)) {
      try {
        const cached = await fs.readJson(outputFile);
        if (cached.sha === sha && cached.tag === label && Array.isArray(cached.components)) {
          resultsByTag[label] = {
            ...sanitizeResult(cached), version: reference.version,
            kind: reference.kind, branch: reference.branch ?? null,
            isDevelop: reference.kind === 'develop',
          };
        }
      } catch (error) {
        logDebug(`Cache illisible pour ${label}, nouvelle analyse : ${error.message}`);
      }
    }
    if (!resultsByTag[label]) {
      resultsByTag[label] = await analyzeTag(repo, repoPath, sha, label, sha, reference);
    }
    // Réécrire aussi les caches anciens pour persister version/type/branche.
    await fs.writeJson(outputFile, resultsByTag[label], { spaces: 2 });
    shaIndex[shaKey] = true;
  }

  const expectedFiles = new Set(refs.map(label => analysisFileName(repo.name, label)));
  for (let i = 1; i < refs.length; i++) {
    for (const extension of ['json', 'md']) {
      expectedFiles.add(comparisonFileName(repo.name, refs[i - 1], refs[i], extension));
    }
  }
  // Suppressions de fichiers uniquement : aucun parcours ni effacement récursif.
  for (const entry of await fs.readdir(CFG.analysisDir, { withFileTypes: true })) {
    if (entry.isFile() && isGeneratedAnalysisFile(repo.name, entry.name) && !expectedFiles.has(entry.name)) {
      await fs.unlink(path.join(CFG.analysisDir, entry.name));
      console.log(`\t🧹 Analyse ou comparaison obsolète supprimée : ${entry.name}`);
    }
  }
  for (const key of Object.keys(shaIndex)) {
    const prefix = `${repo.name}_`;
    if (!key.startsWith(prefix)) continue;
    const label = key.slice(prefix.length).replace(/_[0-9a-f]{40,64}$/, '');
    if (isGeneratedAnalysisFile(repo.name, analysisFileName(repo.name, label)) && !activeCacheKeys.has(key)) {
      delete shaIndex[key];
    }
  }

  // Rapports pair-à-pair
  for (let i = 0; i < refs.length - 1; i++) {
    const tag1 = refs[i];
    const tag2 = refs[i + 1];
    if (resultsByTag[tag1] && resultsByTag[tag2]) {
      await generateReports(repo.name, tag1, tag2, resultsByTag[tag1], resultsByTag[tag2], gitRefs);
    } else {
      console.log(`⏭️ Rapport ignoré entre ${tag1} et ${tag2} (analyse manquante).`);
    }
  }

  // Résumé global (par tag)
  const summary = {
    repo: repo.name,
    tags: refs.map((t) => ({
      tag: t,
      version: resultsByTag[t].version,
      branch: resultsByTag[t].branch,
      kind: resultsByTag[t].kind,
      sha: resultsByTag[t]?.sha,
      componentCount: resultsByTag[t]?.components.length ?? 0,
      dateTag: resultsByTag[t]?.dateTag ?? null,
      date: resultsByTag[t]?.date ?? null
    }))
  };
  const summaryFile = path.join(CFG.reportsDir, `${repo.name}_summary.json`);
  await fs.writeJson(summaryFile, summary, { spaces: 2 });
  console.log(`📄 Résumé global généré : ${summaryFile}`);

  // Sauvegarde caches
  const sortedShaIndex = Object.keys(shaIndex).sort().reduce((acc, k) => (acc[k] = shaIndex[k], acc), {});
  await fs.writeJson(CFG.shaIndexPath, sortedShaIndex, { spaces: 2 });
  console.log(`📦 SHA index mis à jour : ${CFG.shaIndexPath}`);

  await fs.writeJson(CFG.gitDiffCachePath, gitDiffCache, { spaces: 2 });
  console.log(`📦 Git Diff cache mis à jour : ${CFG.gitDiffCachePath}`);

  // Rapports globaux (Excel + Markdown) sur tous les tags
  await generateComponentComparisonReports(repo.name, refs, resultsByTag, gitRefs );
}

// --------------------------
// Entrée principale
// --------------------------

async function main() {
  for (const repo of CFG.repos) {
    try {
      await analyzeRepo(repo);
    } catch (e) {
      console.error(`⛔ Analyse abandonnée pour ${repo.name}:`, e.message);
      process.exitCode = 1;
    }
  }
}

if (require.main === module) main().catch(error => {
  console.error('⛔ Erreur fatale:', error);
  process.exitCode = 1;
});
