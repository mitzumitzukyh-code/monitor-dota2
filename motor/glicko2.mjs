// Glicko-2 (Glickman, 2001). Compite contra motor/elo.mjs por el puesto.
//
// QUÉ AGREGA SOBRE ELO, Y POR QUÉ IMPORTA ACÁ
//
// El Elo clásico guarda un solo número por equipo y trata igual a uno con 29
// partidas que a uno con 334. Glicko-2 guarda tres:
//
//   rating (r)      la fuerza estimada, como en Elo
//   desviación (RD) cuánta confianza hay en esa estimación
//   volatilidad (σ) qué tan errático es el equipo
//
// La consecuencia que buscamos: contra un equipo con RD alto (poca
// experiencia), la probabilidad se **jala hacia 0.5** en vez de salir
// extrema. Ese es exactamente el caso de Iron Wing en TI2026 — 29 partidas,
// se le dio 12.3%, ganó, y su Brier de 1.5379 arrastró la media de las 18
// series. Ver CLAUDE.md, "Hipótesis pendiente para Fase 2".
//
// SOBRE PERIODOS DE CALIFICACIÓN
//
// Glicko-2 está pensado para agrupar partidas en "periodos" (una tanda de
// partidas se aplica junta). Acá se aplica **una partida por periodo**, en
// orden cronológico, por dos razones: la regla 6 exige que al predecir una
// partida el rating solo haya visto partidas anteriores, y así el punto de
// comparación con el Elo secuencial es idéntico. El costo conocido de esta
// simplificación es que el RD baja más rápido de lo que Glickman previó;
// TAU en config.mjs es la perilla para compensarlo, y hay que calibrarla
// contra el backtest como cualquier otro coeficiente (regla 4).
//
// Cero dependencias, como todo motor/.

import { RATING_INICIAL, GLICKO_RD_INICIAL, GLICKO_VOL_INICIAL, GLICKO_TAU } from '../config.mjs';

// Glicko-2 trabaja en una escala interna distinta a la de Glicko/Elo.
// 173.7178 = 400 / ln(10), la constante de conversión del paper.
const ESCALA_G2 = 173.7178;

// Tolerancia y tope de la iteración que resuelve la volatilidad. 1e-6 es lo
// que recomienda el paper; el tope existe para que un caso patológico no
// cuelgue el backtest de 72.000 partidas.
const EPSILON = 1e-6;
const MAX_ITERACIONES = 100;

export function estadoInicial() {
  return { rating: RATING_INICIAL, rd: GLICKO_RD_INICIAL, vol: GLICKO_VOL_INICIAL };
}

// --- conversiones de escala ---

const aMu = (rating) => (rating - RATING_INICIAL) / ESCALA_G2;
const aPhi = (rd) => rd / ESCALA_G2;
const aRating = (mu) => mu * ESCALA_G2 + RATING_INICIAL;
const aRd = (phi) => phi * ESCALA_G2;

// --- funciones del paper ---

// g(φ): cuánto pesa el resultado contra un rival según lo confiable que sea
// su rating. Rival con RD alto -> g bajo -> el resultado mueve menos.
function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

// E: probabilidad esperada de que μ le gane a μj, descontando la
// incertidumbre del rival.
function E(mu, muJ, phiJ) {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

// Resuelve la nueva volatilidad con el método de Illinois (el que indica el
// paper). Es una búsqueda de raíz sobre una función que no tiene solución
// cerrada -- por eso itera.
function nuevaVolatilidad(phi, sigma, v, delta, tau) {
  const a = Math.log(sigma * sigma);
  const phi2 = phi * phi;
  const delta2 = delta * delta;

  const f = (x) => {
    const ex = Math.exp(x);
    const num = ex * (delta2 - phi2 - v - ex);
    const den = 2 * (phi2 + v + ex) ** 2;
    return num / den - (x - a) / (tau * tau);
  };

  let A = a;
  let B;
  if (delta2 > phi2 + v) {
    B = Math.log(delta2 - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0 && k <= MAX_ITERACIONES) k++;
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  let iteraciones = 0;

  while (Math.abs(B - A) > EPSILON && iteraciones < MAX_ITERACIONES) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);

    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }

    B = C;
    fB = fC;
    iteraciones++;
  }

  return Math.exp(A / 2);
}

// --- API ---

