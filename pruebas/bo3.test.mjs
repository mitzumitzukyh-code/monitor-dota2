import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizar, esUtilizable, formatoDesdeBoType, DISCIPLINAS } from '../datos/juegos/bo3.mjs';

// Una partida cruda tal como la devuelve bo3.gg (campos recortados a los que
// importan; la respuesta real trae ~35).
const CRUDA = {
  id: 127194,
  discipline_id: 1,
  tournament_id: 5958,
  start_date: '2026-08-15T18:35:00.000+00:00',
  bo_type: 3,
  team1_id: 6277,
  team2_id: 3513,
  team1_score: 0,
  team2_score: 2,
  winner_team_id: 3513,
  tier: 'c',
  status: 'finished',
};

test('formatoDesdeBoType() traduce al vocabulario del motor', () => {
  assert.equal(formatoDesdeBoType(1), 'bo1');
  assert.equal(formatoDesdeBoType(3), 'bo3');
  assert.equal(formatoDesdeBoType(5), 'bo5');
  assert.equal(formatoDesdeBoType(0), null);
  assert.equal(formatoDesdeBoType(null), null);
});

test('normalizar() convierte la fecha a segundos unix', () => {
  const p = normalizar(CRUDA);
  assert.equal(p.inicio, Math.floor(Date.parse('2026-08-15T18:35:00.000+00:00') / 1000));
  assert.equal(p.formato, 'bo3');
  assert.equal(p.equipoA, 6277);
  assert.equal(p.ganador, 3513);
});

test('esUtilizable() acepta una partida completa y coherente', () => {
  assert.equal(esUtilizable(normalizar(CRUDA)), true);
});

test('esUtilizable() bota una partida sin equipos (cruce por definir)', () => {
  assert.equal(esUtilizable(normalizar({ ...CRUDA, team1_id: null, team2_id: null })), false);
});

test('esUtilizable() bota una partida sin fecha o sin formato', () => {
  assert.equal(esUtilizable(normalizar({ ...CRUDA, start_date: null })), false);
  assert.equal(esUtilizable(normalizar({ ...CRUDA, bo_type: 0 })), false);
});

test('esUtilizable() bota si el ganador no es ninguno de los dos equipos', () => {
  assert.equal(esUtilizable(normalizar({ ...CRUDA, winner_team_id: 99999 })), false);
});

// El hallazgo real de la validación de Fase 0: 43 filas de 72.673 declaran
// un ganador que contradice el marcador.
test('esUtilizable() bota si el ganador contradice el marcador', () => {
  // 0-2 pero declara ganador al equipo A.
  assert.equal(esUtilizable(normalizar({ ...CRUDA, winner_team_id: 6277 })), false);
  // 2-0 y declara ganador al equipo B.
  assert.equal(
    esUtilizable(normalizar({ ...CRUDA, team1_score: 2, team2_score: 0, winner_team_id: 3513 })),
    false,
  );
});

test('esUtilizable() no exige coherencia cuando el marcador viene empatado', () => {
  // Un Bo2 1-1 no lo gana nadie, pero si la fuente declara un ganador la fila
  // no se bota por eso: la incoherencia se juzga sólo con marcador desigual.
  const bo2 = normalizar({ ...CRUDA, bo_type: 2, team1_score: 1, team2_score: 1, winner_team_id: 3513 });
  assert.equal(esUtilizable(bo2), true);
});

test('DISCIPLINAS cubre los juegos que se van a monitorear', () => {
  assert.equal(DISCIPLINAS.cs2, 1);
  assert.equal(DISCIPLINAS.lol, 3);
  assert.equal(DISCIPLINAS.dota2, 4);
  assert.equal(DISCIPLINAS.valorant, 2);
});
