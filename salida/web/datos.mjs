// Agregación del panel: todo lo que las seis pantallas necesitan, calculado
// sobre el backtest real. Ni una línea de HTML acá dentro.
//
// De dónde salen los números, y por qué importa que salgan de aquí:
// `ejecutarBacktest()` es la MISMA función que se usa para juzgar el motor,
// no una copia. Si el panel calculara la probabilidad por su cuenta podría
// divergir de lo que se publicó, y el auto-juicio dejaría de significar algo
// (reglas 1 y 3). El panel sólo lee lo que el juez ya decidió.
//
// Funciona sin Supabase: 8.116 series reales salen de datos/historico.json,
// que está versionado. Las credenciales sólo hacen falta para las series
// PRÓXIMAS, que es lo único que el histórico no puede saber.

import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { ejecutarBacktest } from '../../juez/backtest.mjs';
import { probabilidadGanar, ratings, ratingDeEquipo } from '../../motor/elo.mjs';
import { distribucionMarcadores } from '../../motor/series.mjs';
import { K_FACTOR, ESCALA, DELTA_BO2, RATING_INICIAL } from '../../config.mjs';

const RAIZ = new URL('../../', import.meta.url);

// La base ingenua depende de cuántas clases tiene el formato: bo1/bo3/bo5 se
// deciden entre dos (0.5), bo2 admite empate real y son tres (2/3). Está en
// CLAUDE.md y es la razón por la que el Brier de bo2 no se compara con los
// otros sin decir contra qué base va.
export const BASE_INGENUA = { bo1: 0.5, bo2: 2 / 3, bo3: 0.5, bo5: 0.5 };

export const CLASES = ['ganaA', 'empate', 'ganaB'];

export async function cargarPartidas() {
  return JSON.parse(await readFile(new URL('datos/historico.json', RAIZ), 'utf8'));
}

// --- nombres y torneos ---------------------------------------------------

// OpenDota trae el nombre pegado a la partida, no una tabla de equipos. Gana
// el más reciente: si un equipo se renombró, el panel muestra cómo se llama
// ahora y no como se llamaba en 2021.
export function nombresDeEquipo(partidas) {
  const nombre = new Map();
  for (const p of partidas.slice().sort((a, b) => a.start_time - b.start_time)) {
    if (p.radiant_team_id && p.radiant_name) nombre.set(p.radiant_team_id, p.radiant_name);
    if (p.dire_team_id && p.dire_name) nombre.set(p.dire_team_id, p.dire_name);
  }
  return nombre;
}

// --- series ya juzgadas --------------------------------------------------

function favoritoDe(prediccion) {
  let mejor = 'ganaA';
  for (const c of CLASES) if (prediccion[c] > prediccion[mejor]) mejor = c;
  return mejor;
}

// Enriquece cada fila del backtest con lo que la pantalla necesita mostrar.
// Nada de esto cambia un número: sólo le pone nombre y fecha a lo que el
// juez ya calculó.
export function enriquecerSeries(resultados, partidas) {
  const nombre = nombresDeEquipo(partidas);
  return resultados.map((r) => {
    const favorito = favoritoDe(r.prediccion);
    return {
      ...r,
      nombreA: nombre.get(r.equipoA) ?? `#${r.equipoA}`,
      nombreB: nombre.get(r.equipoB) ?? `#${r.equipoB}`,
      torneo: r.leagueName ?? `Liga ${r.leagueid ?? '—'}`,
      fecha: new Date(r.startTime * 1000).toISOString().slice(0, 10),
      favorito,
      acerto: favorito === r.real,
      probFavorito: r.prediccion[favorito],
      base: BASE_INGENUA[r.formato],
      // Negativo = mejor que adivinar. Es la resta que decide si el motor se
      // ganó el puesto (regla 4), así que se calcula una sola vez acá.
      contraBase: r.brier - BASE_INGENUA[r.formato],
    };
  });
}

// --- pantalla de Calidad -------------------------------------------------

const promedio = (xs) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

// Intervalo de confianza al 95% de la media, por el error estándar. Con n
// grande es normal; con n chico el propio panel tiene que decir que no
// concluye nada, y por eso se devuelve también `concluyente`.
export function intervaloMedia(valores, base) {
  const n = valores.length;
  if (n < 2) return { media: promedio(valores), bajo: NaN, alto: NaN, n, concluyente: false };
  const media = promedio(valores);
  const varianza = valores.reduce((s, v) => s + (v - media) ** 2, 0) / (n - 1);
  const margen = 1.96 * Math.sqrt(varianza / n);
  const bajo = media - margen;
  const alto = media + margen;
  return { media, bajo, alto, n, concluyente: alto < base };
}

