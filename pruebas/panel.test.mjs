import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'https://prueba.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'llave-de-prueba';

const { archivoDeFicha, formaDeEquipo, calcularMetricas, construirFicha, enVenezuela } = await import('../salida/web/generar.mjs');
const { distribucionMarcadores, probabilidadPartidaDesdeSerie } = await import('../motor/series.mjs');

test('archivoDeFicha: sanea los ":" que Windows no admite en nombres de archivo', () => {
  assert.equal(archivoDeFicha('mfiWqjJT5B:0003'), 'serie-mfiWqjJT5B-0003.html');
});

test('archivoDeFicha: no deja pasar caracteres de ruta (nada de escapar del directorio)', () => {
  for (const malicioso of ['../../etc/passwd', 'C:\\Windows\\system32', 'a/b/c', '..\\..\\x']) {
    const nombre = archivoDeFicha(malicioso);
    assert.ok(!nombre.includes('/'), 'no debe quedar barra en: ' + nombre);
    assert.ok(!nombre.includes('\\'), 'no debe quedar barra invertida en: ' + nombre);
    assert.ok(!nombre.includes(':'), 'no debe quedar dos puntos en: ' + nombre);
    // Sin separadores, el resultado es un nombre plano: no puede salir del
    // directorio aunque queden puntos sueltos.
    assert.ok(nombre.startsWith('serie-') && nombre.endsWith('.html'), nombre);
  }
});

function partida(match_id, start_time, radiant, dire, radiantGana) {
  return { match_id, start_time, radiant_team_id: radiant, dire_team_id: dire, radiant_win: radiantGana };
}

test('formaDeEquipo: sólo partidas ANTERIORES al corte, más reciente primero', () => {
  const partidas = [
    partida(1, 1000, 'A', 'X', true), // A ganó
    partida(2, 2000, 'Y', 'A', true), // A perdió (jugó de dire)
    partida(3, 5000, 'A', 'Z', true), // después del corte: no debe salir
  ];
  const forma = formaDeEquipo(partidas, 'A', 3000);

  assert.equal(forma.length, 2);
  assert.equal(forma[0].start_time, 2000, 'la más reciente va primero');
  assert.equal(forma[0].gano, false);
  assert.equal(forma[1].gano, true);
});

test('formaDeEquipo: cuenta bien la victoria cuando el equipo jugó de dire', () => {
  const forma = formaDeEquipo([partida(1, 1000, 'X', 'A', false)], 'A', 2000);
  assert.equal(forma[0].gano, true, 'radiant_win=false y A era dire => A ganó');
});

test('formaDeEquipo: respeta el límite de cuántas devuelve', () => {
  const partidas = Array.from({ length: 10 }, (_, i) => partida(i, 1000 + i, 'A', 'X', true));
  assert.equal(formaDeEquipo(partidas, 'A', 9999, 4).length, 4);
});

test('formaDeEquipo: equipo sin partidas previas devuelve lista vacía, no revienta', () => {
  assert.deepEqual(formaDeEquipo([partida(1, 1000, 'A', 'X', true)], 'NUEVO', 2000), []);
});

test('calcularMetricas: sin series devuelve n=0 sin reventar', () => {
  assert.deepEqual(calcularMetricas([]), { n: 0 });
});

test('calcularMetricas: media, mediana y base verificadas a mano', () => {
  const m = calcularMetricas([
    { brier: 0.2, formato: 'bo3', prob_gana_a: 0.8, prob_gana_b: 0.2, resultado_real: 'ganaA' },
    { brier: 0.4, formato: 'bo3', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: 'ganaA' },
    { brier: 0.9, formato: 'bo3', prob_gana_a: 0.7, prob_gana_b: 0.3, resultado_real: 'ganaB' },
  ]);
  assert.equal(m.n, 3);
  assert.ok(Math.abs(m.media - 0.5) < 1e-9); // (0.2+0.4+0.9)/3
  assert.ok(Math.abs(m.mediana - 0.4) < 1e-9);
  assert.ok(Math.abs(m.baseMedia - 0.5) < 1e-9); // los tres son bo3
  assert.equal(m.aciertos, 2); // el favorito ganó en las dos primeras
  assert.equal(m.mejoresQueBase, 2); // 0.2 y 0.4 están bajo 0.5
});

test('calcularMetricas: marca NO concluyente cuando el intervalo contiene la base', () => {
  // Muestra dispersa alrededor de 0.5 -> el intervalo se come la base.
  const m = calcularMetricas([
    { brier: 0.1, formato: 'bo3', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: 'ganaA' },
    { brier: 1.2, formato: 'bo3', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: 'ganaB' },
    { brier: 0.3, formato: 'bo3', prob_gana_a: 0.6, prob_gana_b: 0.4, resultado_real: 'ganaA' },
  ]);
  assert.equal(m.concluyente, false);
});

