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
const { simpleGit } = require('simple-git');
const fs = require('fs-extra');
const path = require('path');
const semverSort = require('semver/functions/sort');
const nodeCrypto = require('node:crypto');
const { createSourceProject, analysisFingerprint } = require('./sourceProject.cjs');
const { publishOutputs } = require('./publishOutputs.cjs');
const { createVersionReports } = require('./reports/versionReports.cjs');

function collectJson(outputs, file, value) {
  outputs.set(path.resolve(file), JSON.stringify(value, null, 2));
}
const {
  branchReference, inVersionRange, selectReferences, analysisFileName,
  isGeneratedAnalysisFile,
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
const FINGERPRINT = analysisFingerprint(CFG);
const { generateReports, generateComponentComparisonReports } = createVersionReports({
  config: CFG, hasGitDiff, logDebug, collectJson,
});

// --------------------------
// Utils
// --------------------------

// 🧼 Sanitize des résultats relus depuis disque
function sanitizeResult(result) {
  if (!result?.components) return result;
  return {
    ...result,
    components: result.components.filter(
      c => (CFG.includeExportAll || c?.exportType !== 'exportAll') && (!CFG.excludeDefaultNameEverywhere || c?.name !== 'default')
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
    throw new Error(`Diff Git impossible pour ${repoName}: ${err.message}`, { cause: err });
  }
}

// --------------------------
// Parsing exports (AST)
// --------------------------

function parseExportsFromFile(file, project) {
  const exports = project.read(file).exports;
  const explicit = new Set(exports.filter(item => item.name !== '*').map(item => item.name));
  return exports.flatMap(item => {
    if (item.name === '*' && CFG.includeExportAll) {
      return project.exportedNames(file).filter(name => !explicit.has(name)).map(name => ({ ...item, name, imported: name, type: 'named' }));
    }
    return [{ ...item, type: item.name === '*' ? 'exportAll' : item.imported === 'default' ? 'default-named' : 'named' }];
  });
}

// --------------------------
// Analyse d’un tag
// --------------------------

async function getValidSourceFiles(srcPath) {
  if (!await fs.pathExists(srcPath)) throw new Error('Dossier source absent : ' + srcPath);
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

async function analyzeTag(repo, repoPath, reference) {
  const { sha: tagSha, label: displayName } = reference;
  const git = simpleGit(repoPath);
  await git.checkout(tagSha);

  const srcPath = path.join(repoPath, CFG.srcDir);
  const allFiles = await getValidSourceFiles(srcPath);
  const project = createSourceProject(repoPath, { assetExtensions: CFG.validAssetExtensions });

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

    const exportsFound = parseExportsFromFile(abs, project);
    if (exportsFound.length === 0) return;

    for (const ex of exportsFound) {
      // ⛔️ On exclut export * (ExportAllDeclaration), sauf si explicitement autorisé
      if (ex.type === 'exportAll' && !CFG.includeExportAll) continue;

      if (ex.source && isInvalidAssetExt(ex.source)) {
        // on ignore les assets interdits via isInvalidAssetExt (gif/png/css/md/json/yml…)
        continue;
      }

      // Résout les fichiers candidats pour la source
      const resolved = project.resolveExport(abs, ex.name);
      if (!resolved) {
        if (ex.source && !project.resolve(abs, ex.source)) continue;
        throw new Error('Export non resolu : ' + ex.name + ' dans ' + abs);
      }
      const sourceRel = path.relative(srcPath, resolved.file);
      const sourceAbs = resolved.file;
      const srcContent = await fs.readFile(sourceAbs, 'utf8');
      const contentHash = nodeCrypto.createHash('sha256').update(srcContent).digest('hex');
      const sourceAST = resolved.asset ? null : JSON.stringify(cleanAST(project.read(sourceAbs).ast));
      const metadata = extractMetadata(srcContent);

      // Enregistre le "composant"
      components.push({
        id: `${path.relative(repoPath, abs).replace(/\\/g, '/')}#${ex.name}`,
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
    fingerprint: FINGERPRINT,
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

async function analyzeRepo(repo) {
  console.log('Analyse du repository ' + repo.name);
  const repoPath = await prepareRepo(repo);
  const references = await discoverReferences(repoPath);
  const snapshots = [];
  const outputs = new Map();
  const activeCacheKeys = new Set();
  const previousShaIndex = shaIndex;
  const previousDiffCache = gitDiffCache;
  shaIndex = { ...shaIndex };
  gitDiffCache = JSON.parse(JSON.stringify(gitDiffCache));
  try {
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
      console.log('Préparation : ' + label);
      const shaKey = repo.name + '_' + label + '_' + sha + '_' + FINGERPRINT;
      activeCacheKeys.add(shaKey);
      const outputFile = path.join(CFG.analysisDir, analysisFileName(repo.name, label));
      let result;
      if (shaIndex[shaKey] && fs.existsSync(outputFile)) {
        try {
          const cached = await fs.readJson(outputFile);
          if (cached.sha === sha && cached.tag === label && cached.fingerprint === FINGERPRINT && Array.isArray(cached.components)) {
            result = {
              ...sanitizeResult(cached), version: reference.version,
              kind: reference.kind, branch: reference.branch ?? null,
              isDevelop: reference.kind === 'develop',
            };
          }
        } catch (error) {
          logDebug('Cache illisible pour ' + label + ' : ' + error.message);
        }
      }
      if (!result) result = await analyzeTag(repo, repoPath, reference);
      snapshots.push({ reference, result });
      collectJson(outputs, outputFile, result);
      shaIndex[shaKey] = true;
    }

    for (const key of Object.keys(shaIndex)) {
      const prefix = repo.name + '_';
      if (!key.startsWith(prefix)) continue;
      const label = key.slice(prefix.length).replace(/_[0-9a-f]{40,64}(?:_[0-9a-f]{64})?$/, '');
      if (isGeneratedAnalysisFile(repo.name, analysisFileName(repo.name, label)) && !activeCacheKeys.has(key)) {
        delete shaIndex[key];
      }
    }
    for (let i = 1; i < snapshots.length; i++) {
      await generateReports(repo.name, snapshots[i - 1], snapshots[i], outputs);
    }
    const summary = {
      repo: repo.name,
      tags: snapshots.map(({ reference, result }) => ({
        tag: reference.label, version: reference.version,
        branch: reference.branch ?? null, kind: reference.kind, sha: reference.sha,
        componentCount: result.components.length, dateTag: result.dateTag, date: result.date,
      })),
    };
    collectJson(outputs, path.join(CFG.reportsDir, repo.name + '_summary.json'), summary);
    await generateComponentComparisonReports(repo.name, snapshots, outputs);
    const sortedShaIndex = Object.fromEntries(Object.entries(shaIndex).sort(([a], [b]) => a.localeCompare(b)));
    collectJson(outputs, CFG.shaIndexPath, sortedShaIndex);
    collectJson(outputs, CFG.gitDiffCachePath, gitDiffCache);

    const obsolete = [];
    for (const entry of await fs.readdir(CFG.analysisDir, { withFileTypes: true })) {
      const target = path.resolve(CFG.analysisDir, entry.name);
      if (entry.isFile() && isGeneratedAnalysisFile(repo.name, entry.name) && !outputs.has(target)) {
        obsolete.push(target);
      }
    }
    await publishOutputs(outputs, obsolete);
    console.log('Rapports et caches publiés pour ' + repo.name);
  } catch (error) {
    // Un autre dépôt ne doit pas persister les caches d'une analyse échouée.
    shaIndex = previousShaIndex;
    gitDiffCache = previousDiffCache;
    throw error;
  }
}

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
