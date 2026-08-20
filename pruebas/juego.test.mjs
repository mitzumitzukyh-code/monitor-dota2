import { test } from 'node:test';
import assert from 'node:assert/strict';

// Forzado, NO con ??=: si el entorno trae un valor (como en GitHub Actions,
// donde estan los secretos reales), las pruebas apuntarian a la base de
// verdad. Con ??= eso pasaba, y encima heredaban un valor invalido si el
// secreto estaba mal copiado.
process.env.SUPABASE_URL = 'https://prueba.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-prueba';

const { archivoDeFicha, calcularMetricas, agruparPorTorneo, construirPagina, construirFicha, JUEGOS, BASE_ESLO } =
  await import('../salida/web/juego.mjs');
const { probabilidadGanar } = await import('../motor/glicko2.mjs');

const cs2 = JUEGOS.find((j) => j.clave === 'cs2');

function partida(extra = {}) {
  return {
    match_id: 987654321,
    juego: 'cs2',
    equipo_a: 1001,
    equipo_b: 1002,
    inicio_programado: '2026-08-14T05:00:00Z',
    formato: 'bo3',
    motor: 'glicko2',
    prob_a: 0.6477403040230347,
    prob_b: 0.35225969597696527,
    rating_a: 1868,
    rd_a: 87,
    rating_b: 1798,
    rd_b: 112,
    creada_en: '2026-08-14T04:00:00Z',
    resultado_real: 'ganaA',
    marcador_a: 2,
    marcador_b: 0,
    brier: 0.1240384104169059,
    calificada_en: '2026-08-14T08:00:00Z',
    torneo_id: 5001,
    tier: 's',
    ...extra,
  };
}

const nombre = (id) => (id === 1001 ? 'Team Yandex' : 'Team Liquid');

test('archivoDeFicha: un match_id numérico sale limpio', () => {
  assert.equal(archivoDeFicha(987654321), 'partida-987654321.html');
});

test('archivoDeFicha: no deja pasar caracteres de ruta (nada de escapar del directorio)', () => {
  for (const malicioso of ['../../etc/passwd', 'C:\\Windows\\system32', 'a/b/c', '..\\..\\x']) {
    const nombreArchivo = archivoDeFicha(malicioso);
    assert.ok(!nombreArchivo.includes('/'), 'no debe quedar barra en: ' + nombreArchivo);
    assert.ok(!nombreArchivo.includes('\\'), 'no debe quedar barra invertida en: ' + nombreArchivo);
    assert.ok(!nombreArchivo.includes(':'), 'no debe quedar dos puntos en: ' + nombreArchivo);
    assert.ok(nombreArchivo.startsWith('partida-') && nombreArchivo.endsWith('.html'), nombreArchivo);
  }
});

test('calcularMetricas: sin partidas devuelve n=0 sin reventar', () => {
  assert.deepEqual(calcularMetricas([]), { n: 0 });
});

test('calcularMetricas: media, mediana y base verificadas a mano (base 0.25)', () => {
  const m = calcularMetricas([
    { prob_a: 0.8, resultado_real: 'ganaA', brier: 0.04 },
    { prob_a: 0.6, resultado_real: 'ganaA', brier: 0.16 },
    { prob_a: 0.7, resultado_real: 'ganaB', brier: 0.49 },
  ]);
  assert.equal(m.n, 3);
  assert.ok(Math.abs(m.media - 0.23) < 1e-9); // (0.04+0.16+0.49)/3
  assert.ok(Math.abs(m.mediana - 0.16) < 1e-9);
  assert.equal(m.baseMedia, BASE_ESLO);
  assert.equal(m.aciertos, 2); // el favorito ganó en las dos primeras
  assert.equal(m.mejoresQueBase, 2); // 0.04 y 0.16 están bajo 0.25
});

test('calcularMetricas: favorito es A cuando prob_a >= 0.5, aunque sea por poco', () => {
  const m = calcularMetricas([{ prob_a: 0.5001, resultado_real: 'ganaB', brier: 0.25 }]);
  assert.equal(m.aciertos, 0, 'A era el favorito por 0.0001 y perdió');
  const m2 = calcularMetricas([{ prob_a: 0.4999, resultado_real: 'ganaB', brier: 0.25 }]);
  assert.equal(m2.aciertos, 1, 'B era el favorito por 0.0001 y ganó');
  const m3 = calcularMetricas([{ prob_a: 0.4999, resultado_real: 'ganaA', brier: 0.25 }]);
  assert.equal(m3.aciertos, 0, 'B era el favorito por 0.0001 y A ganó: upset contado como fallo');
});

