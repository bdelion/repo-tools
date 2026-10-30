import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const {
    branchReference, selectReferences, inVersionRange,
    isGeneratedAnalysisFile, analysisFileName, comparisonFileName,
} = createRequire(__filename)('../src/versionReferences.cjs');

test('les branches candidates portent des libellés et versions explicites', () => {
    assert.equal(branchReference('release/1.8.0', '1.8.0', 'sha').label, '1.8.0 (release candidate)');
    assert.equal(branchReference('hotfix/1.7.1', '1.7.1', 'sha').label, '1.7.1 (hotfix candidate)');
    assert.equal(branchReference('develop', '1.9.0', 'sha').label, '1.9.0 (develop)');
    assert.throws(() => branchReference('release/1.8.0', '1.8.1', 'sha'), /incohérente/);
    assert.throws(() => branchReference('hotfix/1.8.0', '1.8.0-rc.1', 'sha'), /incohérente/);
    for (const invalid of [undefined, 'v1.8.0', '1.8', 'latest']) {
        assert.throws(() => branchReference('develop', invalid, 'sha'), /invalide/);
    }
});

test('priorité tag > release > hotfix > develop et tri SemVer', () => {
    const refs = [
        branchReference('develop', '1.10.0', 'd'),
        branchReference('hotfix/1.10.0', '1.10.0', 'h'),
        branchReference('release/1.10.0', '1.10.0', 'r'),
        branchReference('release/1.9.0', '1.9.0', 'r9'),
        branchReference('hotfix/1.8.1', '1.8.1', 'h8'),
        { kind: 'tag', version: '1.9.0', label: '1.9.0', sha: 't' },
        branchReference('release/2.0.0-rc.10', '2.0.0-rc.10', 'r10'),
        branchReference('release/2.0.0-rc.2', '2.0.0-rc.2', 'r2'),
    ];
    const selected = selectReferences(refs);
    assert.deepEqual(selected.map((ref: {label: string}) => ref.label), [
        '1.8.1 (hotfix candidate)', '1.9.0', '1.10.0 (release candidate)',
        '2.0.0-rc.2 (release candidate)', '2.0.0-rc.10 (release candidate)',
    ]);
    assert.equal(selectReferences(refs.slice(0, 2))[0].kind, 'hotfix');
});

test('les hotfix descriptives utilisent la version du package.json (#5)', () => {
    const candidate = branchReference('hotfix/viewbox_svg', '0.14.1', 'sha');
    assert.equal(candidate.version, '0.14.1');
    assert.equal(candidate.branch, 'hotfix/viewbox_svg');
    assert.equal(candidate.label, '0.14.1 (hotfix candidate)');
    assert.equal(branchReference('hotfix/ui/viewbox_svg', '0.14.1', 'sha').kind, 'hotfix');
    assert.throws(() => branchReference('hotfix/0.14.2', '0.14.1', 'sha'), /incohérente/);
    assert.throws(() => branchReference('release/viewbox_svg', '0.14.1', 'sha'), /incohérente/);
    assert.throws(() => branchReference('hotfix/viewbox_svg', 'not-semver', 'sha'), /invalide/);
});

test('plusieurs hotfix pour une même version échouent sauf si un tag ou une release prime (#5)', () => {
    const first = branchReference('hotfix/viewbox_svg', '0.14.1', 'first');
    const second = branchReference('hotfix/other_fix', '0.14.1', 'second');
    assert.throws(() => selectReferences([first, second]), /Hotfix ambiguës.*0\.14\.1.*hotfix\/other_fix.*hotfix\/viewbox_svg/);
    const versioned = branchReference('hotfix/0.14.1', '0.14.1', 'third');
    assert.throws(() => selectReferences([versioned, first]), /Hotfix ambiguës/);
    const release = branchReference('release/0.14.1', '0.14.1', 'release');
    assert.equal(selectReferences([first, second, release])[0].kind, 'release');
    assert.equal(selectReferences([first, second, { version: '0.14.1', kind: 'tag', label: '0.14.1', sha: 'tag' }])[0].kind, 'tag');
});

test('les bornes utilisent SemVer', () => {
    assert.equal(inVersionRange('1.10.0', '1.9.0', '2.0.0'), true);
    assert.equal(inVersionRange('1.8.0', '1.9.0', null), false);
    assert.equal(inVersionRange('2.0.0', null, '1.10.0'), false);
    assert.throws(() => inVersionRange('1.0.0', 'invalide', null));
});

test('le ménage reconnaît les sorties anciennes et nouvelles du seul dépôt concerné', () => {
    for (const file of [
        analysisFileName('ui', '1.8.0 (develop)'),
        analysisFileName('ui', '1.8.0 (release candidate)'),
        analysisFileName('ui', '1.8.1 (hotfix candidate)'),
        comparisonFileName('ui', '1.7.0', '1.8.0 (release candidate)', 'md'),
        'ui_1.7.0_to_1.8.0 (develop)_rapport.json',
        'ui_1.8.0.json',
    ]) assert.equal(isGeneratedAnalysisFile('ui', file), true, file);
    for (const file of ['other_1.8.0.json', 'ui_extra_1.8.0.json', 'ui_notes.md', 'sha_index.json']) {
        assert.equal(isGeneratedAnalysisFile('ui', file), false, file);
    }
    assert.equal(isGeneratedAnalysisFile('ui.tools', 'uiXtools_1.0.0.json'), false);
});
