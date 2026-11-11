# Analyser les bibliothèques : UI, API publique et dépendances

`generate-component-dependency-graph` et son alias `graph:generate` exécutent le
même traitement. JavaScript et TypeScript peuvent coexister : JS, JSX, TS, TSX,
MJS, CJS, MTS, CTS et déclarations locales `.d.ts`. Aucun code analysé n'est exécuté.

## Trois vues

| Vue | Contenu affiché | Usage |
| --- | --- | --- |
| `public-ui` (défaut) | Composants graphiques exposés par les entrées publiques | Catalogue utilisable par les clients et graphe UI |
| `public-api` | UI, hooks, fonctions, constantes, types, namespaces et ressources réexportées | Contrat public et inventaire |
| `dependencies` | Définitions publiques et internes, relations runtime et de types | Prérequis, impact et préparation des travaux |

Les alias publics sont conservés sur une même définition ; les homonymes restent
distincts. Les vues publiques projettent les relations passant par les éléments
internes. Le détail sous-jacent est conservé dans `.analysis.json` pour l'impact et
les prérequis. Les membres d'un namespace portent un nom comme `Icons.Check`.

## Commandes

Depuis repo-tools, adapter les chemins à votre bibliothèque :

```powershell
npm run graph:generate -- --source "D:/git/ma-lib/src" --entry index.ts --view public-ui --output reports/ma-lib/ui.tgf
npm run graph:generate -- --source "D:/git/ma-lib/src" --entry index.ts --view public-api --output reports/ma-lib/api.tgf
npm run graph:generate -- --source "D:/git/ma-lib/src" --entry index.ts --view dependencies --external --output reports/ma-lib/dependencies.tgf
npm run generate-component-dependency-graph -- --help
```

`--entry` est relatif à `--source` et répétable. Déclarer toutes les entrées
accessibles aux clients, par exemple `--entry index.js --entry hooks/index.ts`.
Sans cette option, l'outil tente les chemins source de `package.json.exports`.
Les chemins pointant vers des fichiers compilés, absents, ou avec jokers demandent
des entrées source explicites. Sans champ `exports`, `index.*` ou `src/index.*`
sert de convention et un diagnostic demande de vérifier ce périmètre.

Quand la source analysée s'appelle `src` et que la bibliothèque ne possède ni
`tsconfig.json` ni `jsconfig.json`, les imports tels que `src/components` sont
automatiquement compris comme des fichiers de ce même dossier `src`.

La vue `dependencies` peut être utilisée sans entrée publique. Les points
d'entrée explicites prennent priorité sur la découverte dans `package.json`.

## Configuration réutilisable

Copier et adapter `config/library-analysis.example.json`, puis :

```powershell
npm run graph:generate -- --config config/ma-lib.json
```

```json
{
  "source": "../../ma-lib/src",
  "entries": ["index.ts"],
  "view": "public-ui",
  "output": "../reports/ma-lib/ui.tgf",
  "external": false,
  "uiInclude": [],
  "uiExclude": []
}
```

Les chemins `source` et `output` de ce JSON sont relatifs à son dossier. Ceux
fournis directement sur la ligne de commande sont relatifs au dossier courant.
Une option remplace la valeur de configuration. Les paramètres inconnus sont rejetés.

| Option | Rôle |
| --- | --- |
| `--source dossier` | Racine des sources ; défaut `SCAN_PATH` de `src/config.ts` |
| `--entry fichier` | Entrée publique source ; répétable |
| `--view public-ui\|public-api\|dependencies` | Vue ; défaut `public-ui` |
| `--external` | Packages externes dans `dependencies` ; les réexports externes publics restent inventoriés dans l'API |
| `--output fichier.tgf` | Destination du TGF et préfixe de ses rapports |
| `--config fichier.json` | Configuration réutilisable |
| `--ui-include nom-ou-id` | Classification UI explicite, répétable |
| `--ui-exclude nom-ou-id` | Exclusion d'un faux positif UI, répétable |
| `--help` | Aide sans analyser les sources |

Sans destination explicite, `public-ui` utilise `OUTPUT_TGF_PATH`. Les autres vues
ajoutent `.public-api`, `.dependencies` ou `.dependencies.external` avant `.tgf`.
Une destination explicite identique peut remplacer une sortie précédente : choisir
un fichier par vue dans les configurations.

## Sorties pour ui.tgf

