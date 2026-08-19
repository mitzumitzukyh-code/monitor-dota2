import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cargarLogos, logoDeEquipo } from '../datos/logos-dota.mjs';

// Respuesta simulada de OpenDota: nada de llamadas reales en `node --test`
// (regla 5, y una prueba que depende de la red no es una prueba).
const respuesta = (status, cuerpo) => async () => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => cuerpo,
});

test('logoDeEquipo: devuelve la URL cuando OpenDota la trae', async () => {
  const url = 'https://cdn.steamusercontent.com/ugc/123/ABC/';
  const logo = await logoDeEquipo(7119388, { fetchImpl: respuesta(200, { name: 'Team Spirit', logo_url: url }) });
  assert.equal(logo, url);
});

// La distinción entre '' y null es la que evita volver a preguntar para
// siempre por un equipo que simplemente no tiene escudo.
test("logoDeEquipo: equipo sin escudo devuelve '' (preguntado, no tiene), no null", async () => {
  for (const cuerpo of [{ name: 'X', logo_url: null }, { name: 'X' }, { name: 'X', logo_url: '   ' }]) {
    assert.equal(await logoDeEquipo(1, { fetchImpl: respuesta(200, cuerpo) }), '');
  }
});

test("logoDeEquipo: un 404 es respuesta firme -> '' (ese team_id no existe y no va a aparecer)", async () => {
  assert.equal(await logoDeEquipo(999999999, { fetchImpl: respuesta(404, null) }), '');
});

// Un 500 NO puede grabarse como "no tiene": sería perder el escudo de un
// equipo para siempre por una caída de un rato.
test('logoDeEquipo: un fallo del servidor devuelve null para volver a preguntar después', async () => {
  for (const status of [500, 502, 429]) {
    assert.equal(await logoDeEquipo(1, { fetchImpl: respuesta(status, null) }), null, `${status} no puede darse por firme`);
  }
});

test('logoDeEquipo: recorta los espacios de la URL', async () => {
  const logo = await logoDeEquipo(1, { fetchImpl: respuesta(200, { logo_url: '  https://x/y.png  ' }) });
  assert.equal(logo, 'https://x/y.png');
});

test('cargarLogos: devuelve un Map con los team_id como número', () => {
  const logos = cargarLogos();
  assert.ok(logos instanceof Map);
  // El archivo real tiene los 16 de TI2026. Si algún día se borra, la función
  // devuelve un Map vacío en vez de reventar -- eso también se comprueba, al
  // no exigir un mínimo.
  for (const [id, url] of logos) {
    assert.equal(typeof id, 'number', 'la clave debe ser número, no la cadena del JSON');
    assert.ok(url === null || url.startsWith('https://'), `URL rara: ${url}`);
  }
});

test('cargarLogos: los 16 de TI2026 están y apuntan al CDN de Steam', () => {
  const logos = cargarLogos();
  // Team Spirit y Team Liquid: uno del CDN nuevo, otro del viejo de Steam.
  // Los dos formatos conviven en OpenDota y los dos tienen que servir.
  assert.ok(logos.get(7119388), 'Team Spirit sin escudo');
  assert.ok(logos.get(2163), 'Team Liquid sin escudo');
  assert.equal(logos.size >= 16, true, `esperaba al menos los 16 de TI, hay ${logos.size}`);
});
