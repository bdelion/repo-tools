# Issue #32 — générer le rapport Python

Depuis la racine :

```powershell
npm.cmd run validate:issue-32
```

Le kit cherche `py -3`, `python3`, puis `python`. Si aucun Python >= 3.9 ne
fonctionne, son rapport indique BLOCKED. Installer Python via le mécanisme
habituel de votre poste, puis renseigner **uniquement si nécessaire**
`pythonExecutable` dans `config/validation/issue-32.json`, par exemple :

```json
"pythonExecutable": "C:/chemin/reel/vers/python.exe"
```

Utiliser le chemin réel de l'installation, pas cet exemple. Le script emploie
uniquement la bibliothèque standard Python : aucun `pip install` n'est requis.
Rejouer ensuite la même commande.

Ouvrir `reports/validation/issue-32/recette-resultat.md` puis :

| Fichier généré | Attendu |
| --- | --- |
| json.md | 3 lignes analysées, 2 bibliothèques, 1 ligne non résolue ; React 19.0.0-rc.1 visible. |
| jsonl.md et gzip.md | Mêmes totaux que json.md. |
| react-only.md | 2 lignes analysées ; lodash absent des tableaux. |
| invalid-output.terminal.txt | Erreur sur le JSON corrompu ; aucun invalid-output.md produit. |

Les entrées JSON, JSONL, gzip et invalide sont générées dans ce même dossier
depuis `examples/validation-python/dependencies.json`. Les terminaux sont
enregistrés dans `*.terminal.txt`. Aucun scan GHES n'est lancé.

Pour comprendre l'appel Python individuel, après configuration de l'interpréteur :

```powershell
py -3 src/generate_deps_report.py --in examples/validation-python/dependencies.json --out reports/validation/issue-32/manuel.md
```

Cette dernière commande suppose le lanceur Windows `py`. La commande npm ci-dessus
est préférable : elle détecte l'interpréteur, prépare les entrées et vérifie les
attendus. PASS confirme ces cas témoins, pas tous les fichiers de production.
