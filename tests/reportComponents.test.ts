import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const load = createRequire(__filename);
const { groupReportComponents } = load('../src/reports/reportComponents.cjs');
const { buildComponentHistory } = load('../src/reports/componentHistory.cjs');
const { createVersionReports } = load('../src/reports/versionReports.cjs');
const ExcelJS = load('exceljs');
const component = (name: string, file: string, sourcefile: string, sourceExport: string, contentHash = 'old') =>
    ({ id: `${file}#${name}`, name, file, sourcefile, sourceExport, contentHash });
const snapshot = (version: string, components: ReturnType<typeof component>[]) =>
    ({ reference: { version, label: version, sha: version, kind: 'tag' }, result: { components } });

test('une ligne par symbole, nom métier, tous les alias et barrels, analyses intactes (#16/#17)', () => {
    const raw = [component('Type', 'src/type.js', 'src/type.js', 'Type'),
        component('PersonnePhysiquePhoneType', 'src/index.js', 'src/type.js', 'Type'),
        component('PersonnePhysiquePhoneType', 'src/personne/index.js', 'src/type.js', 'Type'),
        component('format', 'src/type.js', 'src/type.js', 'format')];
    const untouched = JSON.stringify(raw);
    const grouped = groupReportComponents(raw);
    assert.equal(grouped.length, 2);
    const type = grouped.find((item: {sourceExport: string}) => item.sourceExport === 'Type');
    assert.equal(type.name, 'PersonnePhysiquePhoneType');
    assert.deepEqual(type.publicNames, ['PersonnePhysiquePhoneType', 'Type']);
    assert.equal(type.exports.length, 3);
    assert.equal(type.exportFiles.length, 3);
    assert.equal(JSON.stringify(raw), untouched);
    assert.deepEqual(groupReportComponents([...raw].reverse()), grouped);
    const deletion = buildComponentHistory([
        snapshot('1.0.0', grouped), snapshot('1.1.0', []),
    ], [new Map()]);
    assert.equal(deletion.rows.size, 2);
    assert.equal(deletion.maps[1].size, 0);
    assert.equal(groupReportComponents(raw, { 'src/type.js#Type': 'PhoneType' })[0].name, 'PhoneType');
    const ambiguous = groupReportComponents([...raw, component('EntreprisePhoneType', 'src/enterprise.js', 'src/type.js', 'Type')])[0];
    assert.equal(ambiguous.name, 'Type');
    assert.equal(ambiguous.nameSelection, 'ambiguous');
});

test('ActionsMenuSvg : default JS devient nommé TS et deux réexports, une seule histoire (#12)', () => {
    const before = component('ActionsMenuSvg', 'src/menus/index.js', 'src/menus/actionsMenuSvg.js', 'default');
    const after = component('ActionsMenuSvg', 'src/menus/actionsMenuSvg.tsx', 'src/menus/actionsMenuSvg.tsx', 'ActionsMenuSvg', 'new');
    const raw = [snapshot('1.5.4', [before]), snapshot('1.6.0', [after, { ...after, id: 'src/menus/index.ts#ActionsMenuSvg', file: 'src/menus/index.ts' }])];
    const grouped = raw.map(item => ({ ...item, result: { components: groupReportComponents(item.result.components) } }));
    const history = buildComponentHistory(grouped, [new Map()]);
    assert.equal(history.rows.size, 1);
    assert.equal(history.maps[1].size, 1);
    const row = [...history.rows.values()][0];
    assert.equal(row[0].sourceExport, 'default');
    assert.equal(row[1].sourceExport, 'ActionsMenuSvg');
    assert.equal(row[1].exports.length, 2);
    const ambiguous = { ...before, id: 'src/menus/other.js#Other', name: 'Other', file: 'src/menus/other.js' };
    const ambiguousBefore = snapshot('1.5.4', groupReportComponents([before, ambiguous]));
    assert.equal(buildComponentHistory([ambiguousBefore, grouped[1]], [new Map()]).rows.size, 2);
});

test('cardTypes : un seul historique et une seule suppression malgré deux barrels (#16)', () => {
    const source = 'src/cards/cardTypes.js';
    const first = component('cardTypes', 'src/cards/cardTypes/index.js', source, 'default');
    const second = component('cardTypes', 'src/cards/index.js', source, 'default');
    const grouped = [snapshot('0.0.1', groupReportComponents([first, second])),
        snapshot('0.0.2', groupReportComponents([second])), snapshot('0.0.3', [])];
    const history = buildComponentHistory(grouped, [new Map(), new Map()]);
    assert.equal(history.rows.size, 1);
    assert.equal(history.maps[0].size, 1);
    assert.equal(history.maps[1].size, 1);
    assert.equal(history.maps[2].size, 0);
    assert.equal([...history.rows.values()][0][0].exports.length, 2);
    assert.equal([...history.rows.values()][0][1].exports.length, 1);
});

