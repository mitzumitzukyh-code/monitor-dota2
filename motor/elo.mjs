// Rating Elo secuencial por equipo, partida a partida. Sin goles -- Dota no
// los tiene -- así que a diferencia de motor/elo.mjs de LaLiga (que en
// realidad es un modelo de ataque/defensa sobre goles), este es el Elo
// clásico: cada partida ajusta el rating de los dos equipos según si el
// resultado fue mejor o peor de lo esperado.
//
// P(A gana) = 1 / (1 + 10^((R_B - R_A) / ESCALA))
// R_A' = R_A + K * (resultado_A - P(A gana))
//
// El ajuste por opuesto ya está incluido en la fórmula (jugarle a un rival
// fuerte y ganar sube más el rating que ganarle a uno débil) -- no hace
// falta un término de "fuerza de defensa" como en fútbol.

import { RATING_INICIAL, K_FACTOR, ESCALA } from '../config.mjs';

// Regla 6 (cero fuga temporal): solo entran partidas con start_time
// estrictamente anterior a fechaCorte.
function partidasAnteriores(partidas, fechaCorte) {
  return partidas
    .filter((p) => p.start_time < fechaCorte)
    .slice()
    .sort((a, b) => a.start_time - b.start_time); // más vieja primero: el Elo se actualiza en orden real
}

export function probabilidadGanar(ratingA, ratingB, escala = ESCALA) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / escala));
}

// Recorre el historial en orden cronológico y devuelve el rating de cada
// equipo justo antes de fechaCorte (es decir, después de aplicar todas sus
// partidas anteriores a esa fecha, y ninguna posterior).
export function ratings(
  partidas,
  fechaCorte,
  { ratingInicial = RATING_INICIAL, kFactor = K_FACTOR, escala = ESCALA } = {},
) {
  const anteriores = partidasAnteriores(partidas, fechaCorte);
  const porEquipo = new Map();
  const partidasJugadas = new Map();

  const ratingDe = (equipo) => porEquipo.get(equipo) ?? ratingInicial;

  for (const p of anteriores) {
    if (!p.radiant_team_id || !p.dire_team_id) continue; // sin equipo identificado, no se puede ratear

    const a = p.radiant_team_id;
    const b = p.dire_team_id;
    const ra = ratingDe(a);
    const rb = ratingDe(b);
    const probA = probabilidadGanar(ra, rb, escala);
    const resultadoA = p.radiant_win ? 1 : 0;

    porEquipo.set(a, ra + kFactor * (resultadoA - probA));
    porEquipo.set(b, rb + kFactor * ((1 - resultadoA) - (1 - probA)));

    partidasJugadas.set(a, (partidasJugadas.get(a) ?? 0) + 1);
    partidasJugadas.set(b, (partidasJugadas.get(b) ?? 0) + 1);
  }

  return { porEquipo, partidasJugadas, ratingInicial };
}

// Rating de un equipo puntual, con el valor inicial de default si nunca jugó
// antes de fechaCorte (equipo nuevo -- ni ventaja ni desventaja).
export function ratingDeEquipo(resultado, teamId) {
  return resultado.porEquipo.get(teamId) ?? resultado.ratingInicial;
}
