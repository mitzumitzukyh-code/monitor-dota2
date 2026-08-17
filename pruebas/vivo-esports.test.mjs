import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://prueba.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-prueba';

const { predecirProximas, sincronizarRatings, calificarTerminadas } = await import('../juez/vivo-esports.mjs');

const respuesta = (datos) => ({ ok: true, status: 200, json: async () => datos, text: async () => JSON.stringify(datos) });

// Partida cruda de bo3.gg, recortada a los campos que se usan.
function cruda({ id, inicio, a = 100, b = 200, estado = 'upcoming', ganador = null, ma = null, mb = null }) {
  return {
    id,
    discipline_id: 1,
    tournament_id: 1,
    start_date: new Date(inicio * 1000).toISOString(),
    bo_type: 3,
    team1_id: a,
    team2_id: b,
    team1_score: ma,
    team2_score: mb,
    winner_team_id: ganador,
    tier: 'a',
    status: estado,
  };
}

// Simula Supabase: devuelve lo que se le diga por tabla y anota lo escrito.
function supabaseFalso(porTabla = {}) {
  const escrituras = [];
  const fetchImpl = async (url, opciones) => {
    const tabla = String(url).match(/\/rest\/v1\/([a-z_]+)/)?.[1] ?? '?';
    if (opciones?.method && opciones.method !== 'GET') {
      escrituras.push({ tabla, metodo: opciones.method, filas: JSON.parse(opciones.body) });
      return respuesta([]);
    }
    return respuesta(porTabla[tabla] ?? []);
  };
  return { fetchImpl, escrituras };
}

const AHORA = 1_800_000_000;

