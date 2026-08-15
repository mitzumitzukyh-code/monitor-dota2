import { test } from 'node:test';
import assert from 'node:assert/strict';

import { conReintentos } from '../datos/reintentar.mjs';

// Las pruebas no esperan de verdad: se registra cuánto se HABRÍA esperado.
function espia() {
  const esperas = [];
  return { esperas, dormir: async (ms) => void esperas.push(ms) };
}

const respuesta = (status) => ({ status, headers: new Map() });

test('devuelve la respuesta buena al primer intento, sin esperar', async () => {
  const { esperas, dormir } = espia();
  let llamadas = 0;
  const f = conReintentos(async () => (llamadas++, respuesta(200)), { dormir });

  const r = await f('https://ejemplo.test');
  assert.equal(r.status, 200);
  assert.equal(llamadas, 1);
  assert.deepEqual(esperas, []);
});

test('reintenta un 521 y devuelve el 200 que llega después', async () => {
  const { esperas, dormir } = espia();
  const codigos = [521, 521, 200];
  let i = 0;
  const f = conReintentos(async () => respuesta(codigos[i++]), { dormir });

  const r = await f('https://ejemplo.test');
  assert.equal(r.status, 200);
  assert.equal(i, 3);
  // Espera exponencial: 500ms y después 1000ms.
  assert.deepEqual(esperas, [500, 1000]);
});

test('reintenta un 429', async () => {
  const { dormir } = espia();
  const codigos = [429, 200];
  let i = 0;
  const f = conReintentos(async () => respuesta(codigos[i++]), { dormir });
  assert.equal((await f('https://ejemplo.test')).status, 200);
});

// Lo importante: repetir un 404 no lo va a convertir en 200, solo gasta
// presupuesto (regla 5).
test('NO reintenta un 404 ni un 401: no se arreglan solos', async () => {
  for (const status of [400, 401, 404]) {
    const { esperas, dormir } = espia();
    let llamadas = 0;
    const f = conReintentos(async () => (llamadas++, respuesta(status)), { dormir });

    const r = await f('https://ejemplo.test');
    assert.equal(r.status, status);
    assert.equal(llamadas, 1, `${status} no debería reintentarse`);
    assert.deepEqual(esperas, []);
  }
});

test('reintenta cuando se cae la red (no hay respuesta)', async () => {
  const { dormir } = espia();
  let i = 0;
  const f = conReintentos(
    async () => {
      i++;
      if (i < 3) throw new Error('ECONNRESET');
      return respuesta(200);
    },
    { dormir },
  );
  assert.equal((await f('https://ejemplo.test')).status, 200);
  assert.equal(i, 3);
});

test('si la red nunca vuelve, relanza el error original', async () => {
  const { dormir } = espia();
  const f = conReintentos(async () => { throw new Error('ECONNRESET'); }, { dormir, intentos: 2 });
  await assert.rejects(() => f('https://ejemplo.test'), /ECONNRESET/);
});

test('agotados los intentos devuelve la última respuesta, no una excepción', async () => {
  const { dormir } = espia();
  const f = conReintentos(async () => respuesta(503), { dormir, intentos: 3 });
  // Se devuelve el 503 para que quien llama arme su propio mensaje con
  // contexto ("OpenDota respondió 503") en vez de un error genérico.
  assert.equal((await f('https://ejemplo.test')).status, 503);
});

test('respeta el Retry-After que manda el servidor, en segundos', async () => {
  const { esperas, dormir } = espia();
  const codigos = [429, 200];
  let i = 0;
  const f = conReintentos(
    async () => (i === 0 ? (i++, { status: 429, headers: new Map([['retry-after', '3']]) }) : respuesta(200)),
    { dormir },
  );

  await f('https://ejemplo.test');
  assert.deepEqual(esperas, [3000], 'debe hacerle caso al servidor, no a su propio cálculo');
});

test('la espera tiene tope', async () => {
  const { esperas, dormir } = espia();
  const f = conReintentos(async () => respuesta(500), { dormir, intentos: 6, esperaBase: 1000, esperaMaxima: 4000 });
  await f('https://ejemplo.test');
  assert.deepEqual(esperas, [1000, 2000, 4000, 4000, 4000]);
});
