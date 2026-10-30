# 📦 Inventaire & rapports de dépendances : GitHub → JSON/XLSX → Markdown

> Ce guide couvre l’utilisation conjointe de deux scripts :
> 1. **scan-ghe.js** : scan des dépôts GitHub et extraction des dépendances (JS/TS, Maven, Gradle).
> 2. **generate_deps_report.py** : génération d’un rapport Markdown analytique (tableaux & camemberts Mermaid) par librairie.

## 🎯 Objectifs

- **Cartographier** les projets, workspaces et modules présents sur GitHub (monorepos JS, Maven, Gradle).
- **Lister les dépendances** (déclarées & résolues via lockfiles) avec leurs versions.
- **Produire** des artefacts 📄 **JSON** / 📊 **XLSX** / 📝 **Markdown** pour analyse.
- **Documenter et visualiser** l’état d’usage des bibliothèques (top libs, multi-majors, pré-releases, dérives).

## ✨ Fonctionnalités principales

### 1) scan-ghe.js

- Découverte des organisations/repos via API GitHub, avec **exclusions** configurables (forks, archived, templates, owner=User).
- **Pré‑filtrage** des repos par **Code Search** ou par **arbre Git** sur des motifs de libs.
- Détection : **workspaces JS (pnpm/yarn)**, **Maven (pom.xml)**, **Gradle (settings/build)**.
- Extraction des **versions déclarées** & **résolues** (lockfiles `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `gradle/versions.lock`).
- **Filtrage** du contenu émis (projets/dépendances) par **glob patterns** de bibliothèques.
- **Exports** JSON + Excel (tables Projects & Dependencies).

### 2) generate_deps_report.py

- Chargement depuis `dependencies.jsonl` **ou** `dependencies.json`.
- **Filtrage** par **libs**, **orgs** et **repos** (patterns type glob, insensitive option).
- **Agrégations** : top libs, dérives **multi‑majors**, pré‑releases/RC, unresolved (lockfiles manquants).
- **Rapport Markdown** : tableaux lisibles + **camemberts Mermaid** (min/max slices, “Autres”).
- Détails **par librairie** en buckets **non cumulés** (`version = 0`, `version ≥ M.m`) pour *resolved* et *declared*.

## 🧩 Pré-requis

- Node.js 22.16+ (branche 22) ou Node.js 24
- Python ≥ 3.9
- Accès API GitHub avec token (`GHE_TOKEN`) et base URL (`GHE_BASE_URL`).
- Droits **Code Search** si tu actives le pré‑filtrage en mode `code` (sinon `tree`).

## ⚙️ Configuration

### Installer deps JS

```bash
npm init -y
npm i @octokit/rest yaml @yarnpkg/lockfile fast-xml-parser exceljs dotenv
```

### Variables d’environnement (scan-ghe.js)

```bash
# Connexion GHES
export GHE_BASE_URL="https://ghe.example.com/api/v3"
export GHE_TOKEN="ghp_***"

# Découverte / périmètre
export START_ORGS="orgA,orgB"           # optionnel (sinon auto via /user/orgs)
export INCLUDE_USER_REPOS="false"       # inclure repos utilisateur (true par défaut)
export SCAN_BRANCH=""                   # optionnel (sinon default_branch)

# Filtrage du CONTENU (sortie)
export INCLUDE_ONLY_LIBS='@repo/*,lodash,org.acme:security'
export LIBS_FILE='./libs.txt'           # optionnel (un motif par ligne)
export LIBS_MATCH_SCOPE='projects'      # 'projects' | 'dependencies' | 'both'
export LIBS_CASE_INSENSITIVE='false'

# PRÉ-FILTRAGE des REPOS (réduction périmètre)
export PREFILTER_MODE='tree'            # 'code' | 'tree' | 'off' (defaut: tree)
export SEARCH_ORGS='orgA,orgB'          # optionnel (qualifier "org:" pour Code Search)
export SEARCH_PER_LIB_LIMIT=200
export SEARCH_FILE_TARGETS='package.json,pom.xml,build.gradle,build.gradle.kts'

# Exclusions (activées par défaut)
export EXCLUDE_FORKS="true"
export EXCLUDE_ARCHIVED="true"
export EXCLUDE_DISABLED="true"
export EXCLUDE_TEMPLATES="true"
export EXCLUDE_OWNER_USER="true"
export EXCLUDE_DIRS=""

# Sorties & Tri
export OUTPUT_DIR="./out"
export OUTPUT_JSON_PROJECTS_FILENAME="projects.json"
export OUTPUT_JSON_DEPENDENCIES_FILENAME="dependencies.json"
export OUTPUT_JSON_ENABLED="true"
export OUTPUT_JSON_INDENT="2"
export OUTPUT_XLSX_ENABLED="true"
export OUTPUT_XLSX_FILENAME="scan.xlsx"
export SORT_CASE_INSENSITIVE="true"
```

### Options CLI (generate_deps_report.py)

```bash
# Entrées & sorties
--in ./out/dependencies.jsonl           # accepte aussi .json et .json(.gz)
--out ./out/dependencies-report.md      # fichier Markdown

# Filtres
--libs "@repo/*,react,org.slf4j:slf4j-api"
--libs-file ./libs.txt
--orgs "org1,org2"
--repos "org1/repoA,org2/repoB"
--case-insensitive

# Synthèses & périmètre
--top 50                                # Top N tables principales
--per-lib-limit 20                      # N librairies détaillées
--perlib-include-zero-line              # ajouter 'version = 0' (0.x)
--no-perlib-include-zero-line
--perlib-include-zero-minors            # ajouter 'version ≥ 0.m'
--no-perlib-include-zero-minors
--pie-max-slices 12                     # max parts camembert Mermaid
--title "Etat des dépendances - Nov 2025"
--include-sections "overview,libraries,drift,prereleases,unresolved,repos,orgs,perlib,branches"
--json-items-key items                  # si le .json possède une clé contenant la liste
```

## ▶️ Exécution

### ✅ Checklist avant run

- [ ] Token GitHub défini.
- [ ] Variables d’environnement configurées.
- [ ] Fichier libs.txt prêt.
- [ ] Dossier ./out créé.

### Étape 1 : Scan GitHub

```bash
npm run scan-ghe
```

Artefacts produits:

- ./out/projects.json (trié org/repo/path)
- ./out/dependencies.json (trié org/repo/package_name/dependency)
- ./out/scan.xlsx (tables Projects & Dependencies, AutoFilter)

### Étape 2 : Rapport Markdown

```bash
python generate_deps_report.py \
  --in ./out/dependencies.json \
  --out ./out/dependencies-report.md \
  --libs-file ./libs.txt \
  --top 50 --per-lib-limit 20 \
  --pie-max-slices 12 \
  --include-sections "overview,libraries,drift,prereleases,unresolved,repos,orgs,perlib,branches" \
  --title "Etat des dépendances — ${DATE}"
```
Artefacts produits:

- `./out/dependencies-report.md`

### 🧭 Exemples d’usage

#### Exemple générique

1. Scan complet + pré‑filtrage tree
```bash
export INCLUDE_ONLY_LIBS='@repo/*,org.slf4j:slf4j-api,lodash'
export PREFILTER_MODE='tree'
npm run scan-ghe
```
2. Rapport markdown pour Top 50 libs, avec détails par librairie
```bash
python generate_deps_report.py \
  --in ./out/dependencies.json \
  --out ./out/dependencies-report.md \
  --libs-file ./libs.txt --top 50 --per-lib-limit 50 \
  --perlib-include-zero-line --perlib-include-zero-minors \
  --pie-max-slices 12 \
  --title "Etat des dépendances — $(date +%d/%m/%Y)"
```

#### Etat des lieux libs repos

1. Mettre en place le fichier `.env` de configuration suivant
```bash
# --- Contexte GHES / Auth ---
GHE_BASE_URL=https://api.github.enterprise.io
GHE_TOKEN=ghp_***

# --- Périmètre : pas d'org spécifiée ---
unset SEARCH_ORGS               # <— important
PREFILTER_MODE='code'           # utilise la recherche de code (API v3)
INCLUDE_USER_REPOS=false
START_ORGS=""

# Ignorer les dossiers de build et les modules
export EXCLUDE_DIRS="node_modules/**,dist/**,build/**,.github/**,**/test/**"

# --- Motif de la lib Node (package name exact) ---
INCLUDE_ONLY_LIBS='repo-react,repo-react-enterprise,enterprise-assets'
LIBS_MATCH_SCOPE='both'

# --- Réglages Code Search (Node/JS) ---
CODESRCH_INCLUDE_MAVEN=false
CODESRCH_INCLUDE_GRADLE=false
# (Le moteur JS/Node s'appuie sur filename:package.json + nom exact de la lib)

# --- Sorties (facultatif) ---
OUTPUT_DIR=reports
OUTPUT_JSON_ENABLED=true
OUTPUT_XLSX_ENABLED=true
OUTPUT_JSON_PROJECTS_FILENAME=library-repo-projects.json
OUTPUT_JSON_DEPENDENCIES_FILENAME=library-repo-dependencies.json
OUTPUT_XLSX_FILENAME=library-repo-scan.xlsx
```
2. Scan complet + pré‑filtrage tree
```bash
npm run scan-ghe
```
3. Générer un rapport complet
```bash
python src/generate_deps_report.py \
  --no-perlib-include-zero-line \
  --in ./reports/library-repo-dependencies.json \
  --out ./reports/library-repo-dependencies-report.md \
  --title "Etat des dépendances - $(date +%d/%m/%Y)"
```

#### Etat des lieux lib enterprise-security-oidc

1. Mettre en place le fichier `.env` de configuration suivant
```bash
# --- Contexte GHES / Auth ---
GHE_BASE_URL=https://api.github.enterprise.io
GHE_TOKEN=ghp_***

# --- Périmètre : pas d'org spécifiée (recherche globale) ---
unset SEARCH_ORGS             # <— important
PREFILTER_MODE='code'         # utilise la recherche de code (API v3)
INCLUDE_USER_REPOS=false      # à ta convenance
START_ORGS=""                 # vide => découverte auto ignorée côté prefilter code

# --- Motif de la lib Maven (groupId:artifactId) ---
INCLUDE_ONLY_LIBS='fr.enterprise.security:enterprise-security-oidc'
LIBS_MATCH_SCOPE='both'

# --- Réglages Code Search (Maven uniquement ici) ---
CODESRCH_INCLUDE_MAVEN="true"
CODESRCH_INCLUDE_GRADLE="false"
CODESRCH_MAVEN_FALLBACK_ARTIFACT_ONLY="true"  # si 0 hit, retente par <artifactId> seul

# --- Sorties (facultatif) ---
OUTPUT_DIR=reports
OUTPUT_JSON_ENABLED="true"
OUTPUT_XLSX_ENABLED="true"
OUTPUT_JSON_PROJECTS_FILENAME=enterprise-security-oidc-projects.json
OUTPUT_JSON_DEPENDENCIES_FILENAME=enterprise-security-oidc-dependencies.json
OUTPUT_XLSX_FILENAME=enterprise-security-oidc-scan.xlsx
```
2. Scan complet + pré‑filtrage tree
```bash
npm run scan-ghe
```
3. Générer un rapport complet
```bash
python src/generate_deps_report.py \
  --no-perlib-include-zero-line \
  --in ./reports/enterprise-security-oidc-dependencies.json \
  --out ./reports/enterprise-security-oidc-dependencies-report.md \
  --title "Etat des dépendances - $(date +%d/%m/%Y)"
```

## 📂 Sorties

- ./out/projects.json — inventaire des projets détectés (repo/workspace/module).
- ./out/dependencies.json — dépendances déclarées/résolues.
- ./out/scan.xlsx — vues Projects & Dependencies avec AutoFilter.
- ./out/dependencies-report.md — rapport synthétique multi-sections (tables + Mermaid).

## 🧪 Lecture du rapport — repères rapides

- Synthèse par librairie (Top N) : nombre de repos/packages, version la plus utilisée, indicateurs multi‑majors et pré‑releases.
- Dérives (multi‑majors) : repère des libs utilisées simultanément sur plusieurs versions majeures, avec échantillon par major.
- Pré‑releases / RC : agrégé + détail exhaustif (Org, Repo, Package, Lib, Version).
- Unresolved : repos à forte proportion de versions non résolues (lockfiles absents ou non pris en compte).
- Par org / par branche : distribution et ratios non résolus, pour vue macro.

## ✅ Bonnes pratiques

- Cadrer le périmètre via INCLUDE_ONLY_LIBS + LIBS_FILE pour des scans plus rapides.
- Utiliser PREFILTER_MODE=tree (par défaut) si Code Search est restreint ou indisponible.
- Commiter les lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml) côté JS ; pour Maven/Gradle, les résolutions complètes sans build local peuvent être limitées.
- Conserver les artefacts scan.xlsx & dependencies.json pour runs reproductibles et diffs dans le temps.
- Dans les rapports, lire les buckets non cumulés : version ≥ M.m ne compte que les M.m.x (ligne “version = 0” sert de cadrage pour 0.x).

## 🧩 Dépannage

- Code Search indisponible / quota : basculer en PREFILTER_MODE=tree.
- Beaucoup de “(unresolved)” :
  - Vérifier la présence de lockfiles au bon niveau (package VS repo).
  - npm v7+ : vérifier packages["node_modules/<lib>"].version.
  - pnpm : vérifier packages["/<lib>@<version>"].
  - Gradle : utiliser gradle/versions.lock si possible.
- Mermaid pie trop chargé : réduire --pie-max-slices ou élargir les filtres de libs.

## 🔒 Sécurité

- Ne jamais logger le token GitHub (`GHE_TOKEN`).
- Bannir pré‑releases (alpha/beta/rc/snapshot) via rulesets CI/CD surtout pour la Release Finale d'un composant.
- Assurer la traçabilité : conserver commit_sha_scanned pour chaque ligne.
