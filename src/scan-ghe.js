/**
 * @file scan-ghe.js
 * @description
 * Scanne une instance GitHub Enterprise Server (GHES 3.17.6) via l’API REST v3 pour :
 *  - Découvrir les organisations et repositories (avec exclusions configurables),
 *  - (Optionnel) Pré-filtrer les repositories par Code Search ou arbre Git,
 *  - Détecter les projets (repo, workspaces JS, modules Maven/Gradle),
 *  - Extraire les versions déclarées et/ou résolues (lockfiles si présents),
 *  - Filtrer la sortie sur une liste de bibliothèques d’intérêt,
 *  - Exporter au format JSON et XLSX (tri insensible à la casse).
 *
 * @version 1.0.0 (documentation ajoutée)
 * @author —
 * @license — (renseigner si nécessaire)
 *
 * @requires node >= 18 (ESM)
 */

import fs from 'node:fs';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parse: parseYaml } = require('yaml');
const { parse: parseYarnLock } = require('@yarnpkg/lockfile');
import { XMLParser } from 'fast-xml-parser';
import ExcelJS from 'exceljs';
require('dotenv').config();

/**
 * @typedef {Object} RepoMeta
 * @property {string} name - Nom du repository.
 * @property {string} [default_branch] - Branche par défaut (ex. "main").
 */

/**
 * @typedef {Object} ProjectRecord
 * @property {string} org - Organisation propriétaire du repository.
 * @property {string} repo - Nom du repository.
 * @property {string} default_branch - Branche analysée.
 * @property {string} path - Chemin du projet ('.' à la racine, ou sous-répertoire).
 * @property {('repo'|'workspace-root'|'workspace-package'|'single-package'|'java-maven-root'|'java-maven-module'|'java-gradle-root')} project_type
 * @property {('npm'|'yarn'|'pnpm'|'maven'|'gradle'|null)} package_manager
 * @property {string|null} name - Nom du package/projet (ex. npm name ou groupId:artifactId).
 * @property {string|null} declared_version - Version déclarée (manifest).
 * @property {string|null} resolved_version - Version résolue (lockfile).
 * @property {string|null} workspace_root - Chemin racine du workspace si monorepo.
 * @property {string[]} lockfiles - Liste des lockfiles trouvés pour le package.
 * @property {string} commit_sha_scanned - SHA du commit/arbre analysé.
 * @property {boolean|null} is_monorepo - Indique un monorepo (déduit).
 * @property {string[]} detection - Indices/fichiers ayant servi à la détection.
 */

/**
 * @typedef {Object} DependencyRecord
 * @property {string} org - Organisation propriétaire du repository.
 * @property {string} repo - Nom du repository.
 * @property {string} default_branch - Branche analysée.
 * @property {string} package_path - Chemin du package (ex. sous-répertoire).
 * @property {string} package_name - Nom du package.
 * @property {string} dependency - Nom de la dépendance (ex. npm name ou group:artifact).
 * @property {string|null} declared_range - Version déclarée (intervalle/semver).
 * @property {string|null} resolved_version - Version résolue depuis lockfile.
 * @property {('npm-lock'|'yarn.lock'|'pnpm-lock.yaml'|'gradle/versions.lock'|null)} lock_source - Source utilisée pour la résolution.
 * @property {string} commit_sha_scanned - SHA du commit/arbre analysé.
 */

// =====================
// Config via variables d'env
// =====================

/**
 * Base URL de l’API GHES (REST v3).
 * @type {string}
 * @example "https://ghe.example.com/api/v3"
 */
const GHE_BASE_URL = process.env.GHE_BASE_URL ?? 'https://ghe.example.com/api/v3';

/**
 * Token d’authentification personnel ou App (⚠️ ne pas logger).
 * @type {string|undefined}
 */
const GHE_TOKEN = process.env.GHE_TOKEN;

/**
 * Liste d’organisations à scanner (prioritaire sur découverte auto).
 * @type {string[]}
 */
