// Fase 0 de un juego: baja todo el histórico de bo3.gg y lo deja en caché.
//
//   node datos/juegos/bajar-historico.mjs cs2
//   node datos/juegos/bajar-historico.mjs lol
//
// Se corre UNA vez por juego. El archivo queda en datos/cache/ (ignorado por
// git, igual que el resto del caché) y a partir de ahí el backtest lee de
// disco -- nunca se vuelve a pedir lo que ya está guardado (regla 5).

import { writeFile, mkdir } from 'node:fs/promises';
import { bajarPartidas, esUtilizable, DISCIPLINAS } from './bo3.mjs';

const juego = process.argv[2];

if (!juego || !DISCIPLINAS[juego]) {
  console.error(`uso: node datos/juegos/bajar-historico.mjs <juego>`);
  console.error(`juegos: ${Object.keys(DISCIPLINAS).join(', ')}`);
  process.exit(1);
}

const inicio = Date.now();
console.log(`bajando histórico de ${juego}...`);

const { partidas, total } = await bajarPartidas(juego, {
  alAvanzar: ({ pagina, bajadas, total }) => {
    if (pagina % 25 === 0) {
      const pct = total ? ((bajadas / total) * 100).toFixed(1) : '?';
      console.log(`  página ${pagina} · ${bajadas}/${total} (${pct}%)`);
    }
  },
});

const utiles = partidas.filter(esUtilizable);
const descartadas = partidas.length - utiles.length;

const destino = new URL(`../cache/historico-${juego}.json`, import.meta.url);
await mkdir(new URL('../cache/', import.meta.url), { recursive: true });
await writeFile(destino, JSON.stringify(utiles), 'utf8');

const seg = ((Date.now() - inicio) / 1000).toFixed(0);
console.log(`\nlisto en ${seg}s`);
console.log(`  la fuente dice:  ${total}`);
console.log(`  bajadas:         ${partidas.length}`);
console.log(`  utilizables:     ${utiles.length}`);
console.log(`  descartadas:     ${descartadas}`);
console.log(`  guardado en:     datos/cache/historico-${juego}.json`);
