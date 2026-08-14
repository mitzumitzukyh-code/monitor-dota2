import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';

process.env.SUPABASE_URL ??= 'https://prueba.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'llave-de-prueba';

const {
  mensajePredicciones,
  mensajeResultados,
  enviar,
  recortar,
  calcularMetricasSimple,
  avisar,
} = await import('../salida/discord.mjs');

const nombre = (id) => ({ 1: 'Team Spirit', 2: 'Aurora Gaming', 3: 'Iron Wing', 4: 'Team Falcons' })[id] ?? `#${id}`;

function respuestaFetch(json = [], ok = true, status = 200) {
  return { ok, status, json: async () => json, text: async () => JSON.stringify(json) };
}

test('mensajePredicciones: null si no hay nada nuevo (no se manda un mensaje vacío)', () => {
  assert.equal(mensajePredicciones([], nombre), null);
});

test('mensajePredicciones: pone al favorito primero y la hora de Venezuela', () => {
  const msg = mensajePredicciones(
    [{ series_id: 'a', equipo_a: 1, equipo_b: 2, prob_gana_a: 0.549, prob_gana_b: 0.451, formato: 'bo3', start_time: '2026-08-15T02:00:00Z' }],
    nombre,
  );
  assert.ok(msg.includes('**Team Spirit** 55%'), 'el favorito va primero, redondeado: ' + msg);
  assert.ok(msg.includes('Aurora Gaming 45%'));
  assert.ok(!msg.includes('BO3'), 'el formato tecnico ya no se muestra en el aviso');
  // 02:00 UTC del 15 => 22:00 del 14 en Venezuela
  // El día va como encabezado del grupo, y la hora en cada línea.
  assert.ok(/\*\*(Hoy|Mañana|Ayer|\d{2}\/\d{2})\*\*/.test(msg), 'debe agrupar por día en palabras: ' + msg);
  assert.ok(msg.includes('`22:00`'), 'la hora va en la línea: ' + msg);
  assert.ok(msg.includes('quedan guardados'), 'debe decir que no se cambian');
});

test('mensajePredicciones: si el favorito es el equipo B, lo pone primero igual', () => {
  const msg = mensajePredicciones(
    [{ series_id: 'a', equipo_a: 3, equipo_b: 4, prob_gana_a: 0.123, prob_gana_b: 0.877, formato: 'bo3', start_time: '2026-08-14T05:00:00Z' }],
    nombre,
  );
  assert.ok(msg.includes('**Team Falcons** 88%'), 'Falcons es el favorito y va primero: ' + msg);
  assert.ok(msg.indexOf('Team Falcons') < msg.indexOf('Iron Wing'));
});

test('mensajeResultados: marca acierto y fallo, y avisa cuando el Brier es peor que la base', () => {
  const msg = mensajeResultados(
    [
      { series_id: 'a', equipo_a: 1, equipo_b: 2, prob_gana_a: 0.549, prob_gana_b: 0.451, formato: 'bo3', resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0, brier: 0.406 },
      { series_id: 'b', equipo_a: 3, equipo_b: 4, prob_gana_a: 0.123, prob_gana_b: 0.877, formato: 'bo3', resultado_real: 'ganaA', victorias_a: 2, victorias_b: 1, brier: 1.538 },
    ],
    nombre,
    null,
  );
  assert.ok(msg.includes('✅'), 'la primera acertó');
  assert.ok(msg.includes('❌'), 'la segunda falló');
  assert.ok(msg.includes('el golpe del día'), 'debe marcar el fallo con mas confianza: ' + msg);
});

test('mensajeResultados: incluye el acumulado y el aviso de que no concluye con n chico', () => {
  const calificadas = [
    { series_id: 'a', equipo_a: 1, equipo_b: 2, prob_gana_a: 0.6, prob_gana_b: 0.4, formato: 'bo3', resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0, brier: 0.2 },
    { series_id: 'b', equipo_a: 3, equipo_b: 4, prob_gana_a: 0.6, prob_gana_b: 0.4, formato: 'bo3', resultado_real: 'ganaB', victorias_a: 0, victorias_b: 2, brier: 1.2 },
  ];
  const msg = mensajeResultados(calificadas, nombre, calcularMetricasSimple(calificadas));
  assert.ok(msg.includes('Acertamos'), 'resumen en llano');
  assert.ok(msg.includes('0.500 de adivinar'), 'el numero tecnico va al pie');
  assert.ok(msg.includes('no alcanza para saber si sirve'), 'en lenguaje llano: ' + msg);
});

