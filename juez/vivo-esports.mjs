// Fase 3 multijuego: sincronizar ratings, predecir lo que viene, calificar lo
// que terminó. Sirve para cualquier juego que esté en COEFICIENTES.
//
//   node --env-file=.env juez/vivo-esports.mjs cs2
//
// LAS TRES GARANTÍAS, que son el motivo de la mitad del código de acá:
//
//   1. Cero fuga temporal (regla 6). Se predice SÓLO lo que no ha empezado, y
//      con ratings construidos SÓLO con partidas anteriores. El orden de este
//      archivo importa: primero se sincroniza con lo ya jugado, después se
//      predice lo que viene. Nunca al revés.
//   2. Una predicción no se reescribe jamás. Si se reescribe, el Brier deja de
//      corresponder a lo que se predijo. Es un bug ya vivido en Dota.
//   3. No se pide lo que ya está guardado (regla 5). La sincronización arranca
//      desde la última partida aplicada, no desde el principio.

import { fileURLToPath } from 'node:url';
import { seleccionar, upsert, parchear } from '../datos/supabase.mjs';
import { DISCIPLINAS, normalizar, esUtilizable } from '../datos/juegos/bo3.mjs';
import { fetchConReintentos } from '../datos/reintentar.mjs';
import { probabilidadGanar, actualizar } from '../motor/glicko2.mjs';
import { COEFICIENTES } from '../config.mjs';

const BASE = 'https://api.bo3.gg/api/v1';
const POR_PAGINA = 100;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'monitor-esports/0.1 (proyecto personal)' } });
  if (!res.ok) throw new Error(`bo3.gg respondió ${res.status}`);
  return res.json();
}

function configDe(juego) {
  const cfg = COEFICIENTES[juego];
  if (!cfg) throw new Error(`${juego} no tiene coeficientes calibrados en config.mjs. Correr Fase 1 antes.`);
  if (cfg.motor !== 'glicko2' || !cfg.glicko) {
    throw new Error(`${juego} está configurado con motor '${cfg.motor}'. Este script sólo maneja glicko2.`);
  }
  return cfg;
}

const estadoInicialDe = (cfg) => ({ rating: 1500, rd: cfg.glicko.rdInicial, vol: cfg.glicko.volInicial });

// --- 1. sincronizar ratings con lo ya jugado --------------------------------

// Trae las partidas terminadas DESPUÉS de una fecha, en orden cronológico.
async function partidasTerminadasDesde(juego, desdeIso, { fetchImpl }) {
  const disciplinaId = DISCIPLINAS[juego];
  const partidas = [];
  const vistos = new Set();
  let offset = 0;

  // Tope de páginas: si la base está muy atrasada conviene que la corrida
  // termine igual y siga poniéndose al día en la siguiente, en vez de
  // pasarse de la ventana de 10 minutos del cron.
  for (let pagina = 0; pagina < 30; pagina++) {
    // `gte`, no `gt`. Con `gt` se perdían las partidas que arrancan a la MISMA
    // hora exacta que la última aplicada, y eso no es raro: en CS2 hay 19
    // grupos de partidas simultáneas entre las 100 más recientes, el mayor de
    // 5. Quedaban fuera para siempre. El duplicado que introduce `gte` se
    // descarta después, en sincronizarRatings, comparando (inicio, matchId).
    const filtroFecha = desdeIso ? `&filter[matches.start_date][gte]=${encodeURIComponent(desdeIso)}` : '';
    const url =
      `${BASE}/matches?page[limit]=${POR_PAGINA}&page[offset]=${offset}&sort=start_date` +
      `&filter[matches.discipline_id][eq]=${disciplinaId}&filter[matches.status][eq]=finished${filtroFecha}`;

    const datos = await pedir(url, fetchImpl);
    const lote = datos.results ?? [];
    if (lote.length === 0) break;

    for (const cruda of lote) {
      if (vistos.has(cruda.id)) continue;
      vistos.add(cruda.id);
      const p = normalizar(cruda);
      if (esUtilizable(p)) partidas.push(p);
    }

    offset += POR_PAGINA;
    if (lote.length < POR_PAGINA) break;
    await espera(400);
  }

  // El desempate por matchId no es cosmético: es lo que hace que "hasta dónde
  // apliqué" sea una posición determinista cuando varias partidas comparten
  // hora exacta. Sin él, dos corridas podrían ordenar distinto el mismo grupo
  // y saltarse alguna.
  return partidas.sort((a, b) => a.inicio - b.inicio || a.matchId - b.matchId);
}

