const semver = require('semver');

function safeReferenceName(label) {
  return String(label).replace(/[^\w.-]/g, '_');
}

function branchReference(branch, version, sha) {
  if (typeof version !== 'string' || semver.valid(version) !== version) {
    throw new Error(`Version SemVer invalide dans package.json de ${branch} : ${version}`);
  }
  if (branch === 'develop') {
    return { branch, version, sha, kind: 'develop', label: `${version} (develop)` };
  }
  const match = /^(release|hotfix)\/(.+)$/.exec(branch);
  if (!match || semver.valid(match[2]) !== match[2] || match[2] !== version) {
    throw new Error(`Version incohérente pour ${branch} : package.json contient ${version}. La version doit être identique au nom de branche.`);
  }
  const kind = match[1];
  const suffix = kind === 'release' ? 'release candidate' : 'hotfix candidate';
  return { branch, version, sha, kind, label: `${version} (${suffix})` };
}

function inVersionRange(version, minimum, maximum) {
  for (const boundary of [minimum, maximum]) {
    if (boundary && semver.valid(boundary) !== boundary) {
      throw new Error(`Borne SemVer invalide : ${boundary}`);
    }
  }
  return (!minimum || semver.gte(version, minimum)) && (!maximum || semver.lte(version, maximum));
}

function selectReferences(references) {
  const priorities = { tag: 0, release: 1, hotfix: 2, develop: 3 };
  const selected = new Map();
  for (const reference of references) {
    const previous = selected.get(reference.version);
    if (!previous || priorities[reference.kind] < priorities[previous.kind]) {
      selected.set(reference.version, reference);
    }
  }
  return [...selected.values()].sort((a, b) => semver.compare(a.version, b.version));
}

function analysisFileName(repoName, label) {
  return `${repoName}_${safeReferenceName(label)}.json`;
}

function comparisonFileName(repoName, from, to, extension) {
  return `${repoName}_${safeReferenceName(from)}_to_${safeReferenceName(to)}_rapport.${extension}`;
}

// Reconnaître uniquement les noms produits par cet analyseur, y compris les
// anciennes comparaisons dont les libellés de branches n'étaient pas normalisés.
function isGeneratedAnalysisFile(repoName, fileName) {
  const escapedRepo = repoName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const version = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:[+_][0-9A-Za-z.-]+)?';
  const suffix = '(?: \\((?:develop|release candidate|hotfix candidate)\\)|__(?:develop|release_candidate|hotfix_candidate)_)';
  const reference = `${version}(?:${suffix})?`;
  return new RegExp(`^${escapedRepo}_${reference}(?:\\.json|_to_${reference}_rapport\\.(?:json|md))$`).test(fileName);
}

module.exports = {
  safeReferenceName, branchReference, inVersionRange, selectReferences,
  analysisFileName, comparisonFileName, isGeneratedAnalysisFile,
};
