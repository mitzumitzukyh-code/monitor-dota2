// Cliente mínimo de PostgREST. Mismo proyecto de Supabase que Monitor
// LaLiga (reutilizado a propósito) -- tablas con prefijo dota_ para no
// chocar con las de fútbol.

import { fetchConReintentos } from './reintentar.mjs';

function headers() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function baseUrl() {
  return process.env.SUPABASE_URL;
}

// PostgREST devuelve como máximo 1.000 filas y NO avisa de que cortó. Eso ya
// costó un bug real y difícil de ver: predecirProximas() pedía los 4.031
// ratings, recibía 1.000, y los equipos que no entraban se trataban como si no
// tuvieran rating. Salieron 34 predicciones de 0.500 exacto con pinta de
// legítimas. Al 2026-08-17 eslo_cuotas ya va por 7.040 filas.
//
// Acá se pagina sola hasta traer todo, así ningún llamador puede recibir un
// resultado truncado por accidente.
const TOPE_POSTGREST = 1000;

export async function seleccionar(tabla, query = '', { fetchImpl = fetchConReintentos } = {}) {
  const pedir = async (q) => {
    const res = await fetchImpl(`${baseUrl()}/rest/v1/${tabla}${q}`, { headers: headers() });
    if (!res.ok) throw new Error(`Supabase seleccionar(${tabla}) respondió ${res.status}: ${await res.text()}`);
    return res.json();
  };

  const primera = await pedir(query);
  if (!Array.isArray(primera) || primera.length < TOPE_POSTGREST) return primera;

  // Si el llamador puso su propio límite, se respeta: pidió eso y eso recibe.
  if (/[?&]limit=/.test(query)) return primera;

  // Paginar sin un orden estable puede repetir o saltar filas, y eso sería
  // peor que truncar porque no se nota. Antes que devolver algo posiblemente
  // mal, se falla fuerte y se dice exactamente cómo arreglarlo.
  if (!/[?&]order=/.test(query)) {
    throw new Error(
      `Supabase seleccionar(${tabla}): hay más de ${TOPE_POSTGREST} filas y la consulta no trae "order". ` +
        `Sin un orden estable la paginación puede repetir o saltar filas. ` +
        `Agregar &order=<clave única> (o &limit=N si de verdad se quiere sólo una parte).`,
    );
  }

  const todo = [...primera];
  for (let offset = TOPE_POSTGREST; ; offset += TOPE_POSTGREST) {
    const separador = query.includes('?') ? '&' : '?';
    const pagina = await pedir(`${query}${separador}limit=${TOPE_POSTGREST}&offset=${offset}`);
    if (!Array.isArray(pagina) || pagina.length === 0) break;
    todo.push(...pagina);
    if (pagina.length < TOPE_POSTGREST) break;
  }

  // Que haya "order" no basta: tiene que ser un orden TOTAL. Ordenar por una
  // columna con valores repetidos (eslo_cuotas.capturado_en, por ejemplo, que
  // comparte timestamp entre las ~100 filas de una misma captura) deja el
  // orden indefinido dentro del empate, y con offset eso repite unas filas y
  // se salta otras. Pasó de verdad: ordenando sólo por capturado_en salían 37
  // duplicadas de 7.040; agregando match_id como desempate, cero.
  //
  // No se puede saber de antemano si un orden es único, pero sí se puede
  // detectar el síntoma: filas repetidas en el resultado. Se avisa fuerte en
  // vez de devolver datos silenciosamente mal.
  const vistas = new Set();
  let repetidas = 0;
  for (const fila of todo) {
    const clave = JSON.stringify(fila);
    if (vistas.has(clave)) repetidas++;
    else vistas.add(clave);
  }
  if (repetidas > 0) {
    throw new Error(
      `Supabase seleccionar(${tabla}): la paginación devolvió ${repetidas} filas repetidas de ${todo.length}. ` +
        `El "order" de la consulta no es único, así que el orden dentro de los empates queda indefinido ` +
        `y el offset repite y salta filas. Agregar una columna de desempate al order (típicamente la clave primaria).`,
    );
  }

  return todo;
}

// PATCH: actualiza sólo las columnas que se pasan, en las filas que matchean
// la query. A diferencia de upsert, no necesita mandar la fila completa --
// importante para marcar "ya avisado" sin arriesgar sobreescribir la
// predicción guardada.
export async function parchear(tabla, query, cambios, { fetchImpl = fetchConReintentos } = {}) {
  const res = await fetchImpl(`${baseUrl()}/rest/v1/${tabla}${query}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify(cambios),
  });
  if (!res.ok) throw new Error(`Supabase parchear(${tabla}) respondió ${res.status}: ${await res.text()}`);
  return true;
}

export async function upsert(tabla, filas, { onConflict, fetchImpl = fetchConReintentos } = {}) {
  const url = new URL(`${baseUrl()}/rest/v1/${tabla}`);
  if (onConflict) url.searchParams.set('on_conflict', onConflict);

  const res = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: {
      ...headers(),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(filas),
  });
  if (!res.ok) throw new Error(`Supabase upsert(${tabla}) respondió ${res.status}: ${await res.text()}`);
  return res.json();
}
