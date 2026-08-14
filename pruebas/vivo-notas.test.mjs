import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultadoDelPar, claseReal, actualizarNotas } from '../juez/vivo-notas.mjs';

process.env.SUPABASE_URL ??= 'https://prueba.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'llave-de-prueba';

function juego(radiant_team_id, dire_team_id, radiant_win, start_time = 1000) {
  return { radiant_team_id, dire_team_id, radiant_win, start_time };
}

function respuestaFetch(json) {
  return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
}

test('resultadoDelPar: cuenta victorias sin importar quién jugó de radiant/dire', () => {
  const partidasLiga = [
    juego('A', 'B', true), // A gana
    juego('B', 'A', true), // B (radiant esta vez) gana
    juego('A', 'B', true), // A gana otra vez -> 2-1 para A
  ];
  const r = resultadoDelPar(partidasLiga, 'A', 'B');
  assert.deepEqual(r, { victoriasA: 2, victoriasB: 1 });
});

test('resultadoDelPar: null si el par de equipos no aparece todavía', () => {
  const partidasLiga = [juego('X', 'Y', true)];
  assert.equal(resultadoDelPar(partidasLiga, 'A', 'B'), null);
});

test('resultadoDelPar: ignora partidas de otros equipos mezcladas en la misma liga', () => {
  const partidasLiga = [juego('A', 'B', true), juego('X', 'Y', true), juego('A', 'B', true)];
  const r = resultadoDelPar(partidasLiga, 'A', 'B');
  assert.deepEqual(r, { victoriasA: 2, victoriasB: 0 });
});

// Bug real encontrado en revisión (2026-08-14): sin acotar por ventana
// temporal, una revancha del mismo par en otra serie (grupo y luego
// playoffs de TI) se sumaba a la serie anterior como si fuera una sola.
test('resultadoDelPar: NO mezcla una revancha posterior del mismo par (series distintas)', () => {
  const HORA = 3600;
  const partidasLiga = [
    // Serie de fase de grupos: A gana 2-0, arranca en t=1000
    juego('A', 'B', true, 1000),
    juego('B', 'A', false, 1000 + 2400),
    // Revancha en playoffs, DÍAS después: B gana 2-0
    juego('A', 'B', false, 1000 + 72 * HORA),
    juego('B', 'A', true, 1000 + 72 * HORA + 2400),
  ];

  const grupos = resultadoDelPar(partidasLiga, 'A', 'B', { desdeTimestamp: 1000, victoriasNecesarias: 2 });
  assert.deepEqual(grupos, { victoriasA: 2, victoriasB: 0 }, 'la serie de grupos debe ser 2-0 para A, sin contar la revancha');

  const playoffs = resultadoDelPar(partidasLiga, 'A', 'B', { desdeTimestamp: 1000 + 72 * HORA, victoriasNecesarias: 2 });
  assert.deepEqual(playoffs, { victoriasA: 0, victoriasB: 2 }, 'la revancha debe ser 2-0 para B, sin contar la de grupos');
});

test('resultadoDelPar: corta al decidirse la serie, no cuenta partidas de más', () => {
  const partidasLiga = [
    juego('A', 'B', true, 1000),
    juego('A', 'B', true, 2000), // aquí ya se decidió 2-0 en bo3
    juego('A', 'B', false, 3000), // ruido: no debería contarse
  ];
  const r = resultadoDelPar(partidasLiga, 'A', 'B', { desdeTimestamp: 1000, victoriasNecesarias: 2 });
  assert.deepEqual(r, { victoriasA: 2, victoriasB: 0 });
});

test('resultadoDelPar: tolera que la serie arranque ANTES de la hora programada (pasa de verdad)', () => {
  // Real: LGD vs Nigma estaba programada 05:00 y arrancó 04:11 (49 min antes).
  const programado = 10000;
  const partidasLiga = [juego('A', 'B', true, programado - 49 * 60), juego('A', 'B', true, programado + 600)];
  const r = resultadoDelPar(partidasLiga, 'A', 'B', { desdeTimestamp: programado, victoriasNecesarias: 2 });
  assert.deepEqual(r, { victoriasA: 2, victoriasB: 0 });
});

