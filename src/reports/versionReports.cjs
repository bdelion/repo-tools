const path = require('node:path');
const ExcelJS = require('exceljs');
const { comparisonFileName } = require('../versionReferences.cjs');
const { createGitHistoryReader } = require('./gitHistory.cjs');
const { componentKey, normalizePath, compareComponents, buildComponentHistory, isTypescriptPathMigration, isTypescriptComponentMigration } = require('./componentHistory.cjs');
const { groupReportComponents } = require('./reportComponents.cjs');

function createVersionReports({ config: CFG, hasGitDiff, logDebug, collectJson, createHistoryReader = createGitHistoryReader }) {
  const contexts = new WeakMap();
  const included = component => (CFG.includeExportAll || component.exportType !== 'exportAll') &&
    (!CFG.excludeDefaultNameEverywhere || component.name !== 'default');
  const latest = history => [...history].reverse().find(Boolean);
  const escapeCell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
  const mdLink = (label, url) => url ? `[${label}](${url})` : '';

  function markdownTable(rows) {
    if (CFG.markdownDropEmptyColumns && rows.length > 1) {
      const keep = rows[0].map((_, index) => index === 0 || rows.slice(1).some(row => String(row[index] ?? '').trim()));
      rows = rows.map(row => row.filter((_, index) => keep[index]));
    }
    const render = row => `|${row.map(escapeCell).join('|')}|`;
    return [render(rows[0]), render(rows[0].map(() => '---')), ...rows.slice(1).map(render)].join('\n');
  }

  function formatMarkdown(content) {
    return CFG.markdownCompactTables ? content.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n') : content;
  }

  async function context(repoName, snapshots) {
    if (!contexts.has(snapshots)) {
      contexts.set(snapshots, (async () => {
        const reader = createHistoryReader(path.join(CFG.tmpDir, repoName));
        const trees = [];
        const renames = [];
        for (let index = 0; index < snapshots.length; index++) {
          trees.push(await reader.files(snapshots[index].reference.sha));
          if (index) renames.push(await reader.renames(snapshots[index - 1].reference.sha, snapshots[index].reference.sha));
        }
        const filtered = snapshots.map(snapshot => ({ ...snapshot, result: {
          ...snapshot.result, components: groupReportComponents(snapshot.result.components.filter(included), CFG.preferredComponentNames?.[repoName]),
        } }));
        return { ...buildComponentHistory(filtered, renames, CFG.componentHistoryMappings?.[repoName]), snapshots, trees, renames, deltas: new Map() };
      })());
    }
    return contexts.get(snapshots);
  }

  function fileLink(repoName, ctx, lineage, field) {
    const history = ctx.rows.get(lineage) ?? [];
    const at = index => {
      for (let position = index; position >= 0; position--) {
        if (history[position]) return normalizePath(history[position][field]);
      }
      return '';
    };
    const lastIndex = ctx.snapshots.length - 1;
    const exists = index => at(index) && ctx.trees[index].has(at(index));
    let index = exists(lastIndex) ? lastIndex : -1;
    if (index < 0) {
      for (let candidate = lastIndex; candidate >= 0; candidate--) {
        if (ctx.snapshots[candidate].reference.kind === 'tag' && exists(candidate)) { index = candidate; break; }
      }
    }
    // Un composant jamais publié peut n'avoir qu'une branche candidate connue.
    if (index < 0) {
      for (let candidate = lastIndex; candidate >= 0; candidate--) {
        if (exists(candidate)) { index = candidate; break; }
      }
    }
    if (index < 0) return { file: '', url: '' };
    return referenceFileLink(repoName, ctx, index, at(index));
  }

  function referenceFileLink(repoName, ctx, index, filePath) {
    const file = normalizePath(filePath);
    if (!file || !ctx.trees[index].has(file)) return { file, url: '' };
    const reference = ctx.snapshots[index].reference;
    const ref = reference.branch ?? (reference.kind === 'develop' ? 'develop' : reference.label);
    const encodedPath = file.split('/').map(encodeURIComponent).join('/');
    return { file, url: `${CFG.githubBaseUrl}/${repoName}/blob/${encodeURIComponent(ref)}/${encodedPath}` };
  }

  function exportLinks(repoName, ctx, component, targetIndex) {
    return (component.exportFiles ?? [normalizePath(component.file)]).map(file => {
      if (targetIndex !== undefined) return referenceFileLink(repoName, ctx, targetIndex, file);
      const last = ctx.snapshots.length - 1;
      if (ctx.trees[last].has(file)) return referenceFileLink(repoName, ctx, last, file);
      for (let index = last; index >= 0; index--) {
        if (ctx.snapshots[index].reference.kind === 'tag' && ctx.trees[index].has(file)) return referenceFileLink(repoName, ctx, index, file);
      }
      for (let index = last; index >= 0; index--) {
        if (ctx.trees[index].has(file)) return referenceFileLink(repoName, ctx, index, file);
      }
      return { file, url: '' };
    });
  }

  async function delta(repoName, ctx, index) {
    if (ctx.deltas.has(index)) return ctx.deltas.get(index);
    const previous = ctx.maps[index - 1] ?? new Map();
    const next = ctx.maps[index];
    const added = [...next.keys()].filter(key => !previous.has(key));
    const removed = [...previous.keys()].filter(key => !next.has(key));
    const changed = [], unchanged = [];
    const nextMap = new Map(next);
    for (const [key, current] of next) {
      const before = previous.get(key);
      if (!before) continue;
      const reasons = [];
      if (before.name !== current.name) reasons.push('nameChanged');
      if (before.sourceExport !== current.sourceExport) reasons.push('sourceSymbolChanged');
      if (JSON.stringify(before.publicNames) !== JSON.stringify(current.publicNames)) reasons.push('publicNamesChanged');
      if (JSON.stringify(before.exportFiles) !== JSON.stringify(current.exportFiles)) reasons.push('exportFilesChanged');
      if (normalizePath(before.file) !== normalizePath(current.file)) reasons.push('exportMoved');
      if (normalizePath(before.sourcefile) !== normalizePath(current.sourcefile)) reasons.push('sourceMoved');
      const typescriptMigration = isTypescriptComponentMigration(before, current) ||
        (before.sourceExport && before.sourceExport === current.sourceExport && isTypescriptPathMigration(before.file, current.file));
      if (typescriptMigration) reasons.push('typescriptMigration');
      if (before.contentHash && current.contentHash && before.contentHash !== current.contentHash) reasons.push('diffContentHash');
      if (before.sourceAST && current.sourceAST && before.sourceAST !== current.sourceAST) reasons.push('diffAST');
      if (before.sourcefile && normalizePath(before.sourcefile) === normalizePath(current.sourcefile) &&
          await hasGitDiff(repoName, ctx.snapshots[index - 1].reference.sha, ctx.snapshots[index].reference.sha, normalizePath(before.sourcefile))) {
        reasons.push('diffGit');
      }
      if (reasons.length) {
        const renamedSource = ctx.renames[index - 1]?.get(normalizePath(before.sourcefile)) === normalizePath(current.sourcefile);
        const historyMatch = ctx.configuredMatches[index]?.has(componentKey(before)) ? 'configuredMapping'
          : componentKey(before) === componentKey(current) ? 'sameIdentity'
          : renamedSource ? 'gitSourceRename'
          : typescriptMigration ? 'typescriptMigration'
          : normalizePath(before.sourcefile) === normalizePath(current.sourcefile) && before.sourceExport && before.sourceExport === current.sourceExport
            ? 'sameSourceSymbol'
            : ctx.renames[index - 1]?.get(normalizePath(before.file)) === normalizePath(current.file) && before.name === current.name
              ? 'gitExportRename' : 'identicalContent';
        const reviewRequired = ctx.configuredReviews[index]?.has(componentKey(before)) ?? false;
        nextMap.set(key, { ...current, changeReasons: reasons, historyMatch, reviewRequired, previous: {
          id: componentKey(before), name: before.name, file: before.file, sourcefile: before.sourcefile,
          sourceExport: before.sourceExport, publicNames: before.publicNames, exportFiles: before.exportFiles,
        } });
        changed.push(key);
      } else unchanged.push(key);
    }
    const result = { added, removed, changed, unchanged, nextMap, previous };
    ctx.deltas.set(index, result);
    return result;
  }

  function pairTable(repoName, ctx, entries, targetIndex) {
    if (!entries.length) return '_Aucun_';
    const rows = [['Nom', 'Previous Name', 'Visible Name', 'Reasons', 'History Match', 'Previous Export File', 'Previous Source File', 'Export Files', 'Source File', 'Source Symbol', 'Public Names', 'Review']];
    for (const { component } of entries) {
      const exported = exportLinks(repoName, ctx, component, targetIndex);
      const source = referenceFileLink(repoName, ctx, targetIndex, component.sourcefile);
      const renderLink = entry => mdLink(path.posix.basename(entry.file), entry.url) || path.posix.basename(entry.file);
      rows.push([component.name, component.previous?.name !== component.name ? component.previous?.name ?? '' : '',
        component.visibleName ?? '', (component.changeReasons ?? []).join(', '), component.historyMatch ?? '',
        component.changeReasons?.includes('exportMoved') ? normalizePath(component.previous.file) : '',
        component.changeReasons?.includes('sourceMoved') ? normalizePath(component.previous.sourcefile) : '',
        exported.map(renderLink).join('<br/>'), renderLink(source), component.sourceExport ?? '', component.publicNames.join(', '),
        component.reviewRequired ? '⚠️ À vérifier' : '']);
    }
    return markdownTable(rows);
  }

  async function generateReports(repoName, from, to, outputs, snapshots = [from, to]) {
    const ctx = await context(repoName, snapshots);
    const index = snapshots.indexOf(to);
    const comparison = await delta(repoName, ctx, index);
    const entries = (keys, map) => keys.map(lineage => ({ lineage, component: map.get(lineage) }))
      .sort((a, b) => compareComponents(a.component, b.component));
    const groups = {
      added: entries(comparison.added, comparison.nextMap), removed: entries(comparison.removed, comparison.previous),
      changed: entries(comparison.changed, comparison.nextMap), unchanged: entries(comparison.unchanged, comparison.nextMap),
    };
    const json = { repository: repoName, from: from.reference.label, to: to.reference.label };
    for (const [name, group] of Object.entries(groups)) json[name] = group.map(entry => entry.component);
    collectJson(outputs, path.join(CFG.analysisDir, comparisonFileName(repoName, json.from, json.to, 'json')), json);
    const sections = [['added', '✅ Nouveaux composants'], ['removed', '❌ Composants supprimés'], ['changed', '🔄 Composants modifiés'], ['unchanged', '🔁 Composants inchangés']];
    const markdown = [`# Rapport de comparaison des composants`, `**Repository** : ${repoName}`, `**De** : ${json.from}`, `**À** : ${json.to}`, '',
      ...sections.flatMap(([key, title]) => [`## ${title}`, '', pairTable(repoName, ctx, groups[key], index), ''])].join('\n');
    const target = path.join(CFG.analysisDir, comparisonFileName(repoName, json.from, json.to, 'md'));
    outputs.set(path.resolve(target), formatMarkdown(markdown));
    logDebug(`Rapport préparé : ${target}`);
  }

  async function generateComponentComparisonReports(repoName, snapshots, outputs) {
    const ctx = await context(repoName, snapshots);
    const components = [...ctx.rows.keys()].sort((a, b) => compareComponents(latest(ctx.rows.get(a)), latest(ctx.rows.get(b))));
    const matrix = new Map(components.map(key => [key, []]));
    for (let index = 0; index < snapshots.length; index++) {
      const comparison = await delta(repoName, ctx, index);
      for (const key of components) {
        let cell = '';
        const current = comparison.nextMap.get(key);
        if (current) {
          if (comparison.changed.includes(key)) {
            const details = current.changeReasons.map(reason => reason === 'nameChanged'
              ? `nameChanged: ${current.previous.name} -> ${current.name}` : reason);
            if (current.historyMatch !== 'sameIdentity') details.push(current.historyMatch);
            if (current.reviewRequired) details.push('⚠️ À vérifier');
            cell = `~\n${[...new Set(details)].join('\n')}`;
          } else cell = comparison.added.includes(key) ? '+' : '=';
          if (current.name !== latest(ctx.rows.get(key)).name) cell += `\nname: ${current.name}`;
        } else if (comparison.removed.includes(key)) cell = '-';
        matrix.get(key).push(cell);
      }
    }
    const headers = snapshots.map((snapshot, index) => `${snapshot.reference.label}${components.some(key => matrix.get(key)[index] === '-') ? ' 💥' : ''}`);
    const columns = ['Component', 'Visible Name', 'Uses ForwardRef', 'Default Export', 'Export Files', 'Source File', 'Source Symbol', 'Public Names', ...headers];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Component Comparison');
    const exportSheet = workbook.addWorksheet('Export Files');
    exportSheet.addRow(['Component', 'Version', 'Public Name', 'Source Symbol', 'Export File']);
    const reviewSheet = workbook.addWorksheet('Historique à vérifier');
    reviewSheet.addRow(['Component', 'From Version', 'To Version', 'Previous Source', 'Previous Symbol', 'Source', 'Symbol', 'Review']);
    sheet.addRow(columns);
    const markdownRows = [columns];
    const names = new Map();
    for (const key of components) {
      const name = latest(ctx.rows.get(key)).name.toLocaleLowerCase('fr');
      names.set(name, (names.get(name) ?? 0) + 1);
    }
    const emoji = { '+': '🟢', '-': '🔴', '=': '⚪', '~': '🟡' };
    for (const key of components) {
      const data = latest(ctx.rows.get(key));
      const needsReview = [...ctx.deltas.values()].some(comparison => comparison.nextMap.get(key)?.reviewRequired);
      const name = `${data.name}${names.get(data.name.toLocaleLowerCase('fr')) > 1 || data.nameSelection === 'ambiguous' || needsReview ? ' ⚠️' : ''}`;
      const exported = exportLinks(repoName, ctx, data);
      const source = fileLink(repoName, ctx, key, 'sourcefile');
      const label = file => CFG.markdownShowFullPathLabels ? file : path.posix.basename(file);
      const base = [name, data.visibleName ?? '', data.usesForwardRef ?? false, data.isDefaultExport ?? false];
      sheet.addRow([...base, { text: exported.map(entry => label(entry.file)).join('\n'), hyperlink: exported.find(entry => entry.url)?.url ?? '' },
        { text: label(source.file), hyperlink: source.url }, data.sourceExport ?? '', data.publicNames.join(', '), ...matrix.get(key)]);
      markdownRows.push([...base, exported.map(entry => mdLink(label(entry.file), entry.url) || label(entry.file)).join('<br/>'),
        mdLink(label(source.file), source.url), data.sourceExport ?? '', data.publicNames.join(', '),
        ...matrix.get(key).map(cell => cell ? `${emoji[cell[0]] ?? ''}${cell.includes('\n') ? ` ${cell.split('\n').slice(1).join(', ')}` : ''}` : '')]);
    }
    snapshots.forEach((snapshot, index) => {
      for (const component of ctx.maps[index].values()) {
        for (const origin of component.exports) {
          const link = referenceFileLink(repoName, ctx, index, origin.file);
          exportSheet.addRow([component.name, snapshot.reference.label, origin.name, component.sourceExport ?? '',
            link.url ? { text: link.file, hyperlink: link.url } : link.file]);
        }
      }
      for (const component of ctx.deltas.get(index).nextMap.values()) {
        if (component.reviewRequired) reviewSheet.addRow([component.name, snapshots[index - 1].reference.label, snapshot.reference.label,
          normalizePath(component.previous.sourcefile), component.previous.sourceExport, normalizePath(component.sourcefile), component.sourceExport, '⚠️ À vérifier']);
      }
    });
    exportSheet.columns.forEach(column => { column.width = 30; });
    reviewSheet.columns.forEach(column => { column.width = 30; });
    sheet.columns.forEach(column => { column.width = 30; });
    outputs.set(path.resolve(CFG.reportsDir, `${repoName}_component_comparison.xlsx`), Buffer.from(await workbook.xlsx.writeBuffer()));
    outputs.set(path.resolve(CFG.reportsDir, `${repoName}_component_comparison.md`),
      formatMarkdown(`# Component Comparison Report for ${repoName}\n\n${markdownTable(markdownRows)}`));
  }

  return { generateReports, generateComponentComparisonReports };
}

module.exports = { createVersionReports };
