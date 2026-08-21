// Corre el motor Elo contra el histórico real, serie por serie, y mide qué
// tan buenas fueron las predicciones con Brier score. Regla 3: nada llega a
// producción sin pasar por acá. Regla 6: cada serie se predice solo con
// partidas ANTERIORES al inicio de esa serie.

import { aplicarPartida, probabilidadGanar } from '../motor/elo.mjs';
import { probabilidadSerie, formatoDesdeSeriesType } from '../motor/series.mjs';
import { RATING_INICIAL } from '../config.mjs';

export function agruparPorSerie(partidas) {
  const porSerie = new Map();
  for (const p of partidas) {
    if (!p.series_id) continue;
    if (!porSerie.has(p.series_id)) porSerie.set(p.series_id, []);
    porSerie.get(p.series_id).push(p);
  }
  for (const juegos of porSerie.values()) {
    juegos.sort((a, b) => a.start_time - b.start_time);
  }
  return porSerie;
}

// Determina los dos equipos de la serie (A = quien jugó de radiant en la
// primera partida cronológica, B = el rival) y cuántas partidas ganó cada
// uno. null si algún juego no tiene los dos team_id (no se puede evaluar).
export function resultadoDeSerie(juegos) {
  const primera = juegos[0];
  if (!primera.radiant_team_id || !primera.dire_team_id) return null;

  const equipoA = primera.radiant_team_id;
  const equipoB = primera.dire_team_id;
  let victoriasA = 0;
  let victoriasB = 0;

  for (const j of juegos) {
    if (!j.radiant_team_id || !j.dire_team_id) return null;

    const equipos = new Set([j.radiant_team_id, j.dire_team_id]);
    if (equipos.size !== 2 || !equipos.has(equipoA) || !equipos.has(equipoB)) {
      return null; // un equipo distinto a A/B jugó esta "serie" -- dato inconsistente, no evaluar
    }

    const ganador = j.radiant_win ? j.radiant_team_id : j.dire_team_id;
    if (ganador === equipoA) victoriasA++;
    else victoriasB++;
  }

  return { equipoA, equipoB, victoriasA, victoriasB };
}

// Brier score estándar (sin normalizar por K): suma de (predicho-real)² sobre
// todas las clases del formato de esta serie. 0 = perfecto. Con empate
// (bo2) el techo es 2; sin empate (bo1/bo3/bo5) también es 2, pero al ser
// binario equivale a 2*(p-real)². No se promedia entre series de distinto
// número de clases sin dejarlo explícito en el reporte.
export function brierDeSerie(prediccion, resultadoReal) {
  const clases = ['ganaA', 'empate', 'ganaB'];
  let suma = 0;
  for (const clase of clases) {
    const real = resultadoReal === clase ? 1 : 0;
    suma += (prediccion[clase] - real) ** 2;
  }
  return suma;
}

export function claseReal(resultado, formato) {
  if (resultado.victoriasA > resultado.victoriasB) return 'ganaA';
  if (resultado.victoriasB > resultado.victoriasA) return 'ganaB';
  if (formato === 'bo2') return 'empate';
  return null; // empate en un formato sin empate posible -- dato inconsistente
}

// Evalúa todas las series del histórico donde se pueda predecir: ambos
// equipos identificados, formato conocido, y resultado real consistente.
//
// Ojo con series en paralelo: si se procesara serie por serie (bloque
// completo antes de pasar a la siguiente), la partida 2 de una serie que
// arrancó antes podría "verse" al predecir otra serie que arrancó después
// pero cuya propia partida 2 todavía no pasó en el reloj real -- fuga
// temporal (regla 6). Por eso la pasada es partida por partida en orden
// cronológico GLOBAL (no por bloques de serie): se captura la predicción de
// una serie justo antes de aplicar su primera partida, con los ratings tal
// como estaban en ese instante real, y se sigue avanzando partida por
// partida sin importar a qué serie pertenece cada una.
export function ejecutarBacktest(partidas, opcionesElo = {}) {
  const { ratingInicial = RATING_INICIAL } = opcionesElo;
  const porSerie = agruparPorSerie(partidas);

  const infoPorPrimeraPartida = new Map(); // match_id de la 1ra partida de la serie -> qué predecir
  for (const juegos of porSerie.values()) {
    const formato = formatoDesdeSeriesType(juegos[0].series_type);
    const resultado = resultadoDeSerie(juegos);
    const real = formato && resultado ? claseReal(resultado, formato) : null;
    if (formato && resultado && real) {
      infoPorPrimeraPartida.set(juegos[0].match_id, {
        seriesId: juegos[0].series_id,
        formato,
        equipoA: resultado.equipoA,
        equipoB: resultado.equipoB,
        real,
      });
    }
  }

  const todasEnOrden = partidas.slice().sort((a, b) => a.start_time - b.start_time);
  const porEquipo = new Map();
  const partidasJugadas = new Map();
  const ratingDe = (id) => porEquipo.get(id) ?? ratingInicial;
  const resultados = [];

  for (const partida of todasEnOrden) {
    const info = infoPorPrimeraPartida.get(partida.match_id);
    if (info) {
      const ratingA = ratingDe(info.equipoA);
      const ratingB = ratingDe(info.equipoB);
      const p = probabilidadGanar(ratingA, ratingB, opcionesElo.escala);
      const prediccion = probabilidadSerie(p, info.formato, { deltaBo2: opcionesElo.deltaBo2 });
      const brier = brierDeSerie(prediccion, info.real);

      resultados.push({
        seriesId: info.seriesId,
        formato: info.formato,
        equipoA: info.equipoA,
        equipoB: info.equipoB,
        prediccion,
        real: info.real,
        brier,
        // Estado CONGELADO al predecir: los dos ratings con los que se
        // calculó la probabilidad de arriba, y cuándo. No es cálculo nuevo,
        // es reportar lo que esta misma función ya usó — sin esto la ficha
        // tendría que replayear el histórico por su cuenta y arriesgarse a
        // divergir del número que se publicó (regla 6).
        ratingA,
        ratingB,
        startTime: partida.start_time,
        leagueid: partida.leagueid,
        leagueName: partida.league_name ?? null,
      });
    }

    aplicarPartida(porEquipo, partidasJugadas, partida, opcionesElo);
  }

  const brierPromedio = (lista) =>
    lista.length > 0 ? lista.reduce((s, r) => s + r.brier, 0) / lista.length : NaN;

  const porFormato = {};
  for (const formato of ['bo1', 'bo2', 'bo3', 'bo5']) {
    const lista = resultados.filter((r) => r.formato === formato);
    porFormato[formato] = { cantidad: lista.length, brierPromedio: brierPromedio(lista) };
  }

  return {
    resultados,
    cantidad: resultados.length,
    brierPromedio: brierPromedio(resultados),
    porFormato,
  };
}
