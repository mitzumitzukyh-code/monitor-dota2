import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginarProMatches, limpiar, validar, segundosDesdeHace } from '../datos/historico.mjs';

function partida(match_id, start_time, extra = {}) {
  return {
    match_id,
    start_time,
    duration: 2000,
    radiant_team_id: 111,
    radiant_name: 'Equipo A',
    dire_team_id: 222,
    dire_name: 'Equipo B',
    leagueid: 999,
    league_name: 'Torneo de prueba',
    series_id: 555,
    series_type: 1,
    radiant_score: 30,
    dire_score: 20,
    radiant_win: true,
    ...extra,
  };
}

function respuesta(pagina) {
  return { ok: true, status: 200, json: async () => pagina };
}

test('paginarProMatches: pagina hacia atrás con less_than_match_id hasta cruzar el cutoff', async () => {
  const paginas = [
    [partida(300, 3000), partida(299, 2900)],
    [partida(298, 2800), partida(297, 1500)],
  ];
  const llamadas = [];
  const fetchImpl = async (url) => {
    llamadas.push(url);
    return respuesta(paginas.shift());
  };

  const resultado = await paginarProMatches({ fetchImpl, cutoffTimestamp: 2000, esperaMs: 0 });

  assert.equal(llamadas.length, 2);
  assert.ok(!llamadas[0].includes('less_than_match_id'));
  assert.ok(llamadas[1].includes('less_than_match_id=299'));
  assert.deepEqual(resultado.map((p) => p.match_id), [300, 299, 298]);
});

test('paginarProMatches: se detiene si una página viene vacía', async () => {
  const paginas = [[partida(100, 5000)], []];
  const fetchImpl = async () => respuesta(paginas.shift());

  const resultado = await paginarProMatches({ fetchImpl, cutoffTimestamp: 0, esperaMs: 0 });

  assert.equal(resultado.length, 1);
});

test('paginarProMatches: reintenta con backoff en un 429 y sigue si luego responde bien', async () => {
  let llamadas = 0;
  const fetchImpl = async () => {
    llamadas++;
    if (llamadas <= 2) return { ok: false, status: 429 };
    if (llamadas === 3) return respuesta([partida(1, 1000)]);
    return respuesta([]);
  };

  const resultado = await paginarProMatches({
    fetchImpl,
    cutoffTimestamp: 0,
    esperaMs: 0,
    esperaReintentoMs: 0,
  });

  assert.equal(llamadas, 4);
  assert.equal(resultado.length, 1);
});

test('paginarProMatches: si el 429 no se resuelve tras maxReintentos, propaga el error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429 });

  await assert.rejects(
    () => paginarProMatches({ fetchImpl, cutoffTimestamp: 0, esperaMs: 0, esperaReintentoMs: 0, maxReintentos: 2 }),
    /429/,
  );
});

test('paginarProMatches: propaga error si OpenDota responde con otro status distinto de 200/429', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });

  await assert.rejects(
    () => paginarProMatches({ fetchImpl, cutoffTimestamp: 0, esperaMs: 0 }),
    /500/,
  );
});

test('paginarProMatches: onPagina se llama con cada página y el acumulado hasta el momento', async () => {
  const paginas = [[partida(2, 2000), partida(1, 1000)]];
  const fetchImpl = async () => respuesta(paginas.shift());
  const vistas = [];

  await paginarProMatches({
    fetchImpl,
    cutoffTimestamp: 1500,
    esperaMs: 0,
    onPagina: (pagina, acumuladas) => vistas.push({ tamañoPagina: pagina.length, tamañoAcumulado: acumuladas.length }),
  });

  assert.deepEqual(vistas, [{ tamañoPagina: 2, tamañoAcumulado: 2 }]);
});

test('limpiar: se queda solo con los campos que usa el motor', () => {
  const crudas = [partida(1, 1000, { extra_campo_que_no_usamos: 'x' })];
  const [limpia] = limpiar(crudas);

  assert.deepEqual(Object.keys(limpia).sort(), [
    'dire_name',
    'dire_team_id',
    'league_name',
    'leagueid',
    'match_id',
    'radiant_name',
    'radiant_team_id',
    'radiant_win',
    'series_id',
    'series_type',
    'start_time',
  ]);
});

test('validar: data limpia real no reporta problemas', () => {
  const partidas = limpiar([partida(1, 1000), partida(2, 2000)]);
  const reporte = validar(partidas);

  assert.equal(reporte.valido, true);
  assert.equal(reporte.problemas.length, 0);
  assert.equal(reporte.total, 2);
  assert.equal(reporte.sinEquipo, 0);
  assert.equal(reporte.sinNombre, 0);
});

test('validar: detecta match_id duplicado', () => {
  const partidas = limpiar([partida(1, 1000), partida(1, 1000)]);
  const reporte = validar(partidas);

  assert.equal(reporte.valido, false);
  assert.ok(reporte.problemas.some((p) => p.includes('duplicado')));
});

test('validar: detecta radiant_win que no es booleano', () => {
  const partidas = limpiar([partida(1, 1000, { radiant_win: 'sí' })]);
  const reporte = validar(partidas);

  assert.equal(reporte.valido, false);
  assert.ok(reporte.problemas.some((p) => p.includes('radiant_win')));
});

test('validar: cuenta partidas sin team_id y sin nombre, sin marcarlas como error duro', () => {
  const partidas = limpiar([
    partida(1, 1000, { radiant_team_id: null, radiant_name: null }),
    partida(2, 2000, { dire_name: null }),
  ]);
  const reporte = validar(partidas);

  assert.equal(reporte.valido, true);
  assert.equal(reporte.sinEquipo, 1);
  assert.equal(reporte.sinNombre, 2);
});

test('validar: detecta start_time inválido', () => {
  const partidas = limpiar([partida(1, 0)]);
  const reporte = validar(partidas);

  assert.equal(reporte.valido, false);
  assert.ok(reporte.problemas.some((p) => p.includes('start_time')));
});

test('segundosDesdeHace: 1 mes atrás cae ~30 días antes en segundos', () => {
  const ahoraMs = new Date('2026-08-13T00:00:00Z').getTime();
  const cutoff = segundosDesdeHace(1, ahoraMs);
  const esperado = Math.floor(new Date('2026-07-14T00:00:00Z').getTime() / 1000);

  assert.equal(cutoff, esperado);
});
