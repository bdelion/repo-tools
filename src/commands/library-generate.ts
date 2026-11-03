import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { analyzeLibrary, LibraryOptions, LibraryResult, LibraryView, selectLibrary } from '../graph/libraryAnalysis';
import { SCAN_PATH, OUTPUT_TGF_PATH } from '../config';
import { libraryDisplayName } from '../graph/naturalOrder';

export const libraryHelp = `Usage : npm run generate-component-dependency-graph -- [options]
  --view public-ui|public-api|dependencies   Vue (défaut : public-ui)
  --source dossier                        Sources locales (défaut : src/config.ts)
  --entry fichier                         Entrée publique relative aux sources, répétable
  --external                              Inclure les packages externes (vue dependencies)
  --output fichier.tgf                    Destination du graphe et des rapports associés
  --config fichier.json                   Valeurs par défaut réutilisables
  --ui-include nom                         Classer explicitement un export UI, répétable
  --ui-exclude nom                         Exclure un export UI, répétable
  --help                                  Afficher cette aide

Chaque génération produit TGF, catalogue JSON/Markdown, analyse complète JSON,
résumé JSON et plan de traitement JSON. Les autres vues utilisent un suffixe
distinct par défaut. --detailed reste disponible pour l'ancien graphe de réexports.

Exemple : npm run graph:generate -- --source ../ma-lib/src --entry index.ts --view public-ui
Impact : npm run graph:impact -- chemin.analysis.json Button
Prérequis : npm run graph:required -- --analysis chemin.analysis.json Button`;

export function parseLibraryArgs(argv: string[]): { options: LibraryOptions; output: string } {
    const values: Record<string, string[]> = {};
    let external = false;
    for (let i = 0; i < argv.length; i++) {
        const [name, inline] = argv[i].split(/=(.*)/s);
        if (name === '--external') {
            if (inline !== undefined || external) throw new Error('Option --external invalide ou répétée.');
            external = true; continue;
        }
        if (!['--view', '--source', '--entry', '--output', '--config', '--ui-include', '--ui-exclude'].includes(name)) throw new Error(`Option inconnue : ${argv[i]}`);
        const value = inline ?? argv[++i];
        if (!value || value.startsWith('--')) throw new Error(`Valeur manquante : ${name}`);
        if (values[name] && !['--entry', '--ui-include', '--ui-exclude'].includes(name)) throw new Error(`Option répétée : ${name}`);
        (values[name] ??= []).push(value);
    }
    const configFile = values['--config']?.[0];
    const config: Partial<LibraryOptions> & { output?: string } = configFile ? JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')) : {};
    for (const key of Object.keys(config)) if (!['source', 'entries', 'view', 'external', 'output', 'uiInclude', 'uiExclude'].includes(key)) throw new Error(`Paramètre de configuration inconnu : ${key}`);
    const configDirectory = configFile ? path.dirname(path.resolve(configFile)) : process.cwd();
    const view = values['--view']?.[0] ?? config.view ?? 'public-ui';
    if (!['public-ui', 'public-api', 'dependencies'].includes(view)) throw new Error(`Vue inconnue : ${view}`);
    if (config.external !== undefined && typeof config.external !== 'boolean') throw new Error('external doit être un booléen.');
    for (const key of ['entries', 'uiInclude', 'uiExclude'] as const) {
        if (config[key] !== undefined && (!Array.isArray(config[key]) || config[key]!.some(value => typeof value !== 'string' || !value))) throw new Error(`${key} doit être une liste de chaînes non vides.`);
    }
    const includeExternal = external || config.external === true;
    if (includeExternal && view !== 'dependencies') throw new Error('--external concerne uniquement la vue dependencies.');
    const source = values['--source']?.[0] ? path.resolve(values['--source'][0])
        : config.source ? path.resolve(configDirectory, config.source) : path.resolve(SCAN_PATH);
    const suffix = view === 'public-ui' ? '' : `.${view}${includeExternal ? '.external' : ''}`;
    const defaultOutput = OUTPUT_TGF_PATH.replace(/\.tgf$/i, '') + suffix + '.tgf';
    const output = values['--output']?.[0] ? path.resolve(values['--output'][0])
        : config.output ? path.resolve(configDirectory, config.output) : path.resolve(defaultOutput);
    if (!/\.tgf$/i.test(output)) throw new Error('--output doit désigner un fichier .tgf.');
    return { options: { source, view: view as LibraryView, external: includeExternal,
        entries: values['--entry'] ?? config.entries,
        uiInclude: values['--ui-include'] ?? config.uiInclude,
        uiExclude: values['--ui-exclude'] ?? config.uiExclude }, output };
}

