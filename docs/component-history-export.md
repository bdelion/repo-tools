# Générer les historiques YAML depuis Excel

Depuis la racine du projet :

```powershell
npm run history:export
```

La commande parcourt récursivement `reports` et convertit chaque rapport global
`<repository>_component_comparison.xlsx` en `<repository>-historique-composants.yaml`,
à côté du classeur. Les autres classeurs, notamment les comparaisons entre deux
versions et les fichiers temporaires Excel, sont ignorés.

```powershell
npm run history:export -- --reports-dir logs --output-dir reports/historiques --repo plume-react
```

`--reports-dir` change le dossier d'entrée, `--output-dir` change le dossier de
sortie en conservant les sous-dossiers, et `--repo` limite la génération à un dépôt.
Les sorties existantes sont remplacées. Tous les classeurs sont validés avant
publication ; une erreur de lecture ou un marqueur inconnu arrête la génération.

Le YAML utilise `schemaVersion: 1`, avec `versions`, `components` et une entrée
`history` par version et par ligne Excel. Les colonnes sont repérées par leur
en-tête, y compris pour les anciens rapports. Chaque entrée conserve la cellule,
le texte complet et le nom historique fourni par les annotations `name:`.
Les marqueurs `+`, `~`, `=`, `-` et vide deviennent respectivement `added`,
`modified`, `unchanged`, `removed` et `absent`. Une suppression n'est plus une
présence ; elle conserve l'identité précédente. Une réapparition crée une nouvelle
identité. Les noms identiques de lignes différentes restent séparés.

Le fichier manuel `logs/plume-react-historique-composants.yaml` contient aussi
une sélection métier, des regroupements (Checkbox, Live Zone), un renommage
Table et un composant DateBox sans ligne source. Ces décisions ne sont pas
contenues dans le classeur : la commande exporte toutes ses lignes sans inventer
ces règles. Elle ne reproduit donc pas exactement cette sélection manuelle.
Les identités générées comprennent le numéro de ligne ; elles sont reproductibles
pour un même classeur, mais ne constituent pas des identifiants stables entre
des rapports dont les lignes ont changé.
