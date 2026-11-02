import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';

const { workbookHistory } = createRequire(__filename)('../src/reports/workbookHistory.cjs');

test('export Excel : colonnes variables, renommage, suppression et nouvelle identité', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Component Comparison');
    sheet.addRow(['Component', 'Source Symbol', '1.0.0 💥', '1.1.0', '1.2.0', '2.0.0 (release candidate)', '2.1.0 (develop)']);
    sheet.addRow(['Button', 'default', '+\nname: OldButton', '-', '', '+', '=']);
    sheet.addRow(['Button', 'default', '', '+', '=', '~\ndiffAST', '=']);
    const result = workbookHistory(workbook, 'library', 'library_component_comparison.xlsx');
    assert.equal(result.versions[0].column, 'C');
    assert.equal(result.versions[3].channel, 'prerelease');
    assert.equal(result.versions[4].channel, 'development');
    const history = result.components[0].history;
    assert.deepEqual(history.map((entry: { present: boolean }) => entry.present), [true, false, false, true, true]);
    assert.equal(history[0].historicalName, 'OldButton');
    assert.equal(history[1].identity, history[0].identity);
    assert.equal(history[2].identity, null);
    assert.notEqual(history[3].identity, history[0].identity);
    assert.equal(history[3].identity, history[4].identity);
    assert.notEqual(result.components[1].history[1].identity, history[0].identity);
    assert.deepEqual(history[0].evidence, [{ cell: 'C2', symbol: 'Button', value: '+\nname: OldButton' }]);
    sheet.getCell('C2').value = '?';
    assert.throws(() => workbookHistory(workbook, 'library', 'file.xlsx'), /C2/);
});
