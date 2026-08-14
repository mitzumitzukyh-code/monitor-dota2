import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partidasDeLaLiga, historicoConLiga, seriesDeLaLiga } from '../datos/liga.mjs';

function partidaLiga(match_id, start_time, extra = {}) {
  return {
    match_id,
    start_time,
    radiant_team_id: 111,
    dire_team_id: 222,
    radiant_team_name: null, // /leagues/{id}/matches siempre los trae null
    dire_team_name: null,
    leagueid: 19719,
    series_id: 900,
    series_type: 1,
    radiant_win: true,
    ...extra,
  };
}

test('partidasDeLaLiga: propaga error si OpenDota no responde 200', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  await assert.rejects(() => partidasDeLaLiga(19719, { fetchImpl }), /503/);
});

test('historicoConLiga: agrega las partidas del torneo que faltaban en el histórico', () => {
  const historico = [{ match_id: 1, start_time: 1000, radiant_team_id: 5, dire_team_id: 6, radiant_win: true }];
  const partidasLiga = [partidaLiga(2, 2000), partidaLiga(3, 3000)];

  const { partidas, agregadas } = historicoConLiga(historico, partidasLiga);

  assert.equal(agregadas, 2);
  assert.equal(partidas.length, 3);
  assert.deepEqual(partidas.map((p) => p.match_id), [1, 2, 3]);
});

test('historicoConLiga: NO duplica una partida que ya estaba en el histórico', () => {
  const historico = [{ match_id: 2, start_time: 2000, radiant_team_id: 111, dire_team_id: 222, radiant_win: true }];
  const partidasLiga = [partidaLiga(2, 2000), partidaLiga(3, 3000)];

  const { partidas, agregadas } = historicoConLiga(historico, partidasLiga);

  assert.equal(agregadas, 1);
  assert.equal(partidas.filter((p) => p.match_id === 2).length, 1);
});

test('historicoConLiga: descarta partidas sin los dos team_id (no se pueden ratear)', () => {
  const historico = [];
  const partidasLiga = [partidaLiga(2, 2000, { dire_team_id: null }), partidaLiga(3, 3000)];

  const { agregadas } = historicoConLiga(historico, partidasLiga);

  assert.equal(agregadas, 1);
});

test('historicoConLiga: descarta partidas sin radiant_win booleano (todavía en curso)', () => {
  const { agregadas } = historicoConLiga([], [partidaLiga(2, 2000, { radiant_win: null })]);
  assert.equal(agregadas, 0);
});

test('historicoConLiga: deja los campos que el motor necesita, con los nombres del histórico', () => {
  const { partidas } = historicoConLiga([], [partidaLiga(2, 2000)]);
  const p = partidas[0];

  assert.equal(p.match_id, 2);
  assert.equal(p.start_time, 2000);
  assert.equal(p.radiant_team_id, 111);
  assert.equal(p.dire_team_id, 222);
  assert.equal(p.radiant_win, true);
  assert.equal(p.series_type, 1);
});

// --- seriesDeLaLiga: agrupa lo que de verdad se jugó, sin depender de si el
// sistema lo había predicho. Sirve para la agenda del día.

test('seriesDeLaLiga: agrupa por serie y cuenta el marcador aunque cambien de lado', () => {
  const partidas = [
    { match_id: 2, series_id: 10, start_time: 2000, radiant_team_id: 'B', dire_team_id: 'A', radiant_win: false },
    { match_id: 1, series_id: 10, start_time: 1000, radiant_team_id: 'A', dire_team_id: 'B', radiant_win: true },
  ];
  const series = seriesDeLaLiga(partidas);

  assert.equal(series.length, 1);
  assert.equal(series[0].equipoA, 'A', 'A es quien fue radiant en la primera partida');
  assert.equal(series[0].victoriasA, 2, 'A gano las dos, jugando de los dos lados');
  assert.equal(series[0].victoriasB, 0);
  assert.equal(series[0].startTime, 1000, 'la hora es la de la primera partida');
});

test('seriesDeLaLiga: devuelve las series en orden cronologico', async () => {
  const partidas = [
    { match_id: 9, series_id: 20, start_time: 5000, radiant_team_id: 'C', dire_team_id: 'D', radiant_win: true },
    { match_id: 1, series_id: 10, start_time: 1000, radiant_team_id: 'A', dire_team_id: 'B', radiant_win: true },
  ];
  const series = seriesDeLaLiga(partidas);
  assert.deepEqual(series.map((s) => s.seriesId), [10, 20]);
});

test('seriesDeLaLiga: salta partidas sin serie o sin equipos', async () => {
  const partidas = [
    { match_id: 1, series_id: null, start_time: 1000, radiant_team_id: 'A', dire_team_id: 'B', radiant_win: true },
    { match_id: 2, series_id: 10, start_time: 2000, radiant_team_id: null, dire_team_id: 'B', radiant_win: true },
  ];
  assert.deepEqual(seriesDeLaLiga(partidas), []);
});

test('seriesDeLaLiga: descarta una serie con un tercer equipo mezclado', async () => {
  const partidas = [
    { match_id: 1, series_id: 10, start_time: 1000, radiant_team_id: 'A', dire_team_id: 'B', radiant_win: true },
    { match_id: 2, series_id: 10, start_time: 2000, radiant_team_id: 'A', dire_team_id: 'C', radiant_win: true },
  ];
  assert.deepEqual(seriesDeLaLiga(partidas), []);
});
