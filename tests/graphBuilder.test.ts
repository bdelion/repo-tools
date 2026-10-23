import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRecursivedTGF } from '../src/graph/graphBuilder';
import { nodes, nodesFiltered, addNode } from '../src/graph/nodeManager';
import { dependencies, dependenciesFiltered, addDependency } from '../src/graph/dependencyManager';

beforeEach(() => {
    for (const map of [nodes, nodesFiltered, dependencies, dependenciesFiltered]) {
        for (const key of Object.keys(map)) delete map[key];
    }
});

function node(name: string, fileName = `${name}.tsx`) {
    addNode(nodes, name, name, '', fileName);
}

function edge(source: string, target: string) {
    addDependency(dependencies, source, target);
}

test('conserve les deux arêtes d’un cycle', () => {
    node('A'); node('B');
    edge('A', 'B'); edge('B', 'A');
    createRecursivedTGF();
    assert.deepEqual([...dependenciesFiltered.A], ['B']);
    assert.deepEqual([...dependenciesFiltered.B], ['A']);
});

test('conserve une auto-dépendance', () => {
    node('A'); edge('A', 'A');
    createRecursivedTGF();
    assert.deepEqual([...dependenciesFiltered.A], ['A']);
});

test('conserve toutes les arêtes des dépendances partagées', () => {
    for (const name of ['A', 'B', 'C', 'D']) node(name);
    edge('A', 'B'); edge('A', 'C'); edge('B', 'D'); edge('C', 'D');
    createRecursivedTGF();
    assert.deepEqual(new Set(dependenciesFiltered.A), new Set(['B', 'C']));
    assert.deepEqual([...dependenciesFiltered.B], ['D']);
    assert.deepEqual([...dependenciesFiltered.C], ['D']);
});

test('supporte une chaîne de 20 000 nœuds sans saturer la pile', () => {
    const count = 20000;
    for (let i = 0; i < count; i++) {
        node(`N${i}`);
        if (i > 0) edge(`N${i - 1}`, `N${i}`);
    }
    createRecursivedTGF();
    assert.equal(Object.keys(nodesFiltered).length, count);
    assert.equal(Object.keys(dependenciesFiltered).length, count - 1);
    assert.deepEqual([...dependenciesFiltered.N19998], ['N19999']);
});

test('ignore les nœuds exclus et les dépendances inconnues', () => {
    node('A'); node('Test', 'Test.spec.ts'); node('B');
    edge('A', 'Test'); edge('A', 'Unknown'); edge('Test', 'B');
    createRecursivedTGF();
    assert.equal(nodesFiltered.Test, undefined);
    assert.equal(dependenciesFiltered.A, undefined);
});

test('conserve les composants sans dépendance', () => {
    node('Isolated');
    createRecursivedTGF();
    assert.ok(nodesFiltered.Isolated);
});

test('traverse les intermédiaires même cycliques sans arête invalide', () => {
    node('A'); node('B'); node('Bridge', 'bridge.json'); node('Other', 'other.json');
    edge('A', 'Bridge'); edge('Bridge', 'Other');
    edge('Other', 'Bridge'); edge('Other', 'B');
    createRecursivedTGF();
    assert.deepEqual([...dependenciesFiltered.A], ['B']);
    assert.equal(nodesFiltered.Bridge, undefined);
    assert.equal(dependenciesFiltered.Bridge, undefined);
});

test('reconstruit le résultat sans conserver les anciennes données', () => {
    node('A'); node('B'); edge('A', 'B');
    createRecursivedTGF();
    delete nodes.B;
    delete dependencies.A;
    createRecursivedTGF();
    assert.equal(nodesFiltered.B, undefined);
    assert.deepEqual(dependenciesFiltered, {});
    assert.ok(nodesFiltered.A);
});
