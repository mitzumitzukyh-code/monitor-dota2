import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predecirProximos } from '../juez/vivo-motor.mjs';

// Forzado, NO con ??=: si el entorno trae un valor (como en GitHub Actions,
// donde estan los secretos reales), las pruebas apuntarian a la base de
// verdad. Con ??= eso pasaba, y encima heredaban un valor invalido si el
// secreto estaba mal copiado.
process.env.SUPABASE_URL = 'https://prueba.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-prueba';

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

  // Las escrituras (con body) van a las tres tablas, en orden.
  const escrituras = llamadasSupabase.filter((l) => l.body);
  assert.equal(escrituras.length, 3);
  assert.ok(escrituras[0].url.includes('dota_teams'));
  assert.ok(escrituras[1].url.includes('dota_series'));
  assert.ok(escrituras[2].url.includes('dota_predictions'));
  assert.equal(escrituras[2].body[0].series_id, 'x1');
});

test('predecirProximos: partido con matchType desconocido se reporta en sinFormato y no se guarda', async () => {
  const fixturePartidos = [
    fixturePartido({ leagueName: 'TI 2026 - Round 2', startsAt: '2026-08-14T02:00:00Z', teamA: 'Team Spirit', teamB: 'Aurora Gaming', matchType: 'Bo7' }),
  ];
  const escrituras = [];
  const fetchImplSupabase = async (url, opts) => {
    if (opts?.body) escrituras.push(url);
    return respuestaFetch([]);
  };
  const fetchImplFixtures = async () => respuestaFetch(fixturePartidos);

  const { predicciones, sinFormato } = await predecirProximos({
    historico: [],
    ahora: 2000,
    fetchImplFixtures,
    fetchImplSupabase,
  });

  assert.equal(predicciones.length, 0);
  assert.equal(sinFormato.length, 1);
  assert.deepEqual(escrituras, [], 'no debe escribir nada si no se pudo predecir');
});

// Bug real encontrado en revisión (2026-08-14): el feed de fixtures sigue
// listando series que YA empezaron (verificado: 5 de TI2026 a la vez). Con
// el flujo de n8n corriendo cada hora, se re-predecían con ratings que ya
// incluían partidas de esa misma serie -> fuga temporal (regla 6) y encima
// se sobreescribía la predicción original, invalidando su Brier.
test('predecirProximos: NO predice una serie que ya empezó (fuga temporal, regla 6)', async () => {
  const ahora = new Date('2026-08-14T10:00:00Z').getTime() / 1000;
  const fixturePartidos = [
    fixturePartido({ leagueName: 'TI 2026 - Round 3', startsAt: '2026-08-14T05:45:00Z', teamA: 'Team Spirit', teamB: 'Aurora Gaming' }),
  ];
  let seLlamoSupabase = false;
  const fetchImplSupabase = async () => {
    seLlamoSupabase = true;
    return respuestaFetch([]);
  };
  const fetchImplFixtures = async () => respuestaFetch(fixturePartidos);

  const { predicciones, yaEmpezaron } = await predecirProximos({
    historico: [],
    ahora,
    fetchImplFixtures,
    fetchImplSupabase,
  });

  assert.equal(predicciones.length, 0, 'no debe predecir una serie ya empezada');
  assert.equal(yaEmpezaron.length, 1);
  assert.equal(seLlamoSupabase, false, 'no debe escribir nada en Supabase');
});

test('predecirProximos: NO sobreescribe una predicción que ya existe (se congela la primera)', async () => {
  const ahora = new Date('2026-08-14T10:00:00Z').getTime() / 1000;
  const fixturePartidos = [
    fixturePartido({ leagueName: 'TI 2026 - Round 4', startsAt: '2026-08-15T02:00:00Z', teamA: 'Team Spirit', teamB: 'Aurora Gaming' }),
  ];
  const escrituras = [];
  const fetchImplSupabase = async (url, opts) => {
    if (opts?.body) escrituras.push(url);
    // La consulta de predicciones existentes devuelve que x1 ya está predicha
    if (url.includes('dota_predictions') && !opts?.body) return respuestaFetch([{ series_id: 'x1' }]);
    return respuestaFetch([]);
  };
  const fetchImplFixtures = async () => respuestaFetch(fixturePartidos);

  const { predicciones, yaPredichas } = await predecirProximos({
    historico: [],
    ahora,
    fetchImplFixtures,
    fetchImplSupabase,
  });

  assert.equal(predicciones.length, 0, 'no debe re-predecir una serie ya predicha');
  assert.equal(yaPredichas.length, 1);
  assert.deepEqual(escrituras, [], 'no debe escribir nada');
});

