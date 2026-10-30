# Historique des composants et noms métier

## Une ligne par symbole source

Les rapports Markdown, Excel et JSON de comparaison regroupent les exports par
`sourcefile#sourceExport`. Les JSON d’analyse par version et les identités TGF
restent inchangés. Sans symbole source résolu, les identités d’export restent séparées.

Un `Type` réexporté comme `PersonnePhysiquePhoneType` depuis plusieurs barrels
donne une ligne :

| Component | Source Symbol | Public Names | Export Files |
|---|---|---|---|
| PersonnePhysiquePhoneType | Type | PersonnePhysiquePhoneType, Type | Tous les fichiers qui exposent ce symbole |

Deux symboles différents d’un même fichier, ou deux symboles homonymes de fichiers
différents, ne sont pas regroupés. La suppression d’un seul point de réexport est
une modification des exports ; la disparition du dernier devient une suppression.

Le JSON de comparaison liste les exports d’origine dans `exports` (identifiant,
nom public, fichier et type d’export), ainsi que `publicNames` et `exportFiles`.
`previous` contient les anciens noms, chemins et listes d’exports pour une modification.
Les changements sont indiqués par `publicNamesChanged`, `exportFilesChanged`,
`sourceSymbolChanged` et les motifs existants.

## Choisir le nom métier

`Component` utilise dans cet ordre :

1. Le nom explicitement configuré pour l’identité source.
2. L’unique alias public différent du symbole source et de `default`.
3. Le nom du symbole s’il est exposé, sinon le premier nom public trié.

Plusieurs alias possibles sans choix explicite donnent `nameSelection: "ambiguous"`
et un marqueur `⚠️`. Le code ne déduit pas le métier du nom le plus long.
Le nom préféré est un libellé de rapport ; il ne renomme pas les exports.

Dans la configuration d’analyse :

```json
{
  "preferredComponentNames": {
    "repo-react-enterprise": {
      "src/contacts/phones/type.js#Type": "PersonnePhysiquePhoneType"
    }
  }
}
```

Les clés utilisent `/`, le chemin relatif au dépôt et le symbole source. Si
l’identité source change, configurer également son nouveau nom préféré si nécessaire.

## Migrations et refontes

Le suivi historique s’effectue après le regroupement. Git, le même symbole source,
le contenu identique unique et la migration JS → TS restent des indices de continuité.
Un `default` devient un export nommé au même chemin sans extension pendant une
migration JS → TS uniquement si ce nom était déjà public avant et l’est après.
Cela couvre `ActionsMenuSvg` sans rapprocher arbitrairement deux symboles différents.

Une suppression/ajout après refonte peut ne fournir aucun indice automatique fiable.
Une correspondance explicite est alors possible ; elle n’est jamais inventée à
partir de la seule ressemblance des noms. Exemple de configuration :

```json
{
  "componentHistoryMappings": {
    "repo-react": [
      {
        "from": {
          "version": "0.0.1",
          "sourcefile": "src/internal/accesibilityPropType.js",
          "sourceExport": "AriaLabelOrLabelBy"
        },
        "to": {
          "version": "0.0.2",
          "sourcefile": "src/internal/accessibilityPropType.js",
          "sourceExport": "AriaLabelOrLabelBy"
        },
        "reviewRequired": true
      }
    ]
  }
}
```

La configuration fournie active pour `repo-react` les trois correspondances des
issues #14 et #15, avec `reviewRequired: true` : correction du chemin
`accesibilityPropType.js`, puis les deux refontes d’`AnchorPosition`. Elles restent
signalées à vérifier jusqu’à leur validation métier. Avec un autre fichier passé
via `--config`, ces règles doivent y être présentes pour s’appliquer.

La règle ne s’applique qu’entre les deux versions consécutives indiquées dans
l’analyse du dépôt concerné. Une correspondance active avec une source/cible absente
ou une cible dupliquée fait échouer la préparation des rapports avant publication.
Elle ne fusionne pas deux symboles qui coexistent dans une même version.

`reviewRequired` vaut `true` par défaut :

- `⚠️` reste sur la ligne globale, même après plusieurs versions inchangées.
- `⚠️ À vérifier` apparaît dans la cellule de transition et la comparaison Markdown.
- Le JSON porte `historyMatch: "configuredMapping"` et `reviewRequired: true`.
- La feuille Excel `Historique à vérifier` liste les deux versions, chemins et symboles.

Après vérification métier, passer `reviewRequired` à `false` retire le marqueur
de revue tout en conservant la trace `configuredMapping`. Sans correspondance
configurée, les historiques incertains restent séparés.

## Liens et feuilles Excel

Le Markdown affiche tous les liens d’export. Une cellule Excel ne porte qu’un
hyperlien : la colonne `Export Files` liste les chemins et pointe vers le premier
fichier disponible. La feuille dédiée `Export Files` contient un lien individuel
pour chaque nom public et fichier d’export, à chaque version.

Les liens des comparaisons pair-à-pair ciblent toujours la version de destination.
Les rapports globaux conservent la référence nommée la plus récente où le fichier
existe, puis le dernier tag connu comme repli. Aucun lien n’est créé vers un fichier
absent de la référence choisie.

Les rapports sont reconstruits à chaque exécution : changer le regroupement, un
nom préféré ou une correspondance ne nécessite pas de vider les analyses en cache.