test('construirFicha: los marcadores de la ficha son consistentes con la predicción guardada', () => {
  // Caso real: Iron Wing 12.3% vs Team Falcons, terminó 2-1 para Iron Wing.
  const serie = {
    series_id: 'x:1',
    formato: 'bo3',
    equipo_a: 1,
    equipo_b: 2,
    start_time: '2026-08-14T05:00:00Z',
    prob_gana_a: 0.123104904273299,
    prob_empate: 0,
    prob_gana_b: 0.876895095726701,
    resultado_real: 'ganaA',
    victorias_a: 2,
    victorias_b: 1,
    brier: 1.5378900178190802,
  };
  const p = probabilidadPartidaDesdeSerie(serie.prob_gana_a, 'bo3');
  const marcadores = distribucionMarcadores(p, 'bo3');

  // La suma de los marcadores de A tiene que dar la probabilidad guardada.
  const sumaA = marcadores.filter((m) => m.gana === 'A').reduce((s, m) => s + m.prob, 0);
  assert.ok(Math.abs(sumaA - serie.prob_gana_a) < 1e-9, 'los marcadores contradicen la predicción guardada');

  const html = construirFicha({
    serie,
    nombre: (id) => (id === 1 ? 'Iron Wing' : 'Team Falcons'),
    p,
    marcadores,
    ratingA: 1575,
    ratingB: 1796,
    formaA: [{ gano: true, start_time: 1 }],
    formaB: [{ gano: false, start_time: 1 }],
    generadoEn: '2026-08-14 10:00 UTC',
  });

  assert.ok(html.includes('Iron Wing'));
  assert.ok(html.includes('2–1'), 'debe mostrar el marcador real');
  assert.ok(html.includes('◇ FALLO'), 'el favorito era Falcons y perdió -> fallo');
  assert.ok(html.includes('1.5379'), 'debe mostrar el brier de la serie');
  assert.ok(html.includes('href="index.html"'), 'debe tener vuelta al panel');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
});

test('construirFicha: escapa el HTML de los nombres de equipo (no inyecta)', () => {
  const serie = {
    series_id: 'x:2',
    formato: 'bo1',
    equipo_a: 1,
    equipo_b: 2,
    start_time: '2026-08-14T05:00:00Z',
    prob_gana_a: 0.6,
    prob_empate: 0,
    prob_gana_b: 0.4,
    resultado_real: 'ganaA',
    victorias_a: 1,
    victorias_b: 0,
    brier: 0.32,
  };
  const html = construirFicha({
    serie,
    nombre: (id) => (id === 1 ? '<script>alert(1)</script>' : 'Normal'),
    p: 0.6,
    marcadores: distribucionMarcadores(0.6, 'bo1'),
    ratingA: 1500,
    ratingB: 1500,
    formaA: [],
    formaB: [],
    generadoEn: 'x',
  });

  assert.ok(!html.includes('<script>alert(1)</script>'), 'el nombre no debe entrar como HTML crudo');
  assert.ok(html.includes('&lt;script&gt;'), 'debe quedar escapado');
});

// --- fichas de series PENDIENTES (predichas, sin jugar). Hoy no hay
// ninguna en la base real porque el suizo de TI publica los cruces de la
// ronda siguiente como TBD, así que el caso se cubre acá.

const seriePendiente = {
  series_id: 'pend:1',
  formato: 'bo3',
  equipo_a: 1,
  equipo_b: 2,
  start_time: '2026-08-15T02:00:00Z',
  creada_en: '2026-08-14T11:00:00Z',
  prob_gana_a: 0.6477403040230347,
  prob_empate: 0,
  prob_gana_b: 0.35225969597696527,
  resultado_real: null,
  victorias_a: null,
  victorias_b: null,
  brier: null,
};

function fichaPendiente(extra = {}) {
  const serie = { ...seriePendiente, ...extra };
  const p = probabilidadPartidaDesdeSerie(Number(serie.prob_gana_a), serie.formato);
  return construirFicha({
    serie,
    nombre: (id) => (id === 1 ? 'Team Yandex' : 'Team Liquid'),
    p,
    marcadores: distribucionMarcadores(p, serie.formato),
    ratingA: 1868,
    ratingB: 1798,
    formaA: [{ gano: true, start_time: 1 }, { gano: false, start_time: 2 }],
    formaB: [{ gano: true, start_time: 1 }],
    generadoEn: '2026-08-14 07:30 VET',
  });
}

