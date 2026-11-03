# Issue #28 — premier exercice prêt à exécuter

## Ce que tu peux faire maintenant

Cet exercice utilise une petite bibliothèque fournie avec le projet. **Aucun
fichier de configuration à remplir**, aucun token, aucun accès GitHub Enterprise,
aucun Python et aucune installation de React ne sont nécessaires. On analyse du
code JavaScript/TypeScript ; on ne lance pas une application React.

Dans le terminal PowerShell de ce dépôt :

```powershell
Set-Location -LiteralPath 'D:\1010 - Developpement\Git\repo-tools'
npm.cmd run validate:issue-28
```

Sur une autre machine, seule la première ligne doit être adaptée au dossier du
dépôt. Si les dépendances de repo-tools ne sont pas installées, exécuter d'abord
`npm.cmd ci`. Node doit respecter les prérequis du README.

La commande prépare les trois vues, les prérequis, l'impact et le plan, puis
effectue **8 contrôles**. Le résultat attendu à la fin du terminal est :

```text
Démonstration réussie : 8 contrôles. Ouvrir reports/validation/issue-28/recette-resultat.md
```

## Les fichiers à ouvrir et ce qu'ils doivent contenir

Tous les fichiers ci-dessous sont sous **`reports/validation/issue-28/`**.
Tu peux les ouvrir depuis l'explorateur de fichiers de ton IDE. Les empreintes et
les identifiants techniques ne sont pas à comparer manuellement.

| Ordre | Fichier | Contrôle concret |
| --- | --- | --- |
| 1 | `recette-resultat.md` | Résultat `PASS` et 8 lignes de contrôles `PASS`. Si `FAIL`, transmettre ce fichier et le message du terminal. |
| 2 | `public-ui.catalog.md` | Exactement **Button2, Button10, Panel**, dans cet ordre. Aucun hook, type, helper privé ou React. |
| 3 | `public-api.catalog.md` | Exactement **Button2, Button10, formatDate, Panel, PublicOptions, useTheme**. La ligne Button2 indique aussi l'alias PrimaryButton ; ce n'est pas une septième définition. |
| 4 | `dependencies.catalog.md` | Les 6 définitions précédentes, plus **internalHelper** et **react**, soit **8**. React est marqué externe. |
| 5 | `public-ui.tgf` | Les 3 nœuds puis les 2 arcs montrés ci-dessous ; ouvrir dans l'IDE suffit, yEd est facultatif. |
| 6 | `prerequis-Panel.json` | Dans `components`, retrouver **Button2, Button10, formatDate, internalHelper, Panel, PublicOptions** une seule fois chacun. |
| 7 | `impact-formatDate.json` | Dans `components`, retrouver uniquement **Button2, formatDate, internalHelper, Panel**. |
| 8 | `public-ui.plan.json` | Les niveaux correspondent au tableau suivant ; `cyclicGroups` est vide. |

Début et fin attendus de `public-ui.tgf` :

```text
Button2.jsx#Button2 Button2 Button2.jsx
Button10.tsx#Button10 Button10 Button10.tsx
Panel.tsx#Panel Panel Panel.tsx
#
Panel.tsx#Panel Button2.jsx#Button2
Panel.tsx#Panel Button10.tsx#Button10
```

Le `#` sépare les nœuds des arcs. Les noms sont triés naturellement : **Button2
avant Button10**, même si un tri alphabétique simple ferait l'inverse.

| Niveau dans le plan | Noms attendus | Explication |
| --- | --- | --- |
| 0 | Button10, formatDate, PublicOptions, useTheme | Feuilles : à traiter en premier dans cet exemple. |
| 1 | internalHelper | Utilise formatDate. |
| 2 | Button2 | Utilise internalHelper. |
| 3 | Panel | Utilise les boutons et le type PublicOptions. |

Les JSON contiennent des identifiants comme `formatDate.js#formatDate` : lire la
partie nom après `#`. L'ordre du plan est un ordre de dépendances, pas un devis.

## La configuration, déjà fournie

| Fichier existant | Vue | Fichier TGF produit |
| --- | --- | --- |
| `config/validation/issue-28/public-ui.json` | Composants graphiques publics | `reports/validation/issue-28/public-ui.tgf` |
| `config/validation/issue-28/public-api.json` | Tous les éléments publics | `reports/validation/issue-28/public-api.tgf` |
| `config/validation/issue-28/dependencies.json` | Tous les éléments et React | `reports/validation/issue-28/dependencies.tgf` |

Ces configurations pointent sur `examples/validation-library/src`. Elles ont des
destinations différentes : les vues ne s'écrasent pas. **Ne pas modifier `.env`,
`src/config.ts` ou les configurations métier pour cet exercice.**

## Commandes individuelles, si tu veux rejouer une étape

La commande unique exécute déjà toutes ces opérations. Elles sont indiquées pour
permettre de comprendre et rejouer, pas pour exiger cinq manipulations :

```powershell
npm.cmd run graph:generate -- --config config/validation/issue-28/public-ui.json
npm.cmd run graph:generate -- --config config/validation/issue-28/public-api.json
npm.cmd run graph:generate -- --config config/validation/issue-28/dependencies.json
npm.cmd run graph:required -- --analysis reports/validation/issue-28/public-ui.analysis.json Panel --output reports/validation/issue-28/prerequis-Panel.json
npm.cmd run graph:impact -- reports/validation/issue-28/public-ui.analysis.json formatDate --output reports/validation/issue-28/impact-formatDate.json
```

## Que répondre pour la validation ?

Si tout correspond, ajouter à #28 :

```text
Démonstration #28 exécutée.
Résultat automatique : PASS, 8 contrôles.
Catalogues contrôlés : UI = 3, API = 6, dépendances = 8.
TGF, prérequis, impact et niveaux conformes au guide.
À confirmer ensuite sur notre bibliothèque réelle.
```

Si un fichier manque ou diffère, indiquer **son nom et l'écart observé**, puis
joindre `recette-resultat.md`. Ne pas modifier les résultats pour les faire passer.

**Cet exercice ne clôture pas #28.** Il démontre le fonctionnement des commandes
sur des données connues. L'étape suivante consiste à fournir le chemin de ta
bibliothèque réelle ; le développeur préparera alors les configurations complètes
pour celle-ci et sa liste attendue avec le référent métier.

**Les autres kits sont accessibles depuis [l'index](README.md).** Certains
signalent encore des défauts (`FAIL`) ou des prérequis manquants (`BLOCKED`).
Cela ne signifie pas que leur exécution a corrigé ou clôturé les tickets.