export function libraryArtifacts(result: LibraryResult, output: string): Map<string, string> {
    const stem = output.replace(/\.tgf$/i, '');
    const fingerprint = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    const label = libraryDisplayName;
    const lines = result.nodes.map(node => `${node.id} ${label(node)} ${node.path || node.package || ''}`);
    const edges = [...new Set(result.edges.map(edge => `${edge.source} ${edge.target}`))];
    const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
    const escape = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const markdown = [
        `# Catalogue ${result.view}`, '',
        `Sources : ${result.source}`, `Entrées : ${result.entries.join(', ') || '(aucune)'}`, '',
        '| Nom | Nature | Source | Noms publics | Identifiant |', '| --- | --- | --- | --- | --- |',
        ...result.nodes.map(node => `| ${[label(node), node.kind, node.path, node.publicNames.join(', '), node.id].map(escape).join(' | ')} |`),
        '', '## Diagnostics et limites', '', ...result.diagnostics.map(message => `- ${message}`), '',
        'Les dépendances internes masquées dans cette vue sont conservées dans le fichier .analysis.json.', '',
    ].join('\n');
    return new Map([
        [output, [...lines, '#', ...edges].join('\n') + '\n'],
        [`${stem}.catalog.json`, json({ schemaVersion: 1, fingerprint, view: result.view, entries: result.entries, nodes: result.nodes,
            metrics: result.metrics.filter(metric => result.nodes.some(node => node.id === metric.id)),
            exports: result.exports.filter(exp => result.nodes.some(node => node.id === exp.id)) })],
        [`${stem}.catalog.md`, markdown],
        [`${stem}.analysis.json`, json({ ...result, fingerprint })],
        [`${stem}.summary.json`, json({ schemaVersion: 1, fingerprint, view: result.view, source: result.source, entries: result.entries,
            visibleNodes: result.nodes.length, visibleEdges: edges.length, analysisNodes: result.analysis.nodes.length,
            publicExports: result.exports.length, cyclicGroups: result.cyclicGroups.length, diagnostics: result.diagnostics })],
        [`${stem}.plan.json`, json({ schemaVersion: 1, fingerprint,
            rule: 'Ordre croissant des niveaux ; les membres d’un cycle sont à traiter ensemble. Les packages externes sont des prérequis, pas des travaux internes.',
            levels: result.levels, cyclicGroups: result.cyclicGroups,
            externalPrerequisites: result.analysis.nodes.filter(node => node.kind === 'external').map(node => node.id) })],
    ]);
}

export async function runLibraryGeneration(argv: string[]): Promise<void> {
    if (argv.includes('--help')) { console.log(libraryHelp); return; }
    const { options, output } = parseLibraryArgs(argv);
    const result = analyzeLibrary(options);
    const artifacts = libraryArtifacts(result, output);
    const { publishOutputs }: { publishOutputs(outputs: Map<string, string>): Promise<void> } = createRequire(__filename)('../publishOutputs.cjs');
    await publishOutputs(artifacts);
    console.log(`Vue ${result.view} : ${result.nodes.length} éléments, ${result.edges.length} relations. Analyse interne : ${result.analysis.nodes.length} éléments.`);
    for (const file of artifacts.keys()) console.log(file);
    for (const diagnostic of result.diagnostics) console.log(`Information : ${diagnostic}`);
}

export async function runLibrarySelection(argv: string[], direction: 'required' | 'impact'): Promise<void> {
    if (argv.includes('--help')) {
        console.log(`Usage : ${direction === 'required' ? 'graph:required -- --analysis' : 'graph:impact --'} fichier.analysis.json NomOuIdentifiant... [--output rapport.json]`);
        return;
    }
    const [file, ...rest] = argv;
    const position = rest.indexOf('--output');
    const names = position < 0 ? rest : rest.slice(0, position);
    const output = position < 0 ? undefined : rest[position + 1];
    if (!file || !names.length || names.some(name => name.startsWith('--')) || (position >= 0 && (!output || position + 2 !== rest.length))) throw new Error('Indiquer un fichier .analysis.json, des noms/identifiants et éventuellement --output rapport.json.');
    const result: LibraryResult = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (result.schemaVersion !== 1 || !Array.isArray(result.analysis?.nodes) || !Array.isArray(result.analysis?.edges)) throw new Error('Analyse incompatible. Régénérer le graphe avec une vue public-ui, public-api ou dependencies.');
    const selection = selectLibrary(result, names, direction);
    const content = JSON.stringify(selection, null, 2) + '\n';
    if (output) {
        const { publishOutputs }: { publishOutputs(outputs: Map<string, string>): Promise<void> } = createRequire(__filename)('../publishOutputs.cjs');
        await publishOutputs(new Map([[path.resolve(output), content]]));
        console.log(path.resolve(output));
    } else console.log(content);
}