test('ficha pendiente: NO inventa resultado, Brier ni juicio', () => {
  const html = fichaPendiente();

  assert.ok(!html.includes('ACIERTO'), 'no puede haber juicio sin resultado');
  assert.ok(!html.includes('FALLO'), 'no puede haber juicio sin resultado');
  assert.ok(!html.includes('RESULTADO REAL'), 'no hay resultado real todavía');
  assert.ok(!html.includes('ocurrió'), 'ningún marcador ocurrió todavía');
  assert.ok(html.includes('SIN JUGAR'), 'debe marcarse como sin jugar');
  assert.ok(html.includes('EMPIEZA'), 'debe decir cuándo empieza');
});

test('ficha pendiente: muestra la predicción y los marcadores posibles', () => {
  const html = fichaPendiente();

  assert.ok(html.includes('Team Yandex'));
  assert.ok(html.includes('Team Liquid'));
  assert.ok(html.includes('64.8'), 'debe mostrar la probabilidad predicha');
  assert.ok(html.includes('2–0') && html.includes('2–1') && html.includes('1–2') && html.includes('0–2'),
    'debe listar los cuatro marcadores del bo3');
  assert.ok(html.includes('TODAVÍA NO PASÓ NINGUNO'), 'la leyenda no debe hablar de marcador real');
});

test('ficha pendiente: la tarjeta de Brier dice que se calcula al terminar, no un número', () => {
  const html = fichaPendiente();
  assert.ok(html.includes('se calcula al terminar'), 'debe explicar que el Brier todavía no existe');
  assert.ok(html.includes('la predicción de arriba queda congelada'));
});

test('ficha pendiente: la narrativa dice el marcador más probable y que no se reescribe', () => {
  const html = fichaPendiente();
  assert.ok(html.includes('Serie sin jugar'));
  assert.ok(html.includes('no se va a reescribir'));
  assert.ok(html.includes('marcador más probable'));
});

test('ficha pendiente: bo2 muestra la tarjeta de empate y el 1–1 entre los marcadores', () => {
  const html = fichaPendiente({ formato: 'bo2', prob_gana_a: 0.42, prob_empate: 0.2, prob_gana_b: 0.38 });
  assert.ok(html.includes('EMPATE'), 'un bo2 sí puede empatar');
  assert.ok(html.includes('1–1'));
});

test('ficha calificada sigue mostrando su juicio (no se rompió con el cambio)', () => {
  const serie = {
    ...seriePendiente,
    resultado_real: 'ganaB',
    victorias_a: 1,
    victorias_b: 2,
    brier: 0.839135002911707,
  };
  const p = probabilidadPartidaDesdeSerie(Number(serie.prob_gana_a), 'bo3');
  const html = construirFicha({
    serie,
    nombre: (id) => (id === 1 ? 'Team Yandex' : 'Team Liquid'),
    p,
    marcadores: distribucionMarcadores(p, 'bo3'),
    ratingA: 1868,
    ratingB: 1798,
    formaA: [],
    formaB: [],
    generadoEn: 'x',
  });

  assert.ok(html.includes('RESULTADO REAL'));
  assert.ok(html.includes('1–2'));
  assert.ok(html.includes('◇ FALLO'), 'el favorito era Yandex y perdió');
  assert.ok(html.includes('0.8391'));
  assert.ok(!html.includes('SIN JUGAR'));
});

// --- hora de Venezuela (VET, UTC-4 todo el año, sin horario de verano)

test('enVenezuela: resta 4 horas', () => {
  assert.deepEqual(enVenezuela('2026-08-14T05:00:00Z'), { fecha: '2026-08-14', hora: '01:00', completo: '2026-08-14 01:00' });
});

test('enVenezuela: cuando cruza medianoche, la FECHA tambien retrocede', () => {
  // Las 02:00 UTC del 15 son las 22:00 del 14 en Venezuela: mostrar la
  // fecha UTC con la hora local seria peor que no convertir.
  assert.deepEqual(enVenezuela('2026-08-15T02:00:00Z'), { fecha: '2026-08-14', hora: '22:00', completo: '2026-08-14 22:00' });
  assert.deepEqual(enVenezuela('2026-08-14T02:00:00Z'), { fecha: '2026-08-13', hora: '22:00', completo: '2026-08-13 22:00' });
});

test('enVenezuela: fecha invalida no revienta', () => {
  assert.deepEqual(enVenezuela('cualquier cosa'), { fecha: '—', hora: '—', completo: '—' });
});

test('la ficha muestra VET y no UTC', () => {
  const html = fichaPendiente();
  assert.ok(html.includes('VET'), 'debe etiquetar la zona horaria');
  assert.ok(!html.includes('UTC'), 'ya no debe quedar ningun UTC visible');
  // start_time 2026-08-15T02:00Z => 22:00 del 14 en Venezuela
  assert.ok(html.includes('22:00'), 'debe mostrar la hora convertida');
  assert.ok(!html.includes('02:00'), 'no debe quedar la hora UTC sin convertir');
});
