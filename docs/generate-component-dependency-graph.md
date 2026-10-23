# 🕸️ Génération d’un graphe de dépendances entre composants

## 🎯 Objectif

- Visualiser les dépendances entre composants d’un projet (ou multi-projets).
- Générer des graphes exploitables sous différents formats : image, HTML interactif, GraphML (yEd), TGF.

## ✨ Fonctionnalités

- Analyse des imports/exports via **madge**.
- Génération de graphes avec **dagre**, **d3**, ou export **GraphML**.
- Support d’un graphe interactif (D3) ou statique (PNG, SVG).
- Export compatible (TGF) **yEd** pour mise en forme avancée.

## ⚙️ Configuration

- Modifier `src/config.ts` pour définir le projet à analyser.
- Options disponibles :
  - `-p <path>` : chemin du projet à analyser.
  - `-t <type>` : type de sortie (`d3`, `graphml`, `tgf`).

## ▶️ Exécution

### Graphe TGF (dépendances entre composants)

1. Mettre à jour la configuration : avant de lancer le traitement, il faut modifier le contenu du fichier `src/config.ts` pour choisir le projet à analyser.
1. Exécuter le script
    ```bash
    npm run generate-component-dependency-graph
    ```
1. Traiter le résultat, un fichier `.tgf` enregistré dans le dossier `graphe`, via [yEd].

Dans le fichier TGF, les nœuds sont triés par identifiant et les liens par source,
puis par cible, dans l’ordre alphanumérique naturel (`Component2` avant `Component10`).

### Graphe statique (image ou DOT)

```bash
npx madge src --image reports/graph.png
# ou
npx madge src --dot > reports/graph.dot
```

### Graphe interactif (D3)

1. Pour générer le graphe, exécuter la commande :
    ```bash
    npm start -- -p /c/workspaces/github/repo/repo-react -t d3
    ```
    qui retourne :
    ```bash
    > repo-tools-npm-init@1.0.0 start
    > ts-node src/index.ts -p C:/workspaces/github/repo/repo-react -t d3

    Analyse du projet à : C:/workspaces/github/repo/repo-react
    Génération du graphe D3...
    Données de graphe générées dans graph-data.json
    ```
1. Pour afficher le graphe, exécuter la commande :
    ```bash
    http-server
    ```
    qui retourne :
    ```bash
    Starting up http-server, serving ./

    http-server version: 14.1.1

    http-server settings:
    CORS: disabled
    Cache: 3600 seconds
    Connection Timeout: 120 seconds
    Directory Listings: visible
    AutoIndex: visible
    Serve GZIP Files: false
    Serve Brotli Files: false
    Default File Extension: none

    Available on:
        http://172.23.126.152:8080
        http://127.0.0.1:8080
        http://172.27.176.1:8080
    Hit CTRL-C to stop the server

    [Tue Apr 01 2025 13:20:00 GMT+0200 (heure d’été d’Europe centrale)]  "GET /graphe/graph.html" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0"
    (node:16300) [DEP0066] DeprecationWarning: OutgoingMessage.prototype._headers is deprecated
    (Use `node --trace-deprecation ...` to show where the warning was created)
    [Tue Apr 01 2025 13:20:01 GMT+0200 (heure d’été d’Europe centrale)]  "GET /graphe/graph-data.json" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0"
    ...
    ```
1. Puis ouvrir l'URL suivante dans le navigateur : http://localhost:8080/graphe/graph.html

### Export GraphML (yEd)

1. Pour générer le fichier `graphml`, exécuter la commande :
    ```bash
    npm start -- -p /c/workspaces/github/repo/repo-react -t grapml
    ```
    qui retourne :
    ```bash
    > repo-tools-npm-init@1.0.0 start
    > ts-node src/index.ts -p C:/workspaces/github/repo/repo-react -t graphml

    Analyse du projet à : C:/workspaces/github/repo/repo-react
    Génération du fichier GraphML...
    Données de graphe générées dans graphe/graph-data.graphml
    ```
1. Ouvrir le fichier dans [yEd] en local ou sur [yEd live].
1. Dans `yEd` et afin de mettre en forme le graphe, on peut choisir dans le menu `Layout` :
    - `Tree` --> `Balloon` pour les gros graphes
    - `Hierarchical` pour les petits graphes

## 📂 Sorties

- reports/graph.png ou reports/graph.svg : image statique.
- reports/graph.dot : format Graphviz.
- graphe/graph-data.json : données pour D3.
- graphe/graph-data.graphml : pour yEd.
- graphe/graph.tgf : graphe des dépendances entre composants pour yEd.

## ✅ Bonnes pratiques

- Créer un fichier .madgerc pour exclure les patterns inutiles.
- Utiliser le layout dagre pour hiérarchiser les graphes.
- Pour yEd : appliquer un layout adapté (Tree → Balloon ou Hierarchical).

## 📚 Références

- [yEd]
- [yEd live]

<!-- liens -->
[yEd]: https://www.yworks.com/products/yed "Lien vers la page produit de yEd"
[yEd live]: https://www.yworks.com/yed-live/ "Lien vers yEd live"
