import { test } from 'node:test';
import assert from 'node:assert/strict';

import { probabilidadesImplicitas, extraerCuota } from '../datos/juegos/cuotas.mjs';

test('probabilidadesImplicitas() invierte la cuota decimal', () => {
  // Cuotas 2.0 / 2.0 = mercado partido por la mitad, sin margen.
  const r = probabilidadesImplicitas(2, 2);
  assert.equal(r.probA.toFixed(4), '0.5000');
  assert.equal(r.probB.toFixed(4), '0.5000');
  assert.equal(r.margen.toFixed(4), '0.0000');
});

test('probabilidadesImplicitas() quita el margen de la casa', () => {
  // 1.10 y 6.27 (caso real: Insiders vs ZOTIX).
  // Crudas: 1/1.10 = 0.9091 y 1/6.27 = 0.1595 -> suman 1.0686.
  // El margen es ese 6.86% de exceso; normalizadas tienen que sumar 1.
  const r = probabilidadesImplicitas(1.1, 6.27);
  assert.equal((r.probA + r.probB).toFixed(6), '1.000000');
  assert.equal(r.margen.toFixed(4), '0.0686');
  assert.ok(r.probA > 0.84 && r.probA < 0.86, `probA fuera de rango: ${r.probA}`);
});

test('probabilidadesImplicitas() rechaza cuotas imposibles', () => {
  assert.equal(probabilidadesImplicitas(1, 2), null); // cuota 1.0 = pago nulo
  assert.equal(probabilidadesImplicitas(0.5, 2), null);
  assert.equal(probabilidadesImplicitas(null, 2), null);
  assert.equal(probabilidadesImplicitas('x', 2), null);
});

const PARTIDA = {
  id: 127194,
  discipline_id: 1,
  team1_id: 6277,
  team2_id: 3513,
  start_date: '2026-08-15T18:35:00.000+00:00',
  bet_updates: {
    team_1: { name: 'ZOTIX', coeff: 6.27, team_id: 6277 },
    team_2: { name: 'Insiders', coeff: 1.1, team_id: 3513 },
    bet_provider_id: 39,
  },
};

test('extraerCuota() asigna cada cuota a su equipo', () => {
  const c = extraerCuota(PARTIDA);
  assert.equal(c.equipoA, 6277);
  assert.equal(c.coeffA, 6.27);
  assert.equal(c.coeffB, 1.1);
  assert.ok(c.probB > c.probA, 'el favorito por cuota debe tener más probabilidad');
});

// El riesgo real: si bet_updates viene en otro orden que team1/team2 y se
// asume que coinciden, la cuota queda asignada al equipo equivocado y todo
// el análisis contra el mercado sale invertido.
test('extraerCuota() cruza por team_id, no por posición', () => {
  const invertida = {
    ...PARTIDA,
    bet_updates: {
      team_1: { name: 'Insiders', coeff: 1.1, team_id: 3513 },
      team_2: { name: 'ZOTIX', coeff: 6.27, team_id: 6277 },
    },
  };
  const c = extraerCuota(invertida);
  assert.equal(c.equipoA, 6277);
  assert.equal(c.coeffA, 6.27, 'la cuota de ZOTIX debe seguir siendo la de ZOTIX');
});

test('extraerCuota() descarta si los ids no cuadran con la partida', () => {
  const ajena = {
    ...PARTIDA,
    bet_updates: { team_1: { coeff: 2, team_id: 111 }, team_2: { coeff: 2, team_id: 222 } },
  };
  assert.equal(extraerCuota(ajena), null);
});

test('extraerCuota() devuelve null si no hay cuota', () => {
  assert.equal(extraerCuota({ ...PARTIDA, bet_updates: null }), null);
  assert.equal(extraerCuota({ ...PARTIDA, bet_updates: { team_1: {}, team_2: {} } }), null);
});

// --- seguridad: menciones en Discord ---
process.env.SUPABASE_URL = 'https://prueba.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-prueba';
const { enviar } = await import('../salida/discord.mjs');

test('enviar() desactiva TODA mención: un equipo llamado @everyone no pinga', async () => {
  let cuerpo = null;
  const fetchFalso = async (_url, opciones) => {
    cuerpo = JSON.parse(opciones.body);
    return { ok: true };
  };

  await enviar('gana **@everyone** 70%', { fetchImpl: fetchFalso, webhook: 'https://discord.test/webhook' });

  assert.deepEqual(cuerpo.allowed_mentions, { parse: [] });
  // El texto NO se altera: se sigue leyendo igual, solo que no notifica.
  assert.match(cuerpo.content, /@everyone/);
});
