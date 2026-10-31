const fs = require('node:fs/promises');
const path = require('node:path');
const { publishOutputs } = require('../publishOutputs.cjs');
const { proposeHistoryMappings, mergeProposals, proposalMarkdown } = require('../reports/historyMappingProposals.cjs');

const usage = `Usage: npm run history:propose -- [--config chemin.json] [--repo nom] [--analysis-dir dossier] [--output-dir dossier]
Application explicite : npm run history:propose -- --config chemin.json --apply propositions.json
Sans --apply, la configuration n'est jamais modifiée.`;

async function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--help') { console.log(usage); return; }
    const match = /^(--[^=]+)(?:=(.*))?$/.exec(argv[index]);
    const name = match?.[1];
    if (!['--config', '--repo', '--analysis-dir', '--output-dir', '--apply'].includes(name)) throw new Error(`Option inconnue : ${argv[index]}`);
    const value = match[2] ?? argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Valeur manquante pour ${name}`);
    if (options[name]) throw new Error(`Option répétée : ${name}`);
    options[name] = value;
  }
  const configPath = path.resolve(options['--config'] ?? path.join(__dirname, '../config.analyse-component-versions.json'));
  const readJson = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  const config = await readJson(configPath);
  if (options['--apply']) {
    if (options['--repo'] || options['--analysis-dir'] || options['--output-dir']) throw new Error('--apply accepte uniquement --config');
    const proposals = await readJson(path.resolve(options['--apply']));
    const merged = mergeProposals(config, proposals);
    if (JSON.stringify(merged) === JSON.stringify(config)) { console.log('Aucune nouvelle correspondance.'); return; }
    const backup = `${configPath}.history-backup-${Date.now()}.json`;
    await fs.copyFile(configPath, backup, require('node:fs').constants.COPYFILE_EXCL);
    await publishOutputs(new Map([[configPath, `${JSON.stringify(merged, null, 4)}\n`]]));
    console.log(`Configuration mise à jour. Sauvegarde : ${backup}. Nouvelles correspondances marquées à vérifier.`);
    return;
  }
  const analysisDir = path.resolve(options['--analysis-dir'] ?? config.analysisDir ?? 'analyses');
  const outputDir = path.resolve(options['--output-dir'] ?? path.join(config.reportsDir ?? 'reports', 'component-history-mappings'));
  const comparisons = [];
  for (const name of (await fs.readdir(analysisDir)).filter(name => name.endsWith('_rapport.json')).sort()) {
    const comparison = await readJson(path.join(analysisDir, name));
    if (!comparison.repository || !comparison.from || !comparison.to) throw new Error(`Rapport invalide : ${name}`);
    comparisons.push(comparison);
  }
  if (!comparisons.length) throw new Error(`Aucune comparaison *_rapport.json dans ${analysisDir}. Exécuter analyse-component-versions d'abord.`);
  const result = proposeHistoryMappings(comparisons, config, options['--repo']);
  if (!result.transitions) throw new Error('Aucune comparaison pour les dépôts sélectionnés. Régénérer leurs rapports.');
  const outputs = new Map();
  const json = (file, value) => outputs.set(path.join(outputDir, file), `${JSON.stringify(value, null, 2)}\n`);
  json('component-history-mappings.proposed.json', { componentHistoryMappings: result.componentHistoryMappings });
  json('component-history-mappings.candidates.json', { candidates: result.candidates, diagnostics: result.diagnostics,
    repositoriesWithoutComparisons: result.repositoriesWithoutComparisons });
  for (const [repo, mappings] of Object.entries(result.componentHistoryMappings)) {
    const file = encodeURIComponent(repo);
    json(`${file}.proposed.json`, { componentHistoryMappings: { [repo]: mappings } });
    outputs.set(path.join(outputDir, `${file}.md`), proposalMarkdown(repo, result));
  }
  await publishOutputs(outputs);
  console.log(`${result.candidates.length} candidats, ${Object.values(result.componentHistoryMappings).reduce((count, items) => count + items.length, 0)} propositions à vérifier. Sorties : ${outputDir}`);
}

main(process.argv.slice(2)).catch(error => { console.error(`${error.message}\n${usage}`); process.exitCode = 1; });
