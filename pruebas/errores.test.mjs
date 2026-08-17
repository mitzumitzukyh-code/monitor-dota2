import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://prueba.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-prueba';

const { mensajeError, contextoDeActions, avisarError } = await import('../salida/errores.mjs');

const CUANDO = new Date('2026-08-18T02:30:00Z'); // 17 ago, 10:30 pm en Venezuela

test('el mensaje dice QUÉ falló, QUIÉN lo causó y CUÁNDO', () => {
  const m = mensajeError({
    paso: 'Ciclo CS2 y LoL',
    actor: 'mitzumitzukyh-code',
    commit: 'b63f23b41889a1894f6a8c57c42268ec83301326',
    mensajeCommit: 'Guarda max_coeff',
    cuando: CUANDO,
  });

  assert.match(m, /Ciclo CS2 y LoL/);
  assert.match(m, /mitzumitzukyh-code/);
  assert.match(m, /b63f23b/, 'el commit va corto, no los 40 caracteres');
  assert.match(m, /Guarda max_coeff/);
  // La conversión a hora de Venezuela cambia también la FECHA: las 02:30 UTC
  // del 18 son las 10:30 pm del 17.
  assert.match(m, /2026-08-17/);
  assert.match(m, /10:30 pm/);
});

test('incluye el enlace directo a la corrida', () => {
  const m = mensajeError({ repo: 'usuario/repo', runId: '123', runNumero: '57', cuando: CUANDO });
  assert.match(m, /github\.com\/usuario\/repo\/actions\/runs\/123/);
  assert.match(m, /corrida 57/);
});

// Un stack de 80 líneas empujaría fuera el qué/quién/cuándo, que es lo que
// de verdad sirve. Se recorta el detalle, no el contexto.
test('recorta un detalle larguísimo pero conserva el contexto', () => {
  const m = mensajeError({
    paso: 'Predecir',
    actor: 'alguien',
    detalle: 'x'.repeat(5000),
    repo: 'u/r',
    runId: '9',
    cuando: CUANDO,
  });

  assert.ok(m.length < 2000, `el mensaje mide ${m.length}`);
  assert.match(m, /recortado/);
  assert.match(m, /Predecir/);
  assert.match(m, /alguien/);
  assert.match(m, /actions\/runs\/9/, 'el enlace tiene que sobrevivir al recorte');
});

test('sin contexto de Actions el mensaje sale igual, con lo que haya', () => {
  const m = mensajeError({ paso: 'Calificar', cuando: CUANDO });
  assert.match(m, /Calificar/);
  assert.doesNotMatch(m, /undefined|null/);
});

test('contextoDeActions lee el entorno de GitHub', () => {
  const c = contextoDeActions({
    GITHUB_ACTOR: 'yo',
    GITHUB_SHA: 'abc123',
    GITHUB_REPOSITORY: 'u/r',
    GITHUB_RUN_ID: '5',
    GITHUB_RUN_NUMBER: '9',
  });
  assert.deepEqual(c, { actor: 'yo', commit: 'abc123', repo: 'u/r', runId: '5', runNumero: '9' });
});

test('fuera de Actions devuelve nulos en vez de reventar', () => {
  assert.deepEqual(contextoDeActions({}), {
    actor: null,
    commit: null,
    repo: null,
    runId: null,
    runNumero: null,
  });
});

// El canal de errores es aparte para que un fallo no se pierda entre veinte
// mensajes de partidas.
test('usa el webhook de errores cuando está configurado', async () => {
  let usado = null;
  const fetchFalso = async (url) => ((usado = url), { ok: true });
  await avisarError(
    { paso: 'x' },
    { fetchImpl: fetchFalso, webhook: 'https://discord.test/errores' },
  );
  assert.equal(usado, 'https://discord.test/errores');
});

test('si no hay canal de errores cae al webhook normal: un fallo nunca queda sin avisar', async () => {
  const previo = process.env.DISCORD_WEBHOOK;
  delete process.env.DISCORD_WEBHOOK_ERRORES;
  process.env.DISCORD_WEBHOOK = 'https://discord.test/normal';

  let usado = null;
  const fetchFalso = async (url) => ((usado = url), { ok: true });
  await avisarError({ paso: 'x' }, { fetchImpl: fetchFalso });

  assert.equal(usado, 'https://discord.test/normal');
  if (previo === undefined) delete process.env.DISCORD_WEBHOOK;
  else process.env.DISCORD_WEBHOOK = previo;
});

test('el aviso de error tampoco pinga: pasa por enviar()', async () => {
  let cuerpo = null;
  const fetchFalso = async (_u, o) => ((cuerpo = JSON.parse(o.body)), { ok: true });
  await avisarError({ paso: 'x' }, { fetchImpl: fetchFalso, webhook: 'https://discord.test/e' });
  assert.deepEqual(cuerpo.allowed_mentions, { parse: [] });
});

// Los mensajes de commit de este repo tienen 20-30 lineas. Meterlos enteros
// dejaba avisos ilegibles: el "que fallo" quedaba enterrado bajo el commit.
test('del mensaje de commit sólo usa la primera línea', () => {
  const m = mensajeError({
    paso: 'ciclo=failure',
    commit: 'abc1234567',
    mensajeCommit: 'Arregla el ciclo\n\nQUE PASO\nUna explicacion larguisima\nde muchas lineas\nque no cabe.',
    cuando: CUANDO,
  });

  assert.match(m, /Arregla el ciclo/);
  assert.doesNotMatch(m, /QUE PASO/, 'el cuerpo del commit está en el enlace, no acá');
  assert.doesNotMatch(m, /muchas lineas/);
  assert.ok(m.length < 600, `el aviso mide ${m.length}, debería ser breve`);
});

test('un título de commit larguísimo se recorta', () => {
  const m = mensajeError({ commit: 'abc1234', mensajeCommit: 'x'.repeat(200), cuando: CUANDO });
  const linea = m.split('\n').find((l) => l.startsWith('**Commit:**'));
  assert.ok(linea.length < 110, `la línea mide ${linea.length}`);
  assert.match(linea, /…/);
});

test('sin mensaje de commit muestra sólo el hash corto', () => {
  const m = mensajeError({ commit: 'abc1234567890', cuando: CUANDO });
  assert.match(m, /\*\*Commit:\*\* `abc1234`/);
  assert.doesNotMatch(m, /— *$/m);
});
