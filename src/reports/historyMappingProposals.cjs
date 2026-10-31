const semver = require('semver');
const { normalizePath, isCaseOnlyPathChange } = require('./componentHistory.cjs');

const endpointKey = endpoint => JSON.stringify([semver.valid(endpoint.version) ?? endpoint.version, normalizePath(endpoint.sourcefile), endpoint.sourceExport]);
const mappingKey = mapping => JSON.stringify([endpointKey(mapping.from), endpointKey(mapping.to)]);
const versionOf = label => typeof label === 'string' ? semver.valid(label.split(' ')[0]) : null;
const publicNames = component => component.publicNames ?? [component.name];

function validateMapping(mapping) {
  for (const endpoint of [mapping?.from, mapping?.to]) {
    if (!endpoint || !semver.valid(endpoint.version) || !normalizePath(endpoint.sourcefile).trim() ||
        typeof endpoint.sourcefile !== 'string' || typeof endpoint.sourceExport !== 'string' || !endpoint.sourceExport.trim()) {
      throw new Error('Correspondance invalide : version SemVer, sourcefile et sourceExport requis');
    }
  }
  if (semver.gte(mapping.from.version, mapping.to.version)) throw new Error('La version cible doit suivre la version source');
}

function mergeProposals(config, proposals) {
  if (!proposals?.componentHistoryMappings || typeof proposals.componentHistoryMappings !== 'object' || Array.isArray(proposals.componentHistoryMappings)) {
    throw new Error('Le fichier doit contenir componentHistoryMappings par dépôt');
  }
  const merged = JSON.parse(JSON.stringify(config));
  const configuredMappings = merged.componentHistoryMappings ?? {};
  if (typeof configuredMappings !== 'object' || Array.isArray(configuredMappings)) throw new Error('componentHistoryMappings doit être un objet par dépôt');
  for (const [repo, incoming] of Object.entries(proposals.componentHistoryMappings)) {
    if (!(config.repos ?? []).some(item => item.name === repo)) throw new Error(`Dépôt absent de la configuration : ${repo}`);
    if (!Array.isArray(incoming)) throw new Error(`Liste de correspondances attendue pour ${repo}`);
    const existing = configuredMappings[repo] ?? [];
    if (!Array.isArray(existing)) throw new Error(`Liste de correspondances attendue pour ${repo}`);
    for (const mapping of existing) validateMapping(mapping);
    for (const mapping of incoming) {
      validateMapping(mapping);
      if (existing.some(item => mappingKey(item) === mappingKey(mapping))) continue;
      const conflict = existing.some(item => semver.eq(item.from.version, mapping.from.version) && semver.eq(item.to.version, mapping.to.version) &&
        (endpointKey(item.from) === endpointKey(mapping.from) || endpointKey(item.to) === endpointKey(mapping.to)));
      if (conflict) throw new Error(`Correspondances incompatibles pour ${repo} : ${mapping.from.sourcefile} -> ${mapping.to.sourcefile}`);
      // Une proposition importée est toujours visible comme provisoire.
      existing.push({ from: { version: semver.valid(mapping.from.version), sourcefile: normalizePath(mapping.from.sourcefile), sourceExport: mapping.from.sourceExport },
        to: { version: semver.valid(mapping.to.version), sourcefile: normalizePath(mapping.to.sourcefile), sourceExport: mapping.to.sourceExport }, reviewRequired: true });
    }
    if (existing.length || Object.hasOwn(configuredMappings, repo)) {
      merged.componentHistoryMappings ??= {};
      merged.componentHistoryMappings[repo] = existing;
    }
  }
  return merged;
}

