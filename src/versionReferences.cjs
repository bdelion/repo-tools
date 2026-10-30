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
  if (!match) throw new Error(`Branche candidate invalide : ${branch}`);
  const kind = match[1];
  const versionedName = semver.valid(match[2]) === match[2];
  if ((kind === 'release' && !versionedName) || (versionedName && match[2] !== version)) {
    throw new Error(`Version incohérente pour ${branch} : package.json contient ${version}. La version doit être identique au nom de branche.`);
  }
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
  const byVersion = new Map();
  for (const reference of references) {
    if (!byVersion.has(reference.version)) byVersion.set(reference.version, []);
    byVersion.get(reference.version).push(reference);
  }
  const selected = [];
  for (const [version, candidates] of byVersion) {
    const priority = Math.min(...candidates.map(reference => priorities[reference.kind]));
    const preferred = candidates.filter(reference => priorities[reference.kind] === priority);
    if (preferred[0].kind === 'hotfix') {
      const branches = [...new Set(preferred.map(reference => reference.branch))].sort();
      if (branches.length > 1) {
        throw new Error(`Hotfix ambiguës pour la version ${version} : ${branches.join(', ')}. Une seule branche hotfix peut être retenue par version.`);
      }
    }
    selected.push(preferred[0]);
  }
  return selected.sort((a, b) => semver.compare(a.version, b.version));
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
