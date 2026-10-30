# Proposer et appliquer les correspondances historiques

La commande `history:propose` prépare, pour chaque dépôt configuré, les rapprochements
possibles entre composants supprimés et ajoutés dans une même comparaison. Elle
s’appuie sur les rapports JSON existants ; elle ne clone pas les dépôts et ne
relance pas l’analyse des sources.

## 1. Générer des comparaisons à jour

Depuis la racine de `repo-tools` :

```powershell
npm run analyse-component-versions -- --config=src/config.analyse-component-versions.json
```

Cette étape tient compte des rapprochements automatiques et des règles déjà
configurées. Les propositions concernent donc les suppressions/ajouts qui restent
à expliquer. Des rapports anciens peuvent proposer des correspondances devenues inutiles.

## 2. Produire les propositions

Pour tous les dépôts de la configuration :

```powershell
npm run history:propose -- --config src/config.analyse-component-versions.json
```

Pour un seul dépôt :

```powershell
npm run history:propose -- --config src/config.analyse-component-versions.json --repo repo-react
```

Les chemins `analysisDir` et `reportsDir` suivent la configuration et sont résolus
depuis le répertoire courant, comme pour l’analyse. Les options `--analysis-dir`
et `--output-dir` permettent de les remplacer pour cette commande uniquement.
Le séparateur npm `--` est nécessaire.

Les sorties sont dans `<reportsDir>/component-history-mappings/` :

| Fichier | Contenu |
|---|---|
| `<repo>.md` | Propositions du dépôt, chemins, versions et indices utilisés |
| `<repo>.proposed.json` | Fragment `componentHistoryMappings` applicable pour ce dépôt |
| `component-history-mappings.proposed.json` | Fragments applicables de tous les dépôts sélectionnés |
| `component-history-mappings.candidates.json` | Tous les candidats, alternatives, ambiguïtés et identités manquantes |

Les versions candidates sont converties en versions SemVer : `2.0.0 (develop)`
donne `2.0.0` dans une correspondance. Les dépôts sans comparaison sont signalés
explicitement ; une absence de rapport n’est pas assimilée à une absence de problème.

## 3. Examiner les indices

Les indices sont la casse du chemin, le contenu identique pour un même symbole,
un nom public commun et le même symbole nommé. `default` seul ne suffit pas.
Le classement numérique dans le JSON sert à départager les candidats ; il n’est
pas une probabilité ni une validation métier.

| Statut | Signification |
|---|---|
| `proposed` | Meilleur candidat unique dans les deux sens, inclus dans le fragment applicable |
| `ambiguous` | Plusieurs choix ou choix réciproques incompatibles ; décision manuelle nécessaire |
| `alternative` | Autre candidat moins bien classé ; absent du fragment applicable |

Même un nom public identique peut désigner deux implémentations différentes.
Vérifier les sources et leur historique avant de retenir une proposition. Les
cas ambigus ne sont pas fusionnés et ne sont pas inclus automatiquement dans le
fragment applicable. Pour en retenir un, copier son `from` et son `to` dans le
fragment après vérification, avec `reviewRequired: true`.

Les règles déjà configurées réservent leurs sources et cibles. Elles ne sont pas
reproposées et les règles existantes ne sont pas écrasées.

## 4. Appliquer le fragment choisi

Après lecture et éventuelle réduction du fragment :

```powershell
npm run history:propose -- --config src/config.analyse-component-versions.json --apply reports/component-history-mappings/repo-react.proposed.json
```

Adapter le dernier chemin si `reportsDir` diffère. Sans `--apply`, la configuration
n’est jamais modifiée. L’application :

- vérifie les dépôts, versions, identités et conflits avant écriture ;
- fusionne les nouvelles règles, en conservant les autres paramètres et règles ;
- ajoute toujours les nouvelles règles avec `reviewRequired: true` ;
- conserve une sauvegarde `<config>.history-backup-<date>.json`, ignorée par Git ;
- publie la configuration avec restauration sur erreur ;
- ne réécrit pas le fichier et ne crée pas de sauvegarde si rien n’est ajouté.

Une répétition du même import n’ajoute pas de doublon et ne remet pas à vérifier
une règle déjà validée. Un conflit de source ou de cible pour une même transition
arrête l’import sans modifier la configuration. Ne pas exécuter des imports simultanés
sur le même fichier de configuration.

## 5. Régénérer et valider les rapports

Relancer la commande d’analyse de l’étape 1. Les nouveaux rapprochements apparaissent
avec `⚠️ À vérifier` et dans la feuille Excel `Historique à vérifier`. Après
validation métier, passer leur `reviewRequired` à `false` dans la configuration,
puis régénérer les rapports. Les analyses en cache peuvent être réutilisées.

Les limites des rapprochements et les noms métier sont détaillés dans
[Historique des composants](report-component-history.md).
