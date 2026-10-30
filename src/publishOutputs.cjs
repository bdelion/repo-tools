const fileSystem = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

/** Prépare toutes les écritures, puis publie les fichiers avec restauration sur erreur. */
async function publishOutputs(outputs, obsoleteFiles = [], io = fileSystem) {
  const changes = [];
  const targets = new Set();
  try {
    const planned = [...outputs].map(([target, content]) => ({ target, content }));
    for (const target of obsoleteFiles) planned.push({ target, remove: true });
    for (const change of planned) {
      change.target = path.resolve(change.target);
      if (targets.has(change.target)) throw new Error(`Sortie dupliquée : ${change.target}`);
      targets.add(change.target);
      changes.push(change);
      await io.mkdir(path.dirname(change.target), { recursive: true });
      try {
        const stat = await io.lstat(change.target);
        if (!stat.isFile()) throw new Error(`La sortie doit être un fichier ordinaire : ${change.target}`);
        change.backup = `${change.target}.${randomUUID()}.backup`;
        await io.copyFile(change.target, change.backup);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!change.remove) {
        change.staged = `${change.target}.${randomUUID()}.staged`;
        await io.writeFile(change.staged, change.content);
      }
    }
    for (const change of changes) {
      if (change.remove) {
        if (!change.backup) continue;
        await io.unlink(change.target);
      } else {
        await io.rename(change.staged, change.target);
      }
      change.applied = true;
    }
  } catch (error) {
    const failures = [];
    for (const change of [...changes].reverse()) {
      if (!change.applied) continue;
      try {
        if (change.backup) {
          await io.rename(change.backup, change.target);
          change.backup = null;
        } else {
          await io.unlink(change.target);
        }
      } catch (restoreError) {
        change.keepBackup = true;
        failures.push(restoreError);
      }
    }
    if (failures.length) {
      throw new AggregateError([error, ...failures], 'Publication échouée ; restauration incomplète, sauvegardes conservées.');
    }
    throw error;
  } finally {
    for (const change of changes) {
      for (const file of [change.staged, change.keepBackup ? null : change.backup]) {
        if (file) await io.unlink(file).catch(() => {});
      }
    }
  }
}

module.exports = { publishOutputs };
