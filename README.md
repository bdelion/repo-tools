# repoTools for enterprise

| Service             |               Master               |              Develop               |
| :------------------ | :--------------------------------: | :--------------------------------: |
| CI Status           |    [![Build Status][jmb]][jml]     |    [![Build Status][jdb]][jdl]     |
| Quality Gate Status | [![Quality Gate Status][smb]][sml] | [![Quality Gate Status][sdb]][sdl] |

> NOTE : Le format est basé sur [Make a README].

## 🚀 Ce que fait ce repo

> **repo-tools** est un ensemble d'outils Node.js pour l’analyse et la visualisation d’artefacts liés à `repo` de la Squad **Communs du Dev** (ex : composants exportés, graphes de dépendances, rapports Markdown/Excel).

- **Analyse des composants exportés** par version de livrable de la stack `repo` (diff de contenu + diff AST, rapports Markdown/Excel), voir [analyse-component-versions].
- **Génération de graphes de dépendances** (via `madge`, `dagre`, `d3`) pour visualiser modules et imports entre eux, voir [generate-component-dependency-graph].
- **Inventaire & rapports de dépendances** pour faire un état des lieux de la déclaration des dépendances et générer des rapports associés, voir [scan-ghe].

## 🧰 Prérequis

- **Node.js ≥ 18** (**Node 20 LTS recommandé**)  
  Utilisez `nvm use` pour appliquer la version définie dans `.nvmrc`.
- **Git CLI** installé et accessible dans le `PATH`.
- Accès aux dépôts Git (SSH recommandé).
- Accès au **registry NPM interne** : registry=https://nexus.enterprise.io/repository/npm-public/
- Droits d’exécution des scripts Node.js (`node` ou via `npm run`).

## ⚙️ Installation

Clonez le dépôt et installez les dépendances :

```bash
git clone <url-entrepot>/repo-tools.git
cd repo-tools

# Sélectionner la bonne version de Node
nvm use

# Installer les dépendances
npm ci
```

Dépendances principales :

- simple-git : gestion des dépôts Git
- fs-extra : manipulation avancée des fichiers
- exceljs : génération des rapports Excel
- @babel/parser : parsing AST pour l’analyse des exports
- semver : gestion des versions

## 🏃‍♂️ Utilisation rapide

### Analyse des composants et comparaison par version

Consultez la doc détaillée : [analyse-component-versions].

### Graphes de dépendances

Consultez la doc détaillée : [generate-component-dependency-graph].

### Inventaire & rapports de dépendances

Consultez la doc détaillée : [scan-ghe].

### Analyse de graphe

#### Génération du graphe

```bash
npm run analyse-components
```

#### Analyse du graphe

```bash
npm run graph:analyze reports/components.tgf
```

#### Résultats

- Détection de cycles
- Profondeur maximale
- Composants orphelins
- Dépendances

### Required Components Analysis

#### Generate dependency report

```bash
npm run graph:required-by-name -- \
  reports/components.tgf \
  ComboBox \
  Dialog
```

Pour traiter tous les composants du graphe :

Le séparateur `--` après `graph:required-by-name` est nécessaire : sans lui,
npm consomme l’option `--all` au lieu de la transmettre au script.

```bash
npm run graph:required-by-name -- graphe/repo-react-component-dependency-graph.tgf --all
```

Pour charger une liste depuis un fichier texte UTF-8 (un nom par ligne,
lignes vides et commentaires commençant par `#` ignorés) :

```bash
npm run graph:required-by-name -- graphe/repo-react-component-dependency-graph.tgf --components-file config/components.txt
```

Ces trois modes sont exclusifs. Les doublons sont supprimés et les noms inconnus
figurent dans la section « Missing Components » du rapport. Voir [le format du fichier](docs/required-components.md).
Exécuter d’abord `npm run graph:analyze -- <graphe.tgf>` pour générer les métadonnées
associées dans `reports/<OUTPUT_GRAPHE_DIR>/components.json` (`OUTPUT_GRAPHE_DIR`
est défini dans `src/config.ts`).

Generated files:

```text
reports/
└── <OUTPUT_GRAPHE_DIR>/
    └── required-components/
        ├── required-components.json
        └── required-components.md
```

#### Available metrics

- direct dependencies
- transitive dependencies
- shared dependencies
- dependency tree
- max depth
- complexity score
- migration effort estimation

## Parcours d'analyse pour `repo-angular`