export function calidad(series) {
  const porFormato = {};
  for (const formato of ['bo1', 'bo2', 'bo3', 'bo5']) {
    const lista = series.filter((s) => s.formato === formato);
    if (lista.length === 0) continue;
    const base = BASE_INGENUA[formato];
    porFormato[formato] = {
      formato,
      cantidad: lista.length,
      brier: promedio(lista.map((s) => s.brier)),
      base,
      aciertos: lista.filter((s) => s.acerto).length,
      acierto: lista.filter((s) => s.acerto).length / lista.length,
      ...intervaloMedia(lista.map((s) => s.brier), base),
    };
  }

  // El total NO se compara contra una base única: mezcla formatos de dos y de
  // tres clases. Se pondera la base por cuántas series hay de cada formato,
  // que es la única forma honesta de dar un solo número.
  const baseP = promedio(series.map((s) => s.base));
  return {
    global: {
      cantidad: series.length,
      brier: promedio(series.map((s) => s.brier)),
      base: baseP,
      aciertos: series.filter((s) => s.acerto).length,
      acierto: series.filter((s) => s.acerto).length / series.length,
      ...intervaloMedia(series.map((s) => s.brier), baseP),
    },
    porFormato,
  };
}

// --- pantalla de Clasificación -------------------------------------------

// Ranking de fuerza al final del histórico. Se usa `ratings()` del motor con
// una fecha de corte posterior a todo, así que es exactamente el estado con
// el que se predeciría la próxima serie.
export function clasificacion(partidas, { minimoPartidas = 20, cuantos = 60 } = {}) {
  const corte = Math.max(...partidas.map((p) => p.start_time)) + 1;
  const estado = ratings(partidas, corte, { kFactor: K_FACTOR, escala: ESCALA });
  const nombre = nombresDeEquipo(partidas);

  const filas = [];
  for (const [teamId, jugadas] of estado.partidasJugadas) {
    if (jugadas < minimoPartidas) continue;
    filas.push({
      teamId,
      nombre: nombre.get(teamId) ?? `#${teamId}`,
      rating: ratingDeEquipo(estado, teamId),
      partidas: jugadas,
    });
  }
  filas.sort((a, b) => b.rating - a.rating);
  return filas.slice(0, cuantos).map((f, i) => ({ ...f, posicion: i + 1 }));
}

// --- ficha de serie ------------------------------------------------------

// Distribución de marcadores de una serie, reconstruida desde el estado
// CONGELADO al predecir (los dos ratings que el backtest guardó). Es la misma
// cuenta que produjo la probabilidad publicada, desagregada — no una segunda
// estimación (regla 6: no se mira nada posterior a la serie).
export function marcadoresDeSerie(fila) {
  const p = probabilidadGanar(fila.ratingA, fila.ratingB, ESCALA);
  return distribucionMarcadores(p, fila.formato, { deltaBo2: DELTA_BO2 }).map((m) => ({
    ...m,
    // El marcador que de verdad pasó no se guarda en el backtest (sólo la
    // clase), así que se marca la clase, no el marcador exacto.
    esReal: (m.gana === 'A' && fila.real === 'ganaA')
      || (m.gana === 'B' && fila.real === 'ganaB')
      || (m.gana === 'empate' && fila.real === 'empate'),
  }));
}

// --- pantalla de Cambios -------------------------------------------------

const RUTAS = ['motor', 'juez', 'datos', 'config.mjs', 'salida'];

function tipoDeCommit(asunto) {
  const s = asunto.toLowerCase();
  if (s.startsWith('diseño') || s.startsWith('diseno')) return 'DISEÑO';
  if (s.includes('corrige') || s.includes('arregla') || s.startsWith('fix')) return 'CORRECCIÓN';
  if (s.startsWith('fase 3') || s.includes('bo3.gg') || s.includes('opendota')) return 'DATOS';
  return 'MOTOR';
}

export function cambiosDeGit({ maximo = 40 } = {}) {
  let salida;
  try {
    salida = execFileSync('git', ['log', `-${maximo}`, '--date=short', '--pretty=format:%h\x1f%ad\x1f%s', '--', ...RUTAS], {
      cwd: new URL('.', RAIZ).pathname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }
  return salida
    .split('\n')
    .filter(Boolean)
    .map((linea) => {
      const [hash, fecha, ...resto] = linea.split('\x1f');
      const asunto = resto.join('\x1f');
      const corte = asunto.indexOf(':');
      return {
        hash,
        fecha,
        tipo: tipoDeCommit(asunto),
        titulo: corte > 0 ? asunto.slice(0, corte).trim() : asunto,
        texto: corte > 0 ? asunto.slice(corte + 1).trim() : '',
      };
    });
}

// --- todo junto ----------------------------------------------------------

export async function resumen({ minimoPartidas = 20 } = {}) {
  const partidas = await cargarPartidas();
  const bt = ejecutarBacktest(partidas, { kFactor: K_FACTOR, escala: ESCALA, deltaBo2: DELTA_BO2 });
  const series = enriquecerSeries(bt.resultados, partidas).sort((a, b) => a.startTime - b.startTime);

  return {
    partidas,
    series,
    calidad: calidad(series),
    clasificacion: clasificacion(partidas, { minimoPartidas }),
    cambios: cambiosDeGit(),
    coeficientes: { K_FACTOR, ESCALA, DELTA_BO2, RATING_INICIAL },
  };
}
