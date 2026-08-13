import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparPorSerie,
  resultadoDeSerie,
  brierDeSerie,
  claseReal,
  ejecutarBacktest,
} from '../juez/backtest.mjs';
import { aplicarPartida, probabilidadGanar } from '../motor/elo.mjs';

function partida(match_id, start_time, series_id, series_type, radiant_team_id, dire_team_id, radiant_win) {
  return { match_id, start_time, series_id, series_type, radiant_team_id, dire_team_id, radiant_win };
}

test('agruparPorSerie: agrupa por series_id y ordena cada grupo por start_time', () => {
  const partidas = [
    partida(2, 2000, 100, 1, 'A', 'B', true),
    partida(1, 1000, 100, 1, 'A', 'B', false),
    partida(9, 500, 200, 0, 'C', 'D', true),
  ];
  const grupos = agruparPorSerie(partidas);

  assert.equal(grupos.size, 2);
  assert.deepEqual(grupos.get(100).map((p) => p.match_id), [1, 2]);
  assert.deepEqual(grupos.get(200).map((p) => p.match_id), [9]);
});

test('resultadoDeSerie: cuenta victorias por equipo aunque radiant/dire se intercambien entre partidas', () => {
  const juegos = [
    partida(1, 1000, 100, 1, 'A', 'B', true), // A gana
    partida(2, 2000, 100, 1, 'B', 'A', true), // B (ahora radiant) gana
    partida(3, 3000, 100, 1, 'A', 'B', true), // A gana otra vez -> serie 2-1 para A
  ];
  const r = resultadoDeSerie(juegos);

  assert.equal(r.equipoA, 'A');
  assert.equal(r.equipoB, 'B');
  assert.equal(r.victoriasA, 2);
  assert.equal(r.victoriasB, 1);
});

test('resultadoDeSerie: null si falta team_id en alguna partida', () => {
  const juegos = [partida(1, 1000, 100, 1, null, 'B', true)];
  assert.equal(resultadoDeSerie(juegos), null);
});

test('resultadoDeSerie: null si un equipo distinto a A/B aparece en la serie (dato inconsistente)', () => {
  const juegos = [
    partida(1, 1000, 100, 1, 'A', 'B', true),
    partida(2, 2000, 100, 1, 'A', 'C', true), // C no es ni A ni B
  ];
  assert.equal(resultadoDeSerie(juegos), null);
});

test('claseReal: bo3 con más victorias de A da ganaA, sin empate posible', () => {
  assert.equal(claseReal({ victoriasA: 2, victoriasB: 1 }, 'bo3'), 'ganaA');
  assert.equal(claseReal({ victoriasA: 1, victoriasB: 2 }, 'bo3'), 'ganaB');
});

test('claseReal: bo2 con 1-1 da empate; en bo3 un 1-1 sería inconsistente y da null', () => {
  assert.equal(claseReal({ victoriasA: 1, victoriasB: 1 }, 'bo2'), 'empate');
  assert.equal(claseReal({ victoriasA: 1, victoriasB: 1 }, 'bo3'), null);
});

test('brierDeSerie: predicción perfecta da 0', () => {
  const brier = brierDeSerie({ ganaA: 1, empate: 0, ganaB: 0 }, 'ganaA');
  assert.equal(brier, 0);
});

test('brierDeSerie: predicción totalmente errada da 2 (el máximo real)', () => {
  const brier = brierDeSerie({ ganaA: 1, empate: 0, ganaB: 0 }, 'ganaB');
  assert.equal(brier, 2);
});

test('brierDeSerie: bo2 sin información (25/50/25) contra un empate real, a mano', () => {
  const brier = brierDeSerie({ ganaA: 0.25, empate: 0.5, ganaB: 0.25 }, 'empate');
  // (0.25-0)² + (0.5-1)² + (0.25-0)² = 0.0625 + 0.25 + 0.0625 = 0.375
  assert.ok(Math.abs(brier - 0.375) < 1e-9);
});

test('ejecutarBacktest: cero fuga temporal entre series que se juegan en paralelo', () => {
  // Serie 300 (A vs C) arranca en t=1500 y todavía sigue corriendo cuando
  // arranca la serie 200 (C vs D) en t=2000 -- comparten al equipo C. La
  // predicción de la serie 200 solo debe reflejar lo que pasó con C ANTES
  // de t=2000 (la partida de t=1500), nunca lo que pasa después (t=3000).
  const opciones = { ratingInicial: 1500, kFactor: 32, escala: 400 };
  const partidas = [
    partida(1, 1000, 100, 0, 'A', 'B', true), // sube a A antes de que juegue contra C
    partida(2, 1500, 300, 0, 'A', 'C', true), // C pierde contra A -- esto SÍ debe afectar la predicción de la serie 200
    partida(3, 2000, 200, 0, 'C', 'D', false), // serie 200 (bo1): la predicción se toma justo AQUÍ
    partida(4, 3000, 400, 0, 'A', 'D', true), // después de la serie 200 -- NO debe afectar su predicción
  ];

  const resultado = ejecutarBacktest(partidas, opciones);
  const serie200 = resultado.resultados.find((r) => r.seriesId === 200);

  // Replay independiente de las dos únicas partidas anteriores a t=2000
  // (match 1 y match 2), con las mismas funciones del motor, para obtener
  // el rating "correcto" de C y D justo antes de que arranque la serie 200.
  const porEquipo = new Map();
  const partidasJugadas = new Map();
  aplicarPartida(porEquipo, partidasJugadas, partidas[0], opciones);
  aplicarPartida(porEquipo, partidasJugadas, partidas[1], opciones);
  const ratingC = porEquipo.get('C') ?? 1500;
  const ratingD = porEquipo.get('D') ?? 1500;
  const pEsperado = probabilidadGanar(ratingC, ratingD, 400);

  assert.ok(Math.abs(serie200.prediccion.ganaA - pEsperado) < 1e-9);

  // Y la propia prueba de fuga: si el motor hubiera procesado la serie 300
  // completa (incluyendo su eventual partida futura) antes de la 200, el
  // rating de C en ese punto sería otro. Confirmamos que NO es el caso
  // corriendo el backtest con la partida 4 removida -- debe dar exactamente
  // la misma predicción para la serie 200 (esa partida no le toca).
  const sinLaPartidaFutura = ejecutarBacktest(partidas.slice(0, 3), opciones);
  const serie200SinFutura = sinLaPartidaFutura.resultados.find((r) => r.seriesId === 200);
  assert.equal(serie200.prediccion.ganaA, serie200SinFutura.prediccion.ganaA);
});

test('ejecutarBacktest: series con series_type desconocido se saltan sin reventar', () => {
  const partidas = [partida(1, 1000, 100, 99, 'A', 'B', true)];
  const resultado = ejecutarBacktest(partidas);
  assert.equal(resultado.cantidad, 0);
});

test('ejecutarBacktest: reporta cantidad y brier promedio por formato', () => {
  const partidas = [
    partida(1, 1000, 100, 0, 'A', 'B', true), // bo1
    partida(2, 2000, 200, 3, 'C', 'D', true), // bo2, primera partida
    partida(3, 2100, 200, 3, 'D', 'C', false), // bo2, segunda -> C gana la serie 2-0
  ];
  const resultado = ejecutarBacktest(partidas);

  assert.equal(resultado.cantidad, 2);
  assert.equal(resultado.porFormato.bo1.cantidad, 1);
  assert.equal(resultado.porFormato.bo2.cantidad, 1);
  assert.ok(Number.isFinite(resultado.brierPromedio));
});