test('resultadoDelPar: sin desdeTimestamp mantiene el comportamiento viejo (cuenta todo el par)', () => {
  const partidasLiga = [juego('A', 'B', true, 1000), juego('B', 'A', true, 2000)];
  const r = resultadoDelPar(partidasLiga, 'A', 'B');
  assert.deepEqual(r, { victoriasA: 1, victoriasB: 1 });
});

test('claseReal: bo3 se decide con 2 victorias, no antes', () => {
  assert.equal(claseReal({ victoriasA: 1, victoriasB: 0 }, 'bo3'), null); // todavía abierta
  assert.equal(claseReal({ victoriasA: 2, victoriasB: 0 }, 'bo3'), 'ganaA');
  assert.equal(claseReal({ victoriasA: 1, victoriasB: 2 }, 'bo3'), 'ganaB');
});

test('claseReal: bo2 con 1-1 da empate; bo1 se decide con 1 sola victoria', () => {
  assert.equal(claseReal({ victoriasA: 1, victoriasB: 1 }, 'bo2'), 'empate');
  assert.equal(claseReal({ victoriasA: 1, victoriasB: 0 }, 'bo1'), 'ganaA');
});

test('actualizarNotas: sin series pendientes, no llama a OpenDota', async () => {
  let seLlamoOpenDota = false;
  const fetchImpl = async () => {
    seLlamoOpenDota = true;
    return respuestaFetch([]);
  };
  const fetchImplSupabase = async () => respuestaFetch([]); // dota_series vacío

  const r = await actualizarNotas({ fetchImpl, fetchImplSupabase });

  assert.equal(r.actualizadas, 0);
  assert.equal(seLlamoOpenDota, false);
});

test('actualizarNotas: califica una serie decidida y deja intacta una que todavía sigue abierta', async () => {
  const pendientes = [
    { series_id: 's1', league_id: 19719, league_name: 'TI 2026', formato: 'bo3', equipo_a: 111, equipo_b: 222, start_time: '2026-08-14T00:00:00Z' },
    { series_id: 's2', league_id: 19719, league_name: 'TI 2026', formato: 'bo3', equipo_a: 333, equipo_b: 444, start_time: '2026-08-14T00:00:00Z' },
  ];
  const predicciones = [
    { series_id: 's1', prob_gana_a: 0.7, prob_empate: 0, prob_gana_b: 0.3 },
    { series_id: 's2', prob_gana_a: 0.5, prob_empate: 0, prob_gana_b: 0.5 },
  ];
  // Los start_time de las partidas tienen que ser coherentes con el
  // start_time de la serie -- resultadoDelPar acota por ventana temporal.
  const t0 = Math.floor(new Date('2026-08-14T00:00:00Z').getTime() / 1000);
  // s1: 111 le ganó 2-0 a 222 (decidida). s2: 333 le ganó 1 partida a 444, sigue abierta.
  const partidasLigaReales = [
    juego(111, 222, true, t0 + 120),
    juego(222, 111, false, t0 + 2700),
    juego(333, 444, true, t0 + 180),
  ];

  let llamadasSupabase = [];
  const fetchImplSupabase = async (url, opts) => {
    llamadasSupabase.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
    if (url.includes('dota_series')) return respuestaFetch(pendientes);
    if (url.includes('dota_predictions')) return respuestaFetch(predicciones);
    return respuestaFetch([]);
  };
  const fetchImpl = async () => respuestaFetch(partidasLigaReales);

  const r = await actualizarNotas({ fetchImpl, fetchImplSupabase });

  assert.equal(r.actualizadas, 1);

  const upsertSeries = llamadasSupabase.find((l) => l.url.includes('dota_series') && l.body);
  assert.equal(upsertSeries.body.length, 1);
  assert.equal(upsertSeries.body[0].series_id, 's1');
  assert.equal(upsertSeries.body[0].terminada, true);
  assert.equal(upsertSeries.body[0].victorias_a, 2);

  const upsertPred = llamadasSupabase.find((l) => l.url.includes('dota_predictions') && l.body && l.body[0]?.resultado_real);
  assert.equal(upsertPred.body[0].resultado_real, 'ganaA');
  // Brier: predicción (0.7,0,0.3) contra real ganaA -> (0.7-1)²+(0-0)²+(0.3-0)² = 0.09+0+0.09 = 0.18
  assert.ok(Math.abs(upsertPred.body[0].brier - 0.18) < 1e-9);
});
