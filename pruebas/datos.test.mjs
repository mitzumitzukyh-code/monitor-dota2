import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_INGENUA,
  nombresDeEquipo,
  enriquecerSeries,
  intervaloMedia,
  calidad,
  marcadoresDeSerie,
} from '../salida/web/datos.mjs';

// --- base ingenua --------------------------------------------------------

// bo1/bo3/bo5 se deciden entre dos clases; bo2 admite empate real y son tres.
// Está en CLAUDE.md y es la razón por la que los Brier de bo2 no se comparan
// con los otros sin decir contra qué base van.
test('la base de bo2 es 2/3 y la de los demás 1/2', () => {
  assert.equal(BASE_INGENUA.bo1, 0.5);
  assert.equal(BASE_INGENUA.bo3, 0.5);
  assert.equal(BASE_INGENUA.bo5, 0.5);
  assert.ok(Math.abs(BASE_INGENUA.bo2 - 2 / 3) < 1e-12);
});

// --- nombres -------------------------------------------------------------

const PARTIDAS = [
  { match_id: 1, start_time: 100, radiant_team_id: 7, radiant_name: 'Los Viejos', dire_team_id: 9, dire_name: 'Nueve' },
  { match_id: 2, start_time: 200, radiant_team_id: 7, radiant_name: 'Los Nuevos', dire_team_id: 9, dire_name: 'Nueve' },
];

test('gana el nombre más reciente cuando un equipo se renombra', () => {
  const n = nombresDeEquipo(PARTIDAS);
  assert.equal(n.get(7), 'Los Nuevos');
  assert.equal(n.get(9), 'Nueve');
});

test('el orden de entrada no cambia el resultado', () => {
  const n = nombresDeEquipo(PARTIDAS.slice().reverse());
  assert.equal(n.get(7), 'Los Nuevos');
});

// --- enriquecer ----------------------------------------------------------

const CRUDAS = [
  {
    seriesId: 1, formato: 'bo3', equipoA: 7, equipoB: 9,
    prediccion: { ganaA: 0.7, empate: 0, ganaB: 0.3 },
    real: 'ganaA', brier: 0.18, ratingA: 1600, ratingB: 1400,
    startTime: 200, leagueid: 42, leagueName: 'Torneo Real',
  },
  {
    seriesId: 2, formato: 'bo2', equipoA: 9, equipoB: 7,
    prediccion: { ganaA: 0.25, empate: 0.5, ganaB: 0.25 },
    real: 'ganaB', brier: 0.9, ratingA: 1400, ratingB: 1600,
    startTime: 300, leagueid: 42, leagueName: 'Torneo Real',
  },
];

test('el favorito es la clase de mayor probabilidad, y acerto la compara con la real', () => {
  const [a, b] = enriquecerSeries(CRUDAS, PARTIDAS);
  assert.equal(a.favorito, 'ganaA');
  assert.equal(a.acerto, true);
  assert.equal(b.favorito, 'empate'); // 0.5 le gana a los dos 0.25
  assert.equal(b.acerto, false);
});

test('contraBase resta la base del formato, no una base única', () => {
  const [a, b] = enriquecerSeries(CRUDAS, PARTIDAS);
  assert.ok(Math.abs(a.contraBase - (0.18 - 0.5)) < 1e-12);
  assert.ok(Math.abs(b.contraBase - (0.9 - 2 / 3)) < 1e-12);
});

test('enriquecer resuelve el nombre de cada equipo y no toca ningún número', () => {
  const [a] = enriquecerSeries(CRUDAS, PARTIDAS);
  assert.equal(a.nombreA, 'Los Nuevos');
  assert.equal(a.nombreB, 'Nueve');
  assert.equal(a.brier, 0.18);
  assert.equal(a.prediccion.ganaA, 0.7);
});

test('un equipo sin nombre en el histórico sale con su id, no en blanco', () => {
  const [a] = enriquecerSeries([{ ...CRUDAS[0], equipoA: 999 }], PARTIDAS);
  assert.equal(a.nombreA, '#999');
});

// --- intervalo -----------------------------------------------------------

