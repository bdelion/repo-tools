# Valider les évolutions sans connaître le code

Les issues [#28 à #37](https://github.com/bdelion/repo-tools/issues/38) sont des
travaux à réaliser, pas une demande de tester immédiatement des fonctionnalités
qui seraient toutes terminées. L'issue #38 sert de tableau de suivi.

## Qui fait quoi ?

- **Le développeur** corrige ou configure, prépare les exemples, écrit les tests
  automatiques et fournit les fichiers ainsi que les commandes exactes de recette.
- **Le validateur** compare le résultat visible au résultat attendu décrit dans
  l'issue. Il peut être accompagné pour lancer les commandes ; il n'a pas à lire
  le code ni à créer les exemples ou à choisir des options techniques.
- **Le référent métier** confirme quels composants, dépôts ou bibliothèques font
  partie du périmètre réel, et ce qui doit apparaître dans les rapports.

## Quand peut-on commencer et quand peut-on valider ?

**Definition of Ready (DoR)** signifie « les informations nécessaires pour
commencer le travail sont connues » : objectif, exemples attendus, environnement
et dépendances. Elle ne signifie pas que le développement est déjà terminé.

**Prêt à valider** signifie que le développeur a livré un guide de recette, les
fichiers à ouvrir, les commandes remplies et une comparaison attendu/obtenu.
Il doit créer `docs/recette/issue-N.md` pour son ticket ; ces guides ne sont pas
encore livrés par le présent document. Si le dossier manque, noter « non prêt
à valider » et demander de le compléter, sans deviner les résultats.

**Definition of Done (DoD)** signifie « le travail et sa validation sont terminés » :
les scénarios passent, les preuves sont disponibles et les tests/documentations
sont à jour. Un validateur peut dire « refusé » si une observation contredit
l'attendu, ou « non vérifiable » si la preuve ou l'environnement manque.

Commencer par **#28** pour retrouver le catalogue attendu. **#29, #30 et #32**
traitent ensuite des problèmes concrets indépendants. La recette GHES réelle
**#34** vient après les corrections et les tests hors ligne. P1/P2/P3 indiquent
l'ordre de priorité, pas une échéance ni un niveau de connaissance demandé.

## Vocabulaire utile

- **Bibliothèque** : code réutilisable par les applications clientes.
- **Public** : un élément que les clients peuvent importer ; **interne** : un
  détail d'implémentation qui ne fait pas partie de ce contrat client.
- **Dépendance** : élément nécessaire à un autre ; **impact** : ce qui peut être
  affecté si on le change ; **prérequis** : ce qu'il faut traiter pour l'utiliser.
- **JSON/Excel/Markdown/TGF** : formats des fichiers de données, tableaux, rapport
  lisible et graphe. Le développeur indique lequel ouvrir à chaque étape.
- **Exemple témoin** (fixture) : données contrôlées dont le résultat est connu.
- **SHA** : identifiant d'une version exacte du code ; le développeur le relève.
- **CI** : contrôles exécutés automatiquement après une modification du code.
- **HTTP 403** : refus d'accès à un dépôt, différent d'une absence de dépendance.

## Les validations, issue par issue

### #28 — Vérifier quels composants de la bibliothèque sont utilisables par nos clients

[Ouvrir l'issue](https://github.com/bdelion/repo-tools/issues/28).

**Pourquoi :** Nous devons distinguer ce qu'un client peut importer de ce qui sert uniquement au fonctionnement interne. Aujourd'hui, un graphe peut mélanger ces éléments et devenir difficile à utiliser.

**Résultat attendu :** Trois listes compréhensibles et trois graphes distincts : composants graphiques publics, API publique complète et dépendances internes/externes.

**À préparer par le développeur :**

- Choisir une bibliothèque réelle et figer sa version ; fournir au validateur son nom et sa version, sans lui demander de les rechercher.
- Préparer un exemple témoin contenant Button2, Button10 et Panel (UI publics), useTheme (hook public), formatDate (fonction publique), Props (type public), internalHelper (privé) et React.
- Fournir les trois configurations et leurs commandes exactes, déjà remplies, ainsi qu'une liste attendue confirmée avec un utilisateur de la bibliothèque.

| Action de validation | Résultat observable attendu |
| --- | --- |
| Ouvrir le catalogue « UI publique ». | Il contient Button2, Button10 et Panel ; il ne contient ni useTheme, ni formatDate, ni Props, ni internalHelper, ni React. |
| Ouvrir le catalogue « API publique ». | Il contient les UI, useTheme, formatDate et Props ; internalHelper reste absent. Les autres exports doivent correspondre à la liste attendue fournie. |
| Ouvrir le graphe « dépendances », avec les éléments externes. | internalHelper et React sont visibles avec leurs liens ; ils sont identifiés comme éléments internes ou externes, pas comme UI publiques. |
| Ouvrir la liste et le TGF ; comparer l'ordre. | Button2 précède Button10 ; les nœuds sont triés par nom, les arcs par source puis cible. |
| Choisir Panel dans l'exemple préparé et ouvrir ses prérequis et son impact. | Les résultats correspondent au dessin attendu fourni. Une dépendance commune n'est présente qu'une seule fois ; les feuilles sont à traiter avant les composants qui les utilisent. |

**Preuves à fournir :**

- Trois catalogues lisibles et graphes ouvrables, avec noms de bibliothèque et version.
- Liste attendue/résultat observé et explication de chaque écart.
- Deux exemples d'impact/prérequis et un ordre de traitement commenté.

**Décision :** Refuser si un élément privé apparaît comme public, si un composant public manque sans explication, si les résultats se contredisent ou si les configurations doivent être devinées.

**Hors périmètre :** Pas de chiffrage en jours ; pas de réécriture générale de la bibliothèque.

### #29 — Scanner la bonne branche lorsque SCAN_BRANCH n'est pas renseigné

[Ouvrir l'issue](https://github.com/bdelion/repo-tools/issues/29).

**Pourquoi :** La branche est une version de travail d'un dépôt Git. Quand le réglage SCAN_BRANCH est laissé vide, le scanner peut actuellement ne rien trouver alors que le dépôt contient des dépendances.

**Résultat attendu :** Laisser la branche vide doit scanner la branche habituelle du dépôt. Renseigner une branche doit scanner exactement celle-ci.

**À préparer par le développeur :**

- Fournir un dépôt simulé sans connexion réelle : sa branche habituelle main utilise React 18.2.0 ; sa branche release-test utilise React 19.0.0.
- Fournir quatre commandes prêtes à copier pour un réglage absent, vide, composé d'espaces, puis release-test.
- Produire un petit tableau comparatif des résultats pour éviter au validateur de lire le code.

| Action de validation | Résultat observable attendu |
| --- | --- |
| Lancer le scénario « réglage absent ». | Le rapport indique main et React 18.2.0. |
| Lancer le scénario « réglage vide ». | Même résultat que le réglage absent : main et React 18.2.0 ; le rapport n'est pas vide. |
| Lancer le scénario « espaces uniquement ». | Même résultat : main et React 18.2.0. |
| Lancer le scénario « release-test ». | Le rapport indique release-test et React 19.0.0, et non la version de main. |
| Comparer les fichiers JSON et Excel générés. | La branche et la version de React sont identiques dans les deux formats. |

**Preuves à fournir :**

- Tableau des quatre cas avec branche attendue et observée.
- JSON et Excel témoins sans données confidentielles.
- Résultat des tests automatiques.

**Décision :** Refuser si un réglage vide produit zéro dépendance ou si la branche renseignée n'est pas respectée.

**Hors périmètre :** Pas besoin d'un compte GitHub Enterprise ni de modifier les filtres de bibliothèques.

### #30 — Ne plus annoncer un scan réussi lorsque des dépôts n'ont pas pu être lus

[Ouvrir l'issue](https://github.com/bdelion/repo-tools/issues/30).

**Pourquoi :** Un inventaire vide peut vouloir dire « aucune dépendance trouvée » ou « accès refusé ». Aujourd'hui ces deux situations peuvent se terminer comme un succès, ce qui donne un résultat trompeur.

**Résultat attendu :** Un message et un bilan distinguent clairement scan terminé, scan réellement vide, scan incomplet et échec. Les derniers rapports complets restent protégés.

**À préparer par le développeur :**

- Fournir un scénario local pour chacun des cas du tableau ci-dessous ; aucun vrai token n'est nécessaire.
- Créer un ancien rapport témoin reconnaissable, puis montrer ce qu'il devient après un échec.
- Fournir un bilan lisible avec les nombres de dépôts prévus, lus, ignorés et en erreur. Le développeur explique le code de retour sans demander au validateur de le connaître.

| Action de validation | Résultat observable attendu |
| --- | --- |
| Scanner deux dépôts lisibles. | Le bilan indique 2 lus, 0 erreur et un succès ; les rapports contiennent les résultats des deux dépôts. |
| Scanner un périmètre réellement vide ou filtré sans correspondance. | Le bilan dit explicitement « aucun résultat » et explique le périmètre/filtre ; il n'annonce pas d'erreur d'accès. |
| Simuler un accès refusé (HTTP 403). | Le message dit « accès refusé / scan échoué », le code de retour indique un échec et le bilan ne prétend pas que l'inventaire est vide légitimement. |
| Simuler un dépôt lisible et un dépôt inaccessible. | Le bilan dit « incomplet : 1 lu, 1 en erreur ». L'échec est détectable automatiquement ; les éventuels résultats partiels sont identifiés comme partiels. |
| Ouvrir l'ancien rapport complet après un échec. | Il est toujours disponible ; il n'a pas été remplacé silencieusement par un fichier vide ou partiel. |

**Preuves à fournir :**

- Bilan et code de retour de chaque scénario.
- Preuve de conservation de l'ancien rapport.
- Comparaison des périmètres JSON et Excel.

**Décision :** Refuser si une erreur donne seulement un succès, si un scan incomplet est présenté comme complet ou si le dernier résultat complet est perdu.

**Hors périmètre :** La politique de filtrage des bibliothèques reste inchangée.

### #31 — Vérifier automatiquement les résultats du scanner sur des exemples connus

[Ouvrir l'issue](https://github.com/bdelion/repo-tools/issues/31).

**Pourquoi :** Une modification du scanner peut oublier des dépendances sans être détectée. Nous avons besoin d'exemples dont les résultats attendus sont connus, sans dépendre d'un accès GitHub réel.

**Résultat attendu :** Une commande de tests affiche quels scénarios ont réussi ou échoué, et chaque scénario possède un tableau de résultats attendus facile à lire.

**À préparer par le développeur :**

- Fournir des petits projets exemples : npm avec lockfile, plusieurs packages JS dans un même dépôt, Maven et Gradle.
- Expliquer en une phrase ce que contient chaque exemple et ses bibliothèques/versions attendues.
- Fournir la commande unique de lancement des tests et les fichiers de résultats.

| Action de validation | Résultat observable attendu |
| --- | --- |
| Lancer la commande de tests fournie. | Chaque famille de projet apparaît dans le bilan ; aucun accès Internet ni token personnel n'est demandé. |
| Ouvrir le tableau du projet npm témoin. | React déclaré ^18.2.0 et résolu 18.2.0 sont retrouvés ; déclaré et résolu ne sont pas confondus. |
| Ouvrir l'exemple de dépôt contenant plusieurs packages JS. | Chaque package et son chemin sont distingués ; les dépendances ne sont pas attribuées au mauvais package. |
| Ouvrir les exemples Maven et Gradle. | Les dépendances attendues sont retrouvées ; les versions qu'on ne sait pas résoudre sont signalées comme inconnues, pas inventées. |
| Vérifier les tests de pagination et d'accès refusé. | Les dépôts de la deuxième page ne sont pas oubliés ; l'accès refusé est compté comme erreur. |
| Comparer JSON et Excel pour les mêmes exemples. | Même nombre de lignes et mêmes noms, versions et branches. |

**Preuves à fournir :**

- Tableau par exemple : entrée, résultats attendus, résultats obtenus.
- Rapport des tests automatiques et exports témoins.
- Explication des limitations des versions Maven/Gradle.

**Décision :** Refuser si un test dit seulement « succès » sans préciser ce qui était attendu, ou si les résultats nécessitent de connaître le code pour être interprétés.

**Hors périmètre :** La recette sur GitHub Enterprise réel est traitée dans #34.

### #32 — Pouvoir générer et vérifier le rapport Markdown des dépendances avec Python

[Ouvrir l'issue](https://github.com/bdelion/repo-tools/issues/32).

**Pourquoi :** Le scanner crée les données JSON/Excel. Un second script Python les transforme en rapport lisible. Ce parcours n'a pas encore été exécuté dans cet environnement et une entrée invalide peut être confondue avec une liste vide.

**Résultat attendu :** Une personne équipée de Python peut suivre une procédure courte, produire le rapport et comprendre si les données sont correctes, absentes ou invalides.

**À préparer par le développeur :**

- Documenter l'installation ou la sélection d'un vrai interpréteur Python et fournir la commande qui affiche sa version.
- Fournir un fichier valide contenant trois lignes : React résolu 18.2.0, React résolu 19.0.0-rc.1 et une dépendance sans version résolue.
- Fournir un fichier JSON corrompu et les commandes exactes pour tous les cas ; ne pas demander de construire les exemples au validateur.

| Action de validation | Résultat observable attendu |
| --- | --- |
| Exécuter la commande de version Python indiquée. | Une version supportée est affichée ; aucun renvoi vers le Microsoft Store ou alias inutilisable. |
| Exécuter la commande de génération sur le fichier valide. | Un fichier Markdown est créé à l'emplacement annoncé et peut être ouvert. |
| Ouvrir le rapport de l'exemple à trois lignes. | Il compte les trois enregistrements ; React est présent, la préversion 19.0.0-rc.1 est signalée et l'absence de version résolue est visible. |
| Appliquer le filtre React fourni. | Seules les deux lignes React contribuent aux tableaux correspondants. |
| Exécuter la génération sur le JSON corrompu. | Un message indique une entrée invalide, le processus échoue et aucun rapport trompeur n'est annoncé comme valide. |
| Exécuter les variantes JSONL et gzip fournies. | Les mêmes données produisent les mêmes totaux métier. |

**Preuves à fournir :**

- Version Python, commandes exactes et rapport Markdown témoin.
- Tableau attendu/obtenu pour totaux, préversions et versions inconnues.
- Résultat des tests Python et du cas JSON invalide.

**Décision :** Refuser si les totaux ne correspondent pas aux données, si une erreur devient un succès vide ou si le validateur doit deviner la commande Python.

**Hors périmètre :** Pas de nouvelle collecte GitHub ; on utilise d'abord les fichiers exemples fournis.

### #33 — Faire vérifier uniquement le code actif et afficher des validations Node/Python fiables

[Ouvrir l'issue](https://github.com/bdelion/repo-tools/issues/33).

**Pourquoi :** Des copies anciennes sous logs sont encore incluses dans la vérification TypeScript. Le pipeline Jenkins possède des étapes ambiguës et les tests Python ne sont pas encore exécutés automatiquement.

**Résultat attendu :** Les contrôles automatiques disent clairement ce qui a été validé. Ils vérifient les sources actives, pas les copies de référence, et incluent le rapport Python.

**À préparer par le développeur :**

- Lister les étapes attendues en mots simples : types, règles de code, tests Node et tests Python.
- Fournir l'accès ou les captures des résultats CI ; préciser qui peut vérifier Jenkins.
- Préparer une copie jetable pour les scénarios d'erreur, sans modifier les références conservées.

| Action de validation | Résultat observable attendu |
| --- | --- |
| Ouvrir le dernier résultat de validation automatique. | Les étapes Node et Python sont identifiables et possèdent chacune un résultat. |
| Demander au développeur la liste des fichiers vérifiés par TypeScript. | Les fichiers actifs src/tests sont présents ; aucun fichier sous logs ne l'est. |
| Dans une copie jetable, ajouter une erreur volontaire uniquement dans logs. | La validation du code actif n'échoue pas à cause de cette copie ; le scénario est ensuite nettoyé. |
| Dans cette copie jetable, introduire une erreur dans une source active puis dans un test Python. | La bonne étape échoue pour chaque cas, avec un message exploitable ; les erreurs sont ensuite retirées. |
| Ouvrir le résultat Jenkins sur un changement propre. | Les étapes ne sont pas doublées, le pipeline s'exécute et son résultat est joint. |

**Preuves à fournir :**

- Lien du pipeline ou captures datées, versions Node/Python utilisées.
- Liste des fichiers inclus/exclus et compte rendu des erreurs volontaires.
- Résultat Jenkins, ou indication explicite qu'il manque encore et que le ticket n'est pas terminé.

**Décision :** Refuser si Python n'est pas testé, si les références déclenchent les contrôles ou si le succès Jenkins est seulement supposé.

**Hors périmètre :** Aucun nettoyage des données sous logs ; elles servent toujours de référence.

### #34 — Vérifier les rapports sur quelques vrais dépôts GitHub Enterprise

[Ouvrir l'issue](https://github.com/bdelion/repo-tools/issues/34).

**Pourquoi :** Les tests locaux ne prouvent pas que les droits, l'API et les configurations réelles permettent de retrouver les bonnes bibliothèques dans nos dépôts.

**Résultat attendu :** Sur un petit périmètre choisi, les rapports retrouvent les dépendances que les responsables des applications savent présentes, avec les bonnes versions et une explication des limites.

**À préparer par le développeur :**

- Le responsable choisit une courte liste de dépôts autorisés et les branches à examiner ; commencer par un seul dépôt connu.
- Fournir une configuration par scénario sans token dans Git ni dans les preuves.
- Demander au responsable du dépôt de fournir une liste attendue issue des fichiers package.json/lockfile ou Maven/Gradle ; le validateur n'a pas à la reconstituer.
- Décrire les trois modes : off = pas de présélection ; tree = présélection par fichiers ; code = recherche de code GitHub.

| Action de validation | Résultat observable attendu |
| --- | --- |
| Vérifier la fiche du périmètre et lancer la commande fournie sur un dépôt connu. | Le dépôt et la branche annoncés sont ceux réellement analysés ; les dépendances attendues sont présentes. |
| Ouvrir les fichiers JSON, Excel et Markdown de cette exécution. | Ils portent sur le même périmètre et donnent les mêmes versions et totaux métier. |
| Comparer les exécutions off, tree et code préparées. | Toute différence dans la liste des dépôts est expliquée. Un mode n'oublie pas silencieusement le dépôt témoin connu. |
| Ajouter progressivement les autres dépôts et écosystèmes retenus. | La grille attendu/obtenu reste vérifiée pour chaque ajout ; les versions inconnues sont explicitement signalées. |
| Consulter la preuve d'un refus de droits sur un compte de recette ou un test contrôlé. | Le résultat est annoncé comme échoué ou incomplet, pas comme inventaire complet vide. |

**Preuves à fournir :**

- Liste des dépôts/branches/versions autorisée, date et SHA analysés.
- Grille des dépendances attendues/obtenues et explication des écarts.
- Rapports anonymisés et commandes reproductibles, sans token.

**Décision :** Refuser si le périmètre n'est pas connu, si les totaux divergent entre formats ou si un problème d'accès est masqué.

**Hors périmètre :** Pas de scan généralisé de tous les dépôts avant validation du petit périmètre.

### #35 — Permettre à un nouvel utilisateur de suivre un guide sans connaître le projet

[Ouvrir l'issue](https://github.com/bdelion/repo-tools/issues/35).

**Pourquoi :** Les guides mélangent d'anciennes commandes, des chemins inexacts et des syntaxes de configuration différentes. Un utilisateur ne sait pas quel document suivre ni quoi obtenir.

**Résultat attendu :** Une personne nouvelle choisit son besoin, copie une commande adaptée et trouve le résultat annoncé sans explication orale supplémentaire.

**À préparer par le développeur :**

- Choisir quatre parcours : catalogue UI/API, dépendances/impact, historique de versions, inventaire GitHub puis rapport Markdown.
- Fournir des exemples anonymisés et une machine Windows ou un environnement indiqué.
- Désigner une personne qui n'a pas écrit le guide pour réaliser la lecture et les essais.

| Action de validation | Résultat observable attendu |
| --- | --- |
| Depuis le README, chercher « voir les composants publics ». | Un lien conduit à un seul guide de référence avec une commande et les fichiers attendus. |
| Suivre la configuration et l'exemple de ce guide sur la bibliothèque témoin. | Aucun chemin, nom d'option ou fichier n'est à deviner ; la sortie existe à l'emplacement indiqué. |
| Suivre le parcours scanner → rapport Python fourni. | Le script est appelé depuis src, la configuration .env n'inclut pas d'instructions shell et le rapport peut être ouvert. |
| Chercher npm start, npm init et les anciens exemples incompatibles. | Ils sont retirés du parcours courant ou clairement expliqués comme historiques ; l'installation d'un checkout utilise npm ci. |
| Expliquer avec ses mots quel rapport utiliser pour un catalogue, un impact et une évolution de version. | Le lecteur peut les distinguer sans consulter le code ni demander une explication supplémentaire. |

**Preuves à fournir :**

- Liste des pages de référence et tableau besoin → commande → sortie.
- Compte rendu d'une lecture/recette par une personne nouvelle.
- Corrections des points où cette personne a dû demander de l'aide.

**Décision :** Refuser si le guide nécessite encore une explication orale pour terminer un exemple ou si une commande documentée n'existe pas.

**Hors périmètre :** La documentation ne doit pas promettre un chiffrage en jours qui n'existe pas.

### #36 — Éviter qu'une évolution du graphe change les résultats de l'historique des versions

[Ouvrir l'issue](https://github.com/bdelion/repo-tools/issues/36).

**Pourquoi :** Le partage de code a déjà modifié le suivi des composants lors d'évolutions destinées à un autre usage. Nous voulons pouvoir faire évoluer les graphes sans dérégler les comparaisons de versions.

**Résultat attendu :** Les graphes et l'historique possèdent leurs propres tests de référence. Changer la présentation du graphe ne modifie ni les résultats métier ni le cache de l'analyse des versions.

**À préparer par le développeur :**

- Fournir un petit projet et deux versions figées avec leurs résultats attendus avant la refonte.
- Documenter quels champs peuvent varier légitimement (date d'exécution, chemin local) et lesquels doivent rester identiques.
- Expliquer les commandes maintenues et les anciennes commandes encore utilisables ; aucune suppression implicite.

| Action de validation | Résultat observable attendu |
| --- | --- |
| Exécuter les commandes de référence avant puis après la séparation du code. | Les composants, ajouts, suppressions et renommages métier sont identiques dans le tableau comparatif. |
| Appliquer dans le test une modification limitée à la présentation du graphe. | L'historique des versions et son cache restent inchangés ; la preuve est montrée dans un test dédié. |
| Demander les prérequis d'un TGF avec les métadonnées d'une autre exécution. | L'outil refuse le mélange ou demande de régénérer les métadonnées ; il ne fournit pas silencieusement des informations erronées. |
| Relancer les commandes historiques retenues sur les exemples. | Elles restent utilisables, ou un changement explicitement accepté possède une procédure de migration. |
| Comparer les sorties des trois vues avant/après. | Identités, alias et tri naturel sont conservés ; tout écart est listé et expliqué. |

**Preuves à fournir :**

- Tableaux métier avant/après sur les versions figées.
- Preuve du test d'indépendance du cache et du rejet de métadonnées incohérentes.
- Liste des commandes compatibles et résultats des tests.

**Décision :** Refuser si les écarts sont justifiés seulement par « refonte technique », sans explication métier ni accord sur le changement.

**Hors périmètre :** Pas d'ajout de fonctionnalités métier pendant ce lot de séparation.

### #37 — Retirer uniquement les éléments devenus inutiles sans casser les usages

[Ouvrir l'issue](https://github.com/bdelion/repo-tools/issues/37).

**Pourquoi :** Le projet contient des bibliothèques et parcours historiques dont l'utilité n'est pas claire. Les supprimer sans inventaire risquerait de casser une commande encore utilisée.

**Résultat attendu :** Un projet plus simple, avec une justification compréhensible pour chaque retrait et la preuve que les usages conservés fonctionnent toujours.

**À préparer par le développeur :**

- Préparer un tableau « élément / à quoi il sert / conserver ou retirer / preuve ».
- Faire confirmer la liste des usages à conserver à partir des guides validés.
- Identifier l'alerte de dépendance concernée et la modification minimale proposée, sans mise à jour majeure automatique.

| Action de validation | Résultat observable attendu |
| --- | --- |
| Lire la liste des suppressions proposées avant de valider le changement. | Chaque retrait a une raison et indique les commandes potentiellement concernées ; aucun retrait n'est fondé sur une supposition. |
| Installer le projet dans un dossier propre avec npm ci. | L'installation réussit à partir du lockfile. |
| Relancer les exemples des usages conservés et les tests Python. | Les fichiers attendus sont produits et leurs données métier correspondent aux références. |
| Ouvrir un arbre de dépendances témoin. | Les branches sont lisibles ; les caractères ??? ne remplacent plus le dessin si ce nettoyage est inclus. |
| Vérifier les références sous logs et les guides. | Les références n'ont pas été supprimées ; aucun guide courant ne renvoie à un élément retiré. |
| Consulter le résultat des tests et le traitement de l'alerte de dépendance. | Les tests réussissent et l'alerte est corrigée ou fait l'objet d'une décision motivée visible. |

**Preuves à fournir :**

- Inventaire avant/après des retraits avec justification.
- Installation propre et résultats des recettes maintenues.
- Décision sur l'alerte et compte rendu des tests.

**Décision :** Refuser si une commande disparaît sans migration, si des données locales sont effacées ou si des dépendances sont retirées sans preuve.

**Hors périmètre :** Pas de suppression automatique de logs, de rapports utilisateur ou de configurations locales.

