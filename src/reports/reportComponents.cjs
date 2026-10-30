const { normalizePath, componentKey } = require('./componentHistory.cjs');

function groupReportComponents(components, preferredNames = {}) {
  const groups = new Map();
  for (const component of components) {
    const source = normalizePath(component.sourcefile);
    // Sans symbole résolu, garder les identités distinctes des anciennes analyses.
    const key = source && component.sourceExport ? `${source}#${component.sourceExport}` : componentKey(component);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(component);
  }
  return [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, members]) => {
    const sorted = [...members].sort((a, b) => componentKey(a).localeCompare(componentKey(b), 'en'));
    const publicNames = [...new Set(sorted.map(item => item.name))].sort();
    const sourceSymbol = sorted[0].sourceExport;
    const aliases = publicNames.filter(name => name !== sourceSymbol && name !== 'default');
    const preferred = preferredNames[id];
    if (preferred !== undefined && (typeof preferred !== 'string' || !preferred.trim())) {
      throw new Error(`Nom préféré invalide pour ${id}`);
    }
    const name = preferred ?? (aliases.length === 1 ? aliases[0]
      : publicNames.includes(sourceSymbol) ? sourceSymbol : publicNames[0]);
    const representative = sorted.find(item => item.name === name) ?? sorted[0];
    return { ...representative, id, name, publicNames,
      nameSelection: preferred ? 'configured' : aliases.length > 1 ? 'ambiguous' : 'automatic',
      exportFiles: [...new Set(sorted.map(item => normalizePath(item.file)))].sort(),
      exports: sorted.map(item => ({ id: componentKey(item), name: item.name, file: normalizePath(item.file), exportType: item.exportType })),
    };
  });
}

module.exports = { groupReportComponents };
