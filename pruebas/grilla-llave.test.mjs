import { test } from 'node:test';
import assert from 'node:assert/strict';

import { grillaDePosiciones, grillaLlave, INICIO_MAIN_EVENT } from '../salida/web/grilla.mjs';

const nombre = (id) => ({ 1: 'Iron Wing', 2: 'Team Spirit', 3: 'TEAM VISION', 4: 'BoomBoys' })[id] ?? `#${id}`;

const T20 = INICIO_MAIN_EVENT + 2 * 3600; // 20 de agosto, 02:00 UTC
const T21 = INICIO_MAIN_EVENT + 26 * 3600; // 21 de agosto

// Cruces reales del calendario publicado (haglund.dev, verificado 2026-08-17).
const pendiente = (o) => ({
  start_time: new Date(T20 * 1000).toISOString(),
  equipo_a: 1,
  equipo_b: 2,
  prob_gana_a: 0.31,
  prob_gana_b: 0.69,
  ...o,
});

const suizo = (o) => ({ startTime: INICIO_MAIN_EVENT - 86400, equipoA: 1, equipoB: 2, victoriasA: 2, victoriasB: 0, ...o });

// ---------------------------------------------------------------------------
// El bug que este archivo existe para que no vuelva: el 20 de agosto, cuando
// el Main Event ya arrancó pero ninguna serie terminó, el panel seguía
// mostrando el suizo, que a esa altura ya no dice nada.
// ---------------------------------------------------------------------------
test('cambia a la llave con CERO series jugadas, si ya hay cruces publicados', () => {
  const r = grillaDePosiciones([suizo()], nombre, { pendientes: [pendiente()] });
  assert.match(r.titulo, /LLAVE/);
});

test('sigue en el suizo mientras no haya nada de playoff', () => {
  const r = grillaDePosiciones([suizo()], nombre, { pendientes: [] });
  assert.match(r.titulo, /SUIZO/);
});

test('un pendiente ANTERIOR al Main Event no dispara la llave', () => {
  const antes = pendiente({ start_time: new Date((INICIO_MAIN_EVENT - 3600) * 1000).toISOString() });
  assert.match(grillaDePosiciones([suizo()], nombre, { pendientes: [antes] }).titulo, /SUIZO/);
});

// ---------------------------------------------------------------------------
// Cómo se dibuja cada estado
// ---------------------------------------------------------------------------
test('una serie por jugar muestra la probabilidad, no un marcador', () => {
  const html = grillaLlave([], nombre, { pendientes: [pendiente()] });
  assert.match(html, /Iron Wing/);
  assert.match(html, /31%/);
  assert.match(html, /69%/);
  assert.match(html, /border-style:dashed/, 'lo que no se jugó va punteado');
});

// Pintar al favorito en negrita antes de que juegue sería dar por ganado algo
// que no pasó. Es justo lo que no se debe hacer.
test('en una serie por jugar NO se resalta a nadie como ganador', () => {
  const html = grillaLlave([], nombre, { pendientes: [pendiente()] });
  const negritas = (html.match(/font-weight:600/g) || []).length;
  assert.equal(negritas, 0, 'nadie gana hasta que se juegue');
});

test('una serie jugada resalta al ganador y muestra el marcador', () => {
  const jugada = { startTime: T20, equipoA: 1, equipoB: 2, victoriasA: 0, victoriasB: 2 };
  const html = grillaLlave([jugada], nombre, {});
  assert.match(html, /font-weight:600/, 'el ganador va resaltado');
  assert.doesNotMatch(html, /border-style:dashed/, 'lo jugado no va punteado');
});

// Lo que va a pasar de verdad el 20 por la tarde.
test('mezcla jugadas y por jugar en el mismo día, en orden', () => {
  const jugada = { startTime: T20, equipoA: 1, equipoB: 2, victoriasA: 2, victoriasB: 1 };
  const porJugar = pendiente({ start_time: new Date((T20 + 3 * 3600) * 1000).toISOString(), equipo_a: 3, equipo_b: 4 });
  const html = grillaLlave([jugada], nombre, { pendientes: [porJugar] });

  assert.ok(html.indexOf('Iron Wing') < html.indexOf('TEAM VISION'), 'la de las 02:00 va antes que la de las 05:00');
  assert.match(html, /border-style:dashed/);
  assert.match(html, /font-weight:600/);
});

test('agrupa por día: dos rondas, dos columnas', () => {
  const html = grillaLlave([], nombre, {
    pendientes: [pendiente(), pendiente({ start_time: new Date(T21 * 1000).toISOString() })],
  });
  assert.match(html, /RONDA 1/);
  assert.match(html, /RONDA 2/);
});

test('sin nada de playoff, la llave dice que está sin definir en vez de salir vacía', () => {
  const html = grillaLlave([], nombre, { pendientes: [] });
  assert.match(html, /LLAVE SIN DEFINIR/);
  assert.match(html, /20 de agosto/);
});

test('un pendiente con fecha inválida no tumba la llave', () => {
  const html = grillaLlave([], nombre, { pendientes: [pendiente({ start_time: 'basura' })] });
  assert.match(html, /LLAVE SIN DEFINIR/);
});

test('una serie por jugar sin probabilidad muestra — y no NaN', () => {
  const html = grillaLlave([], nombre, { pendientes: [pendiente({ prob_gana_a: null, prob_gana_b: null })] });
  assert.doesNotMatch(html, /NaN/);
  assert.match(html, /—/);
});
