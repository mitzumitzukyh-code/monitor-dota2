// Constantes del motor. Calibradas con un sweep real contra
// datos/historico.json (16.450 partidas, solo torneos professional/premium)
// -- ver juez/calibrar.mjs. K=24/escala=400 quedó entre las mejores
// combinaciones del sweep (35 probadas) y no es un extremo raro del grid,
// así que se mantiene aunque el brier general esté casi empatado con varias
// vecinas (diferencias de milésimas, no vale la pena sobreajustar a una
// combinación puntual).
//
// Resultado real del backtest con estos valores (2026-08-13, ver CLAUDE.md
// para la comparación completa contra la base ingenua):
//   bo1 = 0.4875 (ingenua 0.5)   bo3 = 0.4735 (ingenua 0.5)
//   bo5 = 0.4587 (ingenua 0.5)   bo2 = 0.7083 (ingenua 0.6667) <- todavía NO se gana el puesto

export const RATING_INICIAL = 1500;

export const K_FACTOR = 24;

// Divisor en la fórmula logística de Elo: P(A) = 1 / (1 + 10^((R_B-R_A)/ESCALA)).
export const ESCALA = 400;

// Corrección de correlación intra-serie para Bo2 (motor/series.mjs). Sweep
// real contra el backtest (2026-08-13): delta=1.4 minimiza el Brier de bo2
// en 0.5977 (contra 0.6667 de la base ingenua -- ahora SÍ se gana el
// puesto, ver CLAUDE.md). En ese punto el modelo predice 19.0% de empate en
// promedio, casi exactamente la tasa real observada (~20.3%) -- buena señal
// de que el ajuste está capturando la causa real y no sobreajustando ruido.
export const DELTA_BO2 = 1.4;

// --- Glicko-2 (motor/glicko2.mjs) ---
// Valores de arranque del paper de Glickman (2001). NO calibrados todavía
// contra el backtest: hay que hacerlo por juego, igual que K_FACTOR y ESCALA,
// antes de que Glicko-2 pueda reemplazar a Elo (regla 4).

// Desviación inicial: cuánta desconfianza se le tiene al rating de un equipo
// que nunca jugó. 350 = "no sé nada de este equipo". Es lo que hace que las
// probabilidades contra un debutante salgan cerca de 0.5 en vez de extremas.
export const GLICKO_RD_INICIAL = 350;

// Volatilidad inicial: qué tan errático se asume que es un equipo nuevo.
export const GLICKO_VOL_INICIAL = 0.06;

// TAU acota cuánto puede cambiar la volatilidad de una partida a la otra.
// Glickman recomienda entre 0.3 y 1.2; valores chicos = sistema más estable,
// grandes = reacciona más rápido a rachas. 0.5 es el punto medio habitual.
// OJO: acá se aplica UNA partida por periodo de calificación (ver la cabecera
// de motor/glicko2.mjs), y eso hace que la RD baje más rápido de lo previsto.
// TAU es la perilla para compensarlo cuando se calibre.
export const GLICKO_TAU = 0.5;
