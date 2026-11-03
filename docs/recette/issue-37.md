# Issue #37 — préparer et vérifier un nettoyage

Depuis la racine :

```powershell
npm.cmd run validate:issue-37
```

Aucune suppression ni mise à jour de dépendance n'est réalisée. Ouvrir
`reports/validation/issue-37/recette-resultat.md` et `dependency-inventory.json`.
L'inventaire liste chaque dépendance directe, sa contrainte et ses références
textuelles sous src/tests/scripts/docs. **Une absence textuelle ne prouve pas
qu'une dépendance est inutile.** Le kit vérifie aussi l'alignement des dépendances
directes de package.json et du lockfile.

Le développeur prépare ensuite `config/validation/issue-37.json` :

```json
{
  "removals": [
    {
      "element": "nom-reel-de-element",
      "reason": "Justification vérifiée du retrait",
      "commands": ["commande-concernee"],
      "evidence": "chemin/vers/la-preuve.md"
    }
  ],
  "securityDecision": "chemin/vers/la-decision-securite.md"
}
```

Ces valeurs sont un modèle, pas des retraits proposés. Si rien n'est proposé,
laisser removals vide : BLOCKED est alors normal. Les chemins de preuves sont
relatifs à la racine du dépôt ou absolus.

Pour tester réellement l'installation du lockfile, lancer explicitement :

```powershell
npm.cmd run validate:issue-37 -- --clean-install
```

Cette option télécharge les dépendances dans
`reports/validation/issue-37/clean-install` avec `npm ci --ignore-scripts`.
Elle conserve ton node_modules courant. Ouvrir `clean-install.txt` : code 0
attendu. Ce contrôle vérifie l'installation, sans exécuter les scripts lifecycle.

L'acceptation du nettoyage exige encore la revue des retraits et de la décision
sécurité, ainsi que les recettes avant/après. Le kit garde ces validations
BLOCKED. Il ne vérifie pas automatiquement l'alerte GitHub en cours, ne la ferme
pas et ne supprime aucune référence sous logs.
