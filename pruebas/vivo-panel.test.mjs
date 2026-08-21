import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proximasSeries, hayCredenciales } from '../salida/web/vivo.mjs';

// Supabase simulado: devuelve por tabla lo que se le ponga. Sirve para probar
// el camino "con credenciales" sin tener credenciales ni tocar la red.
function fakeSupabase(porTabla) {
  return async (url) => {
    const tabla = String(url).split('/rest/v1/')[1].split('?')[0];
    return { ok: true, status: 200, json: async () => porTabla[tabla] ?? [] };
  };
}

const AHORA = Date.parse('2026-08-21T12:00:00Z');
const DATOS = {
  dota_teams: [{ team_id: 1, nombre: 'Team Spirit' }, { team_id: 2, nombre: 'Falcons' }],
  dota_series: [
    { series_id: 'ya-jugada', league_name: 'TI2026', formato: 'bo3', equipo_a: 1, equipo_b: 2, start_time: '2026-08-21T09:00:00Z', terminada: false },
    { series_id: 'proxima', league_name: 'TI2026', formato: 'bo3', equipo_a: 1, equipo_b: 2, start_time: '2026-08-21T18:00:00Z', terminada: false },
    { series_id: 'sin-pred', league_name: 'TI2026', formato: 'bo5', equipo_a: 2, equipo_b: 1, start_time: '2026-08-21T20:00:00Z', terminada: false },
  ],
  dota_predictions: [{ series_id: 'proxima', prob_gana_a: 0.62, prob_empate: 0, prob_gana_b: 0.38 }],
};

function conCredenciales(fn) {
  const antes = [process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY];
  process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-prueba';
  return fn().finally(() => {
    if (antes[0] === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = antes[0];
    if (antes[1] === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = antes[1];
  });
}

test('sin credenciales devuelve null y no toca la red', async () => {
  const antes = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  assert.equal(await proximasSeries(), null);
  if (antes !== undefined) process.env.SUPABASE_URL = antes;
});

test('hayCredenciales sólo es cierto con las dos variables puestas', async () => {
  await conCredenciales(async () => assert.equal(hayCredenciales(), true));
});

// El feed sigue listando series que YA empezaron: es un bug real del pipeline
// documentado en CLAUDE.md. El panel no las puede mostrar como "próximas".
test('descarta las series que ya empezaron', async () => {
  await conCredenciales(async () => {
    const p = await proximasSeries({ ahora: AHORA, fetchImpl: fakeSupabase(DATOS) });
    assert.ok(!p.map((x) => x.seriesId).includes('ya-jugada'));
    assert.deepEqual(p.map((x) => x.seriesId), ['proxima', 'sin-pred']);
  });
});

test('resuelve el nombre de cada equipo por su id', async () => {
  await conCredenciales(async () => {
    const [primera] = await proximasSeries({ ahora: AHORA, fetchImpl: fakeSupabase(DATOS) });
    assert.equal(primera.nombreA, 'Team Spirit');
    assert.equal(primera.nombreB, 'Falcons');
  });
});

test('une la predicción guardada a su serie', async () => {
  await conCredenciales(async () => {
    const [primera] = await proximasSeries({ ahora: AHORA, fetchImpl: fakeSupabase(DATOS) });
    assert.ok(Math.abs(primera.prediccion.ganaA - 0.62) < 1e-12);
    assert.ok(Math.abs(primera.prediccion.ganaB - 0.38) < 1e-12);
  });
});

test('una serie sin predicción sale con prediccion null, no con ceros', async () => {
  await conCredenciales(async () => {
    const p = await proximasSeries({ ahora: AHORA, fetchImpl: fakeSupabase(DATOS) });
    assert.equal(p.find((x) => x.seriesId === 'sin-pred').prediccion, null);
  });
});

test('respeta el tope de cuántas se piden', async () => {
  await conCredenciales(async () => {
    const p = await proximasSeries({ ahora: AHORA, cuantas: 1, fetchImpl: fakeSupabase(DATOS) });
    assert.equal(p.length, 1);
  });
});

test('si Supabase revienta se devuelve el error, no se cae el generador', async () => {
  await conCredenciales(async () => {
    const r = await proximasSeries({ ahora: AHORA, fetchImpl: async () => { throw new Error('sin red'); } });
    assert.ok(r.error);
    assert.ok(r.error.includes('sin red'));
  });
});

test('un equipo que no está en dota_teams sale con su id, no en blanco', async () => {
  await conCredenciales(async () => {
    const datos = { ...DATOS, dota_teams: [] };
    const [primera] = await proximasSeries({ ahora: AHORA, fetchImpl: fakeSupabase(datos) });
    assert.equal(primera.nombreA, '#1');
  });
});
