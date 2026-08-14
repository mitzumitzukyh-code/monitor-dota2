// Convierte la probabilidad de ganar UNA partida (motor/elo.mjs) en la
// probabilidad de ganar la SERIE completa (Bo1/Bo2/Bo3/Bo5).
//
// OpenDota trae series_type: 0=Bo1, 1=Bo3, 2=Bo5, 3=Bo2 -- verificado con
// datos reales (ver CLAUDE.md). Bo2 es el único formato donde hay empate
// real (1-1). OJO: la fase de grupos de TI2026 es Bo3 (verificado con las
// 29 partidas reales ya jugadas y el calendario de próximas rondas -- ver
// CLAUDE.md), NO Bo2 como se asumió al principio por investigación
// genérica sobre formato suizo. Bo2 sigue siendo real y presente en otros
// torneos del histórico, por eso el ajuste de correlación (deltaBo2) se
// mantiene, pero no es el formato crítico para TI2026 esta edición.

function combinaciones(n, k) {
  if (k < 0 || k > n) return 0;
  let resultado = 1;
  for (let i = 0; i < k; i++) {
    resultado = (resultado * (n - i)) / (i + 1);
  }
  return resultado;
}

// Probabilidad de ganar un "mejor de" con un número impar de partidas
// (1, 3, 5, 7...), sin empate posible. k = victorias necesarias.
export function probabilidadMejorDeImpar(p, mejorDe) {
  const k = (mejorDe + 1) / 2;
  let suma = 0;
  for (let i = 0; i < k; i++) {
    suma += combinaciones(k - 1 + i, i) * p ** k * (1 - p) ** i;
  }
  return suma;
}

import { DELTA_BO2 } from '../config.mjs';

function sigmoide(x) {
  return 1 / (1 + Math.exp(-x));
}

function logit(p) {
  return Math.log(p / (1 - p));
}

// Cuántas partidas hay que ganar para cerrar cada formato.
const VICTORIAS_NECESARIAS = { bo1: 1, bo2: 2, bo3: 2, bo5: 3 };

// Probabilidad de cada MARCADOR posible de la serie (2–0, 2–1, 1–2, 0–2 en
// un Bo3). Es el equivalente honesto de la matriz de marcadores exactos de
// Dixon-Coles en el proyecto de fútbol: no agrega ningún supuesto nuevo,
// sale de la misma p de partida.
//
// Para un "primero a k": A gana con marcador k–j si gana k partidas y
// pierde j, y la ÚLTIMA la gana él. Las j derrotas se reparten entre las
// k−1+j partidas previas -> C(k−1+j, j) · p^k · (1−p)^j.
//
// Bo2 no es un "primero a k" (se juegan las dos partidas siempre y el 1–1
// es un resultado válido), así que va aparte y respeta el mismo deltaBo2
// de correlación intra-serie que probabilidadSerie.
export function distribucionMarcadores(p, formato, { deltaBo2 = DELTA_BO2 } = {}) {
  if (formato === 'bo2') {
    const pSegundaSiGanoA = sigmoide(logit(p) + deltaBo2);
    const pSegundaSiGanoB = sigmoide(logit(p) - deltaBo2);
    const ganaA = p * pSegundaSiGanoA;
    const ganaB = (1 - p) * (1 - pSegundaSiGanoB);
    return [
      { marcador: '2–0', prob: ganaA, gana: 'A' },
      { marcador: '1–1', prob: 1 - ganaA - ganaB, gana: 'empate' },
      { marcador: '0–2', prob: ganaB, gana: 'B' },
    ];
  }

  const k = VICTORIAS_NECESARIAS[formato];
  if (!k) throw new Error(`formato de serie desconocido: ${formato}`);

  const deA = [];
  const deB = [];
  for (let j = 0; j < k; j++) {
    const peso = combinaciones(k - 1 + j, j);
    deA.push({ marcador: `${k}–${j}`, prob: peso * p ** k * (1 - p) ** j, gana: 'A' });
    deB.push({ marcador: `${j}–${k}`, prob: peso * (1 - p) ** k * p ** j, gana: 'B' });
  }
  // A de mejor a peor, después B de peor a mejor: deja el 2–1 y el 1–2
  // pegados en el medio, que es donde se decide la serie.
  return [...deA, ...deB.reverse()];
}

