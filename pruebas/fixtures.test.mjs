import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proximosPartidos, fixturesResueltos } from '../datos/fixtures.mjs';

function partido({ leagueName, startsAt, teamA, teamB, matchType = 'Bo3' }) {
  return {
    id: 'x',
    leagueName,
    matchType,
    startsAt,
    teams: [teamA ? { name: teamA } : null, teamB ? { name: teamB } : null],
  };
}

test('proximosPartidos: propaga error si la respuesta no es 200', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  await assert.rejects(() => proximosPartidos({ fetchImpl }), /500/);
});

test('proximosPartidos: devuelve el JSON tal cual en un 200', async () => {
  const datos = [{ id: '1' }];
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => datos });
  const resultado = await proximosPartidos({ fetchImpl });
  assert.deepEqual(resultado, datos);
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
