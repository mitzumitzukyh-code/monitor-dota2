import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://prueba.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-prueba';

const { seleccionar } = await import('../datos/supabase.mjs');

const respuesta = (datos) => ({ ok: true, status: 200, json: async () => datos, text: async () => '' });
const filas = (n, desde = 0) => Array.from({ length: n }, (_, i) => ({ id: desde + i }));

test('una respuesta corta se devuelve tal cual, sin pedir más', async () => {
  let llamadas = 0;
  const fetchImpl = async () => (llamadas++, respuesta(filas(42)));

  const r = await seleccionar('tabla', '?select=*', { fetchImpl });
  assert.equal(r.length, 42);
  assert.equal(llamadas, 1);
});

// El bug real: PostgREST corta en 1.000 y no avisa. Sin paginar, el llamador
// cree que 1.000 son todas.
test('con más de 1.000 filas pagina hasta traerlas todas', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    const offset = Number(String(url).match(/offset=(\d+)/)?.[1] ?? 0);
    const restantes = 2350 - offset;
    return respuesta(filas(Math.max(0, Math.min(1000, restantes)), offset));
  };

  const r = await seleccionar('tabla', '?select=*&order=id', { fetchImpl });

  assert.equal(r.length, 2350, 'debe traer las 2.350, no 1.000');
  assert.equal(urls.length, 3);
  assert.match(urls[1], /offset=1000/);
  assert.match(urls[2], /offset=2000/);
  // Sin filas repetidas ni saltadas.
  assert.equal(new Set(r.map((x) => x.id)).size, 2350);
});

test('si el llamador puso su propio limit, se respeta y no se pagina', async () => {
  let llamadas = 0;
  const fetchImpl = async () => (llamadas++, respuesta(filas(1000)));

  const r = await seleccionar('tabla', '?select=*&limit=1000', { fetchImpl });
  assert.equal(r.length, 1000);
  assert.equal(llamadas, 1, 'pidió 1.000, recibe 1.000');
});

// Paginar sin orden estable puede repetir o saltar filas, y eso no se nota.
// Falla fuerte antes que devolver algo posiblemente mal.
test('con más de 1.000 filas y sin "order", falla explícito y dice cómo arreglarlo', async () => {
  const fetchImpl = async () => respuesta(filas(1000));

  await assert.rejects(
    () => seleccionar('eslo_cuotas', '?select=*', { fetchImpl }),
    (e) => {
      assert.match(e.message, /no trae "order"/);
      assert.match(e.message, /order=/);
      return true;
    },
  );
});

test('propaga el error de Supabase con su código', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => 'no existe' });
  await assert.rejects(() => seleccionar('inexistente', '?select=*', { fetchImpl }), /respondió 404/);
});

// Que haya "order" no basta: tiene que ser un orden TOTAL. Con una columna de
// valores repetidos el orden dentro del empate queda indefinido y el offset
// repite filas. Pasó de verdad contra la base: ordenando eslo_cuotas sólo por
// capturado_en salían 37 duplicadas de 7.040.
test('detecta un "order" no único: filas repetidas entre páginas', async () => {
  const fetchImpl = async (url) => {
    const offset = Number(String(url).match(/offset=(\d+)/)?.[1] ?? 0);
    // Simula el solapamiento: la segunda página repite 5 de la primera.
    if (offset === 0) return respuesta(filas(1000, 0));
    if (offset === 1000) return respuesta(filas(300, 995));
    return respuesta([]);
  };

  await assert.rejects(
    () => seleccionar('eslo_cuotas', '?select=*&order=capturado_en.asc', { fetchImpl }),
    (e) => {
      assert.match(e.message, /filas repetidas/);
      assert.match(e.message, /no es único/);
      return true;
    },
  );
});

test('un order único pagina limpio y no se queja', async () => {
  const fetchImpl = async (url) => {
    const offset = Number(String(url).match(/offset=(\d+)/)?.[1] ?? 0);
    const restantes = 1500 - offset;
    return respuesta(filas(Math.max(0, Math.min(1000, restantes)), offset));
  };

  const r = await seleccionar('eslo_cuotas', '?select=*&order=capturado_en.asc,match_id.asc', { fetchImpl });
  assert.equal(r.length, 1500);
  assert.equal(new Set(r.map((x) => x.id)).size, 1500);
});

// Falso positivo real de la guarda anterior: `select=match_id` con
// `order=match_id,capturado_en`. Las filas son distintas en la tabla, pero sin
// capturado_en en la proyección se ven idénticas y la detección se disparaba
// sobre una consulta legítima.
test('exige que las columnas del order vengan en el select', async () => {
  const fetchImpl = async () => respuesta(filas(1000));
  await assert.rejects(
    () => seleccionar('eslo_cuotas', '?select=match_id&order=match_id.asc,capturado_en.asc', { fetchImpl }),
    (e) => {
      assert.match(e.message, /capturado_en/);
      assert.match(e.message, /no está en el "select"/);
      return true;
    },
  );
});

test('con select=* no exige nada: ya trae todas las columnas', async () => {
  const fetchImpl = async (url) => {
    const offset = Number(String(url).match(/offset=(\d+)/)?.[1] ?? 0);
    return respuesta(filas(Math.max(0, Math.min(1000, 1200 - offset)), offset));
  };
  const r = await seleccionar('eslo_cuotas', '?select=*&order=capturado_en.asc,match_id.asc', { fetchImpl });
  assert.equal(r.length, 1200);
});