// Recupera la p de PARTIDA a partir de la probabilidad de SERIE ya
// calculada. La ficha necesita esto para que los marcadores que muestra
// sean consistentes con la predicción que de verdad se guardó, en vez de
// con un recálculo del Elo que puede haber cambiado (el histórico crece).
//
// probabilidadMejorDeImpar es monótona creciente en p, así que una
// bisección converge sin sorpresas. Para bo2 se invierte ganaA, que
// también es monótona.
export function probabilidadPartidaDesdeSerie(probGanaA, formato, { deltaBo2 = DELTA_BO2, tolerancia = 1e-12 } = {}) {
  if (formato === 'bo1') return probGanaA;

  const ganaADesdeP = (p) => {
    if (formato === 'bo2') return p * sigmoide(logit(p) + deltaBo2);
    return probabilidadMejorDeImpar(p, formato === 'bo3' ? 3 : 5);
  };

  let lo = 1e-9;
  let hi = 1 - 1e-9;
  for (let i = 0; i < 200; i++) {
    const medio = (lo + hi) / 2;
    if (ganaADesdeP(medio) < probGanaA) lo = medio;
    else hi = medio;
    if (hi - lo < tolerancia) break;
  }
  return (lo + hi) / 2;
}

export function formatoDesdeSeriesType(seriesType) {
  switch (seriesType) {
    case 0: return 'bo1';
    case 3: return 'bo2';
    case 1: return 'bo3';
    case 2: return 'bo5';
    default: return null; // formato desconocido -- quien llama decide si saltar la serie
  }
}

// p = probabilidad de que el equipo A gane UNA partida contra B (motor/elo.mjs).
// Devuelve { ganaA, empate, ganaB }, siempre suma 1.
//
// deltaBo2: las dos partidas de un Bo2 NO son independientes en la
// realidad -- ganar la primera aumenta la chance de ganar la segunda más de
// lo que el rating por sí solo predice (verificado contra el backtest real:
// el modelo sin este ajuste predecía ~47% de empate contra una tasa real de
// ~20%. Ver CLAUDE.md). deltaBo2 desplaza la probabilidad condicional de la
// partida 2 en escala logit: con deltaBo2=0 se reduce exactamente a la
// fórmula binomial ingenua (partidas independientes, p², 2p(1-p), (1-p)²).
// Sin calibrar todavía contra el backtest -- ver juez/calibrar.mjs.
export function probabilidadSerie(p, formato, { deltaBo2 = DELTA_BO2 } = {}) {
  switch (formato) {
    case 'bo1':
      return { ganaA: p, empate: 0, ganaB: 1 - p };
    case 'bo2': {
      const pSegundaSiGanoA = sigmoide(logit(p) + deltaBo2);
      const pSegundaSiGanoB = sigmoide(logit(p) - deltaBo2);
      const ganaA = p * pSegundaSiGanoA;
      const ganaB = (1 - p) * (1 - pSegundaSiGanoB);
      return { ganaA, empate: 1 - ganaA - ganaB, ganaB };
    }
    case 'bo3': {
      const ganaA = probabilidadMejorDeImpar(p, 3);
      return { ganaA, empate: 0, ganaB: 1 - ganaA };
    }
    case 'bo5': {
      const ganaA = probabilidadMejorDeImpar(p, 5);
      return { ganaA, empate: 0, ganaB: 1 - ganaA };
    }
    default:
      throw new Error(`formato de serie desconocido: ${formato}`);
  }
}
