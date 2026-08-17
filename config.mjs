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

// --- Coeficientes POR JUEGO -------------------------------------------------
//
// Los de arriba (K_FACTOR, ESCALA) son los de Dota y quedan como están porque
// TI2026 está en producción con ellos. Pero un Bo3 de CS2 no tiene la misma
// varianza que uno de Dota, y calibrar por juego dio una mejora real y medida
// (ver CLAUDE.md, Fase 1 de CS2): el Elo con los coeficientes de Dota daba
// brier 0.23386 sobre CS2, y con los suyos 0.23190.
//
// Un juego NO hereda los coeficientes de otro. Antes de agregar una entrada
// acá hay que correr juez/calibrar-cs2.mjs adaptado a ese juego.
export const COEFICIENTES = {
  dota2: {
    motor: 'elo',
    kFactor: 24,
    escala: 400,
    // Glicko-2 NO se ha probado contra el histórico de Dota. Le ganó a Elo en
    // CS2, pero la regla es que un juego no hereda la aprobación de otro.
    // Hasta que se corra ese experimento, Dota sigue con Elo.
    glicko: null,
  },
  cs2: {
    // Calibrado con barrido 80/20 cronológico sobre 72.630 partidas y medido
    // sobre el 20% reciente que el barrido nunca vio. Glicko-2 le gana a Elo
    // de forma concluyente: dif -0.002162, IC95 [-0.003145, -0.001179],
    // t = -4.31 sobre n = 12.447.
    motor: 'glicko2',
    kFactor: 20,
    escala: 200,
    glicko: { tau: 1.2, rdInicial: 200, volInicial: 0.06 },
  },
  lol: {
    // EMPATE TECNICO entre Elo y Glicko-2, medido sobre el 20% reciente que
    // el barrido nunca vio: Elo 0.21326 contra Glicko-2 0.21365. Elo queda
    // nominalmente adelante por 0.00039, pero el pareado da t = 1.47 con el
    // intervalo conteniendo el cero -- o sea, ninguno le gana al otro.
    //
    // Se elige glicko2 porque, empatados en nota, es el que ya esta cableado
    // en juez/vivo-esports.mjs y el unico que expresa incertidumbre, que es
    // lo que los avisos de Discord traducen a palabras. NO se elige porque
    // haya ganado: no gano.
    //
    // OJO, esto es lo contrario que en CS2, donde Glicko-2 SI le gana a Elo
    // de forma concluyente (t = -4.31). Es la regla en accion: un juego no
    // hereda la conclusion de otro.
    motor: 'glicko2',
    kFactor: 32,
    escala: 200,
    glicko: { tau: 0.2, rdInicial: 150, volInicial: 0.06 },
  },
  valorant: {
    // EMPATE, y el más parejo de los cuatro: dif 0.000317, t = 0.24, IC95
    // [-0.002316, +0.002951]. Elo queda nominalmente adelante por 0.00032,
    // que es ruido puro.
    //
    // Igual que en LoL, se elige glicko2 por estar ya cableado y por expresar
    // incertidumbre, NO porque haya ganado. No ganó.
    //
    // Contra la base ingenua sí gana: 0.23178 contra 0.25000, un -7.3%. Eso es
    // lo que le da el pase a Fase 3 (regla 4), no el duelo entre motores.
    motor: 'glicko2',
    kFactor: 40,
    escala: 300,
    glicko: { tau: 1.2, rdInicial: 150, volInicial: 0.06 },
  },
};

// El barrido dejó ver algo que conviene tener escrito: en Elo lo que manda es
// la RAZÓN K/escala, no los valores sueltos. K=20/escala=200 y K=40/escala=400
// dieron brier idéntico (0.22406). Si alguien "sube K" sin tocar la escala,
// está cambiando esa razón, no la velocidad de aprendizaje sola.
