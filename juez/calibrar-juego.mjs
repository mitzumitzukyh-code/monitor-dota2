// Fase 1 de un juego: calibrar los coeficientes de los dos motores y decidir cuál
// se queda (regla 4).
//
// POR QUÉ HAY SEPARACIÓN ENTRENAMIENTO / PRUEBA
//
// Barrer N combinaciones y después reportar la mejor sobre LOS MISMOS datos
// no mide el motor: mide cuál combinación tuvo más suerte con ese histórico
// puntual. Ya pasó en este proyecto -- ver CLAUDE.md de LaLiga, Fase 2: 68
// combinaciones dieron una "mejora" de 0.055% que no era consistente por
// temporada, y era ruido.
//
// Acá se parte el histórico por fecha: se calibra con lo viejo y se reporta
// con lo nuevo, que el barrido nunca vio. Es la única cifra que vale.
//
//   node juez/calibrar-juego.mjs cs2
//   node juez/calibrar-juego.mjs lol

import { readFile } from 'node:fs/promises';
import { probabilidadGanar as probElo } from '../motor/elo.mjs';
import { probabilidadGanar as probGlicko, aplicarPartida as aplicarGlicko } from '../motor/glicko2.mjs';

const RATING_INICIAL = 1500;

// Se descartan las primeras partidas de cada equipo: sin historial el rating
// es el inicial y la predicción no dice nada del motor.
const MIN_PREVIAS = 5;

// `puntuarDesde` separa lo que se APLICA de lo que se PUNTÚA: todas las
// partidas mueven el rating, pero sólo las posteriores a esa fecha entran en
// la nota. Sin esto, evaluar el 20% de prueba pasándole sólo ese 20% dejaba
// los ratings en blanco: los equipos llegaban casi sin historial y el número
// no representaba lo que pasa en producción, donde el rating trae encima todo
// el pasado. No era fuga (nunca se miró el futuro), pero sí una medición
// distinta de la que se estaba describiendo.
function pasadaElo(partidas, { k, escala }, puntuarDesde = -Infinity) {
  const rating = new Map();
  const previas = new Map();
  let suma = 0;
  let n = 0;
  let aciertos = 0;

  for (const m of partidas) {
    const a = m.equipoA;
    const b = m.equipoB;
    const ganoA = m.ganador === a;
    const ra = rating.get(a) ?? RATING_INICIAL;
    const rb = rating.get(b) ?? RATING_INICIAL;
    const p = probElo(ra, rb, escala);

    if (m.inicio >= puntuarDesde && (previas.get(a) ?? 0) >= MIN_PREVIAS && (previas.get(b) ?? 0) >= MIN_PREVIAS) {
      suma += (p - (ganoA ? 1 : 0)) ** 2;
      if ((p >= 0.5) === ganoA) aciertos++;
      n++;
    }

    const real = ganoA ? 1 : 0;
    rating.set(a, ra + k * (real - p));
    rating.set(b, rb + k * (1 - real - (1 - p)));
    previas.set(a, (previas.get(a) ?? 0) + 1);
    previas.set(b, (previas.get(b) ?? 0) + 1);
  }

  return { brier: suma / n, acierto: aciertos / n, n };
}

function pasadaGlicko(partidas, { tau, rdInicial }, puntuarDesde = -Infinity) {
  const estado = new Map();
  const previas = new Map();
  const inicial = { rating: RATING_INICIAL, rd: rdInicial, vol: 0.06 };
  let suma = 0;
  let n = 0;
  let aciertos = 0;

  for (const m of partidas) {
    const a = m.equipoA;
    const b = m.equipoB;
    const ganoA = m.ganador === a;
    const ea = estado.get(a) ?? inicial;
    const eb = estado.get(b) ?? inicial;
    const p = probGlicko(ea, eb);

    if (m.inicio >= puntuarDesde && (previas.get(a) ?? 0) >= MIN_PREVIAS && (previas.get(b) ?? 0) >= MIN_PREVIAS) {
      suma += (p - (ganoA ? 1 : 0)) ** 2;
      if ((p >= 0.5) === ganoA) aciertos++;
      n++;
    }

    // aplicarGlicko usa el estado inicial por defecto del config; acá hace
    // falta el rdInicial del barrido, así que se siembra a mano.
    if (!estado.has(a)) estado.set(a, inicial);
    if (!estado.has(b)) estado.set(b, inicial);
    aplicarGlicko(estado, new Map(), m, { tau });

    previas.set(a, (previas.get(a) ?? 0) + 1);
    previas.set(b, (previas.get(b) ?? 0) + 1);
  }

  return { brier: suma / n, acierto: aciertos / n, n };
}

const juego = process.argv[2] ?? 'cs2';