| Fichier | Contenu |
| --- | --- |
| `ui.tgf` | Graphe ouvrable dans yEd et les commandes TGF existantes |
| `ui.catalog.json` | Liste, natures, sources, noms publics, entrées et métriques |
| `ui.catalog.md` | Catalogue lisible et diagnostics |
| `ui.analysis.json` | Définitions et relations complètes, y compris les éléments masqués |
| `ui.summary.json` | Périmètre, compteurs et diagnostics |
| `ui.plan.json` | Niveaux de traitement, groupes cycliques et prérequis externes |

Les JSON associés portent une empreinte commune. Les sorties sont préparées puis
publiées avec restauration en cas d'échec. Les copies de référence sous `logs`
restent conservées et sont désormais exclues du lint.

Les listes sont triées naturellement par nom affiché (`Component2` avant
`Component10`), puis par identifiant pour les homonymes. Les arcs sont triés par
nom de source puis de cible. Les alias et exports publics sont également triés.
Les plans gardent l'ordre croissant des niveaux, avec tri par nom dans chaque
niveau et groupe cyclique ; cet ordre s'applique aussi aux JSON et au Markdown.

## Prérequis et impact

```powershell
# Préparer Panel et Button, avec leurs dépendances communes comptées une fois
npm run graph:required -- --analysis reports/ma-lib/ui.analysis.json Panel Button --output reports/ma-lib/prerequis.json

# Éléments affectés par une modification de formatDate
npm run graph:impact -- reports/ma-lib/ui.analysis.json formatDate --output reports/ma-lib/impact.json
```

Sans `--output`, le JSON est affiché dans la console. Les noms publics, alias et
identifiants sont acceptés. Un nom ambigu est rejeté avec les identifiants possibles.
Les résultats incluent la sélection initiale et ses métriques.

Le niveau 0 contient les feuilles, puis les niveaux croissants leurs dépendants.
Les membres d'un cycle sont au même niveau et doivent être traités ensemble. Le
plan porte sur l'analyse complète : helpers et types masqués dans l'UI en font
partie. Les liens de types sont pris en compte. Les packages externes sont des
prérequis, pas des travaux internes.

Les indicateurs sont `directDependencies`, `directDependents`, `sourceLines` et
`branches`. Ils ne constituent ni un devis en jours ni une mesure cyclomatique
complète. Aucun chiffrage en jours n'est introduit par cette évolution.

## Détection et limites

- Les exports sont résolus avec TypeScript, indépendamment du nom des dossiers.
  Les fichiers de code sous `assets` sont analysés.
- La détection UI combine un nom majuscule et JSX/createElement dans la définition.
  C'est une heuristique. Les wrappers sans JSX et les composants retournant `null`
  peuvent nécessiter `--ui-include` ; les faux positifs, `--ui-exclude`.
- Les relations sont des références statiques entre déclarations ; les imports
  inutilisés ne créent pas de dépendance. Le JSX peut introduire implicitement
  React ou `jsxImportSource` lorsque les packages externes sont inclus.
- Un SVG brut réexporté est une ressource de l'API, pas automatiquement un composant UI.
- Les imports ESM sont pris en charge. Les imports dynamiques, `require` calculés
  et comportements runtime ne sont pas garantis. Les fichiers CommonJS purs ne
  constituent pas un inventaire exhaustif de leurs exports publics.
- `node_modules`, tests, dossiers de sortie et liens symboliques ne sont pas
  parcourus comme sources. Les imports résolus hors de la racine sont signalés
  et ignorés ; élargir `--source` pour couvrir plusieurs dossiers locaux.
- Une syntaxe invalide, un import local absent ou un export public non résolu
  empêche la publication. Cela ne remplace pas une vérification complète du typage.

## Compatibilité

La commande existante reste disponible et `graph:generate` est son alias. Sans
option, la nouvelle vue **public-ui** remplace l'ancien inventaire indifférencié
des implémentations publiques et privées.

`--detailed` seul conserve l'ancien moteur de réexports et les chemins
`SCAN_PATH`/`ORIGIN_PATH`. Il ne se combine pas avec les nouvelles options et ne
produit pas leurs catalogues.

`graph:analyze` et `graph:required-by-name` restent disponibles pour les TGF.
Régénérer les métadonnées avec le même TGF. Pour les prérequis et l'impact incluant
les éléments internes, utiliser `.analysis.json` comme ci-dessus.

Ce nouveau moteur est indépendant de celui d'`analyse-component-versions`, dont
le comportement n'est pas modifié par ces vues.