// Probabilidad de que A le gane a B, tomando en cuenta la incertidumbre de
// LOS DOS. Esta es la diferencia práctica con Elo: las dos RD se combinan,
// así que si cualquiera de los dos es poco conocido, el resultado se acerca
// a 0.5 en vez de dar un número extremo con poca base.
export function probabilidadGanar(estadoA, estadoB) {
  const muA = aMu(estadoA.rating);
  const muB = aMu(estadoB.rating);
  const phiA = aPhi(estadoA.rd);
  const phiB = aPhi(estadoB.rd);
  // La incertidumbre combinada: sqrt(φA² + φB²).
  const phiCombinada = Math.sqrt(phiA * phiA + phiB * phiB);
  return 1 / (1 + Math.exp(-g(phiCombinada) * (muA - muB)));
}

// Forma general del paper: actualiza un equipo contra VARIOS rivales de un
// mismo periodo. `resultados` es [{ rival, puntaje }] con puntaje 1/0/0.5.
//
// En producción se usa con un solo rival (ver `actualizar`), pero la forma
// general existe para poder verificar contra el ejemplo resuelto que publicó
// Glickman — sin ese ancla, la implementación no sería comprobable a mano.
export function actualizarContraVarios(estado, resultados, { tau = GLICKO_TAU } = {}) {
  const mu = aMu(estado.rating);
  const phi = aPhi(estado.rd);
  const sigma = estado.vol;

  if (resultados.length === 0) {
    // Sin partidas el rating no se mueve, pero la confianza se pierde.
    return { rating: estado.rating, rd: aRd(Math.sqrt(phi * phi + sigma * sigma)), vol: sigma };
  }

  let sumaV = 0;
  let sumaDelta = 0;
  for (const { rival, puntaje } of resultados) {
    const muJ = aMu(rival.rating);
    const phiJ = aPhi(rival.rd);
    const gJ = g(phiJ);
    const eJ = E(mu, muJ, phiJ);
    sumaV += gJ * gJ * eJ * (1 - eJ);
    sumaDelta += gJ * (puntaje - eJ);
  }

  // v: varianza de la estimación según las partidas del periodo.
  const v = 1 / sumaV;
  // Δ: cuánto se movería el rating si no hubiera incertidumbre.
  const delta = v * sumaDelta;

  const sigmaNueva = nuevaVolatilidad(phi, sigma, v, delta, tau);

  // φ*: la RD crece por el paso del tiempo/volatilidad antes de encogerse
  // por la información nueva.
  const phiEstrella = Math.sqrt(phi * phi + sigmaNueva * sigmaNueva);
  const phiNueva = 1 / Math.sqrt(1 / (phiEstrella * phiEstrella) + 1 / v);
  const muNueva = mu + phiNueva * phiNueva * sumaDelta;

  return {
    rating: aRating(muNueva),
    rd: aRd(phiNueva),
    vol: sigmaNueva,
  };
}

// El caso de producción: un rival, una partida.
export function actualizar(estado, estadoRival, puntaje, opciones = {}) {
  return actualizarContraVarios(estado, [{ rival: estadoRival, puntaje }], opciones);
}

// Aplica una partida a los dos equipos a la vez. Muta el mapa, igual que
// aplicarPartida() del Elo, para poder recorrer el histórico en una sola
// pasada cronológica.
//
// `partida` en la forma normalizada de datos/juegos/bo3.mjs:
//   { equipoA, equipoB, ganador }
export function aplicarPartida(porEquipo, partidasJugadas, partida, opciones = {}) {
  const { equipoA: a, equipoB: b, ganador } = partida;
  if (!a || !b || (ganador !== a && ganador !== b)) return;

  const estadoA = porEquipo.get(a) ?? estadoInicial();
  const estadoB = porEquipo.get(b) ?? estadoInicial();
  const puntajeA = ganador === a ? 1 : 0;

  // Los dos se actualizan contra el estado del rival ANTES de esta partida:
  // si se usara el ya actualizado, el segundo equipo estaría reaccionando a
  // información que todavía no existía.
  porEquipo.set(a, actualizar(estadoA, estadoB, puntajeA, opciones));
  porEquipo.set(b, actualizar(estadoB, estadoA, 1 - puntajeA, opciones));

  partidasJugadas.set(a, (partidasJugadas.get(a) ?? 0) + 1);
  partidasJugadas.set(b, (partidasJugadas.get(b) ?? 0) + 1);
}

export function estadoDeEquipo(porEquipo, teamId) {
  return porEquipo.get(teamId) ?? estadoInicial();
}
