import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamIdPorNombre, EQUIPOS_TI2026 } from '../datos/equipos-ti2026.mjs';

test('teamIdPorNombre: resuelve un nombre exacto', () => {
  assert.equal(teamIdPorNombre('Team Spirit'), 7119388);
});

test('teamIdPorNombre: normaliza mayúsculas y espacios (TEAM VISION vs "Team Vision")', () => {
  assert.equal(teamIdPorNombre('Team Vision'), 9572001);
  assert.equal(teamIdPorNombre('TEAM VISION'), 9572001);
});

test('teamIdPorNombre: "Nigma Galaxy" sin el espacio final de OpenDota calza igual', () => {
  assert.equal(teamIdPorNombre('Nigma Galaxy'), 10136357);
});

test('teamIdPorNombre: "TBD" (cupo de bracket sin definir) da null, no inventa', () => {
  assert.equal(teamIdPorNombre('TBD'), null);
});

test('teamIdPorNombre: null/vacío da null sin reventar', () => {
  assert.equal(teamIdPorNombre(null), null);
  assert.equal(teamIdPorNombre(''), null);
});

test('EQUIPOS_TI2026: son 16 equipos, sin team_id duplicado', () => {
  assert.equal(EQUIPOS_TI2026.length, 16);
  const ids = new Set(EQUIPOS_TI2026.map((e) => e.teamId));
  assert.equal(ids.size, 16);
});
