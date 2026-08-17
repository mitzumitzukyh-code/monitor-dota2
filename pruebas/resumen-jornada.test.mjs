import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://prueba.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-prueba';

const { bloquesDeJuego } = await import('../salida/formato.mjs');
const { mensajeResumenDia, jornadaParaResumir } = await import('../salida/discord.mjs');
const { tablaDePosiciones } = await import('../juez/tabla.mjs');

const nombre = (id) => ({ 1: 'Team Spirit', 2: 'Aurora Gaming', 3: 'Iron Wing', 4: 'Team Falcons' })[id] ?? `#${id}`;

// Horas reales de TI en Venezuela (UTC-4): 22:00 y 01:00 local son 02:00 y
// 05:00 UTC del día siguiente.
const NOCHE_1_A = '2026-08-14T02:00:00Z'; // 13 ago, 10 pm Vzla
const NOCHE_1_B = '2026-08-14T05:00:00Z'; // 14 ago, 1 am Vzla
const NOCHE_2_A = '2026-08-15T02:00:00Z'; // 14 ago, 10 pm Vzla

test('bloquesDeJuego() mete 10 pm y 1 am en la MISMA jornada', () => {
  const bloques = bloquesDeJuego([{ start_time: NOCHE_1_A }, { start_time: NOCHE_1_B }]);
  assert.equal(bloques.length, 1);
  assert.equal(bloques[0].items.length, 2);
});

test('bloquesDeJuego() separa dos noches distintas', () => {
  const bloques = bloquesDeJuego([{ start_time: NOCHE_1_A }, { start_time: NOCHE_1_B }, { start_time: NOCHE_2_A }]);
  assert.equal(bloques.length, 2);
  assert.deepEqual(bloques.map((b) => b.items.length), [2, 1]);
});

test('jornadaParaResumir() no cierra una jornada con series sin calificar', () => {
  const todas = [
    { series_id: 'a', start_time: NOCHE_1_A, resultado_real: 'ganaA' },
    { series_id: 'b', start_time: NOCHE_1_B, resultado_real: null },
  ];
  assert.equal(jornadaParaResumir(todas, new Date('2026-08-16T00:00:00Z')), null);
});

test('jornadaParaResumir() espera a que se asiente antes de cerrar', () => {
  const todas = [
    { series_id: 'a', start_time: NOCHE_1_A, resultado_real: 'ganaA' },
    { series_id: 'b', start_time: NOCHE_1_B, resultado_real: 'ganaB' },
  ];
  // 2 horas después del arranque de la última: todavía puede aparecer un
  // fixture tardío que pertenece a esta misma jornada.
  assert.equal(jornadaParaResumir(todas, new Date('2026-08-14T07:00:00Z')), null);
  // 7 horas después: ya cerró.
  assert.ok(jornadaParaResumir(todas, new Date('2026-08-14T12:00:00Z')));
});

test('jornadaParaResumir() no repite una jornada ya resumida', () => {
  const todas = [
    { series_id: 'a', start_time: NOCHE_1_A, resultado_real: 'ganaA', avisado_resumen_en: '2026-08-14T12:00:00Z' },
    { series_id: 'b', start_time: NOCHE_1_B, resultado_real: 'ganaB', avisado_resumen_en: '2026-08-14T12:00:00Z' },
  ];
  assert.equal(jornadaParaResumir(todas, new Date('2026-08-14T13:00:00Z')), null);
});

test('jornadaParaResumir() devuelve la jornada más vieja primero', () => {
  const todas = [
    { series_id: 'a', start_time: NOCHE_1_A, resultado_real: 'ganaA' },
    { series_id: 'c', start_time: NOCHE_2_A, resultado_real: 'ganaA' },
  ];
  const j = jornadaParaResumir(todas, new Date('2026-08-16T00:00:00Z'));
  assert.equal(j.items[0].series_id, 'a');
  assert.equal(j.items.length, 1);
});