test('recortar: respeta el límite de Discord con aviso, en vez de dejar que corte a la mitad', () => {
  const largo = 'x'.repeat(5000);
  const r = recortar(largo, 100);
  assert.ok(r.length <= 100, 'largo real: ' + r.length);
  assert.ok(r.includes('recortado'));
});

test('recortar: no toca un mensaje que ya entra', () => {
  assert.equal(recortar('corto', 100), 'corto');
});

test('enviar: sin DISCORD_WEBHOOK no revienta, devuelve enviado:false con la razón', async () => {
  const r = await enviar('hola', { webhook: undefined, fetchImpl: async () => { throw new Error('no debe llamarse'); } });
  assert.equal(r.enviado, false);
  assert.match(r.razon, /DISCORD_WEBHOOK/);
});

test('enviar: hace POST con el contenido en el cuerpo', async () => {
  let visto = null;
  const r = await enviar('mensaje de prueba', {
    webhook: 'https://discord.test/webhook',
    fetchImpl: async (url, opts) => {
      visto = { url, metodo: opts.method, cuerpo: JSON.parse(opts.body) };
      return respuestaFetch({});
    },
  });
  assert.equal(r.enviado, true);
  assert.equal(visto.url, 'https://discord.test/webhook');
  assert.equal(visto.metodo, 'POST');
  assert.equal(visto.cuerpo.content, 'mensaje de prueba');
});

test('enviar: reporta el error si Discord no responde 2xx', async () => {
  const r = await enviar('x', { webhook: 'https://discord.test/w', fetchImpl: async () => respuestaFetch({ error: 'nope' }, false, 429) });
  assert.equal(r.enviado, false);
  assert.match(r.razon, /429/);
});

// --- avisar(): el ciclo completo, sin repetir avisos

const RUTA_ESTADO = new URL('./avisados-de-prueba.json', import.meta.url);

function supabaseFalso({ series, preds, teams }) {
  return async (url) => {
    if (url.includes('dota_series')) return respuestaFetch(series);
    if (url.includes('dota_predictions')) return respuestaFetch(preds);
    if (url.includes('dota_teams')) return respuestaFetch(teams);
    return respuestaFetch([]);
  };
}

test('avisar: no repite el mismo aviso en la corrida siguiente', async () => {
  await rm(RUTA_ESTADO, { force: true });

  const datos = {
    series: [{ series_id: 's1', equipo_a: 1, equipo_b: 2, formato: 'bo3', start_time: '2026-08-15T02:00:00Z', terminada: false }],
    preds: [{ series_id: 's1', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: null, brier: null }],
    teams: [{ team_id: 1, nombre: 'Team Spirit' }, { team_id: 2, nombre: 'Aurora Gaming' }],
  };

  let envios = 0;
  const fetchImpl = async () => { envios++; return respuestaFetch({}); };
  process.env.DISCORD_WEBHOOK = 'https://discord.test/w';

  const primera = await avisar({ fetchImpl, fetchImplSupabase: supabaseFalso(datos), rutaEstado: RUTA_ESTADO });
  assert.equal(primera.nuevasPredichas, 1);
  assert.equal(envios, 1, 'la primera corrida sí avisa');

  const segunda = await avisar({ fetchImpl, fetchImplSupabase: supabaseFalso(datos), rutaEstado: RUTA_ESTADO });
  assert.equal(segunda.nuevasPredichas, 0, 'la segunda no debe tener nada nuevo');
  assert.equal(envios, 1, 'no debe volver a enviar');

  delete process.env.DISCORD_WEBHOOK;
  await rm(RUTA_ESTADO, { force: true });
});

test('avisar: si el envío falla, NO marca como avisado (se reintenta después)', async () => {
  await rm(RUTA_ESTADO, { force: true });

  const datos = {
    series: [{ series_id: 's9', equipo_a: 1, equipo_b: 2, formato: 'bo3', start_time: '2026-08-15T02:00:00Z', terminada: false }],
    preds: [{ series_id: 's9', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: null, brier: null }],
    teams: [{ team_id: 1, nombre: 'A' }, { team_id: 2, nombre: 'B' }],
  };
  process.env.DISCORD_WEBHOOK = 'https://discord.test/w';
  const fetchFalla = async () => respuestaFetch({ error: 'caido' }, false, 500);

  const primera = await avisar({ fetchImpl: fetchFalla, fetchImplSupabase: supabaseFalso(datos), rutaEstado: RUTA_ESTADO });
  assert.equal(primera.enviados[0].enviado, false);

  // La corrida siguiente tiene que volver a intentarlo.
  let reintento = 0;
  const fetchOk = async () => { reintento++; return respuestaFetch({}); };
  const segunda = await avisar({ fetchImpl: fetchOk, fetchImplSupabase: supabaseFalso(datos), rutaEstado: RUTA_ESTADO });
  assert.equal(segunda.nuevasPredichas, 1, 'debe seguir pendiente de avisar');
  assert.equal(reintento, 1, 'debe reintentar el envío');

  delete process.env.DISCORD_WEBHOOK;
  await rm(RUTA_ESTADO, { force: true });
});

