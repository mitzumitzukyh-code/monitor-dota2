import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://prueba.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-prueba';
// Sin esto, enviar() corta con "falta DISCORD_WEBHOOK" y las pruebas de envío
// pasarían por la razón equivocada: la de "si falla no se marca" daba verde
// sin haber probado nunca un fallo de red.
process.env.DISCORD_WEBHOOK = 'https://discord.test/webhook';

const { mensajeResumenGlobal, reunirFilas, enviarResumenDiario } = await import('../salida/resumen-global.mjs');

const respuesta = (datos) => ({ ok: true, status: 200, json: async () => datos, text: async () => '' });

function supabaseFalso(porTabla = {}) {
  const escrituras = [];
  const fetchImpl = async (url, opciones) => {
    const tabla = String(url).match(/\/rest\/v1\/([a-z_]+)/)?.[1] ?? '?';
    if (opciones?.method && opciones.method !== 'GET') {
      escrituras.push({ tabla, filas: JSON.parse(opciones.body) });
      return respuesta([]);
    }
    return respuesta(porTabla[tabla] ?? []);
  };
  return { fetchImpl, escrituras };
}

// ---------------------------------------------------------------------------
// LO IMPORTANTE: los Brier de Dota y de CS2/LoL están en escalas distintas.
// Dota puntúa sobre tres clases (moneda = 0.50), CS2/LoL sobre una (= 0.25).
// Compararlos crudos haría ver a CS2 el doble de bueno sin serlo.
// ---------------------------------------------------------------------------
test('cada juego se muestra contra SU base, no contra una común', () => {
  const filas = [
    { nombre: 'CS2', predichas: 10, n: 4, brier: 0.2371, base: 0.25, vsBase: (0.2371 - 0.25) / 0.25, aciertos: 2 },
    { nombre: 'Dota 2', predichas: 27, n: 23, brier: 0.426, base: 0.5, vsBase: (0.426 - 0.5) / 0.5, aciertos: 17 },
  ];
  const m = mensajeResumenGlobal(filas);

  assert.match(m, /0\.250/, 'la base de CS2');
  assert.match(m, /0\.500/, 'la base de Dota');
  assert.match(m, /escalas son distintas/, 'la advertencia tiene que estar');
});

// Dota 0.426 sobre base 0.5 es -15%; CS2 0.2371 sobre 0.25 es -5%. En crudo
// CS2 parece mucho mejor (0.24 vs 0.43); en la columna comparable, va PEOR.
test('el porcentaje vs base invierte la lectura ingenua de los Brier crudos', () => {
  const cs2 = (0.2371 - 0.25) / 0.25;
  const dota = (0.426 - 0.5) / 0.5;
  assert.ok(0.2371 < 0.426, 'en crudo CS2 tiene el número más bajo');
  assert.ok(dota < cs2, 'pero contra su base, Dota va mejor');
});

test('con muestra chica avisa que los números no dicen nada', () => {
  const m = mensajeResumenGlobal([
    { nombre: 'CS2', predichas: 60, n: 4, brier: 0.2, base: 0.25, vsBase: -0.2, aciertos: 3 },
  ]);
  assert.match(m, /no dicen nada/);
  assert.match(m, /4 partidas calificadas/);
});

test('con muestra suficiente cambia el aviso por un resumen', () => {
  const m = mensajeResumenGlobal([
    { nombre: 'CS2', predichas: 200, n: 120, brier: 0.22, base: 0.25, vsBase: -0.12, aciertos: 80 },
    { nombre: 'LoL', predichas: 200, n: 100, brier: 0.27, base: 0.25, vsBase: 0.08, aciertos: 50 },
  ]);
  assert.doesNotMatch(m, /no dicen nada/);
  assert.match(m, /1 de 2 juegos/);
});

test('un juego sin partidas calificadas sale con guiones, no con NaN', () => {
  const m = mensajeResumenGlobal([{ nombre: 'LoL', predichas: 90, n: 0 }]);
  assert.doesNotMatch(m, /NaN/);
  assert.match(m, /—/);
});