export async function sincronizarRatings(juego, { fetchImpl = fetchConReintentos, fetchImplSupabase } = {}) {
  const cfg = configDe(juego);

  const filasEstado = await seleccionar('eslo_estado', `?select=*&juego=eq.${juego}`, {
    fetchImpl: fetchImplSupabase,
  });
  const estado = filasEstado[0] ?? null;

  // Primero se sabe QUÉ partidas hay que aplicar, y recién ahí se piden los
  // ratings de esos equipos. Pedir la tabla entera devolvería sólo las
  // primeras 1.000 filas (tope de PostgREST, silencioso) y los equipos que no
  // entraran arrancarían desde cero, corrompiendo su rating.
  const traidas = await partidasTerminadasDesde(juego, estado?.ultimo_inicio ?? null, { fetchImpl });

  // Con `gte` vuelven las partidas del borde, incluida la última ya aplicada.
  // Se descartan por posición (inicio, matchId), que es el mismo criterio con
  // el que se ordenaron: así no se pierde ninguna de las simultáneas ni se
  // aplica dos veces la misma.
  const corteInicio = estado?.ultimo_inicio ? Math.floor(new Date(estado.ultimo_inicio).getTime() / 1000) : null;
  const corteId = estado?.ultimo_match_id ?? null;
  const nuevas =
    corteInicio === null
      ? traidas
      : traidas.filter((m) => m.inicio > corteInicio || (m.inicio === corteInicio && m.matchId > corteId));

  if (nuevas.length === 0) return { aplicadas: 0, equipos: 0 };

  const equipos = [...new Set(nuevas.flatMap((m) => [m.equipoA, m.equipoB]))];
  const filasRatings = await seleccionar(
    'eslo_ratings',
    `?select=*&juego=eq.${juego}&team_id=in.(${equipos.join(',')})`,
    { fetchImpl: fetchImplSupabase },
  );
  const porEquipo = new Map(
    filasRatings.map((f) => [f.team_id, { rating: Number(f.rating), rd: Number(f.rd), vol: Number(f.vol), partidas: f.partidas }]),
  );

  const inicial = estadoInicialDe(cfg);
  let ultima = null;

  for (const m of nuevas) {
    const a = porEquipo.get(m.equipoA) ?? { ...inicial, partidas: 0 };
    const b = porEquipo.get(m.equipoB) ?? { ...inicial, partidas: 0 };
    const ganoA = m.ganador === m.equipoA;

    // Los dos se actualizan contra el estado PREVIO del rival.
    const nuevoA = actualizar(a, b, ganoA ? 1 : 0, { tau: cfg.glicko.tau });
    const nuevoB = actualizar(b, a, ganoA ? 0 : 1, { tau: cfg.glicko.tau });

    porEquipo.set(m.equipoA, { ...nuevoA, partidas: a.partidas + 1 });
    porEquipo.set(m.equipoB, { ...nuevoB, partidas: b.partidas + 1 });
    ultima = m;
  }

  const ahora = new Date().toISOString();
  const tocados = new Set(nuevas.flatMap((m) => [m.equipoA, m.equipoB]));
  await upsert(
    'eslo_ratings',
    [...tocados].map((id) => {
      const e = porEquipo.get(id);
      return { juego, team_id: id, rating: e.rating, rd: e.rd, vol: e.vol, partidas: e.partidas, actualizado_en: ahora };
    }),
    { onConflict: 'juego,team_id', fetchImpl: fetchImplSupabase },
  );

  await upsert(
    'eslo_estado',
    [
      {
        juego,
        ultimo_inicio: new Date(ultima.inicio * 1000).toISOString(),
        ultimo_match_id: ultima.matchId,
        partidas_aplicadas: (estado?.partidas_aplicadas ?? 0) + nuevas.length,
        actualizado_en: ahora,
      },
    ],
    { onConflict: 'juego', fetchImpl: fetchImplSupabase },
  );

  return { aplicadas: nuevas.length, equipos: porEquipo.size, hasta: ultima.inicio };
}

// --- 2. predecir lo que viene ------------------------------------------------

