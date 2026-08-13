// Constantes del motor. Los valores de calibración (K_FACTOR, ESCALA) son
// placeholders razonables -- Fase 1 (backtest) decide si se quedan o cambian,
// igual que SEMIVIDA_JORNADAS/PESO_PRIOR_PARTIDOS en el proyecto de LaLiga.

export const RATING_INICIAL = 1500;

// Cuánto se mueve el rating de un equipo tras una partida. Valor clásico de
// ajedrez para jugadores no establecidos. Sin calibrar contra el backtest.
export const K_FACTOR = 32;

// Divisor en la fórmula logística de Elo: P(A) = 1 / (1 + 10^((R_B-R_A)/ESCALA)).
// 400 es la convención de ajedrez (una diferencia de 400 puntos = 10x más
// probable ganar). Sin calibrar contra el backtest.
export const ESCALA = 400;
