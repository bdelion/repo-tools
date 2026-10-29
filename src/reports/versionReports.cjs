const path = require('node:path');
const ExcelJS = require('exceljs');
const { comparisonFileName } = require('../versionReferences.cjs');

function createVersionReports({ config, hasGitDiff, logDebug, collectJson }) {
  const CFG = config;
  function componentKey(component) {
    return component.id ?? `${String(component.file).replace(/\\/g, '/')}#${component.name}`;
  }

  function githubLink(repoName, ref, filePath) {
    return `${CFG.githubBaseUrl}/${repoName}/blob/${encodeURIComponent(ref)}/${String(filePath).replace(/\\/g, '/')}`;
  }

  // Helper lien Markdown sûr
  function mdLink(label, url) {
    return label && url ? `[${label}](${url})` : '';
  }

  // Walk récursif (sans dépendance) + filtres
  function areASTsEqualFromJSON(astJson1, astJson2) {
    try {
      if (!astJson1 || !astJson2) return false;
      const a1 = JSON.parse(astJson1);
      const a2 = JSON.parse(astJson2);
      return JSON.stringify(a1) === JSON.stringify(a2);
    } catch {
      return false;
    }
  }

  // Métadonnées robustes
  function labelOf(p) {
    if (!p) return '';
    const normalized = String(p).replace(/\\/g, '/');
    return CFG.markdownShowFullPathLabels ? normalized : path.basename(normalized);
  }

  async function compareComponents(repoName, from, to, prev, next) {
    const prevMap = new Map(prev.map((c) => [componentKey(c), c]));
    const nextMap = new Map(next.map((c) => [componentKey(c), c]));

    const added = [...nextMap.keys()].filter((x) => !prevMap.has(x));
    const removed = [...prevMap.keys()].filter((x) => !nextMap.has(x));
    const unchanged = [];
    const changed = [];

    for (const name of nextMap.keys()) {
      if (!prevMap.has(name)) continue;

      const prevComp = prevMap.get(name);
      const nextComp = nextMap.get(name);

      let compChanged = false;
      const reasons = [];

      if (prevComp.contentHash && nextComp.contentHash && prevComp.contentHash !== nextComp.contentHash) {
        compChanged = true; reasons.push('diffContentHash');
      }
      if (prevComp.sourceAST && nextComp.sourceAST) {
        const sameAst = areASTsEqualFromJSON(prevComp.sourceAST, nextComp.sourceAST);
        if (!sameAst) { compChanged = true; reasons.push('diffAST'); }
      }
      if (prevComp.sourcefile && nextComp.sourcefile && prevComp.sourcefile === nextComp.sourcefile) {
        const gitRef1 = from.reference.sha;
        const gitRef2 = to.reference.sha;
        const gitChanged =await hasGitDiff(repoName, gitRef1, gitRef2, prevComp.sourcefile);
        if (gitChanged) {
          compChanged = true;
          reasons.push('diffGit');
        }
      }

      if (compChanged) {
        nextMap.set(name, { ...nextComp, changeReasons: reasons });
        changed.push(name);
      } else {
        unchanged.push(name);
      }
    }

    return { added, removed, changed, unchanged, nextMap };
  }

  // ——— Minification / formatage Markdown ———

  // Supprimer les colonnes 100% vides (optionnel)
  function dropEmptyColumns(rows) {
    if (!rows || rows.length < 2) return rows;
    const header = rows[0];
    const body = rows.slice(1);

    // Colonnes vides = toutes cellules nulles/vides/whitespace
    const emptyIdx = header.map((_, i) =>
      body.every(r => !r[i] || String(r[i]).trim() === '')
    );

    // Préserve toujours la première colonne (Component/Nom)
    if (emptyIdx.length > 0) emptyIdx[0] = false;

    return rows.map(r => r.filter((_, i) => !emptyIdx[i]));
  }

  function minifyMarkdownString(md) {
    return md
      .replace(/[ \t]+$/gm, '')  // trim fin de ligne
      .replace(/\n{3,}/g, '\n\n');
  }

  function escapeCell(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/\|/g, '\\|')
      .replace(/\n/g, '<br/>');
  }

  function formatMarkdownTable(rows, { dropEmpty = false } = {}) {
    if (!rows || rows.length === 0) return '';

    const src = dropEmpty ? dropEmptyColumns(rows) : rows;

    const normalizeRow = (cells) =>
      '|' + cells.map(escapeCell).join('|') + '|';

    const header = normalizeRow(src[0]);
    const separator =
      '|' + src[0].map(() => '---').join('|') + '|';

    const body = src.slice(1).map(normalizeRow);

    return [header, separator, ...body].join('\n');
  }

  // ✅ Pair-à-pair : libellé = basename (comme ton ancien script)
  function generateMarkdownTable(components, repoName, tag1, tag2, type) {
    if (!components || components.length === 0) return '';

    const headers = ['Nom', 'Visible Name', 'Reasons', 'Export File', 'Source File'];
    const rows = [headers];

    // Pour les liens : tag2 sauf pour "removed" (tag1)
    const tag = type === 'removed' ? tag1 : tag2;

    for (const c of components) {
      const exportLabel = c?.file ? path.basename(String(c.file).replace(/\\/g, '/')) : '';
      const exportUrl = c?.file ? githubLink(repoName, tag, c.file) : '';
      const exportLink = mdLink(exportLabel, exportUrl);

      const sourceLabel = c?.sourcefile ? path.basename(String(c.sourcefile).replace(/\\/g, '/')) : '';
      const sourceUrl = c?.sourcefile ? githubLink(repoName, tag, c.sourcefile) : '';
      const sourceLink = mdLink(sourceLabel, sourceUrl);

      rows.push([
        c.name ?? '',
        c.visibleName ?? '',
        Array.isArray(c.changeReasons) ? c.changeReasons.join(', ') : '',
        exportLink,
        sourceLink
      ]);
    }

    return formatMarkdownTable(rows, {
      dropEmpty: CFG.markdownDropEmptyColumns
    });
  }

  async function generateReports(repoName, from, to, outputs) {
    const tag1 = from.reference.label;
    const tag2 = to.reference.label;
    const result1 = from.result;
    const result2 = to.result;
    console.log(`\t⚖️ Génération du rapport entre ${tag1} et ${tag2}...`);

    // Option B: exclure exportAll et name === 'default' des comparaisons
    const previous = result1.components.filter(c => (CFG.includeExportAll || c.exportType !== 'exportAll') && (!CFG.excludeDefaultNameEverywhere || c.name !== 'default'));
    const next = result2.components.filter(c => (CFG.includeExportAll || c.exportType !== 'exportAll') && (!CFG.excludeDefaultNameEverywhere || c.name !== 'default'));

    const comparison = await compareComponents(repoName, from, to, previous, next);

    // Tri par nom dans chaque section du rapport
    const sortByName = (arr) =>
      [...(arr || [])].sort((a, b) =>
        String(a?.name || '').localeCompare(String(b?.name || ''), 'fr', { sensitivity: 'base' })
      );

    const jsonReport = {
      repository: repoName,
      from: tag1,
      to: tag2,
      added: sortByName(comparison.added.map((n) => comparison.nextMap.get(n))),
      removed: sortByName(comparison.removed.map((n) => result1.components.find((c) => componentKey(c) === n))),
      changed: sortByName(comparison.changed.map((n) => comparison.nextMap.get(n))),
      unchanged: sortByName(comparison.unchanged.map((n) => comparison.nextMap.get(n)))
    };

    const jsonPath = path.join(CFG.analysisDir, comparisonFileName(repoName, tag1, tag2, 'json'));
    collectJson(outputs, jsonPath, jsonReport);

    const md = `
  # Rapport de comparaison des composants
  **Repository** : ${repoName}
  **De** : ${tag1}
  **À** : ${tag2}

  ## ✅ Nouveaux composants
  ${generateMarkdownTable(jsonReport.added, repoName, from.reference.sha, to.reference.sha, 'added') || '_Aucun_'}

  ## ❌ Composants supprimés
  ${generateMarkdownTable(jsonReport.removed, repoName, from.reference.sha, to.reference.sha, 'removed') || '_Aucun_'}

  ## 🔄 Composants modifiés
  ${generateMarkdownTable(jsonReport.changed, repoName, from.reference.sha, to.reference.sha, 'changed') || '_Aucun_'}

  ## 🔁 Composants inchangés
  ${generateMarkdownTable(jsonReport.unchanged, repoName, from.reference.sha, to.reference.sha, 'unchanged') || '_Aucun_'}
  `.trim();

    const outMd = CFG.markdownCompactTables ? minifyMarkdownString(md) : md;
    const mdPath = path.join(CFG.analysisDir, comparisonFileName(repoName, tag1, tag2, 'md'));
    outputs.set(path.resolve(mdPath), outMd);

    logDebug(`Rapport préparé : ${mdPath}`);
  }

  function getLastComponentData(compName, snapshots) {
    const snapshot = [...snapshots].reverse().find(item => item.result.components.some(c => componentKey(c) === compName));
    return {
      sha: snapshot?.reference.sha,
      data: snapshot?.result.components.find(c => componentKey(c) === compName),
    };
  }

  // ✅ Global : on tient compte de diffGit (async) + exclus exportAll & default
  async function buildComparisonMatrix(repoName, components, snapshots) {
    const matrix = {};
    for (let i = 0; i < snapshots.length; i++) {
      const snapshot = snapshots[i];
      const tag = snapshot.reference.label;

      const current = snapshot.result.components
        .filter(c => (CFG.includeExportAll || c.exportType !== 'exportAll') && (!CFG.excludeDefaultNameEverywhere || c.name !== 'default'));
      const currentMap = new Map(current.map((c) => [componentKey(c), c]));
      const currentSet = new Set(currentMap.keys());

      const previous = snapshots[i - 1];
      const prevTag = previous?.reference.label;
      const prev = previous
        ? (previous.result.components
          .filter(c => (CFG.includeExportAll || c.exportType !== 'exportAll') && (!CFG.excludeDefaultNameEverywhere || c.name !== 'default')))
        : [];
      const prevMap = new Map(prev.map((c) => [componentKey(c), c]));
      const prevSet = new Set(prevMap.keys());

      for (const comp of components) {
        if (!matrix[comp]) matrix[comp] = {};
        if (i === 0) {
          matrix[comp][tag] = currentSet.has(comp) ? '+' : '';
          continue;
        }

        const inCurrent = currentSet.has(comp);
        const inPrevious = prevSet.has(comp);

        if (inCurrent && inPrevious) {
          let compChanged = false;
          const reasons = [];
          const prevItem = prevMap.get(comp);
          const currItem = currentMap.get(comp);

          // Hash
          const prevHash = prevItem?.contentHash;
          const currHash = currItem?.contentHash;
          if (prevHash && currHash && prevHash !== currHash) {
            compChanged = true; reasons.push('diffContentHash');
          }

          // AST
          const prevAST = prevItem?.sourceAST;
          const currAST = currItem?.sourceAST;
          if (prevAST && currAST && !areASTsEqualFromJSON(prevAST, currAST)) {
            compChanged = true; reasons.push('diffAST');
          }

          // Git diff (même fichier source)
          const prevFile = prevItem?.sourcefile;
          const currFile = currItem?.sourcefile;
          if (prevTag && prevFile && currFile && prevFile === currFile) {
            try {
              const gitRef1 = previous.reference.sha;
              const gitRef2 = snapshot.reference.sha;
              const gitChanged = await hasGitDiff(repoName, gitRef1, gitRef2, prevFile);
              if (gitChanged) { compChanged = true; reasons.push('diffGit'); }
            } catch (e) {
              throw new Error(`Comparaison impossible pour ${comp}: ${e.message}`, { cause: e });
            }
          }

          matrix[comp][tag] = compChanged ? `~\n${reasons.join('\n')}` : '=';
        } else if (inCurrent && !inPrevious) {
          matrix[comp][tag] = '+';
        } else if (!inCurrent && inPrevious) {
          matrix[comp][tag] = '-';
        } else {
          matrix[comp][tag] = '';
        }
      }
    }
    return matrix;
  }

  async function generateExcelReport(repoName, snapshots, components, matrix, duplicates, outputs) {
    const tags = snapshots.map(item => item.reference.label);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Component Comparison');

    const tagsWithBreaking = tags.map((t) => {
      const hasBreaking = components.some((c) => matrix[c]?.[t] === '-');
      return hasBreaking ? `${t} 💥` : t;
    });

    sheet.addRow(['Component', 'Visible Name', 'Uses ForwardRef', 'Default Export', 'Export File', 'Source File', ...tagsWithBreaking]);

    components.forEach((comp) => {
      const { sha, data } = getLastComponentData(comp, snapshots);
      const exportFile = data?.file ? githubLink(repoName, sha, data.file) : '';
      const sourceFile = data?.sourcefile ? githubLink(repoName, sha, data.sourcefile) : '';
      const displayName = duplicates.has(comp.toLowerCase()) ? `${data?.name ?? comp} ⚠️` : data?.name ?? comp;

      const row = [
        displayName,
        data?.visibleName ?? '',
        data?.usesForwardRef ?? false,
        data?.isDefaultExport ?? false,
        { text: labelOf(data?.file), hyperlink: exportFile },
        { text: labelOf(data?.sourcefile), hyperlink: sourceFile },
        ...tags.map((t) => matrix[comp][t] ?? '')
      ];
      sheet.addRow(row);
    });

    sheet.columns.forEach((col) => (col.width = 30));
    const excelPath = path.join(CFG.reportsDir, `${repoName}_component_comparison.xlsx`);
    outputs.set(path.resolve(excelPath), Buffer.from(await workbook.xlsx.writeBuffer()));
    logDebug(`Rapport Excel préparé : ${excelPath}`);
  }

  // ✅ Global : libellé = chemin complet
  async function generateMarkdownReport(repoName, snapshots, components, matrix, duplicates, outputs) {
    const tags = snapshots.map(item => item.reference.label);
    const emojiMap = { '+': '🟢', '-': '🔴', '=': '⚪', '~': '🟡' };
    const getEmoji = (value) => (typeof value === 'string' ? (emojiMap[value.charAt(0)] || '') : '');
    const getDetails = (value) => (typeof value === 'string' && value.startsWith('~')
      ? value.split('\n').slice(1).join(', ')
      : '');

    const tagsWithBreaking = tags.map((t) =>
      components.some((c) => matrix[c]?.[t] === '-') ? `${t} 💥` : t
    );

    const rows = [['Component', 'Visible Name', 'Uses ForwardRef', 'Default Export', 'Export File', 'Source File', ...tagsWithBreaking]];

    components.forEach((comp) => {
      const { sha, data } = getLastComponentData(comp, snapshots);

      const exportLabel = data?.file ? String(data.file).replace(/\\/g, '/') : '';
      const exportUrl = data?.file ? githubLink(repoName, sha, data.file) : '';
      const exportFile = mdLink(exportLabel, exportUrl);

      const sourceLabel = data?.sourcefile ? String(data.sourcefile).replace(/\\/g, '/') : '';
      const sourceUrl = data?.sourcefile ? githubLink(repoName, sha, data.sourcefile) : '';
      const sourceFile = mdLink(sourceLabel, sourceUrl);

      const displayName = duplicates.has(comp.toLowerCase()) ? `${data?.name ?? comp} ⚠️` : data?.name ?? comp;

      const statusCells = tags.map((t) => {
        const e = getEmoji(matrix[comp][t]);
        const d = getDetails(matrix[comp][t]);
        return d ? `${e} ${d}` : e;
      });

      rows.push([
        displayName,
        data?.visibleName ?? '',
        String(data?.usesForwardRef ?? ''),
        String(data?.isDefaultExport ?? ''),
        exportFile,
        sourceFile,
        ...statusCells
      ]);
    });

    const table = formatMarkdownTable(rows, {
      dropEmpty: CFG.markdownDropEmptyColumns
    });

    const md = `# Component Comparison Report for ${repoName}\n\n${table}`;
    const outMd = CFG.markdownCompactTables ? minifyMarkdownString(md) : md;

    const mdPath = path.join(CFG.reportsDir, `${repoName}_component_comparison.md`);
    outputs.set(path.resolve(mdPath), outMd);
    logDebug(`Rapport Markdown préparé : ${mdPath}`);
  }

  async function generateComponentComparisonReports(repoName, snapshots, outputs) {
    // set global unique component names
    const all = new Set();
    snapshots.forEach(({ result }) => {
      result.components
        .filter(c => (CFG.includeExportAll || c.exportType !== 'exportAll') && (!CFG.excludeDefaultNameEverywhere || c.name !== 'default'))
        .forEach((c) => all.add(componentKey(c)));
    });

    // Tri alphabétique insensible à la casse
    const sorted = Array.from(all).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const lowerSeen = {};
    const duplicates = new Set();
    sorted.forEach((n) => {
      const lower = n.toLowerCase();
      if (lowerSeen[lower]) duplicates.add(lower);
      else lowerSeen[lower] = n;
    });

    const matrix = await buildComparisonMatrix(repoName, sorted, snapshots);
    await generateExcelReport(repoName, snapshots, sorted, matrix, duplicates, outputs);
    await generateMarkdownReport(repoName, snapshots, sorted, matrix, duplicates, outputs);
  }

  // --------------------------
  // Analyse d’un repo complet
  // --------------------------


  return { generateReports, generateComponentComparisonReports };
}

module.exports = { createVersionReports };
