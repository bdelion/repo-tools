const normalizePath = value => value ? String(value).replace(/\\/g, '/') : '';
const componentKey = component => component.id ?? `${normalizePath(component.file)}#${component.name}`;
const isCaseOnlyPathChange = (before, after) => {
  const source = normalizePath(before), target = normalizePath(after);
  return source && target && source !== target && source.toLowerCase() === target.toLowerCase();
};
const isTypescriptPathMigration = (before, after) => {
  const source = normalizePath(before), target = normalizePath(after);
  return /\.jsx?$/.test(source) && /\.tsx?$/.test(target) &&
    source.replace(/\.jsx?$/, '') === target.replace(/\.tsx?$/, '');
};
const isTypescriptComponentMigration = (a, b) => {
  if (!isTypescriptPathMigration(a.sourcefile, b.sourcefile) || !a.sourceExport || !b.sourceExport) return false;
  if (a.sourceExport === b.sourceExport) return true;
  // Un default devient un export nommé du même nom public au même chemin.
  const publicNames = (a.publicNames ?? [a.name]).filter(name => name !== 'default');
  return a.sourceExport === 'default' && b.sourceExport !== 'default' && publicNames.length === 1 &&
    publicNames[0] === b.sourceExport && (b.publicNames ?? [b.name]).includes(b.sourceExport);
};
const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const compareText = (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const compareComponents = (a, b) => compareText(a.name ?? '', b.name ?? '') || compareText(componentKey(a), componentKey(b));

function matchComponents(previous, current, renames, explicitMatches = new Map()) {
  const matches = new Map();
  const old = new Map(previous.map(component => [componentKey(component), component]));
  const next = new Map(current.map(component => [componentKey(component), component]));
  const targets = new Set();
  for (const [from, to] of explicitMatches) {
    if (!old.has(from) || !next.has(to) || targets.has(to)) {
      throw new Error(`Correspondance historique invalide ou ambiguë : ${from} -> ${to}`);
    }
    matches.set(from, to); targets.add(to);
  }
  for (const [from, to] of matches) { old.delete(from); next.delete(to); }
  for (const key of old.keys()) {
    if (next.has(key)) { matches.set(key, key); old.delete(key); next.delete(key); }
  }
  const score = (a, b) => {
    const sourceA = normalizePath(a.sourcefile), sourceB = normalizePath(b.sourcefile);
    const fileA = normalizePath(a.file), fileB = normalizePath(b.file);
    const sameSymbol = a.sourceExport && a.sourceExport === b.sourceExport;
    // Les empreintes portent sur le fichier entier : deux symboles distincts
    // d'un module ne deviennent pas un seul composant parce que ce module est identique.
    const migration = isTypescriptComponentMigration(a, b);
    if (a.sourceExport && b.sourceExport && !sameSymbol && !migration) return 0;
    let evidence = 0;
    if (sourceA && sourceB && renames.get(sourceA) === sourceB) evidence = 80;
    else if (migration) evidence = 75;
    else if (sameSymbol && isCaseOnlyPathChange(sourceA, sourceB)) evidence = 65;
    else if (sourceA && sourceA === sourceB && sameSymbol) evidence = 60;
    else if (fileA && renames.get(fileA) === fileB && a.name === b.name) evidence = 70;
    else if (a.contentHash && a.contentHash === b.contentHash) evidence = 40;
    if (!evidence) return 0;
    // Une même source peut être exportée directement et par plusieurs barrels.
    // Départager ces exports seulement après avoir établi une correspondance fiable.
    // Le déplacement du fichier d'export ancre l'export direct ; un nom inchangé
    // départage les alias. Un nom seul ou un hash commun ambigu ne suffit jamais.
    const anchoredSource = evidence >= 60;
    const exportRename = fileA && (renames.get(fileA) === fileB || isTypescriptPathMigration(fileA, fileB));
    return evidence + (anchoredSource && exportRename ? 8 : 0) + (anchoredSource && a.name === b.name ? 4 : 0);
  };
  // Accepter seulement un meilleur rapprochement unique dans les deux sens.
  while (old.size && next.size) {
    const bestOld = new Map(), bestNew = new Map();
    const offer = (map, key, target, value) => {
      const best = map.get(key);
      if (!best || value > best.score) map.set(key, { target, score: value, unique: true });
      else if (value === best.score) best.unique = false;
    };
    for (const [oldKey, a] of old) {
      for (const [newKey, b] of next) {
        const value = score(a, b);
        if (value > 0) { offer(bestOld, oldKey, newKey, value); offer(bestNew, newKey, oldKey, value); }
      }
    }
    let found = false;
    for (const [oldKey, best] of bestOld) {
      const reverse = bestNew.get(best.target);
      if (best.unique && reverse?.unique && reverse.target === oldKey) {
        matches.set(oldKey, best.target);
        old.delete(oldKey); next.delete(best.target); found = true;
      }
    }
    if (!found) break;
  }
  return matches;
}

function buildComponentHistory(snapshots, renameMaps, mappings = []) {
  if (!Array.isArray(mappings)) throw new Error('componentHistoryMappings doit contenir une liste par dépôt');
  for (const mapping of mappings) {
    for (const endpoint of [mapping?.from, mapping?.to]) {
      if (!endpoint || ['version', 'sourcefile', 'sourceExport'].some(field => typeof endpoint[field] !== 'string' || !endpoint[field].trim())) {
        throw new Error('Correspondance historique : version, sourcefile et sourceExport requis dans from et to');
      }
    }
  }
  const rows = new Map();
  const assignments = [];
  const maps = [];
  const configuredMatches = [];
  const configuredReviews = [];
  snapshots.forEach((snapshot, index) => {
    const assigned = new Map();
    const current = new Map();
    const components = snapshot.result.components;
    if (index > 0) {
      const previous = snapshots[index - 1].result.components;
      const version = snapshot => snapshot.reference.version ?? snapshot.result.version ?? snapshot.reference.label;
      const configured = new Map();
      const reviews = new Set();
      for (const mapping of mappings) {
        if (mapping.from.version !== version(snapshots[index - 1]) || mapping.to.version !== version(snapshot)) continue;
        const from = `${normalizePath(mapping.from.sourcefile)}#${mapping.from.sourceExport}`;
        const to = `${normalizePath(mapping.to.sourcefile)}#${mapping.to.sourceExport}`;
        if (configured.has(from) || [...configured.values()].includes(to)) throw new Error(`Correspondance historique dupliquée : ${from} -> ${to}`);
        configured.set(from, to);
        if (mapping.reviewRequired !== false) reviews.add(from);
      }
      configuredMatches[index] = configured;
      configuredReviews[index] = reviews;
      const matches = matchComponents(previous, components, renameMaps[index - 1], configured);
      for (const [oldKey, newKey] of matches) assigned.set(newKey, assignments[index - 1].get(oldKey));
    }
    for (const component of components) {
      const key = componentKey(component);
      let lineage = assigned.get(key);
      if (!lineage) {
        lineage = key;
        const history = rows.get(lineage);
        const last = history && [...history].reverse().find(Boolean);
        if ([...assigned.values()].includes(lineage) || (last && componentKey(last) !== key)) {
          lineage = `${key}@${index}`;
        }
        assigned.set(key, lineage);
      }
      if (!rows.has(lineage)) rows.set(lineage, []);
      rows.get(lineage)[index] = component;
      current.set(lineage, component);
    }
    assignments.push(assigned);
    maps.push(current);
  });
  return { rows, assignments, maps, configuredMatches, configuredReviews };
}

module.exports = { normalizePath, componentKey, compareComponents, buildComponentHistory, matchComponents, isTypescriptPathMigration, isTypescriptComponentMigration, isCaseOnlyPathChange };
