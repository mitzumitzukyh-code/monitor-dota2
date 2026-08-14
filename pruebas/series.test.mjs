import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  probabilidadMejorDeImpar,
  probabilidadSerie,
  formatoDesdeSeriesType,
  distribucionMarcadores,
  probabilidadPartidaDesdeSerie,
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

// --- distribución de marcadores: el equivalente honesto de la matriz de
// marcadores de Dixon-Coles en LaLiga, pero para series de Dota. Cada
// marcador posible del formato con su probabilidad, derivada de p.

test('distribucionMarcadores: bo1 sólo tiene 1–0 y 0–1', () => {
  const d = distribucionMarcadores(0.7, 'bo1');
  assert.deepEqual(d.map((x) => x.marcador), ['1–0', '0–1']);
  assert.ok(cerca(d[0].prob, 0.7));
  assert.ok(cerca(d[1].prob, 0.3));
});

test('distribucionMarcadores: bo3 con p=0.5 da 25/25/25/25 a mano', () => {
  // 2–0 = p² = 0.25 | 2–1 = 2p²(1−p) = 0.25 | 1–2 = 2p(1−p)² = 0.25 | 0–2 = (1−p)² = 0.25
  const d = distribucionMarcadores(0.5, 'bo3');
  assert.deepEqual(d.map((x) => x.marcador), ['2–0', '2–1', '1–2', '0–2']);
  for (const x of d) assert.ok(cerca(x.prob, 0.25), x.marcador + ' dio ' + x.prob);
});

test('distribucionMarcadores: bo3 con p=0.6 verificado a mano', () => {
  // p=0.6: 2–0 = 0.36 | 2–1 = 2(0.36)(0.4) = 0.288 | 1–2 = 2(0.6)(0.16) = 0.192 | 0–2 = 0.16
  const d = distribucionMarcadores(0.6, 'bo3');
  assert.ok(cerca(d[0].prob, 0.36));
  assert.ok(cerca(d[1].prob, 0.288));
  assert.ok(cerca(d[2].prob, 0.192));
  assert.ok(cerca(d[3].prob, 0.16));
});

test('distribucionMarcadores: bo5 con p=0.5 tiene 6 marcadores y suma 1', () => {
  const d = distribucionMarcadores(0.5, 'bo5');
  assert.deepEqual(d.map((x) => x.marcador), ['3–0', '3–1', '3–2', '2–3', '1–3', '0–3']);
  assert.ok(cerca(d.reduce((s, x) => s + x.prob, 0), 1));
});

test('distribucionMarcadores: bo2 incluye el 1–1 y suma 1', () => {
  const d = distribucionMarcadores(0.5, 'bo2');
  assert.deepEqual(d.map((x) => x.marcador), ['2–0', '1–1', '0–2']);
  assert.ok(cerca(d.reduce((s, x) => s + x.prob, 0), 1));
});

test('distribucionMarcadores: siempre suma 1 y es consistente con probabilidadSerie', () => {
  for (const formato of ['bo1', 'bo2', 'bo3', 'bo5']) {
    for (const p of [0.2, 0.5, 0.73]) {
      const d = distribucionMarcadores(p, formato);
      assert.ok(cerca(d.reduce((s, x) => s + x.prob, 0), 1, 1e-9), formato + ' p=' + p + ' no suma 1');

      // La suma de los marcadores que gana A tiene que dar exactamente el
      // ganaA de probabilidadSerie -- si no, las dos vistas se contradicen.
      const serie = probabilidadSerie(p, formato);
      const sumaA = d.filter((x) => x.gana === 'A').reduce((s, x) => s + x.prob, 0);
      assert.ok(cerca(sumaA, serie.ganaA, 1e-9), formato + ' p=' + p + ': marcadores de A suman ' + sumaA + ' pero probabilidadSerie dice ' + serie.ganaA);
    }
  }
});

test('distribucionMarcadores: formato desconocido revienta en vez de adivinar', () => {
  assert.throws(() => distribucionMarcadores(0.5, 'bo9'));
});

// --- inversión: recuperar la p de partida desde la probabilidad de serie
// ya guardada, para que la ficha muestre marcadores consistentes con lo
// que de verdad se predijo (y no con un recálculo que puede haber
// cambiado si el histórico creció).

test('probabilidadPartidaDesdeSerie: invierte bo3 correctamente (ida y vuelta)', () => {
  for (const p of [0.12, 0.35, 0.5, 0.68, 0.91]) {
    const serie = probabilidadSerie(p, 'bo3');
    const recuperada = probabilidadPartidaDesdeSerie(serie.ganaA, 'bo3');
    assert.ok(cerca(recuperada, p, 1e-6), 'p=' + p + ' recuperó ' + recuperada);
  }
});

test('probabilidadPartidaDesdeSerie: invierte bo1 y bo5 (ida y vuelta)', () => {
  for (const formato of ['bo1', 'bo5']) {
    for (const p of [0.25, 0.5, 0.8]) {
      const serie = probabilidadSerie(p, formato);
      const recuperada = probabilidadPartidaDesdeSerie(serie.ganaA, formato);
      assert.ok(cerca(recuperada, p, 1e-6), formato + ' p=' + p + ' recuperó ' + recuperada);
    }
  }
});
