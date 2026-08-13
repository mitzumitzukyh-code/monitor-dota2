import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probabilidadGanar, ratings, ratingDeEquipo } from '../motor/elo.mjs';

function partida(match_id, start_time, radiant_team_id, dire_team_id, radiant_win) {
  return { match_id, start_time, radiant_team_id, dire_team_id, radiant_win };
}

test('probabilidadGanar: ratings iguales da 50/50', () => {
  assert.equal(probabilidadGanar(1500, 1500), 0.5);
});

test('probabilidadGanar: 200 puntos de diferencia da ~0.7597 a mano (fórmula clásica de Elo)', () => {
  const p = probabilidadGanar(1600, 1400, 400);
  assert.ok(Math.abs(p - 0.759746928) < 1e-6, `esperaba ~0.759746928, dio ${p}`);
});

test('probabilidadGanar: es simétrica (P(A) + P(B) = 1)', () => {
  const pa = probabilidadGanar(1550, 1480, 400);
  const pb = probabilidadGanar(1480, 1550, 400);
  assert.ok(Math.abs(pa + pb - 1) < 1e-12);
});

test('ratings: una sola partida, ratings iniciales iguales -> 1516/1484 a mano (K=32)', () => {
  const partidas = [partida(1, 1000, 'A', 'B', true)];
  const r = ratings(partidas, 2000, { ratingInicial: 1500, kFactor: 32, escala: 400 });

  assert.equal(ratingDeEquipo(r, 'A'), 1516);
  assert.equal(ratingDeEquipo(r, 'B'), 1484);
});

test('ratings: cero fuga temporal -- una partida en fechaCorte o después no se cuenta', () => {
  const partidas = [
    partida(1, 1000, 'A', 'B', true), // antes del corte: sí cuenta
    partida(2, 2000, 'A', 'B', true), // justo en el corte: NO debe contar
    partida(3, 3000, 'A', 'B', true), // después del corte: NO debe contar
  ];
  const r = ratings(partidas, 2000, { ratingInicial: 1500, kFactor: 32, escala: 400 });

  // Si solo contó la partida 1, A quedó en 1516 (mismo cálculo que el test anterior)
  assert.equal(ratingDeEquipo(r, 'A'), 1516);
  assert.equal(ratingDeEquipo(r, 'B'), 1484);
});

test('ratings: el orden de las partidas en el arreglo no importa, se procesan por start_time', () => {
  // B le gana a A primero (sube B), luego A le gana a B (sube A) -- puesto en
  // el arreglo en orden invertido a como pasó en el tiempo real.
  const partidas = [
    partida(2, 2000, 'A', 'B', true),
    partida(1, 1000, 'A', 'B', false),
  ];
  const enOrden = ratings([partidas[1], partidas[0]], 3000);
  const desordenado = ratings(partidas, 3000);

  assert.equal(ratingDeEquipo(desordenado, 'A'), ratingDeEquipo(enOrden, 'A'));
  assert.equal(ratingDeEquipo(desordenado, 'B'), ratingDeEquipo(enOrden, 'B'));
});

test('ratings: partidas sin team_id en algún lado se saltan sin reventar ni afectar al otro equipo', () => {
  const partidas = [
    partida(1, 1000, null, 'B', true),
    partida(2, 1500, 'A', 'B', true),
  ];
  const r = ratings(partidas, 2000, { ratingInicial: 1500, kFactor: 32, escala: 400 });

  // Solo la partida 2 debió contar: A gana como nuevo (1500) contra B ya afectado por nada más
  assert.equal(ratingDeEquipo(r, 'A'), 1516);
});

test('ratingDeEquipo: un equipo que nunca jugó antes del corte da el rating inicial, sin ventaja ni desventaja', () => {
  const r = ratings([partida(1, 1000, 'A', 'B', true)], 2000, { ratingInicial: 1500 });
  assert.equal(ratingDeEquipo(r, 'EQUIPO_NUEVO'), 1500);
});
