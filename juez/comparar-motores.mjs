// Elo contra Glicko-2, sobre el mismo histórico y las mismas partidas.
// Regla 4: si Glicko-2 no baja el Brier, no entra.
//
//   node juez/comparar-motores.mjs cs2
//
// CÓMO SE EVITA LA FUGA TEMPORAL (regla 6)
// Se recorre el histórico UNA vez en orden cronológico. Para cada partida:
// primero se predice con los ratings acumulados hasta ese momento, y después
// se aplica el resultado. Una partida nunca influye en su propia predicción.

import { readFile } from 'node:fs/promises';
import { probabilidadGanar as probElo } from '../motor/elo.mjs';
import {
  estadoInicial,
  probabilidadGanar as probGlicko,
  aplicarPartida as aplicarGlicko,
} from '../motor/glicko2.mjs';
import { RATING_INICIAL, K_FACTOR, ESCALA } from '../config.mjs';

// Brier de dos resultados: (p - real)^2 promediado sobre las dos clases,
// que para binario equivale a 2*(p-real)^2 / 2. Se usa la forma normalizada
// para que 0.25 sea "predecir 50-50 siempre" y sea comparable con la base.
function brierBinario(probA, ganoA) {
  const real = ganoA ? 1 : 0;
  return (probA - real) ** 2;
}

export function comparar(partidas, { minPartidasPrevias = 0 } = {}) {
  const orden = partidas.slice().sort((x, y) => x.inicio - y.inicio);

  const elo = new Map();
  const glicko = new Map();
  const jugadas = new Map();
  const jugadasGlicko = new Map();

  const acc = {
    n: 0,
    brierElo: 0,
    brierGlicko: 0,
    brierBase: 0,
    aciertosElo: 0,
    aciertosGlicko: 0,
  };

  for (const p of orden) {
    const a = p.equipoA;
    const b = p.equipoB;
    const ganoA = p.ganador === a;

    const previasA = jugadas.get(a) ?? 0;
    const previasB = jugadas.get(b) ?? 0;
    const cuenta = previasA >= minPartidasPrevias && previasB >= minPartidasPrevias;

    if (cuenta) {
      const pElo = probElo(elo.get(a) ?? RATING_INICIAL, elo.get(b) ?? RATING_INICIAL, ESCALA);
      const pGlicko = probGlicko(glicko.get(a) ?? estadoInicial(), glicko.get(b) ?? estadoInicial());

      acc.n++;
      acc.brierElo += brierBinario(pElo, ganoA);
      acc.brierGlicko += brierBinario(pGlicko, ganoA);
      acc.brierBase += brierBinario(0.5, ganoA);
      if ((pElo >= 0.5) === ganoA) acc.aciertosElo++;
      if ((pGlicko >= 0.5) === ganoA) acc.aciertosGlicko++;
    }

    // --- aplicar (después de predecir, siempre) ---
    const ra = elo.get(a) ?? RATING_INICIAL;
    const rb = elo.get(b) ?? RATING_INICIAL;
    const esperadoA = probElo(ra, rb, ESCALA);
    const realA = ganoA ? 1 : 0;
    elo.set(a, ra + K_FACTOR * (realA - esperadoA));
    elo.set(b, rb + K_FACTOR * (1 - realA - (1 - esperadoA)));

    aplicarGlicko(glicko, jugadasGlicko, p);

    jugadas.set(a, previasA + 1);
    jugadas.set(b, previasB + 1);
  }

  return {
    n: acc.n,
    elo: { brier: acc.brierElo / acc.n, acierto: acc.aciertosElo / acc.n },
    glicko: { brier: acc.brierGlicko / acc.n, acierto: acc.aciertosGlicko / acc.n },
    base: { brier: acc.brierBase / acc.n },
  };
}

const juego = process.argv[2] ?? 'cs2';
const partidas = JSON.parse(await readFile(new URL(`../datos/cache/historico-${juego}.json`, import.meta.url), 'utf8'));

console.log(`ELO vs GLICKO-2 · ${juego} · ${partidas.length} partidas\n`);
console.log('filtro                        n      Brier Elo   Brier Glicko   dif      Acierto Elo  Acierto Glicko');
console.log('─'.repeat(104));

for (const min of [0, 5, 10, 25]) {
  const r = comparar(partidas, { minPartidasPrevias: min });
  const dif = r.glicko.brier - r.elo.brier;
  const marca = dif < 0 ? '  GLICKO' : '  elo';
  console.log(
    `ambos con >=${String(min).padEnd(3)} previas   ${String(r.n).padStart(6)}   ` +
      `${r.elo.brier.toFixed(5)}     ${r.glicko.brier.toFixed(5)}      ` +
      `${(dif >= 0 ? '+' : '') + dif.toFixed(5)}   ` +
      `${(r.elo.acierto * 100).toFixed(2)}%       ${(r.glicko.acierto * 100).toFixed(2)}%${marca}`,
  );
}

const base = comparar(partidas, { minPartidasPrevias: 0 });
console.log('─'.repeat(104));
console.log(`base ingenua (siempre 50-50): Brier ${base.base.brier.toFixed(5)}`);