// ---------------------------------------------------------------------------
// Garantía 1: cero fuga temporal (regla 6)
// ---------------------------------------------------------------------------
test('predecirProximas: NO predice una partida que ya empezó', async () => {
  const bo3 = async () => respuesta({ results: [cruda({ id: 1, inicio: AHORA - 600 })] });
  const { fetchImpl, escrituras } = supabaseFalso();

  const r = await predecirProximas('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl, ahora: AHORA });

  assert.equal(r.predichas, 0);
  assert.equal(r.yaEmpezaron, 1);
  assert.equal(escrituras.length, 0, 'no debería escribir nada');
});

test('predecirProximas: sí predice una que arranca en el futuro', async () => {
  const bo3 = async () => respuesta({ results: [cruda({ id: 2, inicio: AHORA + 3600 })] });
  const { fetchImpl, escrituras } = supabaseFalso({ eslo_ratings: [], eslo_predicciones: [] });

  const r = await predecirProximas('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl, ahora: AHORA });

  assert.equal(r.predichas, 1);
  const fila = escrituras[0].filas[0];
  assert.equal(fila.match_id, 2);
  assert.equal(fila.motor, 'glicko2');
  // Dos equipos sin historial: rating inicial igual, así que 50-50 exacto.
  assert.equal(Number(fila.prob_a).toFixed(6), '0.500000');
  assert.equal((Number(fila.prob_a) + Number(fila.prob_b)).toFixed(6), '1.000000');
});

// ---------------------------------------------------------------------------
// Garantía 2: una predicción no se reescribe jamás
// ---------------------------------------------------------------------------
test('predecirProximas: NO reescribe una predicción que ya existe', async () => {
  const bo3 = async () => respuesta({ results: [cruda({ id: 3, inicio: AHORA + 3600 })] });
  const { fetchImpl, escrituras } = supabaseFalso({ eslo_predicciones: [{ match_id: 3 }] });

  const r = await predecirProximas('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl, ahora: AHORA });

  assert.equal(r.predichas, 0);
  assert.equal(r.yaPredichas, 1);
  assert.equal(escrituras.length, 0, 'reescribir invalidaría el Brier ya calculado');
});

// ---------------------------------------------------------------------------
// El rating guardado se usa de verdad
// ---------------------------------------------------------------------------
test('predecirProximas: usa el rating guardado, y guarda con qué predijo', async () => {
  const bo3 = async () => respuesta({ results: [cruda({ id: 4, inicio: AHORA + 3600, a: 100, b: 200 })] });
  const { fetchImpl, escrituras } = supabaseFalso({
    eslo_ratings: [
      { team_id: 100, rating: 1800, rd: 60, vol: 0.06, partidas: 50 },
      { team_id: 200, rating: 1400, rd: 60, vol: 0.06, partidas: 50 },
    ],
  });

  await predecirProximas('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl, ahora: AHORA });

  const fila = escrituras[0].filas[0];
  assert.ok(Number(fila.prob_a) > 0.7, `el de 1800 debería ser claro favorito: ${fila.prob_a}`);
  // Sin esto no se puede auditar después por qué salió ese número.
  assert.equal(Number(fila.rating_a), 1800);
  assert.equal(Number(fila.rd_b), 60);
});

test('predecirProximas: más incertidumbre acerca la probabilidad a 0.5', async () => {
  const bo3 = async () => respuesta({ results: [cruda({ id: 5, inicio: AHORA + 3600, a: 100, b: 200 })] });

  const conocido = supabaseFalso({
    eslo_ratings: [
      { team_id: 100, rating: 1800, rd: 60, vol: 0.06, partidas: 50 },
      { team_id: 200, rating: 1400, rd: 60, vol: 0.06, partidas: 50 },
    ],
  });
  const nuevo = supabaseFalso({
    eslo_ratings: [
      { team_id: 100, rating: 1800, rd: 60, vol: 0.06, partidas: 50 },
      { team_id: 200, rating: 1400, rd: 300, vol: 0.06, partidas: 3 },
    ],
  });

  await predecirProximas('cs2', { fetchImpl: bo3, fetchImplSupabase: conocido.fetchImpl, ahora: AHORA });
  await predecirProximas('cs2', { fetchImpl: bo3, fetchImplSupabase: nuevo.fetchImpl, ahora: AHORA });

  const pConocido = Number(conocido.escrituras[0].filas[0].prob_a);
  const pNuevo = Number(nuevo.escrituras[0].filas[0].prob_a);
  assert.ok(pNuevo < pConocido, `contra un rival poco conocido debe ser menos confiado: ${pNuevo} vs ${pConocido}`);
});

// ---------------------------------------------------------------------------
// Sincronización de ratings
// ---------------------------------------------------------------------------
test('sincronizarRatings: aplica las partidas nuevas y mueve los ratings', async () => {
  const bo3 = async () =>
    respuesta({ results: [cruda({ id: 10, inicio: AHORA - 7200, estado: 'finished', ganador: 100, ma: 2, mb: 0 })] });
  const { fetchImpl, escrituras } = supabaseFalso({ eslo_estado: [], eslo_ratings: [] });

  const r = await sincronizarRatings('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl });

  assert.equal(r.aplicadas, 1);
  const ratings = escrituras.find((e) => e.tabla === 'eslo_ratings').filas;
  const ganador = ratings.find((f) => f.team_id === 100);
  const perdedor = ratings.find((f) => f.team_id === 200);
  assert.ok(ganador.rating > 1500, 'el que ganó debe subir');
  assert.ok(perdedor.rating < 1500, 'el que perdió debe bajar');
  assert.equal(ganador.partidas, 1);
});

test('sincronizarRatings: sin partidas nuevas no escribe nada', async () => {
  const bo3 = async () => respuesta({ results: [] });
  const { fetchImpl, escrituras } = supabaseFalso({ eslo_estado: [{ juego: 'cs2', ultimo_inicio: '2026-01-01T00:00:00Z' }] });

  const r = await sincronizarRatings('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl });

  assert.equal(r.aplicadas, 0);
  assert.equal(escrituras.length, 0, 'escribir sin cambios gasta llamadas por gusto (regla 5)');
});

// ---------------------------------------------------------------------------
// Calificación
// ---------------------------------------------------------------------------
test('calificarTerminadas: califica y calcula el Brier de lo que ya se jugó', async () => {
  const bo3 = async () =>
    respuesta({ results: [cruda({ id: 20, inicio: AHORA - 3600, estado: 'finished', ganador: 100, ma: 2, mb: 1 })] });
  const { fetchImpl, escrituras } = supabaseFalso({
    eslo_predicciones: [
      { match_id: 20, juego: 'cs2', equipo_a: 100, equipo_b: 200, prob_a: 0.75, prob_b: 0.25, resultado_real: null },
    ],
  });

  const r = await calificarTerminadas('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl });

  assert.equal(r.calificadas, 1);
  const fila = escrituras[0].filas[0];
  assert.equal(fila.resultado_real, 'ganaA');
  // Se predijo 0.75 y ganó A: (0.75 - 1)^2 = 0.0625. Verificable a mano.
  assert.equal(Number(fila.brier).toFixed(4), '0.0625');
  assert.equal(fila.marcador_a, 2);
});

test('calificarTerminadas: no toca una predicción cuya partida aún no terminó', async () => {
  const bo3 = async () => respuesta({ results: [] });
  const { fetchImpl, escrituras } = supabaseFalso({
    eslo_predicciones: [{ match_id: 21, juego: 'cs2', equipo_a: 100, equipo_b: 200, prob_a: 0.6, resultado_real: null }],
  });

  const r = await calificarTerminadas('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl });
  assert.equal(r.calificadas, 0);
  assert.equal(escrituras.length, 0);
});

// ---------------------------------------------------------------------------
// Un juego sin calibrar no puede entrar en producción (regla 4)
// ---------------------------------------------------------------------------
test('un juego sin coeficientes calibrados falla explícito, no en silencio', async () => {
  await assert.rejects(
    () => predecirProximas('valorant', { fetchImpl: async () => respuesta({ results: [] }) }),
    /no tiene coeficientes calibrados/,
  );
});

test('dota2 está configurado con elo, así que este script lo rechaza', async () => {
  await assert.rejects(
    () => predecirProximas('dota2', { fetchImpl: async () => respuesta({ results: [] }) }),
    /motor 'elo'/,
  );
});
