// Sweep de K_FACTOR/ESCALA contra el backtest real. Diagnóstico, no motor:
// no lleva pruebas dedicadas, solo imprime resultados para decidir a mano
// qué combinación se gana el puesto (regla 4). Ver CLAUDE.md.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ejecutarBacktest } from './backtest.mjs';

const BASE_INGENUA = { bo1: 0.5, bo2: 2 / 3, bo3: 0.5, bo5: 0.5 };

async function main() {
  const partidas = JSON.parse(await readFile(new URL('../datos/historico.json', import.meta.url), 'utf8'));

  const kFactores = [8, 16, 24, 32, 48, 64, 96];
  const escalas = [200, 300, 400, 600, 800];

  const filas = [];
  for (const kFactor of kFactores) {
    for (const escala of escalas) {
      const r = ejecutarBacktest(partidas, { kFactor, escala });
      filas.push({
        kFactor,
        escala,
        cantidad: r.cantidad,
        brierPromedio: r.brierPromedio,
        bo1: r.porFormato.bo1.brierPromedio,
        bo2: r.porFormato.bo2.brierPromedio,
        bo3: r.porFormato.bo3.brierPromedio,
        bo5: r.porFormato.bo5.brierPromedio,
      });
    }
  }

  filas.sort((a, b) => a.brierPromedio - b.brierPromedio);

  console.log('Base ingenua (sin información):', JSON.stringify(BASE_INGENUA));
  console.log(`\nTop 10 combinaciones por brier promedio general (${filas.length} probadas):`);
  for (const f of filas.slice(0, 10)) {
    console.log(
      `  K=${f.kFactor} escala=${f.escala} -> general=${f.brierPromedio.toFixed(4)} | bo1=${f.bo1.toFixed(4)} bo2=${f.bo2.toFixed(4)} bo3=${f.bo3.toFixed(4)} bo5=${f.bo5.toFixed(4)}`,
    );
  }

  console.log('\nPeor combinación:');
  const peor = filas[filas.length - 1];
  console.log(`  K=${peor.kFactor} escala=${peor.escala} -> general=${peor.brierPromedio.toFixed(4)}`);

  await calibrarDeltaBo2(partidas);
}

// bo2 (fase de grupos de TI) es el único formato con empate real. La
// fórmula binomial pura (deltaBo2=0) predecía ~47% de empate contra una
// tasa real de ~20% -- perdía contra la base ingenua (0.6667) sin importar
// K_FACTOR/ESCALA. deltaBo2 corrige la correlación intra-serie que la
// fórmula binomial ignora (ver motor/series.mjs).
async function calibrarDeltaBo2(partidas) {
  const deltas = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.4, 2.8, 3.2];
  const filas = [];
  for (const deltaBo2 of deltas) {
    const r = ejecutarBacktest(partidas, { deltaBo2 });
    const bo2 = r.resultados.filter((x) => x.formato === 'bo2');
    const empatePromedioPredicho = bo2.reduce((s, x) => s + x.prediccion.empate, 0) / bo2.length;
    filas.push({ deltaBo2, cantidad: bo2.length, brierBo2: r.porFormato.bo2.brierPromedio, empatePromedioPredicho });
  }

  console.log(`\nSweep de deltaBo2 (K/escala fijos en los valores de config.mjs), base ingenua bo2=${BASE_INGENUA.bo2.toFixed(4)}:`);
  for (const f of filas) {
    console.log(
      `  delta=${f.deltaBo2.toFixed(1)} -> brier bo2=${f.brierBo2.toFixed(4)} | empate promedio predicho=${(f.empatePromedioPredicho * 100).toFixed(1)}% (n=${f.cantidad})`,
    );
  }
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