test('calcularMetricas: marca NO concluyente cuando el intervalo contiene la base', () => {
  const m = calcularMetricas([
    { prob_a: 0.6, resultado_real: 'ganaA', brier: 0.1 },
    { prob_a: 0.6, resultado_real: 'ganaB', brier: 1.2 },
    { prob_a: 0.6, resultado_real: 'ganaA', brier: 0.3 },
  ]);
  assert.equal(m.concluyente, false);
});

test('agruparPorTorneo: agrupa, cuenta aciertos y resuelve nombres', () => {
  const calificadas = [
    partida({ match_id: 1, torneo_id: 5001, tier: 's', prob_a: 0.8, resultado_real: 'ganaA', brier: 0.04, inicio_programado: '2026-08-10T05:00:00Z' }),
    partida({ match_id: 2, torneo_id: 5001, tier: 's', prob_a: 0.7, resultado_real: 'ganaB', brier: 0.49, inicio_programado: '2026-08-11T05:00:00Z' }),
    partida({ match_id: 3, torneo_id: 5002, tier: 'a', prob_a: 0.9, resultado_real: 'ganaA', brier: 0.01, inicio_programado: '2026-08-12T05:00:00Z' }),
  ];
  const torneos = agruparPorTorneo(calificadas, new Map([[5001, 'IEM Katowice'], [5002, 'ESL Pro League']]));

  assert.equal(torneos.length, 2);
  const [t5002, t5001] = torneos; // el más reciente (5002) va primero
  assert.equal(t5002.nombre, 'ESL Pro League');
  assert.equal(t5002.n, 1);
  assert.equal(t5002.aciertos, 1);
  assert.ok(Math.abs(t5002.brier - 0.01) < 1e-9);
  assert.equal(t5001.nombre, 'IEM Katowice');
  assert.equal(t5001.n, 2);
  assert.equal(t5001.aciertos, 1);
  assert.ok(Math.abs(t5001.brier - 0.265) < 1e-9);
});

test('agruparPorTorneo: sin torneo_id cae a "Sin torneo" y no revienta', () => {
  const calificadas = [partida({ match_id: 9, torneo_id: null, tier: null })];
  const torneos = agruparPorTorneo(calificadas, new Map());
  assert.equal(torneos.length, 1);
  assert.equal(torneos[0].nombre, 'Sin torneo');
});

test('construirPagina: arma la página del juego con sus secciones', () => {
  const html = construirPagina({
    juego: cs2,
    calificadas: [partida()],
    pendientes: [partida({ match_id: 555, resultado_real: null, marcador_a: null, marcador_b: null, brier: null })],
    torneos: agruparPorTorneo([partida()], new Map([[5001, 'IEM Katowice']])),
    ranking: [
      { teamId: 1001, nombre: 'Team Yandex', rating: 1868, rd: 87, partidas: 234 },
      { teamId: 1002, nombre: 'Team Liquid', rating: 1798, rd: 112, partidas: 189 },
    ],
    totalEquipos: 4031,
    nombre,
    metricas: calcularMetricas([partida()]),
    generadoEn: '2026-08-14 10:00 VET',
  });

  assert.ok(html.includes('Counter-Strike 2'));
  assert.ok(html.includes('IEM Katowice'), 'el desglose por torneo trae el nombre resuelto');
  assert.ok(html.includes('TIER S'), 'el tier aparece en el desglose');
  assert.ok(html.includes('href="partida-987654321.html"'), 'las calificadas enlazan a su ficha');
  assert.ok(html.includes('href="partida-555.html"'), 'las pendientes enlazan a su ficha');
  assert.ok(html.includes('ACERTÓ') && html.includes('Team Yandex'));
  assert.ok(html.includes('1868'), 'el ranking muestra el rating');
  assert.ok(html.includes('±87'), 'el ranking muestra la RD');
  assert.ok(html.includes('4031'), 'el ranking dice de cuántos equipos sale el top');
  assert.ok(html.includes('0.1240'), 'debe mostrar el Brier medio');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
});

test('construirPagina: sin calificadas se ve el vacío, no revienta', () => {
  const html = construirPagina({
    juego: cs2,
    calificadas: [],
    pendientes: [],
    torneos: [],
    ranking: [],
    totalEquipos: 0,
    nombre,
    metricas: calcularMetricas([]),
    generadoEn: 'x',
  });
  assert.ok(html.includes('Sin partidas calificadas'));
  assert.ok(html.includes('Por torneo'));
});

test('construirPagina: escapa el HTML de los nombres de equipo y torneo (no inyecta)', () => {
  const html = construirPagina({
    juego: cs2,
    calificadas: [partida({ torneo_id: 1 })],
    pendientes: [],
    torneos: agruparPorTorneo([partida({ torneo_id: 1 })], new Map([[1, '<script>torneo()</script>']])),
    ranking: [{ teamId: 1001, nombre: '<script>equipo()</script>', rating: 1500, rd: 100, partidas: 1 }],
    totalEquipos: 1,
    nombre: (id) => (id === 1001 ? '<script>equipo()</script>' : 'Normal'),
    metricas: calcularMetricas([partida({ torneo_id: 1 })]),
    generadoEn: 'x',
  });
  assert.ok(!html.includes('<script>'), 'ningún nombre debe entrar como HTML crudo');
  assert.ok(html.includes('&lt;script&gt;'), 'debe quedar escapado');
});

