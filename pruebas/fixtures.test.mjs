import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proximosPartidos, proximosPartidosDesdeBo3gg, fixturesResueltos } from '../datos/fixtures.mjs';

function partido({ leagueName, startsAt, teamA, teamB, matchType = 'Bo3' }) {
  return {
    id: 'x',
    leagueName,
    matchType,
    startsAt,
    teams: [teamA ? { name: teamA } : null, teamB ? { name: teamB } : null],
  };
}

// Mock de bo3.gg: la forma cruda de /matches (verificado con llamadas reales
// 2026-08-16: bet_updates trae los nombres de equipo, y puede faltar).
function bo3ggMatch({ id, tournamentId = 5134, boType = 3, startDate, team1, team2, conBetUpdates = true }) {
  return {
    id,
    tournament_id: tournamentId,
    bo_type: boType,
    start_date: startDate,
    team1_id: team1?.id ?? null,
    team2_id: team2?.id ?? null,
    bet_updates: conBetUpdates
      ? {
          team_1: team1 ? { name: team1.name } : null,
          team_2: team2 ? { name: team2.name } : null,
        }
      : null,
  };
}

function respuestaBo3gg(results) {
  return { ok: true, status: 200, json: async () => ({ results }) };
}

test('proximosPartidos: si haglund devuelve 500, usa bo3.gg como respaldo', async () => {
  const matches = [
    bo3ggMatch({ id: 127227, startDate: '2026-08-20T05:00:00.000+00:00', team1: { id: 18604, name: 'TEAM VISION' }, team2: { id: 15526, name: 'BoomBoys' } }),
  ];
  const fetchImpl = async (url) =>
    url.includes('haglund') ? { ok: false, status: 500 } : respuestaBo3gg(matches);

  const partidos = await proximosPartidos({ fetchImpl });

  assert.equal(partidos.length, 1);
  assert.equal(partidos[0].id, '127227');
  assert.equal(partidos[0].leagueName, 'TI 2026');
  assert.equal(partidos[0].matchType, 'bo3');
  assert.equal(partidos[0].teams[0].name, 'TEAM VISION');
  // Y el fixture resuelto sigue calzando con el mapeo de equipos de TI2026.
  const resueltos = fixturesResueltos(partidos, 'TI 2026');
  assert.equal(resueltos.length, 1);
  assert.equal(resueltos[0].equipoA, 9572001); // TEAM VISION
  assert.equal(resueltos[0].equipoB, 8255888); // BoomBoys
});

test('proximosPartidos: si ambas fuentes fallan, propaga el error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  await assert.rejects(() => proximosPartidos({ fetchImpl }), /500/);
});

test('proximosPartidos: devuelve el JSON de haglund tal cual en un 200', async () => {
  const datos = [{ id: '1' }];
  const fetchImpl = async (url) =>
    url.includes('haglund') ? { ok: true, status: 200, json: async () => datos } : null;
  const resultado = await proximosPartidos({ fetchImpl });
  assert.deepEqual(resultado, datos);
});

test('proximosPartidosDesdeBo3gg: filtra a TI2026 por tournament_id y resuelve nombres', async () => {
  const matches = [
    bo3ggMatch({ id: 127227, startDate: '2026-08-20T05:00:00.000+00:00', team1: { id: 18604, name: 'TEAM VISION' }, team2: { id: 15526, name: 'BoomBoys' } }),
    // Otro torneo (tournament_id distinto): no debe salir.
    bo3ggMatch({ id: 999, tournamentId: 777, startDate: '2026-08-20T05:00:00.000+00:00', team1: { id: 1, name: 'Otro' }, team2: { id: 2, name: 'Equipo' } }),
    // Sin bet_updates: el nombre debe resolverse con /teams/{id}.
    bo3ggMatch({ id: 127228, startDate: '2026-08-20T08:00:00.000+00:00', team1: { id: 16721, name: 'Team Liquid' }, team2: { id: 20951, name: 'Team Yandex' }, conBetUpdates: false }),
    // Equipo TBD (team_id null): se descarta, nunca inventar cruces.
    bo3ggMatch({ id: 127230, startDate: '2026-08-21T02:00:00.000+00:00', team1: null, team2: null, conBetUpdates: false }),
  ];

  const fetchImpl = async (url) => {
    if (url.includes('/teams/')) {
      const id = Number(url.split('/teams/')[1]);
      return { ok: true, status: 200, json: async () => ({ result: { name: id === 16721 ? 'Team Liquid' : 'Team Yandex' } }) };
    }
    return respuestaBo3gg(matches);
  };

  const partidos = await proximosPartidosDesdeBo3gg({ fetchImpl });

  assert.equal(partidos.length, 2);
  assert.deepEqual(
    partidos.map((p) => [p.id, p.teams[0].name, p.teams[1].name]),
    [
      ['127227', 'TEAM VISION', 'BoomBoys'],
      ['127228', 'Team Liquid', 'Team Yandex'],
    ],
  );
  assert.equal(partidos[1].matchType, 'bo3');
});

test('fixturesResueltos: filtra por substring de liga y resuelve team_id reales', () => {
  const partidos = [
    partido({ leagueName: 'TI 2026 - Round 2', startsAt: '2026-08-14T02:00:00Z', teamA: 'Team Spirit', teamB: 'Aurora Gaming' }),
    partido({ leagueName: 'Otro torneo cualquiera', startsAt: '2026-08-14T02:00:00Z', teamA: 'Team Spirit', teamB: 'Aurora Gaming' }),
  ];

  const resueltos = fixturesResueltos(partidos, 'TI 2026');

  assert.equal(resueltos.length, 1);
  assert.equal(resueltos[0].equipoA, 7119388); // Team Spirit
  assert.equal(resueltos[0].equipoB, 9467224); // Aurora Gaming
});

test('fixturesResueltos: se salta partidos con "TBD" (cupo sin definir) en vez de inventar', () => {
  const partidos = [
    partido({ leagueName: 'TI 2026 - Round 3', startsAt: '2026-08-15T02:00:00Z', teamA: 'Team Spirit', teamB: 'TBD' }),
  ];
  assert.deepEqual(fixturesResueltos(partidos, 'TI 2026'), []);
});

test('fixturesResueltos: se salta partidos sin fecha o sin los dos equipos presentes', () => {
  const partidos = [
    partido({ leagueName: 'TI 2026', startsAt: null, teamA: 'Team Spirit', teamB: 'Aurora Gaming' }),
    { id: 'y', leagueName: 'TI 2026', startsAt: '2026-08-14T02:00:00Z', teams: [{ name: 'Team Spirit' }] },
  ];
  assert.deepEqual(fixturesResueltos(partidos, 'TI 2026'), []);
});
