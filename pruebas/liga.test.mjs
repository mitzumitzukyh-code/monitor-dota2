import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partidasDeLaLiga, historicoConLiga } from '../datos/liga.mjs';

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