test('construirFicha: calificada muestra marcador real, brier y el estado congelado', () => {
  const html = construirFicha({
    partida: partida(),
    juego: cs2,
    nombre,
    cuota: { max_coeff_a: 1.85, coeff_a: 1.9, max_coeff_b: 1.95, coeff_b: 2.0 },
    nombreTorneo: 'IEM Katowice 2026',
    generadoEn: '2026-08-14 10:00 VET',
  });

  assert.ok(html.includes('Team Yandex') && html.includes('Team Liquid'));
  assert.ok(html.includes('2–0'), 'debe mostrar el marcador real');
  assert.ok(html.includes('ACERTÓ'), 'el favorito (Yandex, 64.8%) ganó');
  assert.ok(html.includes('0.1240'), 'debe mostrar el brier de la partida');
  assert.ok(html.includes('1868') && html.includes('± 87'), 'debe mostrar el rating y la RD de A');
  assert.ok(html.includes('1798') && html.includes('± 112'), 'debe mostrar el rating y la RD de B');
  assert.ok(html.includes('1.85') && html.includes('1.95'), 'debe mostrar la cuota del mercado');
  assert.ok(html.includes('IEM Katowice 2026') && html.includes('TIER S'), 'debe mostrar torneo y tier');
  assert.ok(html.includes('href="cs2.html"'), 'la ficha vuelve a la página del juego');
  assert.ok(!html.includes('SIN JUGAR'), 'la partida está calificada');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
});

test('construirFicha: la probabilidad mostrada reproduce el estado guardado', () => {
  // El estado se fabrica PRIMERO y prob_a se deriva de él, para que la
  // reproducción tenga que coincidir exactamente (1e-9).
  const estados = { rating_a: 1868, rd_a: 87, rating_b: 1798, rd_b: 112 };
  const esperada = probabilidadGanar(
    { rating: estados.rating_a, rd: estados.rd_a, vol: 0 },
    { rating: estados.rating_b, rd: estados.rd_b, vol: 0 },
  );
  const html = construirFicha({
    partida: partida({ ...estados, prob_a: esperada, prob_b: 1 - esperada }),
    juego: cs2,
    nombre,
    generadoEn: 'x',
  });
  const pct = (esperada * 100).toFixed(1);
  assert.ok(html.includes(`${pct}%`), `debe reproducir la p que sale del estado: ${pct}%`);
  assert.ok(html.includes('se reproduce la predicción guardada'), 'la narrativa lo dice cuando coincide');
});

test('construirFicha: pendiente NO inventa resultado, Brier ni juicio', () => {
  const html = construirFicha({
    partida: partida({ resultado_real: null, marcador_a: null, marcador_b: null, brier: null }),
    juego: cs2,
    nombre,
    cuota: null,
    nombreTorneo: null,
    generadoEn: 'x',
  });

  assert.ok(!html.includes('ACERTÓ'), 'no puede haber juicio sin resultado');
  assert.ok(!html.includes('FALLÓ'), 'no puede haber juicio sin resultado');
  assert.ok(!html.includes('RESULTADO REAL'), 'no hay resultado real todavía');
  assert.ok(html.includes('SIN JUGAR'), 'debe marcarse como sin jugar');
  assert.ok(html.includes('EMPIEZA'), 'debe decir cuándo empieza');
  assert.ok(html.includes('se calcula al terminar'), 'el Brier dice que todavía no existe');
  assert.ok(html.includes('64.8'), 'debe mostrar la probabilidad predicha');
});

test('construirFicha: sin cuota capturada lo dice, no inventa un número', () => {
  const html = construirFicha({
    partida: partida(),
    juego: cs2,
    nombre,
    cuota: null,
    nombreTorneo: null,
    generadoEn: 'x',
  });
  assert.ok(html.includes('No se capturó cuota para esta partida'));
  assert.ok(!html.includes('Cuota <span'), 'sin cuota no se dibuja la tarjeta con números');
});

test('construirFicha: escapa el HTML de los nombres de equipo (no inyecta)', () => {
  const html = construirFicha({
    partida: partida(),
    juego: cs2,
    nombre: (id) => (id === 1001 ? '<script>alert(1)</script>' : 'Normal'),
    generadoEn: 'x',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'el nombre no debe entrar como HTML crudo');
  assert.ok(html.includes('&lt;script&gt;'), 'debe quedar escapado');
});