- Synchroniser en local le repository `repo-react` sur la branche `develop`
- Mettre à jour le fichier `config-ts` pour l'analyse de `repo-react`
```ts
export const SCAN_PATH = '/workspaces/github/repo/repo-react/src';
export const ORIGIN_PATH = '/workspaces/github/repo/repo-react/src/';
export const OUTPUT_TGF_PATH = 'graphe/repo-react-component-dependency-graph.tgf';
export const OUTPUT_GRAPHE_DIR = 'repo-react';
```
- Générer le fichier TGF pour `repo-react`
```sh
npm run generate-component-dependency-graph
```
- Générer les rapports d'analyse du graphe TGF
```sh
npm run graph:analyze graphe/repo-react-component-dependency-graph.tgf
```
- Générer le rapport permettant de connaître les composants `repo-react` à implémenter en `repo-angular` pour avoir une version de librairie qui correspond à la liste des composants attendus pour les écrans SMACL
```sh
npm run graph:required-by-name graphe/repo-react-component-dependency-graph.tgf Accordion ActionsMenuButton AnchorDialog Badge Button ButtonPagination CheckBoxCardGroupFormFragment CheckBoxFormFragment CheckBoxGroupFormFragment ChipsGroupFormFragment CollapsibleDialog ComboBoxFormFragment ConfirmationAnchorDialog ConfirmationDialog DateFormFragment Dialog FileUploadFormFragment Form HeadlinedWizardForm InputPagination LinkButton ListBoxFormFragment Loader LoadingIndicator MoneyFormFragment MultiButton NumberFormFragment NumberedWizardForm RadioCardGroupFormFragment RadioGroupFormFragment SearchFormFragment Stepper StringFormFragment SummaryWizardForm Switch Table Tabs Tag TextFormFragment WizardForm LocalNotificationStack NotificationStack useDataSearch usePagination useServerPagination useValidatedState
```

## ⚙️ Scripts NPM (proposés)

> Pour intégrer proprement le stage **Lint (Node)** du Jenkinsfile (qui exécute `npm run lint`), ajoute ces scripts si absents.

```jsonc
  "scripts": {
    "build": "echo 'useless pipeline step'",
    "lint": "eslint .",
    "lint:fix": "eslint --fix .",
    "generate-component-dependency-graph": "ts-node src/generate-component-dependency-graph.ts",
    "analyse-component-versions": "node src/analyse-exports.js"
  },
```

## Journal des modifications

Pour connaître les dernières évolutions et leurs impacts, consuler la page [CHANGELOG].

## Contribution

Pour toutes demandes de modifications, veuillez d'abord ouvrir une [issue] afin de discuter de ce que vous souhaitez modifier.

Voir aussi la liste des [contributeurs] ayant participé à ce projet.

## 🗂️ Versioning

Nous utilisons [SemVer] pour le versioning. Pour les versions disponibles, voir [les tags de ce projet].

## 🔗 Liens utiles

- Documentation :
    - [analyse-component-versions] — Analyse des composants exportés (AST, rapports, tips).
    - [generate-component-dependency-graph] — Graphes de dépendances (Madge/Dagre/D3).
    - [scan-ghe] — Inventaire & rapports de dépendances.
- Build : [Job Jenkins]
- Code Quality : [Sonar]
- Repository : [Nexus]

<!-- liens -->
[jmb]: https://jenkins.enterprise.io/buildStatus/icon?job=bertrand-delion%2Frepo-tools%2Fmaster&subject=Build%20${displayName} "Jenkins master Build Status Icon"
[jml]: https://jenkins.enterprise.io/job/DELION%20Bertrand/job/repo-tools/job/master/ "Jenkins master Job"
[jdb]: https://jenkins.enterprise.io/buildStatus/icon?job=bertrand-delion%2Frepo-tools%2Fdevelop&subject=Build%20${displayName} "Jenkins develop Build Status Icon"
[jdl]: https://jenkins.enterprise.io/job/DELION%20Bertrand/job/repo-tools/job/develop/ "Jenkins develop Job"
[smb]: https://sonarqube.enterprise.io/api/project_badges/measure?project=repo-tools&metric=alert_status "Sonar master Quality Gate Status Badge"
[sml]: https://sonarqube.enterprise.io/dashboard?id=repo-tools "Sonar master Dashboard"
[sdb]: https://sonarqube.enterprise.io/api/project_badges/measure?project=repo-tools&metric=alert_status&branch=develop "Sonar develop Quality Gate Status Badge"
[sdl]: https://sonarqube.enterprise.io/dashboard?id=repo-tools&branch=develop "Sonar develop Dashboard"
[Make a README]: https://www.makeareadme.com/#template-1 "README Template et bonnes pratiques"

[analyse-component-versions]: docs/analyse-component-versions.md
[generate-component-dependency-graph]: docs/generate-component-dependency-graph.md
[scan-ghe]: docs/scan-ghe.md

[CHANGELOG]: CHANGELOG.md "CHANGELOG du projet"
[issue]: https://github.enterprise.io/bertrand-delion/repo-tools/issues "Liste des issues ouvertes"
[contributeurs]: https://github.enterprise.io/bertrand-delion/repo-tools/graphs/contributors "Liste des contributeurs au projet"
[SemVer]: https://semver.org/lang/fr/ "Bonnes pratique de la Gestion de Version"
[les tags de ce projet]: https://github.enterprise.io/bertrand-delion/repo-tools/tags "Liste des tags du projet"
[Job Jenkins]: https://jenkins.enterprise.io/job/DELION%20Bertrand/job/repo-tools "Job Jenkins du projet"
[Sonar]: https://sonarqube.enterprise.io/dashboard?id=repo-tools&branch=master "Dashboard Sonar du projet"
[Nexus]: http://nexus-fabfonc.enterprise.io/#browse/search=keyword%3Drepo-tools "Liste des artifacts existants dans Nexus"
