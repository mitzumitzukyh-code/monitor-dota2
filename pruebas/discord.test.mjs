import { test } from 'node:test';
import assert from 'node:assert/strict';

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
  assert.ok(msg.includes('`10 pm`'), 'la hora va en la línea, en 12 horas: ' + msg);
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

// Corre `fn` con DISCORD_WEBHOOK fuera del entorno, y lo restaura después.
// Necesario porque en GitHub Actions la variable SÍ está puesta.
async function sinWebhookEnElEntorno(fn) {
  const previo = process.env.DISCORD_WEBHOOK;
  delete process.env.DISCORD_WEBHOOK;
  try {
    return await fn();
  } finally {
    if (previo !== undefined) process.env.DISCORD_WEBHOOK = previo;
  }
}

test('enviar: sin DISCORD_WEBHOOK no revienta, devuelve enviado:false con la razón', async () => {
  // OJO: pasar `webhook: undefined` NO desactiva el default. En JS el default
  // de destructuring se aplica justamente cuando el valor es undefined, así
  // que tomaría process.env.DISCORD_WEBHOOK. Este test pasaba en local sólo
  // porque la variable no estaba en el entorno, y falló en GitHub Actions
  // donde sí está: era un test falsamente verde. Hay que sacarla de verdad.
  const r = await sinWebhookEnElEntorno(() =>
    enviar('hola', { fetchImpl: async () => { throw new Error('no debe llamarse'); } }),
  );
  assert.equal(r.enviado, false);
  assert.match(r.razon, /DISCORD_WEBHOOK/);
});

test('enviar: un webhook vacío tampoco intenta enviar', async () => {
  // La cadena vacía sí evita el default (no es undefined), y es lo que
  // llegaría de un secreto mal configurado.
  const r = await enviar('hola', { webhook: '', fetchImpl: async () => { throw new Error('no debe llamarse'); } });
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

// --- avisar(): el ciclo completo. El registro de "ya avisado" vive en
// Supabase (columnas avisado_prediccion_en / avisado_resultado_en), no en un
// archivo: en GitHub Actions no hay disco que persista entre corridas.

function supabaseFalso({ series, preds, teams }, registro = []) {
  return async (url, opts = {}) => {
    if (opts.method === 'PATCH') {
      registro.push({ url, cambios: JSON.parse(opts.body) });
      return respuestaFetch([]);
    }
    if (url.includes('dota_series')) return respuestaFetch(series);
    if (url.includes('dota_predictions')) return respuestaFetch(preds);
    if (url.includes('dota_teams')) return respuestaFetch(teams);
    return respuestaFetch([]);
  };
}

const equipos = [{ team_id: 1, nombre: 'Team Spirit' }, { team_id: 2, nombre: 'Aurora Gaming' }];
const unaSerie = { series_id: 's1', equipo_a: 1, equipo_b: 2, formato: 'bo3', start_time: '2026-08-15T02:00:00Z', terminada: false };

test('avisar: avisa una predicción nueva y la marca en la base', async () => {
  process.env.DISCORD_WEBHOOK = 'https://discord.test/w';
  const patches = [];
  let envios = 0;

  const r = await avisar({
    fetchImpl: async () => { envios++; return respuestaFetch({}); },
    fetchImplSupabase: supabaseFalso(
      { series: [unaSerie], preds: [{ series_id: 's1', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: null, brier: null, avisado_prediccion_en: null }], teams: equipos },
      patches,
    ),
  });

  assert.equal(r.nuevasPredichas, 1);
  assert.equal(envios, 1);
  assert.equal(patches.length, 1, 'debe marcar en la base');
  assert.ok(patches[0].cambios.avisado_prediccion_en, 'debe escribir la fecha de aviso');
  assert.ok(patches[0].url.includes('s1'));
  delete process.env.DISCORD_WEBHOOK;
});

test('avisar: una serie ya marcada en la base NO se vuelve a avisar', async () => {
  process.env.DISCORD_WEBHOOK = 'https://discord.test/w';
  let envios = 0;

  const r = await avisar({
    fetchImpl: async () => { envios++; return respuestaFetch({}); },
    fetchImplSupabase: supabaseFalso({
      series: [unaSerie],
      // avisado_prediccion_en ya tiene fecha: se avisó en una corrida anterior
      preds: [{ series_id: 's1', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: null, brier: null, avisado_prediccion_en: '2026-08-14T10:00:00Z' }],
      teams: equipos,
    }),
  });

  assert.equal(r.nuevasPredichas, 0);
  assert.equal(envios, 0, 'no debe mandar nada');
  delete process.env.DISCORD_WEBHOOK;
});

test('avisar: si el envío falla, NO marca en la base (se reintenta después)', async () => {
  process.env.DISCORD_WEBHOOK = 'https://discord.test/w';
  const patches = [];

  const r = await avisar({
    fetchImpl: async () => respuestaFetch({ error: 'caido' }, false, 500),
    fetchImplSupabase: supabaseFalso(
      { series: [unaSerie], preds: [{ series_id: 's1', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: null, brier: null, avisado_prediccion_en: null }], teams: equipos },
      patches,
    ),
  });

  assert.equal(r.enviados[0].enviado, false);
  assert.deepEqual(patches, [], 'un Discord caído no debe marcar como avisado');
  delete process.env.DISCORD_WEBHOOK;
});

test('avisar: predicción y resultado se marcan en columnas distintas', async () => {
  process.env.DISCORD_WEBHOOK = 'https://discord.test/w';
  const patches = [];

  await avisar({
    fetchImpl: async () => respuestaFetch({}),
    fetchImplSupabase: supabaseFalso(
      {
        series: [unaSerie, { ...unaSerie, series_id: 's2', terminada: true }],
        preds: [
          { series_id: 's1', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: null, brier: null, avisado_prediccion_en: null },
          { series_id: 's2', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0, brier: 0.3, avisado_resultado_en: null },
        ],
        teams: equipos,
      },
      patches,
    ),
  });

  const columnas = patches.map((p) => Object.keys(p.cambios)[0]).sort();
  assert.deepEqual(columnas, ['avisado_prediccion_en', 'avisado_resultado_en']);
  delete process.env.DISCORD_WEBHOOK;
});

test('avisar: sin webhook no toca la red ni marca nada', async () => {
  const patches = [];

  // Con el helper y no con un `delete` suelto: así el test no depende de ser
  // el último del archivo ni deja el entorno sucio para los que vengan.
  const r = await sinWebhookEnElEntorno(() =>
    avisar({
      fetchImpl: async () => { throw new Error('no debe tocar la red sin webhook'); },
      fetchImplSupabase: supabaseFalso(
        { series: [unaSerie], preds: [{ series_id: 's1', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: null, brier: null, avisado_prediccion_en: null }], teams: equipos },
        patches,
      ),
    }),
  );

  assert.equal(r.enviados[0].enviado, false);
  assert.match(r.enviados[0].razon, /DISCORD_WEBHOOK/);
  assert.deepEqual(patches, []);
});