// Cuatro valores: 1, 2, 3, 4. Media 2.5. Varianza muestral
// ((1.5)²+(0.5)²+(0.5)²+(1.5)²)/3 = 5/3. Error estándar = sqrt((5/3)/4).
test('intervaloMedia calcula la media y el margen a mano', () => {
  const r = intervaloMedia([1, 2, 3, 4], 99);
  assert.ok(Math.abs(r.media - 2.5) < 1e-12);
  const margen = 1.96 * Math.sqrt(5 / 3 / 4);
  assert.ok(Math.abs(r.alto - (2.5 + margen)) < 1e-12);
  assert.ok(Math.abs(r.bajo - (2.5 - margen)) < 1e-12);
  assert.equal(r.n, 4);
});

test('concluyente sólo si el intervalo ENTERO queda por debajo de la base', () => {
  assert.equal(intervaloMedia([1, 2, 3, 4], 99).concluyente, true);
  // Con la base dentro del intervalo, no se concluye nada.
  assert.equal(intervaloMedia([1, 2, 3, 4], 2.5).concluyente, false);
});

test('con una sola muestra no hay intervalo y nunca es concluyente', () => {
  const r = intervaloMedia([0.1], 0.5);
  assert.equal(r.concluyente, false);
  assert.ok(Number.isNaN(r.bajo));
});

// --- calidad -------------------------------------------------------------

test('calidad separa por formato y cada uno lleva su propia base', () => {
  const c = calidad(enriquecerSeries(CRUDAS, PARTIDAS));
  assert.equal(c.porFormato.bo3.cantidad, 1);
  assert.equal(c.porFormato.bo3.base, 0.5);
  assert.ok(Math.abs(c.porFormato.bo2.base - 2 / 3) < 1e-12);
});

test('la base global se pondera por formato, no es 0.5 fija', () => {
  const c = calidad(enriquecerSeries(CRUDAS, PARTIDAS));
  // Una serie bo3 (0.5) y una bo2 (2/3): el promedio es 7/12.
  assert.ok(Math.abs(c.global.base - (0.5 + 2 / 3) / 2) < 1e-12);
});

test('el acierto global cuenta las series donde el favorito ganó', () => {
  const c = calidad(enriquecerSeries(CRUDAS, PARTIDAS));
  assert.equal(c.global.aciertos, 1);
  assert.equal(c.global.cantidad, 2);
  assert.equal(c.global.acierto, 0.5);
});

test('un formato sin series no aparece en la tabla en vez de salir con NaN', () => {
  const c = calidad(enriquecerSeries([CRUDAS[0]], PARTIDAS));
  assert.ok(c.porFormato.bo3);
  assert.equal(c.porFormato.bo1, undefined);
  assert.equal(c.porFormato.bo5, undefined);
});

// --- marcadores ----------------------------------------------------------

test('los marcadores suman 1: es la misma cuenta que la probabilidad, desagregada', () => {
  const m = marcadoresDeSerie(CRUDAS[0]);
  const suma = m.reduce((s, x) => s + x.prob, 0);
  assert.ok(Math.abs(suma - 1) < 1e-9);
});

test('un bo3 tiene cuatro marcadores posibles y ninguno es empate', () => {
  const m = marcadoresDeSerie(CRUDAS[0]);
  assert.equal(m.length, 4);
  assert.equal(m.filter((x) => x.gana === 'empate').length, 0);
});

test('un bo2 sí tiene empate, y es el 1–1', () => {
  const m = marcadoresDeSerie(CRUDAS[1]);
  const empate = m.find((x) => x.gana === 'empate');
  assert.ok(empate);
  assert.equal(empate.marcador, '1–1');
});

test('esReal marca la clase que ganó, no un marcador exacto inventado', () => {
  const m = marcadoresDeSerie(CRUDAS[0]); // real: ganaA
  assert.ok(m.filter((x) => x.esReal).every((x) => x.gana === 'A'));
  assert.ok(m.some((x) => x.esReal));
});

test('con los ratings al revés, la probabilidad se invierte', () => {
  const derecho = marcadoresDeSerie(CRUDAS[0]);
  const alReves = marcadoresDeSerie({ ...CRUDAS[0], ratingA: 1400, ratingB: 1600 });
  const ganaA = (l) => l.filter((x) => x.gana === 'A').reduce((s, x) => s + x.prob, 0);
  assert.ok(ganaA(derecho) > 0.5);
  assert.ok(ganaA(alReves) < 0.5);
  assert.ok(Math.abs(ganaA(derecho) + ganaA(alReves) - 1) < 1e-9);
});