function proposeHistoryMappings(comparisons, config, selectedRepo) {
  const repositories = (config.repos ?? []).map(repo => repo.name).filter(name => !selectedRepo || name === selectedRepo);
  if (selectedRepo && !repositories.includes(selectedRepo)) throw new Error(`Dépôt absent de la configuration : ${selectedRepo}`);
  const candidates = new Map();
  const diagnostics = [];
  const transitions = new Set();
  const analyzedRepositories = new Set();
  for (const comparison of comparisons) {
    const repo = comparison.repository;
    if (!repositories.includes(repo)) continue;
    if (!Array.isArray(comparison.added) || !Array.isArray(comparison.removed)) throw new Error(`Comparaison invalide pour ${repo}`);
    const fromVersion = versionOf(comparison.from), toVersion = versionOf(comparison.to);
    if (!fromVersion || !toVersion || !semver.lt(fromVersion, toVersion)) throw new Error(`Versions de comparaison invalides pour ${repo}`);
    transitions.add(JSON.stringify([repo, fromVersion, toVersion]));
    analyzedRepositories.add(repo);
    const configured = (config.componentHistoryMappings?.[repo] ?? []).filter(mapping =>
      mapping.from.version === fromVersion && mapping.to.version === toVersion);
    for (const [direction, components] of [['removed', comparison.removed], ['added', comparison.added]]) {
      for (const component of components) {
        if (!component.sourcefile || !component.sourceExport) diagnostics.push({ repository: repo, from: comparison.from, to: comparison.to,
          component: component.name, direction, reason: 'missingSourceIdentity' });
      }
    }
    for (const before of comparison.removed) {
      if (!before.sourcefile || !before.sourceExport) continue;
      const from = { version: fromVersion, sourcefile: normalizePath(before.sourcefile), sourceExport: before.sourceExport };
      if (configured.some(mapping => endpointKey(mapping.from) === endpointKey(from))) continue;
      for (const after of comparison.added) {
        if (!after.sourcefile || !after.sourceExport) continue;
        const to = { version: toVersion, sourcefile: normalizePath(after.sourcefile), sourceExport: after.sourceExport };
        if (configured.some(mapping => endpointKey(mapping.to) === endpointKey(to))) continue;
        const sameSymbol = before.sourceExport === after.sourceExport;
        const sameName = publicNames(before).some(name => name && name !== 'default' && publicNames(after).includes(name));
        const reasons = [];
        if (sameSymbol && isCaseOnlyPathChange(from.sourcefile, to.sourcefile)) reasons.push('caseOnlyPath');
        if (before.contentHash && before.contentHash === after.contentHash && sameSymbol) reasons.push('identicalContent');
        if (sameName) reasons.push('samePublicName');
        if (sameSymbol && before.sourceExport !== 'default') reasons.push('sameSourceSymbol');
        if (!reasons.length) continue;
        const score = reasons.includes('caseOnlyPath') ? 90 : reasons.includes('identicalContent') ? 80
          : sameName && sameSymbol ? 70 : sameName ? 50 : 40;
        const candidate = { repository: repo, from, to, fromName: before.name, toName: after.name, reasons, score, reviewRequired: true };
        const key = JSON.stringify([repo, mappingKey(candidate)]);
        if (!candidates.has(key) || candidates.get(key).score < score) candidates.set(key, candidate);
      }
    }
  }
  const all = [...candidates.values()].sort((a, b) => a.repository.localeCompare(b.repository) ||
    semver.compare(a.from.version, b.from.version) || semver.compare(a.to.version, b.to.version) || mappingKey(a).localeCompare(mappingKey(b)));
  const bestFrom = new Map(), bestTo = new Map();
  const offer = (map, key, candidate) => {
    const best = map.get(key);
    if (!best || candidate.score > best.score) map.set(key, { score: candidate.score, candidates: [candidate] });
    else if (candidate.score === best.score) best.candidates.push(candidate);
  };
  const fromKey = candidate => JSON.stringify([candidate.repository, candidate.to.version, endpointKey(candidate.from)]);
  const toKey = candidate => JSON.stringify([candidate.repository, candidate.from.version, endpointKey(candidate.to)]);
  for (const candidate of all) { offer(bestFrom, fromKey(candidate), candidate); offer(bestTo, toKey(candidate), candidate); }
  const componentHistoryMappings = Object.fromEntries(repositories.map(repo => [repo, []]));
  for (const candidate of all) {
    const from = bestFrom.get(fromKey(candidate)), to = bestTo.get(toKey(candidate));
    const selected = from.candidates.length === 1 && to.candidates.length === 1 && from.candidates[0] === candidate && to.candidates[0] === candidate;
    candidate.status = selected ? 'proposed' : from.candidates.includes(candidate) || to.candidates.includes(candidate) ? 'ambiguous' : 'alternative';
    if (selected) componentHistoryMappings[candidate.repository].push({ from: candidate.from, to: candidate.to, reviewRequired: true });
  }
  return { componentHistoryMappings, candidates: all, diagnostics, transitions: transitions.size,
    repositoriesWithoutComparisons: repositories.filter(repo => !analyzedRepositories.has(repo)) };
}

function proposalMarkdown(repo, result) {
  const escape = value => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const candidates = result.candidates.filter(candidate => candidate.repository === repo);
  return [`# Propositions pour ${repo}`, '', 'Propositions à vérifier, sans validation métier automatique. Les cas ambigus ne sont pas inclus dans le JSON applicable.', '',
    '| Statut | Versions | Source avant | Source après | Indices |', '|---|---|---|---|---|',
    ...candidates.map(candidate => `|${[candidate.status, `${candidate.from.version} → ${candidate.to.version}`,
      `${candidate.from.sourcefile}#${candidate.from.sourceExport}`, `${candidate.to.sourcefile}#${candidate.to.sourceExport}`, candidate.reasons.join(', ')].map(escape).join('|')}|`),
    ...(candidates.length ? [] : [result.repositoriesWithoutComparisons.includes(repo) ? 'Aucune comparaison disponible pour ce dépôt. Générer ses rapports avant de conclure.' : 'Aucune proposition.']),
    '', ...result.diagnostics.filter(item => item.repository === repo).map(item => `Identité source manquante : ${escape(item.component)} (${escape(item.from)} → ${escape(item.to)}). Régénérer les analyses et comparaisons.`), ''].join('\n');
}

module.exports = { proposeHistoryMappings, mergeProposals, proposalMarkdown };