const START_ORGS = (process.env.START_ORGS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Inclure les repositories appartenant/utilisés par l’utilisateur authentifié.
 * @type {boolean}
 */
const INCLUDE_USER_REPOS = (process.env.INCLUDE_USER_REPOS ?? 'true') === 'true';

/**
 * Branche à scanner (optionnelle). Si vide → default_branch du repo.
 * @type {string|undefined}
 */
const SCAN_BRANCH = process.env.SCAN_BRANCH;

/**
 * Activer l’extraction des dépendances (via lockfiles).
 * @type {boolean}
 */
const INCLUDE_DEPENDENCIES = (process.env.INCLUDE_DEPENDENCIES ?? 'true') === 'true';

/**
 * Filtres de bibliothèques (glob) à inclure dans la sortie (projets/dépendances).
 * @type {string[]}
 */
const INCLUDE_ONLY_LIBS = (process.env.INCLUDE_ONLY_LIBS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Chemin de fichier contenant des motifs (un par ligne) supplémentaires.
 * @type {string|undefined}
 */
const LIBS_FILE = process.env.LIBS_FILE;

/**
 * Portée du filtrage par bibliothèques d’intérêt.
 * @type {'projects'|'dependencies'|'both'}
 */
const LIBS_MATCH_SCOPE = (process.env.LIBS_MATCH_SCOPE ?? 'projects').toLowerCase();

/**
 * Cas-insensibilité lors du matching des bibliothèques.
 * @type {boolean}
 */
const LIBS_CASE_INSENSITIVE = (process.env.LIBS_CASE_INSENSITIVE ?? 'false') === 'true';

/**
 * Mode de pré-filtrage des repos : 'code' (Code Search) | 'tree' (arbre Git) | 'off'
 * @type {'code'|'tree'|'off'}
 */
const PREFILTER_MODE = (process.env.PREFILTER_MODE ?? 'tree').toLowerCase();

/**
 * Orgs à qualifier dans Code Search (org:ORG).
 * @type {string[]}
 */
const SEARCH_ORGS = (process.env.SEARCH_ORGS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Limite d’items par lib en Code Search (max 100 par page).
 * @type {number}
 */
const SEARCH_PER_LIB_LIMIT = parseInt(process.env.SEARCH_PER_LIB_LIMIT ?? '200', 10);

/**
 * Fichiers cibles pour Code Search.
 * @type {string[]}
 */
const SEARCH_FILE_TARGETS = (process.env.SEARCH_FILE_TARGETS ??
  'package.json,pom.xml,build.gradle,build.gradle.kts')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Exclusion des forks.
 * @type {boolean}
 */
const EXCLUDE_FORKS = (process.env.EXCLUDE_FORKS ?? 'true') === 'true';

/**
 * Exclusion des repositories archivés.
 * @type {boolean}
 */
const EXCLUDE_ARCHIVED = (process.env.EXCLUDE_ARCHIVED ?? 'true') === 'true';

/**
 * Exclusion des repositories désactivés.
 * @type {boolean}
 */
const EXCLUDE_DISABLED = (process.env.EXCLUDE_DISABLED ?? 'true') === 'true';

/**
 * Exclusion des repositories templates.
 * @type {boolean}
 */
const EXCLUDE_TEMPLATES = (process.env.EXCLUDE_TEMPLATES ?? 'true') === 'true';

/**
 * Exclusion des repositories appartenant à un 'User' (non-Org).
 * @type {boolean}
 */
const EXCLUDE_OWNER_USER = (process.env.EXCLUDE_OWNER_USER ?? 'true') === 'true';

/**
 * Liste des dossiers à exclure (globs, séparés par virgules).
 * Ex.: "node_modules/**,dist/**,.github/**,**\/test/**"
 * @type {string[]}
 */
const EXCLUDE_DIRS = (process.env.EXCLUDE_DIRS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);


/**
 * Convertit un motif glob de dossier en expression régulière compatible avec les chemins POSIX.
 *
 * Règles :
 *   - "**\/"  => "(?:.*\/)?"   (multi-niveaux optionnel + slash)
 * - "**"   => ".*"(multi - niveaux sans imposer slash)
 * - "*"    => "[^/]*"(un segment sans '/')
 * - Les autres caractères spéciaux sont échappés ; '/' devient '\/'
 *
 * Exemples :
 *   "node_modules/**"    => ^node_modules(?:\/.*)?$
 *   "**\/test/**"         => ^(?:.*\/)?test(?:\/.*)?$
 *   "packages/legacy/**" => ^packages\/legacy(?:\/.*)?$
 *
 * @param { string } glob - Motif glob à convertir.
 * @param { boolean }[caseInsensitive = true] - Indique si la casse doit être ignorée.
 * @returns { RegExp } Expression régulière correspondante.
 */
function dirGlobToRegex(glob, caseInsensitive = true) {
  // 1) Normaliser le motif en POSIX
  const g = String(glob).replace(/\\/g, '/').replace(/^\.\/+/, '');

  // 2) Construire la regex en parcourant le motif
  let re = '^';
  let i = 0;
  while (i < g.length) {
    const c = g[i];

    if (c === '*') {
      // Regarder si on a un "**"
      const isDoubleStar = g[i + 1] === '*';
      if (isDoubleStar) {
        // Consommer les deux '*'
        i += 2;
        // Si suivi d'un '/', produire la variante avec slash optionnel
        if (g[i] === '/') {
          i += 1; // consommer le '/'
          re += '(?:.*\\/)?';
        } else {
          re += '.*';
        }
      } else {
        // Simple '*'
        re += '[^/]*';
        i += 1;
      }
      continue;
    }

    // Échappement des caractères spéciaux regex
    if (c === '/') {
      re += '\\/';
    } else if ('.^$+?()[]{}|'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
    i += 1;
  }

  // 3) Suffixe: si le motif se termine par '/', autoriser sous-chemins libres
  const endsWithSlash = /\/$/.test(g);
  re += endsWithSlash ? '(.*)?' : '(?:\\/.*)?';
  re += '$';

  const flags = caseInsensitive ? 'i' : '';
  return new RegExp(re, flags);
}

/** @type {RegExp[]} */
const EXCLUDE_DIRS_REGEXES = EXCLUDE_DIRS.map(d => dirGlobToRegex(d, true));

/**
* Indique si un chemin (POSIX) doit être exclu selon EXCLUDE_DIRS.
* @param {string} p
* @returns {boolean}
*/
function isPathExcluded(p) {
  if (!p || EXCLUDE_DIRS_REGEXES.length === 0) return false;
  const posixPath = p.replace(/\\/g, '/');
  // On teste soit le chemin entier, soit son "répertoire" (prefix), car
  // notre regex est basée "dossier" et autorise les sous-chemins
  return EXCLUDE_DIRS_REGEXES.some(re => re.test(posixPath));
}

/**
 * Dossier de sortie.
 * @type {string}
 */
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? './out';

/**
 * Fichier JSON (projets).
 * @type {string}
 */
const OUTPUT_JSON_PROJECTS_FILENAME =
  process.env.OUTPUT_JSON_PROJECTS_FILENAME ?? 'projects.json';

/**
 * Fichier JSON (dépendances).
 * @type {string}
 */
const OUTPUT_JSON_DEPENDENCIES_FILENAME =
  process.env.OUTPUT_JSON_DEPENDENCIES_FILENAME ?? 'dependencies.json';

/**
 * Indentation JSON.
 * @type {number}
 */
const OUTPUT_JSON_INDENT = parseInt(process.env.OUTPUT_JSON_INDENT ?? '2', 10);

/**
 * Activer export JSON.
 * @type {boolean}
 */
const OUTPUT_JSON_ENABLED = (process.env.OUTPUT_JSON_ENABLED ?? 'true') === 'true';

/**
 * Activer export XLSX.
 * @type {boolean}
 */
const OUTPUT_XLSX_ENABLED = (process.env.OUTPUT_XLSX_ENABLED ?? 'true') === 'true';

/**
 * Nom du fichier Excel.
 * @type {string}
 */
const OUTPUT_XLSX_FILENAME = process.env.OUTPUT_XLSX_FILENAME ?? 'scan.xlsx';

/**
 * Tri insensible à la casse.
 * @type {boolean}
 */
const SORT_CASE_INSENSITIVE = (process.env.SORT_CASE_INSENSITIVE ?? 'true') === 'true';

// --- Guard: token requis pour l’API ---
if (!GHE_TOKEN) {
  // ⚠️ Bonne pratique: ne jamais afficher le token, même partiellement
  console.error('❌ Missing GHE_TOKEN env variable.');
  process.exit(1);
}

// Crée le dossier de sortie si absent
fs.mkdirSync(OUTPUT_DIR, { recursive: true });


// --- Résumé de configuration au démarrage (options + signification) ---
function printRuntimeConfigSummary() {
  // Spécification des options de runtime (clé env, description, sensibilité, lecture)
  const spec = [
    { key: 'GHE_BASE_URL', desc: 'Base URL de l’API GHES (REST v3)', sensitive: false, read: () => process.env.GHE_BASE_URL ?? 'https://ghe.example.com/api/v3' },
    { key: 'GHE_TOKEN', desc: 'Token d’authentification (PAT ou GitHub App)', sensitive: true, read: () => process.env.GHE_TOKEN ? '*** masqué ***' : '❌ non défini' },
    { key: 'START_ORGS', desc: 'Liste d’organisations à scanner (prioritaire)', sensitive: false, read: () => (process.env.START_ORGS ?? '').split(',').map(s => s.trim()).filter(Boolean) },
    { key: 'INCLUDE_USER_REPOS', desc: 'Inclure les repositories de l’utilisateur', sensitive: false, read: () => (process.env.INCLUDE_USER_REPOS ?? 'true') === 'true' },
    { key: 'SCAN_BRANCH', desc: 'Branche à scanner (sinon branche par défaut)', sensitive: false, read: () => process.env.SCAN_BRANCH ?? '' },
    { key: 'INCLUDE_DEPENDENCIES', desc: 'Extraire les dépendances via lockfiles', sensitive: false, read: () => (process.env.INCLUDE_DEPENDENCIES ?? 'true') === 'true' },
    { key: 'INCLUDE_ONLY_LIBS', desc: 'Motifs de bibliothèques à inclure en sortie', sensitive: false, read: () => (process.env.INCLUDE_ONLY_LIBS ?? '').split(',').map(s => s.trim()).filter(Boolean) },
    { key: 'LIBS_FILE', desc: 'Fichier additionnel de motifs (un par ligne)', sensitive: false, read: () => process.env.LIBS_FILE ?? '' },
    { key: 'LIBS_MATCH_SCOPE', desc: 'Portée du filtrage (projects|dependencies|both)', sensitive: false, read: () => (process.env.LIBS_MATCH_SCOPE ?? 'projects').toLowerCase() },
    { key: 'LIBS_CASE_INSENSITIVE', desc: 'Matching case-insensitive des bibliothèques', sensitive: false, read: () => (process.env.LIBS_CASE_INSENSITIVE ?? 'false') === 'true' },
    { key: 'PREFILTER_MODE', desc: 'Pré-filtrage des repos (code|tree|off)', sensitive: false, read: () => (process.env.PREFILTER_MODE ?? 'tree').toLowerCase() },
    { key: 'SEARCH_ORGS', desc: 'Orgs qualifiées pour Code Search (org:...)', sensitive: false, read: () => (process.env.SEARCH_ORGS ?? '').split(',').map(s => s.trim()).filter(Boolean) },
    { key: 'SEARCH_PER_LIB_LIMIT', desc: 'Limite d’items par lib en Code Search', sensitive: false, read: () => parseInt(process.env.SEARCH_PER_LIB_LIMIT ?? '200', 10) },
    { key: 'SEARCH_FILE_TARGETS', desc: 'Fichiers cibles de Code Search', sensitive: false, read: () => (process.env.SEARCH_FILE_TARGETS ?? 'package.json,pom.xml,build.gradle,build.gradle.kts').split(',').map(s => s.trim()).filter(Boolean) },
    { key: 'EXCLUDE_FORKS', desc: 'Exclure les forks', sensitive: false, read: () => (process.env.EXCLUDE_FORKS ?? 'true') === 'true' },
    { key: 'EXCLUDE_ARCHIVED', desc: 'Exclure les repositories archivés', sensitive: false, read: () => (process.env.EXCLUDE_ARCHIVED ?? 'true') === 'true' },
    { key: 'EXCLUDE_DISABLED', desc: 'Exclure les repositories désactivés', sensitive: false, read: () => (process.env.EXCLUDE_DISABLED ?? 'true') === 'true' },
    { key: 'EXCLUDE_TEMPLATES', desc: 'Exclure les repositories templates', sensitive: false, read: () => (process.env.EXCLUDE_TEMPLATES ?? 'true') === 'true' },
    { key: 'EXCLUDE_OWNER_USER', desc: 'Exclure les repos appartenant à un User', sensitive: false, read: () => (process.env.EXCLUDE_OWNER_USER ?? 'true') === 'true' },
    { key: 'EXCLUDE_DIRS', desc: 'Dossiers exclus de l’analyse (globs)', sensitive: false, read: () => (process.env.EXCLUDE_DIRS ?? '').split(',').map(s => s.trim()).filter(Boolean) },
    { key: 'OUTPUT_DIR', desc: 'Dossier de sortie', sensitive: false, read: () => process.env.OUTPUT_DIR ?? './out' },
    { key: 'OUTPUT_JSON_PROJECTS_FILENAME', desc: 'Nom du fichier JSON (projects)', sensitive: false, read: () => process.env.OUTPUT_JSON_PROJECTS_FILENAME ?? 'projects.json' },
    { key: 'OUTPUT_JSON_DEPENDENCIES_FILENAME', desc: 'Nom du fichier JSON (dependencies)', sensitive: false, read: () => process.env.OUTPUT_JSON_DEPENDENCIES_FILENAME ?? 'dependencies.json' },
    { key: 'OUTPUT_JSON_ENABLED', desc: 'Activer export JSON', sensitive: false, read: () => (process.env.OUTPUT_JSON_ENABLED ?? 'true') === 'true' },
    { key: 'OUTPUT_JSON_INDENT', desc: 'Indentation JSON', sensitive: false, read: () => parseInt(process.env.OUTPUT_JSON_INDENT ?? '2', 10) },
    { key: 'OUTPUT_XLSX_ENABLED', desc: 'Activer export XLSX', sensitive: false, read: () => (process.env.OUTPUT_XLSX_ENABLED ?? 'true') === 'true' },
    { key: 'OUTPUT_XLSX_FILENAME', desc: 'Nom du fichier Excel', sensitive: false, read: () => process.env.OUTPUT_XLSX_FILENAME ?? 'scan.xlsx' },
    { key: 'SORT_CASE_INSENSITIVE', desc: 'Tri insensible à la casse', sensitive: false, read: () => (process.env.SORT_CASE_INSENSITIVE ?? 'true') === 'true' },
  ];

  // Mise en forme pour console.table
  const rows = spec.map(({ key, desc, sensitive, read }) => {
    let val;
    try { val = read(); } catch { val = '⚠️ erreur lecture'; }
    // Pour les tableaux, afficher une version courte/lisible
    if (Array.isArray(val)) val = val.length ? val.join(', ') : '(vide)';
    if (typeof val === 'string' && val.trim() === '') val = '(vide)';
    return {
      option: key,
      signification: desc,
      valeur: sensitive ? '*** masqué ***' : val,
    };
  });

  console.log('🧭 Contexte d’exécution — options & valeurs (sensibles masquées):');
  console.table(rows);
}

// Appel immédiat avant toute logique
printRuntimeConfigSummary();

function printResolvedConstantsSummary() {
  const rows = [
    { option: 'GHE_BASE_URL', value: GHE_BASE_URL, desc: 'Base URL de l’API GHES (REST v3)' },
    { option: 'GHE_TOKEN', value: '*** masqué ***', desc: 'Token d’authentification' },
    { option: 'START_ORGS', value: START_ORGS.join(', ') || '(vide)', desc: 'Organisations à scanner' },
    { option: 'INCLUDE_USER_REPOS', value: INCLUDE_USER_REPOS, desc: 'Inclure repos utilisateur' },
    { option: 'SCAN_BRANCH', value: SCAN_BRANCH ?? '(non spécifié)', desc: 'Branche à scanner' },
    { option: 'INCLUDE_DEPENDENCIES', value: INCLUDE_DEPENDENCIES, desc: 'Extraire dépendances' },
    { option: 'INCLUDE_ONLY_LIBS', value: INCLUDE_ONLY_LIBS.join(', ') || '(vide)', desc: 'Motifs de libs' },
    { option: 'LIBS_FILE', value: LIBS_FILE ?? '(non spécifié)', desc: 'Fichier de motifs' },
    { option: 'LIBS_MATCH_SCOPE', value: LIBS_MATCH_SCOPE, desc: 'Portée du filtrage' },
    { option: 'LIBS_CASE_INSENSITIVE', value: LIBS_CASE_INSENSITIVE, desc: 'Matching case-insensitive' },
    { option: 'PREFILTER_MODE', value: PREFILTER_MODE, desc: 'Mode de pré-filtrage' },
    { option: 'SEARCH_ORGS', value: SEARCH_ORGS.join(', ') || '(vide)', desc: 'Orgs pour Code Search' },
    { option: 'SEARCH_PER_LIB_LIMIT', value: SEARCH_PER_LIB_LIMIT, desc: 'Limite par lib (Code Search)' },
    { option: 'SEARCH_FILE_TARGETS', value: SEARCH_FILE_TARGETS.join(', '), desc: 'Fichiers cibles' },
    { option: 'EXCLUDE_FORKS', value: EXCLUDE_FORKS, desc: 'Exclure forks' },
    { option: 'EXCLUDE_ARCHIVED', value: EXCLUDE_ARCHIVED, desc: 'Exclure archivés' },
    { option: 'EXCLUDE_DISABLED', value: EXCLUDE_DISABLED, desc: 'Exclure désactivés' },
    { option: 'EXCLUDE_TEMPLATES', value: EXCLUDE_TEMPLATES, desc: 'Exclure templates' },
    { option: 'EXCLUDE_OWNER_USER', value: EXCLUDE_OWNER_USER, desc: 'Exclure Owner=User' },
    { option: 'EXCLUDE_DIRS', value: EXCLUDE_DIRS.join(', ') || '(vide)', desc: 'Dossiers exclus' },
    { option: 'OUTPUT_DIR', value: OUTPUT_DIR, desc: 'Dossier de sortie' },
    { option: 'OUTPUT_JSON_PROJECTS_FILENAME', value: OUTPUT_JSON_PROJECTS_FILENAME, desc: 'JSON projects' },
    { option: 'OUTPUT_JSON_DEPENDENCIES_FILENAME', value: OUTPUT_JSON_DEPENDENCIES_FILENAME, desc: 'JSON dependencies' },
    { option: 'OUTPUT_JSON_ENABLED', value: OUTPUT_JSON_ENABLED, desc: 'Export JSON' },
    { option: 'OUTPUT_JSON_INDENT', value: OUTPUT_JSON_INDENT, desc: 'Indent JSON' },
    { option: 'OUTPUT_XLSX_ENABLED', value: OUTPUT_XLSX_ENABLED, desc: 'Export XLSX' },
    { option: 'OUTPUT_XLSX_FILENAME', value: OUTPUT_XLSX_FILENAME, desc: 'Nom XLSX' },
    { option: 'SORT_CASE_INSENSITIVE', value: SORT_CASE_INSENSITIVE, desc: 'Tri case-insensitive' },
  ];
  console.log('🧭 Contexte résolu — constantes utilisées:');
  console.table(rows.map(r => ({ option: r.option, valeur: r.option === 'GHE_TOKEN' ? '*** masqué ***' : r.value, signification: r.desc })));
}

// Appeler après la définition de toutes les constantes :
printResolvedConstantsSummary();

// =====================
// Octokit (GHES 3.17.6 compatible)
// =====================

/**
 * Client Octokit configuré pour GHES.
 * @type {Octokit}
 */
const octokit = new Octokit({
  auth: GHE_TOKEN,
  baseUrl: GHE_BASE_URL,
});

// =====================
// Containers (JSON arrays)
// =====================

/** @type {ProjectRecord[]} */
const projects = [];

/** @type {DependencyRecord[]} */
const dependencies = [];

// =====================
// Helpers de tri multi-clés
// =====================

/**
 * Convertit une valeur en chaîne sécurisée (pour tri).
 * @param {unknown} v - Valeur à normaliser.
 * @returns {string} Chaîne utilisable pour comparaison.
 */
function safeStr(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return String(v);
}

/**
 * Compare 2 objets selon plusieurs clés, avec option de casse.
 * @template T
 * @param {T} a
 * @param {T} b
 * @param {Array<keyof T & string>} keys - Clés de tri (ordre).
 * @param {{ caseInsensitive?: boolean }} [options]
 * @returns {number} -1 si a<b, 1 si a>b, 0 sinon.
 */
function compareMultiple(a, b, keys, { caseInsensitive = SORT_CASE_INSENSITIVE } = {}) {
  for (const key of keys) {
    let av = safeStr(a[key]);
    let bv = safeStr(b[key]);
    if (caseInsensitive) {
      av = av.toLowerCase();
      bv = bv.toLowerCase();
    }
    const c = av.localeCompare(bv);
    if (c !== 0) return c;
  }
  return 0;
}

// =====================
// Pagination helpers
// =====================

/**
 * Paginate sur une API Octokit avec robustesse (fallback).
 * @template T
 * @param {Function} fn - Méthode Octokit (ex. octokit.repos.listForOrg).
 * @param {object} params - Paramètres de la requête.
 * @returns {Promise<T[]>} Tableau concaténé des items paginés.
 * @throws {Error} En cas d’erreur réseau ou API inattendue.
 */
async function paginate(fn, params) {
  const results = [];
  try {
    for await (const res of octokit.paginate.iterator(fn, params)) {
      results.push(...(res.data ?? []));
    }
  } catch {
    // Fallback sans iterator (ex. environnements restreints)
    const data = await octokit.paginate(fn, params).catch(() => []);
    results.push(...data);
  }
  return results;
}

/**
 * Liste les organisations à scanner.
 * @returns {Promise<string[]>} Logins des organisations.
 */
async function listOrgs() {
  if (START_ORGS.length) return START_ORGS;
  const orgs = await paginate(octokit.orgs.listForAuthenticatedUser, { per_page: 100 });
  return orgs.map((o) => o.login);
}

/**
 * Applique les exclusions définies au repository.
 * @param {any} repo - Métadonnées du repo (Octokit).
 * @returns {boolean} True si le repo passe les filtres.
 */
function repoPassesExclusions(repo) {
  if (EXCLUDE_FORKS && repo.fork) return false;
  if (EXCLUDE_ARCHIVED && repo.archived) return false;
  if (EXCLUDE_DISABLED && repo.disabled) return false;
  if (EXCLUDE_TEMPLATES && repo.is_template) return false;
  if (EXCLUDE_OWNER_USER && repo.owner && repo.owner.type === 'User') return false;
  return true;
}

/**
 * Liste les repositories d’une organisation (après exclusions).
 * @param {string} org - Nom de l’organisation.
 * @returns {Promise<Array<{name:string, default_branch:string}>>}
 */
async function listReposForOrg(org) {
  const repos = await paginate(octokit.repos.listForOrg, { org, type: 'all', per_page: 100 });
  return repos.filter((r) => repoPassesExclusions(r));
}

/**
 * Liste les repositories accessibles à l’utilisateur (après exclusions).
 * @returns {Promise<any[]>} Liste des repos filtrés.
 */
async function listUserRepos() {
  const repos = await paginate(octokit.repos.listForAuthenticatedUser, {
    visibility: 'all',
    affiliation: 'owner,collaborator,organization_member',
    per_page: 100,
  });
  return repos.filter((r) => repoPassesExclusions(r));
}

// =====================
// Git & Contents helpers
// =====================

/**
 * Récupère le SHA de la branche cible.
 * @param {string} owner - Organisation/Owner.
 * @param {string} repo - Repository.
 * @param {string} branch - Nom de la branche.
 * @returns {Promise<string>} SHA du commit HEAD de la branche.
 * @throws {Error} Si la branche n’existe pas ou API échoue.
 */
async function getDefaultBranchSha(owner, repo, branch) {
  const { data } = await octokit.repos.getBranch({ owner, repo, branch });
  return data.commit.sha;
}

/**
 * Récupère l’arbre Git de façon récursive.
 * @param {string} owner - Organisation/Owner.
 * @param {string} repo - Repository.
 * @param {string} sha - SHA de l’arbre/commit.
 * @returns {Promise<Array<{path:string,type:'tree'|'blob'}>>} Arbre de fichiers.
 */
async function getTreeRecursive(owner, repo, sha) {
  const { data } = await octokit.git.getTree({ owner, repo, tree_sha: sha, recursive: '1' });
  return data.tree ?? [];
}

/**
 * Lit le contenu texte d’un fichier (base64 → utf8).
 * @param {string} owner - Organisation/Owner.
 * @param {string} repo - Repository.
 * @param {string} ref - Référence (sha/branch).
 * @param {string} filePath - Chemin du fichier.
 * @returns {Promise<string|null>} Contenu UTF-8 ou null si absent.
 */
async function getFileContent(owner, repo, ref, filePath) {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: filePath, ref });
    if (Array.isArray(data)) return null;
    if (data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf8');
    }
    return null;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// =====================
// Filtrage (contenu émis)
// =====================

/** @type {RegExp[]|null} */
let compiledLibMatchers = null;

/**
 * Convertit un motif "glob simple" en regex.
 * @param {string} glob - Motif glob (ex. "@scope/*").
 * @param {string} [flags] - Flags regex (ex. 'i').
 * @returns {RegExp} Regex équivalente.
 */
function globToRegex(glob, flags = '') {
  const esc = glob
    .replace(/[.\+^${}()\[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp('^' + esc + '$', flags);
}

/**
 * Compile une liste de motifs en expressions régulières.
 * @param {string[]} list - Liste de globs.
 * @returns {RegExp[]} Tableau de regex.
 */
function compileMatchers(list) {
  if (!list || list.length === 0) return [];
  const flags = LIBS_CASE_INSENSITIVE ? 'i' : '';
  return list.map((g) => globToRegex(g, flags));
}

/**
 * Charge une liste de motifs depuis un fichier texte (un par ligne).
 * @param {string} filePath - Chemin du fichier.
 * @returns {string[]} Motifs parsés.
 */
function loadLibsFromFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Retourne l’ensemble des motifs (env + fichier).
 * @returns {string[]} Motifs normalisés.
 */
function getAllRawLibPatterns() {
  let list = [...INCLUDE_ONLY_LIBS];
  if (LIBS_FILE) list = list.concat(loadLibsFromFile(LIBS_FILE));
  return list.map((s) => s.trim()).filter(Boolean);
}

/**
 * Initialise les matchers (idempotent).
 * @returns {void}
 */
function initMatchers() {
  if (compiledLibMatchers !== null) return;
  const list = getAllRawLibPatterns();
  compiledLibMatchers = compileMatchers(list);
}

/**
 * Teste si une valeur correspond à au moins un motif.
 * @param {unknown} value - Valeur (string) à tester.
 * @returns {boolean} True si correspondance ; False sinon.
 */
function anyMatch(value) {
  initMatchers();
  if (!compiledLibMatchers || compiledLibMatchers.length === 0) return true; // Pas de filtre → tout passe
  if (typeof value !== 'string' || !value) return false;
  return compiledLibMatchers.some((re) => re.test(value));
}

/**
 * Détermine si un projet doit être émis en sortie.
 * @param {ProjectRecord} obj - Projet.
 * @returns {boolean} True si à émettre.
 */
function shouldEmitProject(obj) {
  if (!obj) return false;
  if (LIBS_MATCH_SCOPE === 'dependencies') return true;
  return anyMatch(obj.name);
}

/**
 * Détermine si une dépendance doit être émise en sortie.
 * @param {DependencyRecord} obj - Dépendance.
 * @returns {boolean} True si à émettre.
 */
function shouldEmitDependency(obj) {
  if (!obj) return false;
  if (LIBS_MATCH_SCOPE === 'projects') return true;
  return anyMatch(obj.dependency);
}

/**
 * Ajoute un projet dans la collection si autorisé par le filtre.
 * @param {ProjectRecord} obj - Projet à pousser.
 * @returns {void}
 */
function pushProject(obj) {
  if (shouldEmitProject(obj)) projects.push(obj);
}

/**
 * Ajoute une dépendance dans la collection si autorisée par le filtre.
 * @param {DependencyRecord} obj - Dépendance à pousser.
 * @returns {void}
 */
function pushDependency(obj) {
  if (shouldEmitDependency(obj)) dependencies.push(obj);
}

// =====================
// Parsers
// =====================

/**
 * Parse JSON de manière sûre (null en cas d’échec).
 * @param {string} s - Chaîne JSON.
 * @returns {any|null} Objet parsé ou null.
 */
function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Parse un pom.xml (Maven) et renvoie l’objet 'project'.
 * @param {string} xml - Contenu XML du pom.
 * @returns {any} Objet project (groupId, artifactId, version, parent, …).
 */
function parsePom(xml) {
  const parser = new XMLParser({ ignoreAttributes: false });
  const j = parser.parse(xml);
  return j.project ?? j['mvn:project'] ?? j;
}

/**
 * Parse un fichier yarn.lock (v1).
 * @param {string} content - Contenu de yarn.lock.
 * @returns {Record<string, any>|null} Mapping des entrées ou null.
 */
function parseYarnLockFile(content) {
  try {
    const res = parseYarnLock(content);
    if (res && res.object) return res.object;
  } catch { }
  return null;
}

/**
 * Parse un fichier pnpm-lock.yaml.
 * @param {string} content - Contenu YAML.
 * @returns {any|null} Objet PNPM lock ou null.
 */
function parsePnpmLock(content) {
  try {
    const y = parseYaml(content);
    return y ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse un fichier package-lock.json (npm).
 * @param {string} content - Contenu JSON.
 * @returns {any|null} Objet npm lock ou null.
 */
function parseNpmLock(content) {
  return safeJson(content);
}

/**
 * Extrait une version résolue d’un npm lock (npm v7+).
 * @param {any} npmLock - Objet lock npm.
 * @param {string} depName - Nom de la dépendance.
 * @returns {string|null} Version résolue ou null.
 */
function getNpmLockResolved(npmLock, depName) {
  if (!npmLock) return null;
  if (npmLock.packages) {
    const key = `node_modules/${depName}`;
    if (npmLock.packages[key] && npmLock.packages[key].version) return npmLock.packages[key].version;
  }
  if (npmLock.dependencies && npmLock.dependencies[depName]) {
    const dep = npmLock.dependencies[depName];
    if (dep.version && typeof dep.version === 'string') return dep.version;
  }
  return null;
}

/**
 * ❗ Extraction de la version projet Gradle (Groovy/Kotlin DSL) via regex.
 * ⚠️ Selon la complexité des scripts Gradle, cette méthode peut ne pas couvrir tous les cas.
 * @param {string} buildScript - Contenu du build.gradle(.kts).
 * @param {boolean} [isKts=false] - Indique un script Kotlin DSL.
 * @returns {string|null} Version extraite ou null si introuvable.
 */
function extractGradleProjectVersion(buildScript, isKts = false) {
  if (!buildScript || typeof buildScript !== 'string') return null;
  // 1) Supprime commentaires /* ... */ et // ...
  const withoutBlockComments = buildScript.replace(/\/\*[\s\S]*?\*\//g, '');
  const cleaned = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '');
  // 2) Évite les faux positifs dans le bloc dependencies { ... }
  const sanitized = cleaned.replace(/dependencies\s*\{[\s\S]*?\}/g, '/* dependencies block removed */');
  // 3) Regex simplifiée et robuste (peut nécessiter des ajustements selon cas réels)
  const re = /^\s*(?:(?:rootProject|project)\s*\.\s*)?version\s*(?:=\s*|:\s+)\s*["']([^"']+)["']\s*$/gmu;
  let m;
  while ((m = re.exec(sanitized)) !== null) {
    const v = (m[1] ?? '').trim();
    if (v) return v;
  }
  // setVersion("x")
  const reSet = /setVersion\(\s*["']([^"']+)["']\s*\)/gmu;
  const m2 = reSet.exec(sanitized);
  if (m2 && m2[1]) return m2[1].trim();
  return null;
}

// =====================
// Détection monorepo JS
// =====================

/**
 * Détecte si la racine contient un workspace (pnpm/yarn).
 * @param {Map<string,string>} filesMap - Map des fichiers racine et contenu.
 * @returns {{is:boolean, via:string[]}} Indicateur + indices de détection.
 */
function detectWorkspaceRoot(filesMap) {
  const hasPnpmWs = filesMap.has('pnpm-workspace.yaml');
  if (hasPnpmWs) return { is: true, via: ['pnpm-workspace.yaml'] };
  const pkgJsonRaw = filesMap.get('package.json');
  if (pkgJsonRaw) {
    const pkg = safeJson(pkgJsonRaw);
    if (pkg && pkg.workspaces) return { is: true, via: ['package.json'] };
  }
  return { is: false, via: [] };
}

/**
 * Déduit le gestionnaire de packages JS à partir des lockfiles.
 * @param {Set<string>} lockfilesSet - Basenames de lockfiles.
 * @returns {'pnpm'|'yarn'|'npm'|null} Gestionnaire détecté.
 */
function inferJsPackageManager(lockfilesSet) {
  if (lockfilesSet.has('pnpm-lock.yaml')) return 'pnpm';
  if (lockfilesSet.has('yarn.lock')) return 'yarn';
  if (lockfilesSet.has('package-lock.json')) return 'npm';
  return null;
}

// =====================
// Pré‑filtrage des repos
// =====================

/**
 * Recherche Code Search pour identifier des repos candidats (selon libs).
 * @returns {Promise<Array<{owner:string, name:string}>|null>} Liste de candidats ou null si indisponible.
 */
async function codeSearchRepoCandidatesFromLibs() {
  const rawLibs = getAllRawLibPatterns();
  if (rawLibs.length === 0) return null;
  const repoSet = new Set();
  const quote = (s) => `"${s.replace(/"/g, '\\"')}"`;

  for (const lib of rawLibs) {
    for (const fname of SEARCH_FILE_TARGETS) {
      const baseQ = `${quote(lib)} filename:${fname}`;
      const orgQuals = SEARCH_ORGS.length ? SEARCH_ORGS.map((o) => `org:${o}`) : [''];

      for (const oq of orgQuals) {
        const q = oq ? `${baseQ} ${oq}` : baseQ;
        let page = 1, fetched = 0;
        const per_page = Math.min(100, Math.max(1, SEARCH_PER_LIB_LIMIT));
        while (fetched < SEARCH_PER_LIB_LIMIT) {
          try {
            const { data } = await octokit.search.code({ q, per_page, page });
            for (const item of (data.items ?? [])) {
              if (item.repository?.full_name) repoSet.add(item.repository.full_name);
            }
            const count = data.items?.length ?? 0;
            fetched += count;
            if (count < per_page) break;
            page++;
          } catch (e) {
            // 403/404/422: restrictions possibles sur GHES (Code Search)
            if ([403, 404, 422].includes(e.status)) {
              console.warn(`[prefilter:code] Search unavailable/restricted (q="${q}") → fallback to tree.`);
              return null;
            }
            console.warn(`[prefilter:code] Error q="${q}": ${e.message}`);
            break;
          }
        }
      }
    }
  }

  return Array.from(repoSet).map((full) => {
    const [owner, name] = full.split('/');
    return { owner, name };
  });
}

/**
 * Teste via arbre Git si un repo contient au moins un des motifs libs.
 * @param {string} owner - Organisation.
 * @param {RepoMeta} repoMeta - Métadonnées du repo.
 * @param {string[]} libsList - Motifs textuels à chercher.
 * @returns {Promise<boolean>} True si match trouvé dans fichiers clés.
 */
async function treePrefilterRepoContainsAnyLib(owner, repoMeta, libsList) {
  // 1) Lire l’arbre du default_branch
  let rootSha;
  try {
    rootSha = await getDefaultBranchSha(owner, repoMeta.name, repoMeta.default_branch ?? 'main');
  } catch {
    return false;
  }
  const tree = await getTreeRecursive(owner, repoMeta.name, rootSha);
  const blobs = tree
    .filter(t => t.type === 'blob')
    .map(t => t.path)
    .filter(p => !isPathExcluded(p)); // <-- filtre exclusion

  // 2) Vérifier présence de fichiers clés
  const candidates = ['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts'];
  const present = blobs.filter(p => candidates.includes(path.posix.basename(p)));
  if (present.length === 0) return false;


  // 3) Lire ces fichiers et tester présence textuelle d’au moins une lib
  for (const p of present) {
    if (isPathExcluded(p)) continue; // sécurité
    const content = await getFileContent(owner, repoMeta.name, rootSha, p);
    if (!content) continue;
    for (const lib of libsList) {
      if (content.includes(lib)) return true;
    }
  }
  return false;
}

// =====================
// Scan d'un repo (analyse détaillée)
// =====================

/**
 * Analyse approfondie d’un repository pour détecter projets et dépendances.
 * @param {string} owner - Organisation/Owner.
 * @param {RepoMeta} repoMeta - Métadonnées du repo.
 * @returns {Promise<void>} Ajoute les enregistrements dans `projects` et `dependencies`.
 */
async function scanRepo(owner, repoMeta) {
  const repo = repoMeta.name;
  const defaultBranch = SCAN_BRANCH ?? repoMeta.default_branch ?? 'main';

  // Récupération du SHA de la branche ciblée
  let rootSha;
  try {
    rootSha = await getDefaultBranchSha(owner, repo, defaultBranch);
  } catch (e) {
    console.warn(`[skip] ${owner}/${repo} cannot get branch ${defaultBranch}: ${e.message}`);
    return;
  }

  // Arbre de fichiers
  const tree = await getTreeRecursive(owner, repo, rootSha);
  const blobIndex = new Set(
    tree
      .filter(t => t.type === 'blob' && !isPathExcluded(t.path)) // <-- filtre exclusion
      .map(t => t.path)
  );
  const pathExists = (p) => blobIndex.has(p);

  // Helper: lit un fichier seulement s’il est présent dans l’arbre
  const getFileIfExists = (owner, repo, ref, filePath) =>
    (isPathExcluded(filePath) || !pathExists(filePath))
      ? Promise.resolve(null)
      : getFileContent(owner, repo, ref, filePath);

  const readInDir = (dir, filename) => {
    const fp = dir === '.' ? filename : `${dir}/${filename}`;
    return getFileIfExists(owner, repo, rootSha, fp);
  };

  // Repo-level (enregistrement racine)
  pushProject({
    org: owner,
    repo,
    default_branch: defaultBranch,
    path: '.',
    project_type: 'repo',
    package_manager: null,
    name: `${owner}/${repo}`,
    declared_version: null,
    resolved_version: null,
    workspace_root: null,
    lockfiles: [],
    commit_sha_scanned: rootSha,
    is_monorepo: null,
    detection: [],
  });

  // 2) Détection workspace root et lockfiles racine
  const rootFiles = new Map();
  for (const f of [
    'package.json',
    'pnpm-workspace.yaml',
    'yarn.lock',
    'package-lock.json',
    'pnpm-lock.yaml',
    'pom.xml',
    'settings.gradle',
    'settings.gradle.kts',
  ]) {
    const content = await readInDir('.', f);
    if (content) rootFiles.set(f, content);
  }

  const wsInfo = detectWorkspaceRoot(rootFiles);
  const rootLockSet = new Set(['yarn.lock', 'pnpm-lock.yaml', 'package-lock.json'].filter((f) => pathExists(f)));
  const rootPm = inferJsPackageManager(rootLockSet);

  if (wsInfo.is) {
    pushProject({
      org: owner,
      repo,
      default_branch: defaultBranch,
      path: '.',
      project_type: 'workspace-root',
      package_manager: rootPm,
      name: `${owner}/${repo}#workspace-root`,
      declared_version: null,
      resolved_version: null,
      workspace_root: '.',
      lockfiles: Array.from(rootLockSet),
      commit_sha_scanned: rootSha,
      is_monorepo: true,
      detection: wsInfo.via,
    });
  }

  // 3) JS/TS: Tous les package.json
  const packageJsonPaths = tree
    .filter((t) => t.type === 'blob' && t.path.endsWith('package.json'))
    .map((t) => t.path);

  for (const pkgPath of packageJsonPaths) {
    const dir = path.posix.dirname(pkgPath);
    const content = await getFileIfExists(owner, repo, rootSha, pkgPath);
    if (!content) continue;

    const pkg = safeJson(content);
    if (!pkg || !pkg.name) continue;

    // Lockfiles à la racine du package ou du repo
    const lockfiles = [];
    for (const lf of ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json']) {
      const pkgLfPath = path.posix.join(dir, lf);
      if (pathExists(pkgLfPath)) {
        const atPkg = await getFileContent(owner, repo, rootSha, pkgLfPath);
        if (atPkg) lockfiles.push(pkgLfPath);
      } else if (pathExists(lf)) {
        lockfiles.push(lf);
      }
    }

    const pkgLockSet = new Set(lockfiles.map((p) => path.posix.basename(p)));
    const pkgPm = inferJsPackageManager(pkgLockSet) ?? rootPm;

    // Enregistrement du package
    pushProject({
      org: owner,
      repo,
      default_branch: defaultBranch,
      path: dir,
      project_type: wsInfo.is ? 'workspace-package' : 'single-package',
      package_manager: pkgPm,
      name: pkg.name,
      declared_version: pkg.version ?? null,
      resolved_version: pkg.version ?? null,
      workspace_root: wsInfo.is ? '.' : null,
      lockfiles,
      commit_sha_scanned: rootSha,
      is_monorepo: wsInfo.is ?? null,
      detection: ['package.json'],
    });

    // Dépendances résolues (depuis lockfiles)
    if (INCLUDE_DEPENDENCIES) {
      let yarnObj = null, pnpmObj = null, npmLock = null;

      for (const lf of lockfiles) {
        const c = await getFileIfExists(owner, repo, rootSha, lf);
        if (!c) continue;
        if (lf.endsWith('yarn.lock')) yarnObj = parseYarnLockFile(c);
        if (lf.endsWith('pnpm-lock.yaml')) pnpmObj = parsePnpmLock(c);
        if (lf.endsWith('package-lock.json')) npmLock = parseNpmLock(c);
      }

      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.peerDependencies ?? {}),
        ...(pkg.optionalDependencies ?? {}),
      };

      for (const [depName, declaredRange] of Object.entries(allDeps)) {
        let resolved = null, source = null;

        // npm
        if (!resolved && npmLock) {
          const v = getNpmLockResolved(npmLock, depName);
          if (v) { resolved = v; source = 'npm-lock'; }
        }

        // yarn v1
        if (!resolved && yarnObj) {
          const candidates = Object.entries(yarnObj).filter(([k]) => k.startsWith(`${depName}@`));
          if (candidates.length) {
            const [, val] = candidates[0];
            if (val?.version) { resolved = val.version; source = 'yarn.lock'; }
          }
        }

        // pnpm v6/v7
        if (!resolved && pnpmObj) {
          const pkgs = pnpmObj.packages ?? {};
          const hitKey = Object.keys(pkgs).find((k) => k.startsWith(`/${depName}@`));
          if (hitKey) {
            const node = pkgs[hitKey];
            if (node && (node.version ?? node.resolution?.version)) {
              resolved = node.version ?? node.resolution.version ?? null;
              source = 'pnpm-lock.yaml';
            }
          }
        }

        pushDependency({
          org: owner,
          repo,
          default_branch: defaultBranch,
          package_path: dir,
          package_name: pkg.name,
          dependency: depName,
          declared_range: declaredRange,
          resolved_version: resolved,
          lock_source: source,
          commit_sha_scanned: rootSha,
        });
      }
    }
  }

  // 4) Maven: tous les pom.xml
  const pomPaths = tree
    .filter((t) => t.type === 'blob' && t.path.endsWith('pom.xml'))
    .map((t) => t.path);

  for (const pomPath of pomPaths) {
    const dir = path.posix.dirname(pomPath);
    const xml = await getFileIfExists(owner, repo, rootSha, pomPath);
    if (!xml) continue;

    const proj = parsePom(xml);
    const groupId = proj?.groupId ?? proj?.parent?.groupId ?? null;
    const artifactId = proj?.artifactId ?? null;
    const version = proj?.version ?? proj?.parent?.version ?? null;

    pushProject({
      org: owner,
      repo,
      default_branch: defaultBranch,
      path: dir,
      project_type: dir === '.' ? 'java-maven-root' : 'java-maven-module',
      package_manager: 'maven',
      name: artifactId ? `${groupId ?? 'unknown'}:${artifactId}` : null,
      declared_version: version ?? null,
      resolved_version: version ?? null,
      workspace_root: null,
      lockfiles: [],
      commit_sha_scanned: rootSha,
      is_monorepo: null,
      detection: ['pom.xml'],
    });
  }

  // 5) Gradle: settings.gradle(.kts) + build.gradle(.kts)
  const gradleSettings = tree
    .filter((t) => t.type === 'blob' && (t.path.endsWith('settings.gradle') || t.path.endsWith('settings.gradle.kts')))
    .map((t) => t.path);

  for (const settingsPath of gradleSettings) {
    const dir = path.posix.dirname(settingsPath);
    const settingsContent = await getFileIfExists(owner, repo, rootSha, settingsPath);
    if (!settingsContent) continue;

    // Détection des modules via include(...)
    const includes = Array.from(settingsContent.matchAll(/include\(([^)]+)\)/g))
      .flatMap((m) => m[1].split(','))
      .map((s) => s.replace(/['"`\s]/g, ''))
      .filter(Boolean);

    // Lecture du build.gradle(.kts) pour extraire une éventuelle version
    const buildGradlePath = path.posix.join(dir, 'build.gradle');
    const buildGradleKtsPath = path.posix.join(dir, 'build.gradle.kts');
    const buildGradle = await getFileIfExists(owner, repo, rootSha, buildGradlePath);
    const buildGradleKts = await getFileIfExists(owner, repo, rootSha, buildGradleKtsPath);
    const isKts = Boolean(buildGradleKts);
    const buildScript = buildGradle ?? buildGradleKts ?? '';
    const rootVersion = extractGradleProjectVersion(buildScript, isKts);

    pushProject({
      org: owner,
      repo,
      default_branch: defaultBranch,
      path: dir,
      project_type: 'java-gradle-root',
      package_manager: 'gradle',
      name: `${owner}/${repo}#gradle-root`,
      declared_version: rootVersion,
      resolved_version: rootVersion,
      workspace_root: dir,
      lockfiles: [],
      commit_sha_scanned: rootSha,
      is_monorepo: includes.length > 0,
      detection: ['settings.gradle(.kts)'],
    });

    // (Optionnel) lock Gradle simple (versions.lock)
    if (INCLUDE_DEPENDENCIES) {
      const lockPath = path.posix.join(dir, 'gradle', 'versions.lock');
      const lockContent = await getFileIfExists(owner, repo, rootSha, lockPath);
      if (lockContent) {
        const lines = lockContent
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'));

        for (const l of lines) {
          // Format: group:artifact = version
          const m = l.match(/^([^=:\s]+[:][^=:\s]+)\s*=\s*([^\s#]+)$/);
          if (m) {
            pushDependency({
              org: owner,
              repo,
              default_branch: defaultBranch,
              package_path: dir,
              package_name: `${owner}/${repo}#gradle-root`,
              dependency: m[1],
              declared_range: null,
              resolved_version: m[2],
              lock_source: 'gradle/versions.lock',
              commit_sha_scanned: rootSha,
            });
          }
        }
      }
    }
  }
}

// =====================
// Orchestration + Pré‑filtrage + Exports JSON/XLSX
// =====================

/**
 * Point d’entrée principal du scan.
 * - Compile les filtres,
 * - Découvre ou pré-filtre les repositories,
 * - Lance l’analyse détaillée,
 * - Trie et exporte les résultats (JSON/XLSX).
 *
 * @returns {Promise<void>}
 */
async function main() {
  initMatchers(); // compile éventuels filtres de sortie

  const libsForPrefilter = getAllRawLibPatterns();
  /** @type {Array<{owner:string, name:string, default_branch:string}>} */
  let repos = [];

  // 1) Pré-filtrage Code Search si demandé
  let repoCandidates = null;
  if (PREFILTER_MODE === 'code' && libsForPrefilter.length > 0) {
    console.log(`🔎 Prefilter(mode=code): searching repos with ${libsForPrefilter.length} lib patterns...`);
    repoCandidates = await codeSearchRepoCandidatesFromLibs();
    if (repoCandidates && repoCandidates.length === 0) {
      console.log('ℹ️ Code search returned 0 repos for given libs; falling back to tree prefilter.');
      repoCandidates = null;
    }
  }

  if (repoCandidates) {
    // Récupérer métadonnées et appliquer exclusions
    for (const c of repoCandidates) {
      try {
        const { data } = await octokit.repos.get({ owner: c.owner, repo: c.name });
        if (repoPassesExclusions(data)) {
          repos.push({ owner: c.owner, name: c.name, default_branch: data.default_branch ?? 'main' });
        }
      } catch (e) {
        console.warn(`[prefilter:code] Skip ${c.owner}/${c.name}: ${e.message}`);
      }
    }
  } else {
    // 2) Découverte standard des repos (orgs + user), avec exclusions
    const orgs = await listOrgs();
    for (const org of orgs) {
      const r = await listReposForOrg(org);
      console.log(`🔎 ${r.length} repositories find in ${org}.`);
      r.forEach((x) => repos.push({ owner: org, name: x.name, default_branch: x.default_branch ?? 'main' }));
    }
    if (INCLUDE_USER_REPOS) {
      const mine = await listUserRepos();
      for (const r of mine) {
        const key = `${r.owner.login}/${r.name}`;
        if (!repos.find((x) => `${x.owner}/${x.name}` === key)) {
          repos.push({ owner: r.owner.login, name: r.name, default_branch: r.default_branch ?? 'main' });
        }
      }
    }
  }

  // 3) Pré‑filtrage par arbre (si demandé & libs fournies)
  if (PREFILTER_MODE === 'tree' && libsForPrefilter.length > 0) {
    console.log(`🌲 Prefilter(mode=tree): checking ${repos.length} repos against ${libsForPrefilter.length} lib patterns...`);
    const filtered = [];
    for (const repoMeta of repos) {
      try {
        const ok = await treePrefilterRepoContainsAnyLib(repoMeta.owner, repoMeta, libsForPrefilter);
        if (ok) filtered.push(repoMeta);
      } catch (e) {
        console.warn(`[prefilter:tree] Skip ${repoMeta.owner}/${repoMeta.name}: ${e.message}`);
      }
    }
    repos = filtered;
  }

  console.log(`🗂️ Repositories to scan in depth: ${repos.length}`);
  for (const entry of repos) {
    console.log(`📦 scanRepo ${entry.owner}/${entry.name}.`);
    try {
      await scanRepo(entry.owner, { name: entry.name, default_branch: entry.default_branch });
    } catch (e) {
      console.warn(`[error] ${entry.owner}/${entry.name}: ${e.message}`);
    }
  }

  // ---- Tri (case-insensitive) ----
  // Projects: org, repo, path
  const sortedProjects = [...projects].sort((a, b) =>
    compareMultiple(a, b, ['org', 'repo', 'path'])
  );

  // Dependencies: org, repo, package_name, dependency
  const sortedDependencies = [...dependencies].sort((a, b) =>
    compareMultiple(a, b, ['org', 'repo', 'package_name', 'dependency'])
  );

  // ---- Exports JSON ----
  if (OUTPUT_JSON_ENABLED) {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, OUTPUT_JSON_PROJECTS_FILENAME),
      JSON.stringify(sortedProjects, null, OUTPUT_JSON_INDENT),
      'utf8'
    );
    fs.writeFileSync(
      path.join(OUTPUT_DIR, OUTPUT_JSON_DEPENDENCIES_FILENAME),
      JSON.stringify(sortedDependencies, null, OUTPUT_JSON_INDENT),
      'utf8'
    );
    console.log(`📝 JSON written: ${path.join(OUTPUT_DIR, OUTPUT_JSON_PROJECTS_FILENAME)} & ${path.join(OUTPUT_DIR, OUTPUT_JSON_DEPENDENCIES_FILENAME)}`);
  }

  // ---- Exports XLSX (Tables + AutoFilter) ----
  if (OUTPUT_XLSX_ENABLED) {
    const wb = new ExcelJS.Workbook();

    // --- Sheet Projects ---
    const wsProj = wb.addWorksheet('Projects');
    wsProj.columns = [
      { header: 'org', key: 'org', width: 20 },
      { header: 'repo', key: 'repo', width: 30 },
      { header: 'default_branch', key: 'default_branch', width: 16 },
      { header: 'path', key: 'path', width: 30 },
      { header: 'project_type', key: 'project_type', width: 20 },
      { header: 'package_manager', key: 'package_manager', width: 12 },
      { header: 'name', key: 'name', width: 40 },
      { header: 'declared_version', key: 'declared_version', width: 16 },
      { header: 'resolved_version', key: 'resolved_version', width: 16 },
      { header: 'workspace_root', key: 'workspace_root', width: 16 },
      { header: 'lockfiles', key: 'lockfiles', width: 30 },
      { header: 'commit_sha_scanned', key: 'commit_sha_scanned', width: 16 },
      { header: 'is_monorepo', key: 'is_monorepo', width: 10 },
      { header: 'detection', key: 'detection', width: 20 },
    ];

    const projRows = sortedProjects.map((p) => ([
      p.org,
      p.repo,
      p.default_branch,
      p.path,
      p.project_type,
      p.package_manager,
      p.name,
      p.declared_version,
      p.resolved_version,
      p.workspace_root,
      Array.isArray(p.lockfiles) ? p.lockfiles.join(',') : '',
      p.commit_sha_scanned,
      p.is_monorepo,
      Array.isArray(p.detection) ? p.detection.join(',') : '',
    ]));

    wsProj.addTable({
      name: 'ProjectsTable',
      ref: 'A1',
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: wsProj.columns.map((c) => ({ name: c.header })),
      rows: projRows,
    });
    wsProj.getRow(1).font = { bold: true };

    // --- Sheet Dependencies ---
    const wsDeps = wb.addWorksheet('Dependencies');
    wsDeps.columns = [
      { header: 'org', key: 'org', width: 20 },
      { header: 'repo', key: 'repo', width: 30 },
      { header: 'default_branch', key: 'default_branch', width: 20 },
      { header: 'package_path', key: 'package_path', width: 30 },
      { header: 'package_name', key: 'package_name', width: 40 },
      { header: 'dependency', key: 'dependency', width: 40 },
      { header: 'declared_range', key: 'declared_range', width: 24 },
      { header: 'resolved_version', key: 'resolved_version', width: 18 },
      { header: 'lock_source', key: 'lock_source', width: 18 },
      { header: 'commit_sha_scanned', key: 'commit_sha_scanned', width: 16 },
    ];

    const depsRows = sortedDependencies.map((d) => ([
      d.org,
      d.repo,
      d.default_branch,
      d.package_path,
      d.package_name,
      d.dependency,
      d.declared_range,
      d.resolved_version,
      d.lock_source,
      d.commit_sha_scanned,
    ]));

    wsDeps.addTable({
      name: 'DependenciesTable',
      ref: 'A1',
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: wsDeps.columns.map((c) => ({ name: c.header })),
      rows: depsRows,
    });
    wsDeps.getRow(1).font = { bold: true };

    const xlsxPath = path.join(OUTPUT_DIR, OUTPUT_XLSX_FILENAME);
    await wb.xlsx.writeFile(xlsxPath);
    console.log(`📘 Excel written: ${xlsxPath}`);
  }

  console.log('✅ Done.');
}

// --- Exécution ---
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * @example
 * // Installation des dépendances
 * // npm init -y
 * // npm i @octokit/rest yaml @yarnpkg/lockfile fast-xml-parser exceljs dotenv
 *
 * // Variables d'environnement
 * // export GHE_BASE_URL="https://ghe.mondomaine.tld/api/v3"
 * // export GHE_TOKEN="ghp_xxx"
 * // export START_ORGS="monOrg1,monOrg2"
 * // export INCLUDE_USER_REPOS="false"
 * // export SCAN_BRANCH=""
 * // export INCLUDE_ONLY_LIBS='@repo/*,org.acme:security,lodash'
 * // export LIBS_FILE='./libs.txt'
 * // export LIBS_MATCH_SCOPE='projects'   // 'projects' | 'dependencies' | 'both'
 * // export LIBS_CASE_INSENSITIVE='false'
 * // export PREFILTER_MODE='tree'         // 'code' | 'tree' | 'off'
 * // export SEARCH_ORGS='monOrg1,monOrg2'
 * // export SEARCH_PER_LIB_LIMIT=200
 * // export SEARCH_FILE_TARGETS='package.json,pom.xml,build.gradle,build.gradle.kts'
 * // export EXCLUDE_FORKS="true"
 * // export EXCLUDE_ARCHIVED="true"
 * // export EXCLUDE_DISABLED="true"
 * // export EXCLUDE_TEMPLATES="true"
 * // export EXCLUDE_OWNER_USER="true"
 * // export OUTPUT_DIR="./out"
 * // export OUTPUT_JSON_PROJECTS_FILENAME="projects.json"
 * // export OUTPUT_JSON_DEPENDENCIES_FILENAME="dependencies.json"
 * // export OUTPUT_JSON_ENABLED="true"
 * // export OUTPUT_JSON_INDENT="2"
 * // export OUTPUT_XLSX_ENABLED="true"
 * // export OUTPUT_XLSX_FILENAME="scan.xlsx"
 * // export SORT_CASE_INSENSITIVE="true"
 *
 * // Lancer:
 * // node scan-ghe.js
 */
