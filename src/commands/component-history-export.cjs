const fs = require('node:fs/promises');
const path = require('node:path');
const ExcelJS = require('exceljs');
const YAML = require('yaml');
const { workbookHistory } = require('../reports/workbookHistory.cjs');
const { publishOutputs } = require('../publishOutputs.cjs');

const usage = 'Usage: npm run history:export -- [--reports-dir reports] [--output-dir dossier] [--repo nom]';

async function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--help') { console.log(usage); return; }
    const match = /^(--reports-dir|--output-dir|--repo)(?:=(.*))?$/.exec(argv[index]);
    if (!match) throw new Error(`Option inconnue : ${argv[index]}`);
    const value = match[2] ?? argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Valeur manquante pour ${match[1]}`);
    if (options[match[1]]) throw new Error(`Option répétée : ${match[1]}`);
    options[match[1]] = value;
  }
  const input = path.resolve(options['--reports-dir'] ?? 'reports');
  const output = options['--output-dir'] && path.resolve(options['--output-dir']);
  const outputs = new Map();
  async function visit(directory) {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      const match = /^(.*)_component_comparison\.xlsx$/i.exec(entry.name);
      if (!entry.isFile() || !match || entry.name.startsWith('~$')) continue;
      if (options['--repo'] && options['--repo'] !== match[1]) continue;
      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.readFile(file);
        const history = workbookHistory(workbook, match[1], entry.name);
        const destination = output ? path.join(output, path.relative(input, directory)) : directory;
        outputs.set(path.join(destination, `${match[1]}-historique-composants.yaml`), YAML.stringify(history));
      } catch (error) { throw new Error(`${file} : ${error.message}`); }
    }
  }
  await visit(input);
  if (!outputs.size) throw new Error(`Aucun rapport *_component_comparison.xlsx trouvé dans ${input}`);
  await publishOutputs(outputs);
  for (const target of outputs.keys()) console.log(target);
  console.log(`${outputs.size} historique(s) généré(s).`);
}

main(process.argv.slice(2)).catch(error => { console.error(`${error.message}\n${usage}`); process.exitCode = 1; });