test('predecirProximos: refresca los ratings con las partidas ya jugadas del torneo', async () => {
  // Sin refrescar, predecir una ronda de TI ignora las rondas anteriores del
  // mismo torneo (verificado real: 24 partidas ignoradas el 2026-08-14).
  const ahora = new Date('2026-08-14T10:00:00Z').getTime() / 1000;
  const fixturePartidos = [
    fixturePartido({ leagueName: 'TI 2026 - Round 4', startsAt: '2026-08-15T02:00:00Z', teamA: 'Team Spirit', teamB: 'Aurora Gaming' }),
  ];
  // Team Spirit (7119388) le ganó dos veces a Aurora (9467224) HOY en el torneo.
  const partidasLiga = [
    { match_id: 50, start_time: ahora - 7200, radiant_team_id: 7119388, dire_team_id: 9467224, radiant_win: true, series_id: 1, series_type: 1, leagueid: 19719 },
    { match_id: 51, start_time: ahora - 5400, radiant_team_id: 7119388, dire_team_id: 9467224, radiant_win: true, series_id: 1, series_type: 1, leagueid: 19719 },
  ];

  const fetchImplSupabase = async (url, opts) => respuestaFetch([]);
  const fetchImplFixtures = async () => respuestaFetch(fixturePartidos);
  const fetchImplLiga = async () => respuestaFetch(partidasLiga);

  const conRefresco = await predecirProximos({
    historico: [], ahora, fetchImplFixtures, fetchImplSupabase, fetchImplLiga,
  });
  const sinRefresco = await predecirProximos({
    historico: [], ahora, refrescarLiga: false, fetchImplFixtures, fetchImplSupabase,
  });

  assert.equal(conRefresco.agregadasDeLaLiga, 2);
  assert.equal(sinRefresco.agregadasDeLaLiga, 0);
  // Sin historial ambos arrancan en 1500 -> 50/50. Con las dos victorias de
  // hoy, Team Spirit tiene que quedar favorito.
  assert.ok(Math.abs(sinRefresco.predicciones[0].prediccion.ganaA - 0.5) < 1e-9);
  assert.ok(
    conRefresco.predicciones[0].prediccion.ganaA > sinRefresco.predicciones[0].prediccion.ganaA + 0.05,
    'el refresco debe mover la probabilidad hacia el que ganó hoy, dio ' + conRefresco.predicciones[0].prediccion.ganaA,
  );
});

test('predecirProximos: sí predice una serie futura que todavía no está predicha', async () => {
  const ahora = new Date('2026-08-14T10:00:00Z').getTime() / 1000;
  const fixturePartidos = [
    fixturePartido({ leagueName: 'TI 2026 - Round 4', startsAt: '2026-08-15T02:00:00Z', teamA: 'Team Spirit', teamB: 'Aurora Gaming' }),
  ];
  const fetchImplSupabase = async (url, opts) => {
    if (url.includes('dota_predictions') && !opts?.body) return respuestaFetch([]); // ninguna predicha
    return respuestaFetch([]);
  };
  const fetchImplFixtures = async () => respuestaFetch(fixturePartidos);

  const { predicciones } = await predecirProximos({
    historico: [{ match_id: 1, start_time: 1000, radiant_team_id: 7119388, dire_team_id: 999, radiant_win: true }],
    ahora,
    fetchImplFixtures,
    fetchImplSupabase,
  });

  assert.equal(predicciones.length, 1);
  assert.equal(predicciones[0].formato, 'bo3');
});

test('predecirProximos: sin fixtures que calcen, no llama a Supabase', async () => {
  const fetchImplSupabase = async () => {
    throw new Error('no debería llamarse');
  };
  const fetchImplFixtures = async () => respuestaFetch([]);

  const { predicciones } = await predecirProximos({ historico: [], fetchImplFixtures, fetchImplSupabase });
  assert.equal(predicciones.length, 0);
});
