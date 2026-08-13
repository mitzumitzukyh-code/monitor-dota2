// Convierte la probabilidad de ganar UNA partida (motor/elo.mjs) en la
// probabilidad de ganar la SERIE completa (Bo1/Bo2/Bo3/Bo5).
//
// OpenDota trae series_type: 0=Bo1, 1=Bo3, 2=Bo5, 3=Bo2 -- verificado con
// datos reales (ver CLAUDE.md). Bo2 es el único formato donde hay empate
// real (1-1): lo usa la fase de grupos de The International.

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
export function probabilidadSerie(p, formato) {
  switch (formato) {
    case 'bo1':
      return { ganaA: p, empate: 0, ganaB: 1 - p };
    case 'bo2':
      return { ganaA: p * p, empate: 2 * p * (1 - p), ganaB: (1 - p) * (1 - p) };
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