test('mensajeResumenDia() separa aciertos de fallos', () => {
  const calificadas = [
    // Favorito 1 (70%) gana: acierto.
    { series_id: 'a', start_time: NOCHE_1_A, equipo_a: 1, equipo_b: 2, prob_gana_a: 0.7, prob_gana_b: 0.3, resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0 },
    // Favorito 4 (88%) pierde contra 3: fallo.
    { series_id: 'b', start_time: NOCHE_1_B, equipo_a: 3, equipo_b: 4, prob_gana_a: 0.12, prob_gana_b: 0.88, resultado_real: 'ganaA', victorias_a: 2, victorias_b: 1 },
  ];
  const msg = mensajeResumenDia(calificadas, nombre, []);

  assert.match(msg, /Acertamos 1 de 2/);
  assert.match(msg, /Le atinamos/);
  assert.match(msg, /Team Spirit\*\* 70% · le ganó a Aurora Gaming/);
  assert.match(msg, /Nos equivocamos/);
  assert.match(msg, /Iron Wing\*\* le ganó a Team Falcons · íbamos con Team Falcons 88%/);
});

test('mensajeResumenDia() pinta la tabla y marca solo a los que jugaron', () => {
  const calificadas = [
    { series_id: 'a', start_time: NOCHE_1_A, equipo_a: 1, equipo_b: 2, prob_gana_a: 0.7, prob_gana_b: 0.3, resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0 },
  ];
  // Equipo 3 existe en la tabla pero no jugó esta jornada.
  const tabla = tablaDePosiciones([
    { equipoA: 1, equipoB: 2, victoriasA: 2, victoriasB: 0 },
    { equipoA: 3, equipoB: 2, victoriasA: 2, victoriasB: 1 },
  ]);
  const msg = mensajeResumenDia(calificadas, nombre, tabla);

  assert.match(msg, /Tabla del TI/);
  // Formato agrupado por récord: "1-0 │ Team Spirit›, Iron Wing".
  assert.match(msg, /1-0\s*│/, 'los equipos van agrupados por su récord');
  assert.match(msg, /Team Spirit›/, 'el que jugó esta jornada lleva la marca ›');
  assert.match(msg, /Iron Wing(?!›)/, 'el que no jugó va sin marca');
});

test('mensajeResumenDia() agrupa por récord y queda más corto que una fila por equipo', () => {
  const calificadas = [
    { series_id: 'a', start_time: NOCHE_1_A, equipo_a: 1, equipo_b: 2, prob_gana_a: 0.7, prob_gana_b: 0.3, resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0 },
  ];
  // Cuatro equipos empatados en 1-0 tienen que salir en UN renglón, no cuatro.
  const tabla = tablaDePosiciones([
    { equipoA: 1, equipoB: 5, victoriasA: 2, victoriasB: 0 },
    { equipoA: 2, equipoB: 6, victoriasA: 2, victoriasB: 0 },
    { equipoA: 3, equipoB: 7, victoriasA: 2, victoriasB: 0 },
    { equipoA: 4, equipoB: 8, victoriasA: 2, victoriasB: 0 },
  ]);
  const msg = mensajeResumenDia(calificadas, nombre, tabla);

  const renglones = msg.split('\n').filter((l) => /^\d-\d\s*│/.test(l));
  assert.equal(renglones.length, 2, 'un renglón para los 1-0 y otro para los 0-1');
  assert.match(renglones[0], /,/, 'los empatados van juntos, separados por coma');
});

test('mensajeResumenDia() sin series devuelve null', () => {
  assert.equal(mensajeResumenDia([], nombre, []), null);
});

test('mensajeResumenDia() funciona aunque la tabla venga vacía (OpenDota caído)', () => {
  const calificadas = [
    { series_id: 'a', start_time: NOCHE_1_A, equipo_a: 1, equipo_b: 2, prob_gana_a: 0.7, prob_gana_b: 0.3, resultado_real: 'ganaA', victorias_a: 2, victorias_b: 0 },
  ];
  const msg = mensajeResumenDia(calificadas, nombre, []);
  assert.match(msg, /Acertamos 1 de 1/);
  assert.doesNotMatch(msg, /Tabla del TI/);
});
