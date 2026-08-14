// Se pone nota a sí mismo: busca predicciones pendientes (resultado_real
// null), las cruza contra partidas reales ya completadas de OpenDota por
// par de equipos (no hay series_id compartido entre dota.haglund.dev y
// OpenDota -- ver CLAUDE.md), calcula el resultado real y el Brier, y
// actualiza la fila.

import { fileURLToPath } from 'node:url';
import { seleccionar, upsert } from '../datos/supabase.mjs';
import { partidasDeLaLiga } from '../datos/liga.mjs';
import { brierDeSerie } from './backtest.mjs';

export { partidasDeLaLiga };

// Cuántas partidas hacen falta ganar para cerrar la serie, según el
// formato -- para saber si ya está DECIDIDA o todavía puede seguir.
export function victoriasParaGanar(formato) {
  return { bo1: 1, bo2: 2, bo3: 2, bo5: 3 }[formato] ?? null;
}

// Busca, entre las partidas reales de la liga, las que enfrentan a ese par
// de equipos (sin importar quién jugó de radiant/dire) y cuenta victorias.
// null si el par de equipos no aparece todavía.
//
// OJO (bug real corregido 2026-08-14): un par de equipos puede enfrentarse
// en MÁS DE UNA serie del mismo torneo -- fase de grupos y después
// playoffs. Sin acotar, las dos series se sumaban como si fueran una sola.
// Por eso hay que pasar `desdeTimestamp` (el inicio programado de LA serie
// que se está calificando) y `victoriasNecesarias` del formato:
//
//   - toleranciaAntesSegundos: las series arrancan antes de lo programado
//     con frecuencia (real: LGD vs Nigma arrancó 49 min antes). 2h da
//     margen sin alcanzar la ronda anterior, que está a ~3h.
//   - ventanaSerieSegundos: corta por arriba para que una revancha del
//     mismo par (días después, en bracket) no entre en esta serie.
//   - victoriasNecesarias: deja de contar en cuanto la serie se decide,
//     así ninguna partida posterior se cuela.
export function resultadoDelPar(
  partidasLiga,
  equipoA,
  equipoB,
  {
    desdeTimestamp = null,
    victoriasNecesarias = null,
    toleranciaAntesSegundos = 2 * 3600,
    ventanaSerieSegundos = 8 * 3600,
  } = {},
) {
  let candidatas = partidasLiga
    .filter(
      (p) =>
        (p.radiant_team_id === equipoA && p.dire_team_id === equipoB) ||
        (p.radiant_team_id === equipoB && p.dire_team_id === equipoA),
    )
    .sort((a, b) => a.start_time - b.start_time);

  if (desdeTimestamp !== null) {
    candidatas = candidatas.filter((p) => p.start_time >= desdeTimestamp - toleranciaAntesSegundos);
    if (candidatas.length > 0) {
      const limite = candidatas[0].start_time + ventanaSerieSegundos;
      candidatas = candidatas.filter((p) => p.start_time <= limite);
    }
  }

  if (candidatas.length === 0) return null;

  let victoriasA = 0;
  let victoriasB = 0;
  for (const p of candidatas) {
    const ganador = p.radiant_win ? p.radiant_team_id : p.dire_team_id;
    if (ganador === equipoA) victoriasA++;
    else victoriasB++;

    if (victoriasNecesarias && (victoriasA >= victoriasNecesarias || victoriasB >= victoriasNecesarias)) {
      break;
    }
  }

  return { victoriasA, victoriasB };
}

export function claseReal(resultado, formato) {
  const necesarias = victoriasParaGanar(formato);
  if (resultado.victoriasA >= necesarias) return 'ganaA';
  if (resultado.victoriasB >= necesarias) return 'ganaB';
  if (formato === 'bo2' && resultado.victoriasA === 1 && resultado.victoriasB === 1) return 'empate';
  return null; // todavía no está decidida
}

export async function actualizarNotas({ fetchImpl, fetchImplSupabase } = {}) {
  const pendientes = await seleccionar(
    'dota_series',
    '?terminada=eq.false&select=series_id,league_id,league_name,formato,equipo_a,equipo_b,start_time',
    { fetchImpl: fetchImplSupabase },
  );

  if (pendientes.length === 0) return { actualizadas: 0 };

  const predicciones = await seleccionar(
    'dota_predictions',
    `?resultado_real=is.null&series_id=in.(${pendientes.map((p) => `"${p.series_id}"`).join(',')})`,
    { fetchImpl: fetchImplSupabase },
  );
  const prediccionPorSerie = new Map(predicciones.map((p) => [p.series_id, p]));

  const porLiga = new Map();
  for (const s of pendientes) {
    if (!prediccionPorSerie.has(s.series_id)) continue;
    if (!porLiga.has(s.league_id)) porLiga.set(s.league_id, []);
    porLiga.get(s.league_id).push(s);
  }

  let actualizadas = 0;
  const filasSeries = [];
  const filasPredicciones = [];

  for (const [leagueId, series] of porLiga) {
    const partidasLiga = await partidasDeLaLiga(leagueId, { fetchImpl });

    for (const s of series) {
      // start_time viene de Postgres como texto ISO -- a epoch en segundos,
      // que es la unidad de start_time de OpenDota.
      const desdeTimestamp = Math.floor(new Date(s.start_time).getTime() / 1000);
      const resultado = resultadoDelPar(partidasLiga, s.equipo_a, s.equipo_b, {
        desdeTimestamp,
        victoriasNecesarias: victoriasParaGanar(s.formato),
      });
      if (!resultado) continue;

      const real = claseReal(resultado, s.formato);
      if (!real) continue; // par encontrado pero la serie sigue abierta

      const prediccion = prediccionPorSerie.get(s.series_id);
      const brier = brierDeSerie(
        { ganaA: prediccion.prob_gana_a, empate: prediccion.prob_empate, ganaB: prediccion.prob_gana_b },
        real,
      );

      filasSeries.push({
        series_id: s.series_id,
        league_id: s.league_id,
        league_name: s.league_name,
        formato: s.formato,
        equipo_a: s.equipo_a,
        equipo_b: s.equipo_b,
        start_time: s.start_time,
        terminada: true,
        victorias_a: resultado.victoriasA,
        victorias_b: resultado.victoriasB,
      });
      filasPredicciones.push({
        series_id: s.series_id,
        prob_gana_a: prediccion.prob_gana_a,
        prob_empate: prediccion.prob_empate,
        prob_gana_b: prediccion.prob_gana_b,
        resultado_real: real,
        brier,
      });
      actualizadas++;
    }
  }

  if (filasSeries.length > 0) {
    await upsert('dota_series', filasSeries, { onConflict: 'series_id', fetchImpl: fetchImplSupabase });
    await upsert('dota_predictions', filasPredicciones, { onConflict: 'series_id', fetchImpl: fetchImplSupabase });
  }

  return { actualizadas };
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  actualizarNotas()
    .then((r) => console.log(`${r.actualizadas} series actualizadas.`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