test('reunirFilas separa CS2 de LoL y trae Dota de su propia tabla', async () => {
  const { fetchImpl } = supabaseFalso({
    eslo_predicciones: [
      { juego: 'cs2', prob_a: 0.7, resultado_real: 'ganaA', brier: 0.09 },
      { juego: 'cs2', prob_a: 0.6, resultado_real: null, brier: null },
      { juego: 'lol', prob_a: 0.8, resultado_real: 'ganaB', brier: 0.64 },
    ],
    dota_predictions: [{ series_id: 's1', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: 'ganaA', brier: 0.32 }],
    dota_series: [{ series_id: 's1', formato: 'bo3' }],
  });

  const filas = await reunirFilas({ fetchImplSupabase: fetchImpl });
  const por = Object.fromEntries(filas.map((f) => [f.nombre, f]));

  assert.equal(por['CS2'].predichas, 2);
  assert.equal(por['CS2'].n, 1, 'sólo la que tiene resultado');
  assert.equal(por['LoL'].n, 1);
  assert.equal(por['Dota 2'].n, 1);
  assert.equal(por['Dota 2'].base, 0.5, 'bo3 -> base 0.5, no 0.25');
  assert.equal(por['CS2'].base, 0.25);
});

test('un bo2 de Dota usa base 2/3, no 1/2', async () => {
  const { fetchImpl } = supabaseFalso({
    eslo_predicciones: [],
    dota_predictions: [{ series_id: 's1', prob_gana_a: 0.5, prob_gana_b: 0.5, resultado_real: 'ganaA', brier: 0.5 }],
    dota_series: [{ series_id: 's1', formato: 'bo2' }],
  });
  const filas = await reunirFilas({ fetchImplSupabase: fetchImpl });
  assert.equal(filas.find((f) => f.nombre === 'Dota 2').base.toFixed(4), (2 / 3).toFixed(4));
});

// ---------------------------------------------------------------------------
// Una vez al día
// ---------------------------------------------------------------------------
test('no reenvía si ya salió hoy', async () => {
  const ahora = new Date('2026-08-17T18:00:00Z');
  const { fetchImpl } = supabaseFalso({
    eslo_estado: [{ juego: 'resumen-global', ultimo_inicio: '2026-08-17T12:00:00Z' }],
  });
  const r = await enviarResumenDiario({ fetchImpl: async () => ({ ok: true }), fetchImplSupabase: fetchImpl, ahora });
  assert.equal(r.enviado, false);
  assert.match(r.razon, /ya se envió hoy/);
});

test('sí envía si el último fue ayer', async () => {
  const ahora = new Date('2026-08-17T18:00:00Z');
  const { fetchImpl, escrituras } = supabaseFalso({
    eslo_estado: [{ juego: 'resumen-global', ultimo_inicio: '2026-08-16T12:00:00Z' }],
    eslo_predicciones: [],
    dota_predictions: [],
    dota_series: [],
  });
  const r = await enviarResumenDiario({
    fetchImpl: async () => ({ ok: true }),
    fetchImplSupabase: fetchImpl,
    ahora,
  });
  assert.equal(r.enviado, true);
  assert.ok(escrituras.some((e) => e.tabla === 'eslo_estado'), 'debe dejar marcado que ya salió');
});

// Si Discord está caído, el resumen sale en la corrida siguiente en vez de
// perderse el día entero.
test('si el envío falla NO se marca como enviado', async () => {
  const { fetchImpl, escrituras } = supabaseFalso({ eslo_estado: [], eslo_predicciones: [], dota_predictions: [], dota_series: [] });
  const r = await enviarResumenDiario({
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'caido' }),
    fetchImplSupabase: fetchImpl,
    ahora: new Date('2026-08-17T18:00:00Z'),
  });
  assert.equal(r.enviado, false);
  assert.equal(escrituras.filter((e) => e.tabla === 'eslo_estado').length, 0);
});