test('avisar: sin webhook configurado no revienta y no marca nada como avisado', async () => {
  await rm(RUTA_ESTADO, { force: true });
  delete process.env.DISCORD_WEBHOOK;

  const datos = {
    series: [{ series_id: 's5', equipo_a: 1, equipo_b: 2, formato: 'bo3', start_time: '2026-08-15T02:00:00Z', terminada: false }],
    preds: [{ series_id: 's5', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: null, brier: null }],
    teams: [{ team_id: 1, nombre: 'A' }, { team_id: 2, nombre: 'B' }],
  };

  const r = await avisar({
    fetchImpl: async () => { throw new Error('no debe tocar la red sin webhook'); },
    fetchImplSupabase: supabaseFalso(datos),
    rutaEstado: RUTA_ESTADO,
  });

  assert.equal(r.enviados[0].enviado, false);
  assert.match(r.enviados[0].razon, /DISCORD_WEBHOOK/);
  await rm(RUTA_ESTADO, { force: true });
});

// Bug encontrado por una prueba (no en producción): si a una serie le
// faltaba start_time, el agrupado por día reventaba con TypeError y se caía
// el aviso COMPLETO, incluidas las series que sí tenían fecha.
test('agrupar: una serie sin fecha no tumba el aviso, va a un grupo aparte', () => {
  const msg = mensajeResultados(
    [
      { series_id: 'a', equipo_a: 1, equipo_b: 2, prob_gana_a: 0.6, prob_gana_b: 0.4, formato: 'bo3', resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0, brier: 0.3, start_time: '2026-08-14T05:00:00Z' },
      { series_id: 'b', equipo_a: 3, equipo_b: 4, prob_gana_a: 0.6, prob_gana_b: 0.4, formato: 'bo3', resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0, brier: 0.3 }, // sin start_time
    ],
    nombre,
    null,
  );

  assert.ok(msg.includes('Team Spirit'), 'la serie con fecha debe seguir apareciendo');
  assert.ok(msg.includes('Iron Wing'), 'la serie sin fecha también debe aparecer');
  assert.ok(msg.includes('Sin fecha'), 'debe marcarla como sin fecha en vez de inventarle una');
  assert.ok(!msg.includes('``'), 'no debe quedar un hueco de hora vacío: ' + msg);
});

test('agrupar: las series sin fecha van al final, no al principio', () => {
  const msg = mensajeResultados(
    [
      { series_id: 'b', equipo_a: 3, equipo_b: 4, prob_gana_a: 0.6, prob_gana_b: 0.4, formato: 'bo3', resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0, brier: 0.3 },
      { series_id: 'a', equipo_a: 1, equipo_b: 2, prob_gana_a: 0.6, prob_gana_b: 0.4, formato: 'bo3', resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0, brier: 0.3, start_time: '2026-08-14T05:00:00Z' },
    ],
    nombre,
    null,
  );
  assert.ok(msg.indexOf('Team Spirit') < msg.indexOf('Sin fecha'), 'lo fechado va primero: ' + msg);
});

test('agrupar: series de días distintos salen en orden cronológico', () => {
  const msg = mensajeResultados(
    [
      { series_id: 'nueva', equipo_a: 3, equipo_b: 4, prob_gana_a: 0.6, prob_gana_b: 0.4, formato: 'bo3', resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0, brier: 0.3, start_time: '2026-08-20T05:00:00Z' },
      { series_id: 'vieja', equipo_a: 1, equipo_b: 2, prob_gana_a: 0.6, prob_gana_b: 0.4, formato: 'bo3', resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0, brier: 0.3, start_time: '2026-08-14T05:00:00Z' },
    ],
    nombre,
    null,
  );
  assert.ok(msg.indexOf('Team Spirit') < msg.indexOf('Iron Wing'), 'la del 14 va antes que la del 20: ' + msg);
});