export async function predecirProximas(
  juego,
  { fetchImpl = fetchConReintentos, fetchImplSupabase, ahora = Date.now() / 1000 } = {},
) {
  const cfg = configDe(juego);
  const disciplinaId = DISCIPLINAS[juego];

  const url =
    `${BASE}/matches?page[limit]=${POR_PAGINA}&page[offset]=0&sort=start_date` +
    `&filter[matches.discipline_id][eq]=${disciplinaId}&filter[matches.status][eq]=upcoming`;

  const datos = await pedir(url, fetchImpl);
  const candidatas = (datos.results ?? [])
    .map(normalizar)
    .filter((p) => p.equipoA && p.equipoB && p.inicio && p.formato);

  // Regla 6: nada que ya haya empezado. El feed lista partidas en curso.
  const noEmpezadas = candidatas.filter((p) => p.inicio > ahora);
  const yaEmpezaron = candidatas.length - noEmpezadas.length;
  if (noEmpezadas.length === 0) return { predichas: 0, yaEmpezaron, yaPredichas: 0 };

  const ids = noEmpezadas.map((p) => p.matchId).join(',');
  // Los ratings se piden SÓLO de los equipos que juegan, nunca la tabla
  // entera. PostgREST corta en 1.000 filas por defecto y no avisa: pedir
  // "todos" devolvía los primeros 1.000 de 4.031, y los equipos que no
  // entraban se trataban como si no tuvieran rating. Eso produjo 34
  // predicciones de 0.500 exacto que parecían legítimas. Acotando por id el
  // tope no se toca nunca.
  const equipos = [...new Set(noEmpezadas.flatMap((p) => [p.equipoA, p.equipoB]))];
  const [existentes, filasRatings] = await Promise.all([
    seleccionar('eslo_predicciones', `?select=match_id&match_id=in.(${ids})`, { fetchImpl: fetchImplSupabase }),
    seleccionar('eslo_ratings', `?select=*&juego=eq.${juego}&team_id=in.(${equipos.join(',')})`, {
      fetchImpl: fetchImplSupabase,
    }),
  ]);

  // Garantía 2: lo ya predicho no se toca.
  const yaEstan = new Set(existentes.map((e) => e.match_id));
  const nuevas = noEmpezadas.filter((p) => !yaEstan.has(p.matchId));
  if (nuevas.length === 0) return { predichas: 0, yaEmpezaron, yaPredichas: yaEstan.size };

  const inicial = estadoInicialDe(cfg);
  const porEquipo = new Map(
    filasRatings.map((f) => [f.team_id, { rating: Number(f.rating), rd: Number(f.rd), vol: Number(f.vol) }]),
  );

  const filas = nuevas.map((p) => {
    const ea = porEquipo.get(p.equipoA) ?? inicial;
    const eb = porEquipo.get(p.equipoB) ?? inicial;
    const probA = probabilidadGanar(ea, eb);
    return {
      match_id: p.matchId,
      juego,
      equipo_a: p.equipoA,
      equipo_b: p.equipoB,
      inicio_programado: new Date(p.inicio * 1000).toISOString(),
      formato: p.formato,
      // El tier se guarda para poder filtrar QUÉ se avisa: CS2 mueve ~34
      // partidas al día contando todos los tiers, y anunciarlas todas es
      // spam inservible. Sin esta columna habría que volver a pedirle a la
      // API algo que ya tuvimos en la mano.
      torneo_id: p.torneoId,
      tier: p.tier,
      motor: cfg.motor,
      prob_a: probA,
      prob_b: 1 - probA,
      rating_a: ea.rating,
      rd_a: ea.rd,
      rating_b: eb.rating,
      rd_b: eb.rd,
    };
  });

  await upsert('eslo_predicciones', filas, { onConflict: 'match_id', fetchImpl: fetchImplSupabase });
  return { predichas: filas.length, yaEmpezaron, yaPredichas: yaEstan.size };
}

// --- 3. calificar lo que terminó ---------------------------------------------

