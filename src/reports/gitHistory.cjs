const { simpleGit } = require('simple-git');

function createGitHistoryReader(directory) {
  const git = simpleGit(directory);
  const trees = new Map();
  const renameCache = new Map();
  return {
    files(sha) {
      if (!trees.has(sha)) {
        trees.set(sha, git.raw(['ls-tree', '-r', '--name-only', '-z', sha])
          .then(output => new Set(output.split('\0').filter(Boolean))));
      }
      return trees.get(sha);
    },
    renames(from, to) {
      const key = `${from}:${to}`;
      if (!renameCache.has(key)) {
        renameCache.set(key, git.raw(['diff', '--name-status', '-z', '--find-renames=50%', '--diff-filter=R', from, to, '--'])
          .then(output => {
            const fields = output.split('\0');
            const renames = new Map();
            for (let index = 0; index < fields.length && fields[index]; index += 3) {
              if (!/^R\d+$/.test(fields[index]) || !fields[index + 1] || !fields[index + 2]) {
                throw new Error('Réponse Git invalide lors de la détection des renommages');
              }
              renames.set(fields[index + 1], fields[index + 2]);
            }
            return renames;
          }));
      }
      return renameCache.get(key);
    },
  };
}

module.exports = { createGitHistoryReader };
