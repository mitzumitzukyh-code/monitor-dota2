// Adaptador de bo3.gg -- la fuente multijuego.
//
// Por qué esta y no una por juego: bo3.gg cubre CS2, LoL, Dota 2, Valorant,
// R6 y MLBB con el MISMO esquema, IDs de equipo estables y las partidas
// futuras en el mismo endpoint que las jugadas. Verificado con llamadas
// reales (2026-08-15). Eso evita tener un adaptador distinto por juego, que
// era el plan hasta que se comprobó que existe una sola fuente para todos.
//
// Lo que la hace mejor que las fuentes de Dota (OpenDota + haglund.dev):
//   - historial Y calendario en el mismo sitio (haglund.dev es comunitario,
//     sin SLA, y es el punto frágil del pipeline de Dota hoy)
//   - `status` explícito ("finished" / "upcoming"), sin deducir si ya se jugó
//   - `winner_team_id` directo, sin reconstruir la serie partida por partida
//
// OJO, lo que NO se hizo: Dota sigue con OpenDota. Su Elo está calibrado
// sobre ese histórico (16.450 partidas) y TI2026 está en producción hasta el
// 23 -- cambiarle la fuente por debajo mientras corre rompería la regla 3.
// Migrar Dota a bo3.gg es una decisión aparte, para después del torneo.

import { fetchConReintentos } from '../reintentar.mjs';

const BASE = 'https://api.bo3.gg/api/v1';

// Tope duro del servidor: pedir 500 o 1000 igual devuelve 100 (verificado).
const POR_PAGINA = 100;

// bo3.gg no documenta límite de tasa. 400ms entre peticiones es ~2.5/segundo,
// muy por debajo de lo que aguantó en las pruebas, y respeta la regla 5.
const MS_ENTRE_PETICIONES = 400;

export const DISCIPLINAS = {
  cs2: 1,
  valorant: 2,
  lol: 3,
  dota2: 4,
  deadlock: 5,
  r6siege: 7,
  mlbb: 8,
};

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// El formato viene como número (bo_type: 1, 3, 5). El motor de series usa
// 'bo1'/'bo3'/'bo5', igual que en Dota, para no tener dos vocabularios.
export function formatoDesdeBoType(boType) {
  const n = Number(boType);
  return Number.isFinite(n) && n > 0 ? `bo${n}` : null;
}

// Una partida cruda de bo3.gg -> la forma mínima que necesita el motor.
// Se descarta lo que no sirve para predecir (comentarios, rating de la web,
// cobertura en vivo): guardar campos que nadie usa solo hace el caché grande
// y la validación borrosa.
export function normalizar(m) {
  const inicio = m.start_date ? Math.floor(new Date(m.start_date).getTime() / 1000) : null;
  return {
    matchId: m.id,
    disciplinaId: m.discipline_id,
    torneoId: m.tournament_id,
    inicio,
    formato: formatoDesdeBoType(m.bo_type),
    equipoA: m.team1_id,
    equipoB: m.team2_id,
    marcadorA: m.team1_score,
    marcadorB: m.team2_score,
    ganador: m.winner_team_id,
    tier: m.tier ?? null,
    estado: m.status,
  };
}

// Una partida sirve para el motor solo si tiene los dos equipos, un ganador
// que sea uno de los dos, y una fecha. Todo lo demás se bota: es preferible
// un histórico más chico y limpio que uno grande con filas a medias.
export function esUtilizable(p) {
  if (!p.equipoA || !p.equipoB) return false;
  if (p.equipoA === p.equipoB) return false;
  if (!p.inicio) return false;
  if (!p.formato) return false;
  if (p.ganador !== p.equipoA && p.ganador !== p.equipoB) return false;

  // El ganador declarado tiene que cuadrar con el marcador. En el histórico
  // real de CS2 hay 43 filas (de 72.673, el 0,06%) donde no cuadra: marcador
  // 2-0 y ganador el que perdió, entre otras. Se revisó buscando patrón --
  // repartidas entre 2022 y 2026, entre formatos y entre tiers, con
  // marcadores limpios -- así que no son walkovers ni resultados revertidos:
  // es dato malo, o los ids vienen cambiados. En cualquiera de los dos casos
  // la fila no es de fiar y meterla movería el Elo en la dirección contraria.
  if (p.marcadorA != null && p.marcadorB != null && p.marcadorA !== p.marcadorB) {
    const esperado = p.marcadorA > p.marcadorB ? p.equipoA : p.equipoB;
    if (esperado !== p.ganador) return false;
  }

  return true;
}

async function pedir(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'monitor-esports/0.1 (proyecto personal)' },
  });
  if (!res.ok) throw new Error(`bo3.gg respondió ${res.status} en ${url}`);
  return res.json();
}