export async function calificarTerminadas(juego, { fetchImpl = fetchConReintentos, fetchImplSupabase } = {}) {
  const disciplinaId = DISCIPLINAS[juego];
  if (!disciplinaId) throw new Error(`juego desconocido: ${juego}`);

  const pendientes = await seleccionar(
    'eslo_predicciones',
    `?select=*&juego=eq.${juego}&resultado_real=is.null&order=inicio_programado.asc&limit=100`,
    { fetchImpl: fetchImplSupabase },
  );
  if (pendientes.length === 0) return { calificadas: 0 };

  // Se piden EXACTAMENTE las partidas pendientes, por id.
  //
  // Antes se traían las 100 terminadas más recientes y se cruzaban. Con datos
  // reales eso cubre apenas 3 días de CS2 (~34 partidas/día): una predicción
  // cuya partida terminó hace 4 días no se calificaba NUNCA. Y como la cola de
  // pendientes se ordena por fecha ascendente, esas viejas taponaban el frente
  // y bloqueaban también a las nuevas. El fallo se agravaba solo.
  // EL FILTRO DE DISCIPLINA NO ES OPCIONAL, ni siquiera pidiendo por id.
  // `/matches?filter[matches.id][in]=` está acotado a CS2 por defecto: pedir
  // un id de LoL sin él devuelve CERO resultados, sin error. Sin esto las
  // predicciones de LoL no se calificaban NUNCA -- 87 de 139 no volvían.
  // Es el mismo comportamiento de `/teams`, ya documentado: en esta API, el
  // default de disciplina se aplica aunque preguntes por clave primaria.
  const ids = pendientes.map((p) => p.match_id);
  const url =
    `${BASE}/matches?page[limit]=${POR_PAGINA}&filter[matches.discipline_id][eq]=${disciplinaId}` +
    `&filter[matches.id][in]=${ids.join(',')}`;
  const datos = await pedir(url, fetchImpl);
  const terminadas = new Map(
    (datos.results ?? [])
      .filter((m) => m.status === 'finished')
      .map(normalizar)
      .filter(esUtilizable)
      .map((p) => [p.matchId, p]),
  );

  const ahora = new Date().toISOString();
  const filas = [];
  for (const pred of pendientes) {
    const real = terminadas.get(pred.match_id);
    if (!real) continue;

    const ganoA = real.ganador === pred.equipo_a;
    const probA = Number(pred.prob_a);
    filas.push({
      match_id: pred.match_id,
      resultado_real: ganoA ? 'ganaA' : 'ganaB',
      marcador_a: real.marcadorA,
      marcador_b: real.marcadorB,
      brier: (probA - (ganoA ? 1 : 0)) ** 2,
      calificada_en: ahora,
    });
  }

  if (filas.length === 0) return { calificadas: 0 };

  // PATCH, no upsert. Con upsert, PostgREST arma un INSERT ... ON CONFLICT, y
  // el INSERT valida los NOT NULL ANTES de resolver el conflicto: como acá
  // sólo se mandan las columnas de calificación, `juego` iba en null y la
  // base rechazaba con 23502. O sea que calificar NUNCA pudo escribir, y no
  // se vio hasta que termino la primera partida de verdad.
  //
  // PATCH además es lo correcto semánticamente: se está ACTUALIZANDO una fila
  // que ya existe. Y protege la regla de no reescribir predicciones -- toca
  // sólo las columnas que se le pasan, así que no puede pisar prob_a ni el
  // rating con que se predijo, ni aunque alguien meta esos campos por error.
  for (const f of filas) {
    const { match_id, ...cambios } = f;
    await parchear('eslo_predicciones', `?match_id=eq.${match_id}`, cambios, { fetchImpl: fetchImplSupabase });
  }

  return { calificadas: filas.length };
}

// --- ciclo -------------------------------------------------------------------

export async function ciclo(juego, opciones = {}) {
  // El orden NO es negociable: sincronizar con lo jugado ANTES de predecir, o
  // se predice con ratings viejos. Calificar al final, con lo que ya terminó.
  const sinc = await sincronizarRatings(juego, opciones);
  const pred = await predecirProximas(juego, opciones);
  const cal = await calificarTerminadas(juego, opciones);
  return { sinc, pred, cal };
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  const juegos = process.argv.slice(2).length ? process.argv.slice(2) : ['cs2'];
  for (const juego of juegos) {
    try {
      const r = await ciclo(juego);
      console.log(
        `${juego}: ${r.sinc.aplicadas} partidas aplicadas (${r.sinc.equipos} equipos) · ` +
          `${r.pred.predichas} predichas (${r.pred.yaPredichas} ya estaban, ${r.pred.yaEmpezaron} ya empezaron) · ` +
          `${r.cal.calificadas} calificadas`,
      );
    } catch (e) {
      console.error(`${juego}: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
