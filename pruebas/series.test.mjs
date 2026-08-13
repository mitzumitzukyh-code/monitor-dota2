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

test('probabilidadSerie: bo2 con deltaBo2=0 y p=0.5 da 25/50/25 a mano (partidas independientes)', () => {
  const r = probabilidadSerie(0.5, 'bo2', { deltaBo2: 0 });
  assert.ok(cerca(r.ganaA, 0.25));
  assert.ok(cerca(r.empate, 0.5));
  assert.ok(cerca(r.ganaB, 0.25));
});

test('probabilidadSerie: bo2 con deltaBo2=0 y p=0.7 da 49/42/9 a mano (p², 2p(1-p), (1-p)²)', () => {
  const r = probabilidadSerie(0.7, 'bo2', { deltaBo2: 0 });
  assert.ok(cerca(r.ganaA, 0.49));
  assert.ok(cerca(r.empate, 0.42));
  assert.ok(cerca(r.ganaB, 0.09));
});

test('probabilidadSerie: bo2 SIN pasar deltaBo2 usa el DELTA_BO2 calibrado de config.mjs, no 0', () => {
  const r = probabilidadSerie(0.7, 'bo2'); // sin opciones -> default real del proyecto
  const conDeltaCero = probabilidadSerie(0.7, 'bo2', { deltaBo2: 0 });
  assert.notEqual(r.empate, conDeltaCero.empate);
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

test('probabilidadSerie: bo2 con deltaBo2=ln(3) en p=0.5 da 37.5/25/37.5 a mano', () => {
  // logit(0.5)=0, así que pSegundaSiGanoA=sigmoide(ln3)=3/4, pSegundaSiGanoB=sigmoide(-ln3)=1/4.
  // ganaA = 0.5*0.75 = 0.375, ganaB = 0.5*(1-0.25) = 0.375, empate = 0.25.
  const r = probabilidadSerie(0.5, 'bo2', { deltaBo2: Math.log(3) });
  assert.ok(cerca(r.ganaA, 0.375, 1e-9));
  assert.ok(cerca(r.empate, 0.25, 1e-9));
  assert.ok(cerca(r.ganaB, 0.375, 1e-9));
});

test('probabilidadSerie: bo2 con deltaBo2 > 0 siempre reduce el empate frente a deltaBo2=0, sin importar p', () => {
  for (const p of [0.3, 0.45, 0.5, 0.6, 0.8]) {
    const sinAjuste = probabilidadSerie(p, 'bo2', { deltaBo2: 0 });
    const conAjuste = probabilidadSerie(p, 'bo2', { deltaBo2: 1.2 });
    assert.ok(conAjuste.empate < sinAjuste.empate, `p=${p}: empate no bajó`);
  }
});

test('probabilidadSerie: bo2 con deltaBo2 sigue sumando 1', () => {
  const r = probabilidadSerie(0.63, 'bo2', { deltaBo2: 0.8 });
  assert.ok(cerca(r.ganaA + r.empate + r.ganaB, 1, 1e-9));
});