function construirUrl({ disciplinaId, estado, tier, orden = '-start_date', limite, offset }) {
  const filtros = [
    `page[limit]=${limite}`,
    `page[offset]=${offset}`,
    `sort=${orden}`,
    `filter[matches.discipline_id][eq]=${disciplinaId}`,
  ];
  if (estado) filtros.push(`filter[matches.status][eq]=${estado}`);
  if (tier) filtros.push(`filter[matches.tier][eq]=${tier}`);
  return `${BASE}/matches?${filtros.join('&')}`;
}

// Baja partidas ya jugadas de una disciplina, paginando. `maxPaginas` existe
// para poder probar con poco antes de bajar decenas de miles.
export async function bajarPartidas(
  juego,
  { tier = null, maxPaginas = Infinity, fetchImpl = fetchConReintentos, alAvanzar = null } = {},
) {
  const disciplinaId = DISCIPLINAS[juego];
  if (!disciplinaId) throw new Error(`juego desconocido: ${juego}`);

  const partidas = [];
  const vistos = new Set();
  let offset = 0;
  let pagina = 0;
  let total = null;

  while (pagina < maxPaginas) {
    const url = construirUrl({ disciplinaId, estado: 'finished', tier, limite: POR_PAGINA, offset });
    const datos = await pedir(url, fetchImpl);
    total ??= datos.total?.count ?? null;

    const lote = datos.results ?? [];
    if (lote.length === 0) break;

    for (const cruda of lote) {
      // El offset puede repetir filas si entran partidas nuevas mientras se
      // pagina. Sin este control el histórico saldría con duplicados.
      if (vistos.has(cruda.id)) continue;
      vistos.add(cruda.id);
      partidas.push(normalizar(cruda));
    }

    pagina++;
    offset += POR_PAGINA;
    if (alAvanzar) alAvanzar({ pagina, bajadas: partidas.length, total });
    if (lote.length < POR_PAGINA) break;
    await espera(MS_ENTRE_PETICIONES);
  }

  return { partidas, total };
}

// Partidas futuras: el calendario. Mismo endpoint, otro estado.
export async function proximasPartidas(juego, { fetchImpl = fetchConReintentos, limite = POR_PAGINA } = {}) {
  const disciplinaId = DISCIPLINAS[juego];
  if (!disciplinaId) throw new Error(`juego desconocido: ${juego}`);
  const url = construirUrl({
    disciplinaId,
    estado: 'upcoming',
    orden: 'start_date',
    limite: Math.min(limite, POR_PAGINA),
    offset: 0,
  });
  const datos = await pedir(url, fetchImpl);
  return (datos.results ?? []).map(normalizar);
}

// Nombres de equipo. Se resuelven aparte y se cachean: cambian lentísimo y
// pedirlos en cada corrida sería gastar por gusto (regla 5).
// OJO: `/teams/{id}` devuelve 404 en bo3.gg (verificado 2026-08-17). El que
// funciona es el listado con filtro `in`, que además trae todos los pedidos en
// UNA petición en vez de una por equipo. La versión anterior de esta función
// usaba el endpoint roto -- nunca llegó a usarse en producción.
//
// EL FILTRO DE DISCIPLINA NO ES OPCIONAL. Sin él, `/teams` asume CS2
// (discipline_id 1) y devuelve VACÍO para cualquier otro juego -- no da error,
// devuelve cero resultados. Verificado: los ids de LoL 17800 y 17142 salen
// vacíos sin el filtro y resuelven a "Natus Vincere" y "Team Heretics" con él.
// Los avisos de CS2 funcionaban por casualidad, porque CS2 es el default.
// Nombre Y logo de cada equipo. bo3.gg trae `image_url` (webp de ~23 KB en
// su CDN) y no se estaba usando: las tablas mostraban las tres primeras
// letras del nombre, que para "PCI" o "JUS" no dice nada.
//
// Los logos de equipo se ENLAZAN, no se incrustan como los de los juegos: son
// decenas por render y cambian seguido, asi que incrustarlos pesaria medio
// mega. Si el CDN falla, el navegador muestra el `alt` con el nombre.
export async function datosDeEquipos(ids, { juego = 'cs2', fetchImpl = fetchConReintentos } = {}) {
  const disciplinaId = DISCIPLINAS[juego];
  if (!disciplinaId) throw new Error(`juego desconocido: ${juego}`);

  const porId = new Map();
  const unicos = [...new Set(ids)].filter(Boolean);

  for (let i = 0; i < unicos.length; i += POR_PAGINA) {
    const lote = unicos.slice(i, i + POR_PAGINA);
    const datos = await pedir(
      `${BASE}/teams?page[limit]=${POR_PAGINA}&filter[teams.discipline_id][eq]=${disciplinaId}` +
        `&filter[teams.id][in]=${lote.join(',')}`,
      fetchImpl,
    );
    for (const t of datos.results ?? []) {
      if (t?.id && t?.name) porId.set(t.id, { nombre: t.name, logo: t.image_url ?? null });
    }
    if (i + POR_PAGINA < unicos.length) await espera(MS_ENTRE_PETICIONES);
  }

  return porId;
}