// Dota no viene de bo3.gg: su histórico es el de OpenDota, con otros nombres
// de campo (radiant_team_id / dire_team_id / radiant_win). Se normaliza a la
// misma forma para que la comparación entre motores sea exactamente la misma
// que se le corrió a CS2 y a LoL -- si la metodología cambiara entre juegos,
// los resultados no serían comparables.
//
// OJO: acá se compara a nivel de PARTIDA, igual que en los otros juegos,
// porque es donde los dos motores actualizan. La unidad de predicción de Dota
// en producción es la SERIE, derivada con motor/series.mjs; ese paso es el
// mismo para los dos motores, así que no cambia cuál gana.
const ES_DOTA = juego === 'dota2';
const ruta = ES_DOTA ? '../datos/historico.json' : `../datos/cache/historico-${juego}.json`;
const crudas = JSON.parse(await readFile(new URL(ruta, import.meta.url), 'utf8'));

const partidas = (
  ES_DOTA
    ? crudas
        .filter((p) => p.radiant_team_id && p.dire_team_id && typeof p.radiant_win === 'boolean')
        .map((p) => ({
          inicio: p.start_time,
          equipoA: p.radiant_team_id,
          equipoB: p.dire_team_id,
          ganador: p.radiant_win ? p.radiant_team_id : p.dire_team_id,
        }))
    : crudas
).sort((a, b) => a.inicio - b.inicio);

// Corte cronológico 80/20. El 20% más reciente NO se toca hasta el final.
const corte = partidas[Math.floor(partidas.length * 0.8)].inicio;
const entrenamiento = partidas.filter((p) => p.inicio < corte);
const prueba = partidas.filter((p) => p.inicio >= corte);

const fecha = (t) => new Date(t * 1000).toISOString().slice(0, 10);
console.log(`${juego.toUpperCase()} · ${partidas.length} partidas`);
console.log(`  entrenamiento: ${entrenamiento.length}  (${fecha(partidas[0].inicio)} → ${fecha(corte)})`);
console.log(`  prueba:        ${prueba.length}  (${fecha(corte)} → ${fecha(partidas[partidas.length - 1].inicio)})\n`);

// --- barrido de Elo ---
const combosElo = [];
for (const k of [8, 12, 16, 20, 24, 32, 40, 48]) {
  for (const escala of [200, 300, 400, 500, 600]) combosElo.push({ k, escala });
}
const resElo = combosElo
  .map((c) => ({ ...c, ...pasadaElo(entrenamiento, c) }))
  .sort((a, b) => a.brier - b.brier);

console.log('ELO · mejores 5 en ENTRENAMIENTO');
for (const r of resElo.slice(0, 5)) {
  console.log(`  K=${String(r.k).padStart(2)} escala=${r.escala}  brier ${r.brier.toFixed(5)}  acierto ${(r.acierto * 100).toFixed(2)}%`);
}

// --- barrido de Glicko-2 ---
const combosG = [];
for (const tau of [0.2, 0.35, 0.5, 0.8, 1.2]) {
  for (const rdInicial of [150, 200, 250, 300, 350, 400]) combosG.push({ tau, rdInicial });
}
const resG = combosG
  .map((c) => ({ ...c, ...pasadaGlicko(entrenamiento, c) }))
  .sort((a, b) => a.brier - b.brier);

console.log('\nGLICKO-2 · mejores 5 en ENTRENAMIENTO');
for (const r of resG.slice(0, 5)) {
  console.log(`  tau=${r.tau} rd=${r.rdInicial}  brier ${r.brier.toFixed(5)}  acierto ${(r.acierto * 100).toFixed(2)}%`);
}

// --- el veredicto, sobre datos que el barrido NUNCA vio ---
const mejorElo = resElo[0];
const mejorG = resG[0];
const finalElo = pasadaElo(partidas, mejorElo, corte);
const finalG = pasadaGlicko(partidas, mejorG, corte);
const finalEloDota = pasadaElo(partidas, { k: 24, escala: 400 }, corte);

console.log('\n' + '='.repeat(66));
console.log('VEREDICTO · sobre el 20% reciente, que el barrido nunca vio');
console.log('='.repeat(66));
console.log(`  base ingenua (50-50)            brier 0.25000`);
console.log(`  Elo con coefs de DOTA (24/400)  brier ${finalEloDota.brier.toFixed(5)}  acierto ${(finalEloDota.acierto * 100).toFixed(2)}%`);
console.log(`  Elo calibrado (${mejorElo.k}/${mejorElo.escala})${' '.repeat(Math.max(0, 12 - String(mejorElo.k + '/' + mejorElo.escala).length))}   brier ${finalElo.brier.toFixed(5)}  acierto ${(finalElo.acierto * 100).toFixed(2)}%`);
console.log(`  Glicko-2 calibrado (${mejorG.tau}/${mejorG.rdInicial})     brier ${finalG.brier.toFixed(5)}  acierto ${(finalG.acierto * 100).toFixed(2)}%`);
console.log(`\n  n de prueba: ${finalElo.n}`);
console.log(`  gana: ${finalG.brier < finalElo.brier ? 'GLICKO-2' : 'ELO'} por ${Math.abs(finalG.brier - finalElo.brier).toFixed(5)} de brier`);
