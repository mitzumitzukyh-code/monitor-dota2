import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predecirProximos } from '../juez/vivo-motor.mjs';

process.env.SUPABASE_URL ??= 'https://prueba.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'llave-de-prueba';

function fixturePartido({ leagueName, startsAt, teamA, teamB, matchType = 'Bo3' }) {
  return {
    id: 'x1',
    leagueName,
    matchType,
    startsAt,
    teams: [{ name: teamA }, { name: teamB }],
  };
}

function respuestaFetch(json, ok = true, status = 200) {
  return { ok, status, json: async () => json, text: async () => JSON.stringify(json) };
}

test('predecirProximos: predice y guarda una serie real, con equipo nuevo (rating inicial) contra otro con historia', async () => {
  const historico = [
    { match_id: 1, start_time: 1000, radiant_team_id: 7119388, dire_team_id: 999, radiant_win: true },
  ];
  const fixturePartidos = [
    fixturePartido({ leagueName: 'TI 2026 - Round 2', startsAt: '2026-08-14T02:00:00Z', teamA: 'Team Spirit', teamB: 'Aurora Gaming' }),
  ];

  const llamadasSupabase = [];
  const fetchImplSupabase = async (url, opts) => {
    llamadasSupabase.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
    return respuestaFetch([]);
  };
  const fetchImplFixtures = async () => respuestaFetch(fixturePartidos);

  const { predicciones, sinFormato } = await predecirProximos({
    historico,
    ahora: 2000,
    fetchImplFixtures,
    fetchImplSupabase,
  });

  assert.equal(predicciones.length, 1);
  assert.equal(sinFormato.length, 0);
  assert.equal(predicciones[0].formato, 'bo3');
  // Team Spirit (7119388) le ganó a un equipo desconocido -> rating > 1500 -> favorito
  assert.ok(predicciones[0].prediccion.ganaA > 0.5);

  assert.equal(llamadasSupabase.length, 3); // dota_teams, dota_series, dota_predictions
  assert.ok(llamadasSupabase[0].url.includes('dota_teams'));
  assert.ok(llamadasSupabase[1].url.includes('dota_series'));
  assert.ok(llamadasSupabase[2].url.includes('dota_predictions'));
  assert.equal(llamadasSupabase[2].body[0].series_id, 'x1');
});

test('predecirProximos: partido con matchType desconocido se reporta en sinFormato y no se guarda', async () => {
  const fixturePartidos = [
    fixturePartido({ leagueName: 'TI 2026 - Round 2', startsAt: '2026-08-14T02:00:00Z', teamA: 'Team Spirit', teamB: 'Aurora Gaming', matchType: 'Bo7' }),
  ];
  let seLlamoSupabase = false;
  const fetchImplSupabase = async () => {
    seLlamoSupabase = true;
    return respuestaFetch([]);
  };
  const fetchImplFixtures = async () => respuestaFetch(fixturePartidos);

  const { predicciones, sinFormato } = await predecirProximos({
    historico: [],
    fetchImplFixtures,
    fetchImplSupabase,
  });

  assert.equal(predicciones.length, 0);
  assert.equal(sinFormato.length, 1);
  assert.equal(seLlamoSupabase, false);
});

test('predecirProximos: sin fixtures que calcen, no llama a Supabase', async () => {
  const fetchImplSupabase = async () => {
    throw new Error('no debería llamarse');
  };
  const fetchImplFixtures = async () => respuestaFetch([]);

  const { predicciones } = await predecirProximos({ historico: [], fetchImplFixtures, fetchImplSupabase });
  assert.equal(predicciones.length, 0);
});