export async function nombresDeEquipos(ids, { juego = 'cs2', fetchImpl = fetchConReintentos } = {}) {
  const disciplinaId = DISCIPLINAS[juego];
  if (!disciplinaId) throw new Error(`juego desconocido: ${juego}`);

  const nombres = new Map();
  const unicos = [...new Set(ids)].filter(Boolean);

  for (let i = 0; i < unicos.length; i += POR_PAGINA) {
    const lote = unicos.slice(i, i + POR_PAGINA);
    const datos = await pedir(
      `${BASE}/teams?page[limit]=${POR_PAGINA}&filter[teams.discipline_id][eq]=${disciplinaId}` +
        `&filter[teams.id][in]=${lote.join(',')}`,
      fetchImpl,
    );
    for (const t of datos.results ?? []) {
      if (t?.id && t?.name) nombres.set(t.id, t.name);
    }
    if (i + POR_PAGINA < unicos.length) await espera(MS_ENTRE_PETICIONES);
  }

  return nombres;
}

// Nombres de torneo. MISMA trampa que nombresDeEquipos: el endpoint está
// acotado por disciplina. Verificado el 2026-08-17 -- pidiendo
// [5958 (CS2), 5134 (Dota)] sin el filtro devuelve UNO SOLO, el de CS2, y el
// otro desaparece sin error ni aviso.
//
// Van cuatro veces que esta API muerde con lo mismo: /teams, /matches como
// listado, /matches por id, y ahora /tournaments. Regla para la próxima: en
// bo3.gg, TODO endpoint lleva filtro de disciplina, aunque preguntes por
// clave primaria.
export async function nombresDeTorneos(ids, { juego = 'cs2', fetchImpl = fetchConReintentos } = {}) {
  const disciplinaId = DISCIPLINAS[juego];
  if (!disciplinaId) throw new Error(`juego desconocido: ${juego}`);

  const nombres = new Map();
  const unicos = [...new Set(ids)].filter(Boolean);

  for (let i = 0; i < unicos.length; i += POR_PAGINA) {
    const lote = unicos.slice(i, i + POR_PAGINA);
    const datos = await pedir(
      `${BASE}/tournaments?page[limit]=${POR_PAGINA}&filter[tournaments.discipline_id][eq]=${disciplinaId}` +
        `&filter[tournaments.id][in]=${lote.join(',')}`,
      fetchImpl,
    );
    for (const t of datos.results ?? []) {
      const nombre = t?.name ?? t?.slug;
      if (t?.id && nombre) nombres.set(t.id, nombre);
    }
    if (i + POR_PAGINA < unicos.length) await espera(MS_ENTRE_PETICIONES);
  }

  return nombres;
}

// Partidas futuras CON nombre de equipo. El /matches no trae el nombre de los
// equipos en el cuerpo (solo id); los trae en `bet_updates`, que puede faltar
// (verificado: un partido con equipos TBD venía con bet_updates: null). Para
// no pagar una petición por equipo cuando el nombre ya vino gratis, solo se
// resuelven los que faltan con /teams/{id}.
export async function proximasPartidasConNombres(juego, { fetchImpl = fetchConReintentos, limite = POR_PAGINA } = {}) {
  const disciplinaId = DISCIPLINAS[juego];
  if (!disciplinaId) throw new Error(`juego desconocido: ${juego}`);
  const url = construirUrl({
    disciplinaId,
    estado: 'upcoming',
    orden: 'start_date',
    limite: Math.min(limite, POR_PAGINA),
    offset: 0,
  });
  const datos = await pedir(url, fetchImpl);

  const conNombre = [];
  const idsSinNombre = new Set();
  for (const cruda of datos.results ?? []) {
    const nombreA = cruda.bet_updates?.team_1?.name ?? null;
    const nombreB = cruda.bet_updates?.team_2?.name ?? null;
    if (!nombreA) idsSinNombre.add(cruda.team1_id);
    if (!nombreB) idsSinNombre.add(cruda.team2_id);
    conNombre.push({ cruda, nombreA, nombreB });
  }

  const nombres = await nombresDeEquipos([...idsSinNombre], { juego, fetchImpl });

  return conNombre.map(({ cruda, nombreA, nombreB }) => ({
    matchId: cruda.id,
    tournamentId: cruda.tournament_id,
    inicio: cruda.start_date ? Math.floor(new Date(cruda.start_date).getTime() / 1000) : null,
    formato: formatoDesdeBoType(cruda.bo_type),
    equipoA: cruda.team1_id,
    equipoB: cruda.team2_id,
    nombreA: nombreA ?? nombres.get(cruda.team1_id) ?? null,
    nombreB: nombreB ?? nombres.get(cruda.team2_id) ?? null,
    tier: cruda.tier ?? null,
  }));
}
