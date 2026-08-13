import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  probabilidadMejorDeImpar,
  probabilidadSerie,
  formatoDesdeSeriesType,
} from '../motor/series.mjs';

function cerca(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) < epsilon;
}

test('probabilidadMejorDeImpar: Bo1 es simplemente p', () => {
  assert.ok(cerca(probabilidadMejorDeImpar(0.5, 1), 0.5));
  assert.ok(cerca(probabilidadMejorDeImpar(0.7, 1), 0.7));
});

test('probabilidadMejorDeImpar: Bo3 con p=0.5 da 0.5 (simetría)', () => {
  assert.ok(cerca(probabilidadMejorDeImpar(0.5, 3), 0.5));
});

test('probabilidadMejorDeImpar: Bo3 con p=0.6 da 0.648 a mano (fórmula p²(3-2p))', () => {
  assert.ok(cerca(probabilidadMejorDeImpar(0.6, 3), 0.648, 1e-9));
});

test('probabilidadMejorDeImpar: Bo5 con p=0.5 da 0.5 (simetría)', () => {
  assert.ok(cerca(probabilidadMejorDeImpar(0.5, 5), 0.5));
});

test('probabilidadMejorDeImpar: Bo5 con p=0.6 da 0.68256 a mano (p³[1+3(1-p)+6(1-p)²])', () => {
  assert.ok(cerca(probabilidadMejorDeImpar(0.6, 5), 0.68256, 1e-9));
});

test('formatoDesdeSeriesType: mapeo verificado con datos reales de OpenDota', () => {
  assert.equal(formatoDesdeSeriesType(0), 'bo1');
  assert.equal(formatoDesdeSeriesType(3), 'bo2');
  assert.equal(formatoDesdeSeriesType(1), 'bo3');
  assert.equal(formatoDesdeSeriesType(2), 'bo5');
});

test('formatoDesdeSeriesType: series_type desconocido da null, no inventa un formato', () => {
  assert.equal(formatoDesdeSeriesType(99), null);
});

test('probabilidadSerie: bo1 es directo, sin empate', () => {
  const r = probabilidadSerie(0.7, 'bo1');
  assert.ok(cerca(r.ganaA, 0.7));
  assert.equal(r.empate, 0);
  assert.ok(cerca(r.ganaB, 0.3));
});

test('probabilidadSerie: bo2 con p=0.5 da 25/50/25 a mano', () => {
  const r = probabilidadSerie(0.5, 'bo2');
  assert.ok(cerca(r.ganaA, 0.25));
  assert.ok(cerca(r.empate, 0.5));
  assert.ok(cerca(r.ganaB, 0.25));
});

test('probabilidadSerie: bo2 con p=0.7 da 49/42/9 a mano (p², 2p(1-p), (1-p)²)', () => {
  const r = probabilidadSerie(0.7, 'bo2');
  assert.ok(cerca(r.ganaA, 0.49));
  assert.ok(cerca(r.empate, 0.42));
  assert.ok(cerca(r.ganaB, 0.09));
});

test('probabilidadSerie: siempre suma 1, para los cuatro formatos', () => {
  for (const formato of ['bo1', 'bo2', 'bo3', 'bo5']) {
    const r = probabilidadSerie(0.63, formato);
    assert.ok(cerca(r.ganaA + r.empate + r.ganaB, 1, 1e-9), `${formato} no suma 1`);
  }
});

test('probabilidadSerie: formato desconocido revienta en vez de adivinar', () => {
  assert.throws(() => probabilidadSerie(0.5, 'bo7'));
});
