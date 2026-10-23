# Idées d'évolutions scan-ghe & generate_deps_report

Revoir les analyses plus globalement et la configuration :

```shell
# --- Réglages Code Search (Maven uniquement ici) ---
CODESRCH_INCLUDE_MAVEN="true"
CODESRCH_INCLUDE_GRADLE="false"
CODESRCH_MAVEN_FALLBACK_ARTIFACT_ONLY="true"  # si 0 hit, retente par <artifactId> seul
```

---

Voici des idées pertinentes pour enrichir ton rapport et le rendre encore plus utile pour l’analyse et la prise de décision :

✅ 1. Indicateurs de qualité et de risque

Score de conformité par repo ou org :

% de dépendances résolues (lockfiles présents)
% de dépendances en pré-release
% de dépendances multi-major


Alertes critiques :

Dépendances en pré-release dans des repos marqués comme production (si info dispo)
Versions SNAPSHOT ou -hc dans des libs critiques (ex. logging, sécurité)




✅ 2. Évolution temporelle

Si tu as des rapports générés régulièrement :

Courbe d’évolution du nombre de pré-releases, multi-majors, lockfiles manquants.
Tendance par org : amélioration ou dégradation.




✅ 3. Analyse des dérives

Top des libs avec le plus de majors différentes (déjà partiellement fait).
Histogramme des versions pour une lib critique (ex. Spring Boot, React).
Camembert global : répartition des dépendances par major (toutes libs confondues).


✅ 4. Couverture des lockfiles

Tableau par package manager (npm, yarn, pnpm, Maven, Gradle) :

% de repos avec lockfile
% de packages sans lockfile → risque de dérive.




✅ 5. Détection des versions obsolètes

Comparer la version résolue à la dernière version stable (nécessite un mapping via registry ou API).
Indicateur : % de dépendances > 1 version derrière.


✅ 6. Corrélation org / risque

Heatmap : org vs métriques (pré-release, multi-major, lockfile manquant).
Classement des orgs par score de risque.


✅ 7. Export complémentaire

CSV/Excel des agrégats pour exploitation dans Power BI ou Data Studio.
JSON pour intégration dans pipeline CI/CD.


✅ 8. Visualisations avancées

Mermaid bar chart global :

Répartition des dépendances par major (ex. 0.x, 1.x, 2.x).


Diagramme Sankey (libs → versions → orgs) pour voir la dispersion.


✅ 9. Recommandations automatiques

Pour chaque lib critique :

Version cible recommandée (ex. dernière stable).
Plan d’action : upgrade, suppression des pré-releases, ajout lockfile.




Veux-tu que je complète ton script pour :

Ajouter un tableau global des pré-releases par org/repo avec un score de risque ?
Générer un camembert global (Mermaid) des dépendances par major ?
Ajouter un export CSV des agrégats (pré-releases, multi-major, lockfile manquant) ?

Ou tu préfères que je commence par les recommandations automatiques dans le Markdown ?