test('refonte : correspondance explicite limitée aux versions, rejet des doublons et cibles absentes (#14/#15)', () => {
    const old = component('AnchorPosition', 'src/dialog/index.js', 'src/dialog/AnchorPosition.js', 'default');
    const next = component('AnchorPosition', 'src/hooks/constants.js', 'src/hooks/constants.js', 'AnchorPosition', 'new');
    const raw = [snapshot('0.3.3', [old]), snapshot('1.0.0', [next])];
    const grouped = raw.map(item => ({ ...item, result: { components: groupReportComponents(item.result.components) } }));
    const mapping = { from: { version: '0.3.3', sourcefile: old.sourcefile, sourceExport: 'default' },
        to: { version: '1.0.0', sourcefile: next.sourcefile, sourceExport: 'AnchorPosition' } };
    assert.equal(buildComponentHistory(grouped, [new Map()]).rows.size, 2);
    const configured = buildComponentHistory(grouped, [new Map()], [mapping]);
    assert.equal(configured.rows.size, 1);
    assert.ok(configured.configuredReviews[1].has('src/dialog/AnchorPosition.js#default'));
    assert.equal(buildComponentHistory(grouped, [new Map()], [{ ...mapping, reviewRequired: false }]).configuredReviews[1].size, 0);
    assert.equal(buildComponentHistory(grouped, [new Map()], [{ ...mapping, from: { ...mapping.from, version: '0.3.2' } }]).rows.size, 2);
    assert.throws(() => buildComponentHistory(grouped, [new Map()], [mapping, mapping]), /dupliquée/);
    assert.throws(() => buildComponentHistory(grouped, [new Map()], [{ ...mapping, to: { ...mapping.to, sourcefile: 'absent.js' } }]), /invalide/);
    assert.throws(() => buildComponentHistory(grouped, [new Map()], [{}]), /requis/);
});

test('rapports : regroupement et marqueur de revue explicite dans JSON, Markdown et Excel', async () => {
    const before = component('AriaLabelOrLabelBy', 'src/internal/accesibilityPropType.js', 'src/internal/accesibilityPropType.js', 'AriaLabelOrLabelBy');
    const after = component('AriaLabelOrLabelBy', 'src/internal/accessibilityPropType.js', 'src/internal/accessibilityPropType.js', 'AriaLabelOrLabelBy', 'new');
    const snapshots = [snapshot('0.0.1', [before]), snapshot('0.0.2', [after])];
    const mapping = { from: { version: '0.0.1', sourcefile: before.sourcefile, sourceExport: before.sourceExport },
        to: { version: '0.0.2', sourcefile: after.sourcefile, sourceExport: after.sourceExport } };
    const outputs = new Map<string, string | Buffer>();
    const reports = createVersionReports({ config: { tmpDir: '.', reportsDir: 'reports', analysisDir: 'analyses', githubBaseUrl: 'https://example.org',
        componentHistoryMappings: { fixture: [mapping] } },
    hasGitDiff: async () => false, logDebug: () => {},
    collectJson: (map: typeof outputs, file: string, value: unknown) => map.set(path.resolve(file), JSON.stringify(value)),
    createHistoryReader: () => ({ files: async (sha: string) => new Set(snapshots.find(item => item.reference.sha === sha)!.result.components.map(item => item.file)),
        renames: async () => new Map() }) });
    await reports.generateReports('fixture', snapshots[0], snapshots[1], outputs, snapshots);
    await reports.generateComponentComparisonReports('fixture', snapshots, outputs);
    const json = JSON.parse([...outputs.entries()].find(([file]) => file.endsWith('.json'))![1].toString());
    assert.equal(json.changed.length, 1);
    assert.equal(json.changed[0].historyMatch, 'configuredMapping');
    assert.equal(json.changed[0].reviewRequired, true);
    const markdown = outputs.get(path.resolve('reports/fixture_component_comparison.md'))!.toString();
    assert.match(markdown, /AriaLabelOrLabelBy ⚠️/);
    assert.match(markdown, /⚠️ À vérifier/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(outputs.get(path.resolve('reports/fixture_component_comparison.xlsx')));
    assert.equal(workbook.getWorksheet('Component Comparison').rowCount, 2);
    assert.equal(workbook.getWorksheet('Historique à vérifier').rowCount, 2);
    assert.equal(workbook.getWorksheet('Export Files').rowCount, 3);
    assert.match(workbook.getWorksheet('Export Files').getCell('E3').value.hyperlink, /blob\/0.0.2\//);
});
