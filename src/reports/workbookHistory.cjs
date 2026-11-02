const changes = { '+': 'added', '~': 'modified', '=': 'unchanged', '-': 'removed', '': 'absent' };

function cellText(cell) {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if (value.error) throw new Error(`Erreur Excel en ${cell.address}`);
  if ('result' in value) return cellText({ value: value.result, address: cell.address });
  if (value.richText) return value.richText.map(part => part.text).join('');
  return value.text ?? '';
}

function workbookHistory(workbook, repository, filename) {
  const sheet = workbook.getWorksheet('Component Comparison');
  if (!sheet) throw new Error('Feuille Component Comparison absente');
  const versions = [];
  let componentColumn;
  sheet.getRow(1).eachCell(cell => {
    const label = cellText(cell).trim();
    if (label === 'Component') componentColumn = cell.col;
    const match = /^(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\s|$)/.exec(label);
    if (match) versions.push({ column: cell.address.replace(/1$/, ''), version: match[1],
      channel: /\(develop\)/i.test(label) ? 'development' : /\(release candidate\)/i.test(label) || /-/.test(match[1]) ? 'prerelease' : 'release',
      sourceLabel: label });
  });
  if (!componentColumn || !versions.length) throw new Error('Colonnes Component ou versions absentes');
  const components = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const name = cellText(row.getCell(componentColumn)).trim();
    if (!name) return;
    let generation = 0, active = false, identity = null;
    const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'component';
    const history = versions.map(({ column, version, channel }) => {
      const cell = sheet.getCell(`${column}${number}`), value = cellText(cell);
      const marker = value.trim()[0] ?? '';
      if (!(marker in changes)) throw new Error(`Marqueur inconnu en ${cell.address} : ${value}`);
      const present = ['+', '~', '='].includes(marker);
      if (present && !active) identity = `${slug}-row-${number}-${++generation}`;
      const entryIdentity = present || marker === '-' ? identity : null;
      active = present;
      if (!present) identity = null;
      const historicalName = /^name: (.+)$/m.exec(value)?.[1] ?? name.replace(/\s*⚠️?\s*$/, '');
      return { version, channel, present, change: changes[marker], identity: entryIdentity, historicalName,
        evidence: [{ cell: cell.address, symbol: name, value }] };
    });
    components.push({ name, selectedExcelRows: [number], history });
  });
  return { schemaVersion: 1, repository, integrationStatus: 'supported',
    source: { workbook: filename, sheet: sheet.name, legend: { ...changes, empty: 'absent', '': undefined } },
    rules: { selection: 'all-source-rows', reappearance: 'new-identity', auditAttribution: 'target-version-and-historical-name',
      unknownAuditVersion: 'unresolved', technicalModification: 'does-not-automatically-invalidate-an-audit' },
    versions, components };
}

module.exports = { workbookHistory };
