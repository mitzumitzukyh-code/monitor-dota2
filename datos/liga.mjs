// Partidas ya jugadas de un torneo puntual (OpenDota). Compartido entre el
// que predice (para tener ratings frescos) y el que califica (para saber
// cómo terminó cada serie).

import { fetchConReintentos } from './reintentar.mjs';

const BASE_LEAGUE_MATCHES = 'https://api.opendota.com/api/leagues';

export async function partidasDeLaLiga(leagueId, { fetchImpl = fetchConReintentos } = {}) {
  const res = await fetchImpl(`${BASE_LEAGUE_MATCHES}/${leagueId}/matches`);
  if (!res.ok) throw new Error(`OpenDota respondió ${res.status}`);
  return res.json();
}

// Agrupa las partidas de un torneo en SERIES: quiénes jugaron, cómo quedó y
// cuándo arrancó. Sirve para saber qué se jugó de verdad, sin depender de si
// el sistema lo había predicho o no.
export function seriesDeLaLiga(partidasLiga) {
  const porSerie = new Map();
  for (const p of partidasLiga) {
    if (!p.series_id || !p.radiant_team_id || !p.dire_team_id) continue;
    if (!porSerie.has(p.series_id)) porSerie.set(p.series_id, []);
    porSerie.get(p.series_id).push(p);
  }

  const series = [];
  for (const [seriesId, juegos] of porSerie) {
    juegos.sort((a, b) => a.start_time - b.start_time);
    const primera = juegos[0];
    const equipoA = primera.radiant_team_id;
    const equipoB = primera.dire_team_id;

    let victoriasA = 0;
    let victoriasB = 0;
    let consistente = true;
    for (const j of juegos) {
      const equipos = new Set([j.radiant_team_id, j.dire_team_id]);
      if (!equipos.has(equipoA) || !equipos.has(equipoB)) {
        consistente = false;
        break;
      }
      const ganador = j.radiant_win ? j.radiant_team_id : j.dire_team_id;
      if (ganador === equipoA) victoriasA++;
      else victoriasB++;
    }
    if (!consistente) continue;

    series.push({
      seriesId,
      equipoA,
      equipoB,
      victoriasA,
      victoriasB,
      startTime: primera.start_time,
      partidas: juegos.length,
    });
  }

  return series.sort((a, b) => a.startTime - b.startTime);
}

// Fusiona las partidas de un torneo en vivo con el histórico bajado a disco,
// sin duplicar por match_id. El histórico es un snapshot: sin esto, predecir
// una ronda de TI ignora todo lo que pasó en las rondas anteriores del mismo
// torneo (verificado: 24 partidas reales ignoradas el 2026-08-14).
//
// No hay riesgo de fuga temporal: OpenDota solo devuelve partidas ya
// terminadas, y ratings() de todas formas filtra por start_time < fechaCorte.
export function historicoConLiga(historico, partidasLiga) {
  const vistos = new Set(historico.map((p) => p.match_id));
  const nuevas = [];

  for (const p of partidasLiga) {
    if (vistos.has(p.match_id)) continue;
    if (!p.radiant_team_id || !p.dire_team_id) continue;
    if (typeof p.radiant_win !== 'boolean') continue;

    nuevas.push({
      match_id: p.match_id,
      series_id: p.series_id,
      series_type: p.series_type,
      leagueid: p.leagueid,
      league_name: p.league_name ?? null,
      start_time: p.start_time,
      radiant_team_id: p.radiant_team_id,
      radiant_name: p.radiant_team_name ?? null,
      dire_team_id: p.dire_team_id,
      dire_name: p.dire_team_name ?? null,
      radiant_win: p.radiant_win,
    });
  }

  return { partidas: [...historico, ...nuevas], agregadas: nuevas.length };
}
