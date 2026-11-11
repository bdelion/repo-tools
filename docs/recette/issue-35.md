# Issue #35 — vérifier les guides et leur compréhension

Configuration prête : `config/validation/issue-35.json` liste les pages courantes
et les commandes attendues. Depuis la racine :

```powershell
npm.cmd run validate:issue-35
```

Ouvrir `reports/validation/issue-35/recette-resultat.md`, puis
`documentation-findings.json` :

| Contrôle | Attendu |
| --- | --- |
| Commandes obsolètes | Aucun npm start ou npm init dans les parcours courants. |
| Liens locaux Markdown directs | Chaque cible existe. Les ancres, liens de référence et liens externes ne sont pas vérifiés automatiquement. |
| Commandes de parcours | Elles existent toutes dans package.json. |

Les signalements doivent être relus : une mention historique ou une explication
« ne pas utiliser » peut être légitime. Le kit ne modifie pas la documentation
automatiquement. Les syntaxes PowerShell/Bash/.env et toutes les options ne sont
pas validées par cette seule recherche.

Une personne qui n'a pas écrit les guides complète ensuite
`reports/validation/issue-35/lecture-utilisateur.md`. Elle essaie les parcours
catalogue, impact, versions, puis scanner/Python avec les exemples fournis et
consigne la commande suivie, le fichier trouvé et toute aide demandée. Pour les
versions, utiliser les tests locaux du kit #36 et le guide des versions ; le
parcours manuel sur une bibliothèque reste à préparer avec le référent.

Joindre sa note à #35. Le kit reste BLOCKED pour cette lecture humaine, même si
les contrôles automatiques passent : trouver des liens ne prouve pas qu'un
nouvel utilisateur comprend le guide.
