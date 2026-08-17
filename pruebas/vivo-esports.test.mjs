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

// ---------------------------------------------------------------------------
// El bug del tope de 1.000 filas de PostgREST.
// Pedir la tabla de ratings entera devuelve sólo las primeras 1.000 filas, sin
// avisar. Los equipos que no entran se tratan como si no tuvieran rating y la
// predicción sale 0.500 exacto, con pinta de legítima. Pasó de verdad: 34 de
// 51 predicciones salieron así. La defensa es pedir sólo los ids que juegan.
// ---------------------------------------------------------------------------
test('predecirProximas: pide los ratings acotados por id, no la tabla entera', async () => {
  const bo3 = async () => respuesta({ results: [cruda({ id: 30, inicio: AHORA + 3600, a: 4321, b: 8765 })] });

  const consultas = [];
  const fetchImpl = async (url, opciones) => {
    if (!opciones?.method || opciones.method === 'GET') consultas.push(String(url));
    else return respuesta([]);
    return respuesta([]);
  };

  await predecirProximas('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl, ahora: AHORA });

  const deRatings = consultas.find((u) => u.includes('eslo_ratings'));
  assert.ok(deRatings, 'debería consultar los ratings');
  assert.match(deRatings, /team_id=in\./, 'sin acotar por id, PostgREST corta en 1.000 y no avisa');
  assert.ok(deRatings.includes('4321') && deRatings.includes('8765'), 'debe pedir los dos equipos que juegan');
});

test('sincronizarRatings: también acota por id al traer ratings', async () => {
  const bo3 = async () =>
    respuesta({ results: [cruda({ id: 31, inicio: AHORA - 7200, estado: 'finished', ganador: 555, ma: 2, mb: 0, a: 555, b: 666 })] });

  const consultas = [];
  const fetchImpl = async (url, opciones) => {
    if (!opciones?.method || opciones.method === 'GET') consultas.push(String(url));
    return respuesta([]);
  };

  await sincronizarRatings('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl });

  const deRatings = consultas.find((u) => u.includes('eslo_ratings'));
  assert.match(deRatings, /team_id=in\./);
  assert.ok(deRatings.includes('555') && deRatings.includes('666'));
});

// ---------------------------------------------------------------------------
// Bugs encontrados en la revisión con datos reales (2026-08-17)
// ---------------------------------------------------------------------------

test('calificarTerminadas: pide las partidas por ID, no las 100 más recientes', async () => {
  // Con datos reales, las 100 terminadas más recientes de CS2 cubren 3 días.
  // Una predicción de hace 4 días no se calificaba nunca, y taponaba la cola.
  let urlPedida = null;
  const bo3 = async (url) => {
    urlPedida = String(url);
    return respuesta({ results: [] });
  };
  const { fetchImpl } = supabaseFalso({
    eslo_predicciones: [
      { match_id: 777, juego: 'cs2', equipo_a: 1, equipo_b: 2, prob_a: 0.6, resultado_real: null },
      { match_id: 888, juego: 'cs2', equipo_a: 3, equipo_b: 4, prob_a: 0.4, resultado_real: null },
    ],
  });

  await calificarTerminadas('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl });

  assert.match(urlPedida, /filter\[matches\.id\]\[in\]=/);
  assert.ok(urlPedida.includes('777') && urlPedida.includes('888'));
});

test('calificarTerminadas: ignora una partida devuelta que todavía no terminó', async () => {
  const bo3 = async () =>
    respuesta({ results: [cruda({ id: 777, inicio: AHORA, estado: 'upcoming', ganador: null })] });
  const { fetchImpl, escrituras } = supabaseFalso({
    eslo_predicciones: [{ match_id: 777, juego: 'cs2', equipo_a: 100, equipo_b: 200, prob_a: 0.6, resultado_real: null }],
  });

  const r = await calificarTerminadas('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl });
  assert.equal(r.calificadas, 0);
  assert.equal(escrituras.length, 0);
});

test('sincronizarRatings: NO pierde partidas que arrancan a la misma hora exacta', async () => {
  // 19 grupos simultáneos entre las 100 más recientes de CS2, el mayor de 5.
  // Con `gt` sobre start_date, las que empataban con el borde se perdían.
  const t = AHORA - 7200;
  const bo3 = async () =>
    respuesta({
      results: [
        cruda({ id: 50, inicio: t, estado: 'finished', ganador: 10, ma: 2, mb: 0, a: 10, b: 11 }),
        cruda({ id: 51, inicio: t, estado: 'finished', ganador: 12, ma: 2, mb: 1, a: 12, b: 13 }),
        cruda({ id: 52, inicio: t, estado: 'finished', ganador: 14, ma: 2, mb: 0, a: 14, b: 15 }),
      ],
    });
  // Ya se aplicó la 50, que arranca a la MISMA hora que la 51 y la 52.
  const { fetchImpl, escrituras } = supabaseFalso({
    eslo_estado: [{ juego: 'cs2', ultimo_inicio: new Date(t * 1000).toISOString(), ultimo_match_id: 50 }],
  });

  const r = await sincronizarRatings('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl });

  assert.equal(r.aplicadas, 2, 'la 51 y la 52 deben aplicarse; la 50 no, que ya estaba');
  const ratings = escrituras.find((e) => e.tabla === 'eslo_ratings').filas.map((f) => f.team_id).sort((a, b) => a - b);
  assert.deepEqual(ratings, [12, 13, 14, 15], 'no debe volver a tocar a los de la partida 50');
});

test('sincronizarRatings: no reaplica la última partida ya aplicada', async () => {
  const t = AHORA - 7200;
  const bo3 = async () =>
    respuesta({ results: [cruda({ id: 60, inicio: t, estado: 'finished', ganador: 10, ma: 2, mb: 0, a: 10, b: 11 })] });
  const { fetchImpl, escrituras } = supabaseFalso({
    eslo_estado: [{ juego: 'cs2', ultimo_inicio: new Date(t * 1000).toISOString(), ultimo_match_id: 60 }],
  });

  const r = await sincronizarRatings('cs2', { fetchImpl: bo3, fetchImplSupabase: fetchImpl });
  assert.equal(r.aplicadas, 0, 'aplicarla dos veces corrompería el rating');
  assert.equal(escrituras.length, 0);
});

// El bug mas caro de la revision del 2026-08-17: `/matches` esta acotado a CS2
// por defecto INCLUSO pidiendo por id. Un id de LoL sin el filtro devuelve
// cero resultados, sin error. Las 87 predicciones de LoL no se habrian
// calificado nunca.
test('calificarTerminadas: pide con filtro de DISCIPLINA, o LoL nunca se califica', async () => {
  let urlPedida = null;
  const bo3 = async (url) => {
    urlPedida = String(url);
    return respuesta({ results: [] });
  };
  const { fetchImpl } = supabaseFalso({
    eslo_predicciones: [{ match_id: 555, juego: 'lol', equipo_a: 1, equipo_b: 2, prob_a: 0.6, resultado_real: null }],
  });

  await calificarTerminadas('lol', { fetchImpl: bo3, fetchImplSupabase: fetchImpl });

  assert.match(urlPedida, /filter\[matches\.discipline_id\]\[eq\]=3/, 'LoL es discipline_id 3');
  assert.match(urlPedida, /filter\[matches\.id\]\[in\]=555/);
});

test('calificarTerminadas: cada juego pide con SU disciplina', async () => {
  for (const [juego, disc] of [['cs2', 1], ['lol', 3]]) {
    let url = null;
    const bo3 = async (u) => ((url = String(u)), respuesta({ results: [] }));
    const { fetchImpl } = supabaseFalso({
      eslo_predicciones: [{ match_id: 1, juego, equipo_a: 1, equipo_b: 2, prob_a: 0.5, resultado_real: null }],
    });
    await calificarTerminadas(juego, { fetchImpl: bo3, fetchImplSupabase: fetchImpl });
    assert.ok(
      url.includes('filter[matches.discipline_id][eq]=' + disc),
      juego + ' deberia pedir con disciplina ' + disc + ', pidio: ' + url,
    );
  }
});
