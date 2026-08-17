// Siembra los ratings de un juego desde el histórico local, de una sola vez.
//
//   node --env-file=.env datos/juegos/sembrar-ratings.mjs cs2
//
// POR QUÉ HACE FALTA
// sincronizarRatings() de juez/vivo-esports.mjs avanza de a 30 páginas por
// corrida para no pasarse de la ventana del cron. Eso está bien para el día a
// día, pero arrancando desde cero es un desastre: la primera corrida real
// aplicó las 2.993 partidas MÁS VIEJAS (llegó a julio de 2021) y predijo con
// eso. Las 51 predicciones salieron 0.500 exacto, porque ningún equipo actual
// tenía rating todavía. Habría tardado ~24 corridas en ponerse al día, y
// mientras tanto todo lo predicho era basura.
//
// Acá se dobla el histórico completo en memoria (72.630 partidas, ~85 ms) y
// se escribe el estado final. Después el incremental toma la posta.
//
// Se corre UNA vez por juego, o cuando haga falta reconstruir el estado.

import { readFile } from 'node:fs/promises';
import { upsert, seleccionar } from '../supabase.mjs';
import { actualizar } from '../../motor/glicko2.mjs';
import { COEFICIENTES } from '../../config.mjs';

const POR_LOTE = 500; // Supabase rechaza cuerpos muy grandes de un tirón.

export async function sembrarRatings(juego, { fetchImplSupabase } = {}) {
  const cfg = COEFICIENTES[juego];
  if (!cfg?.glicko) throw new Error(`${juego} no tiene coeficientes de glicko calibrados`);

  const partidas = JSON.parse(
    await readFile(new URL(`../cache/historico-${juego}.json`, import.meta.url), 'utf8'),
  ).sort((a, b) => a.inicio - b.inicio);

  const inicial = { rating: 1500, rd: cfg.glicko.rdInicial, vol: cfg.glicko.volInicial };
  const porEquipo = new Map();
  let ultima = null;

  for (const m of partidas) {
    const a = porEquipo.get(m.equipoA) ?? { ...inicial, partidas: 0 };
    const b = porEquipo.get(m.equipoB) ?? { ...inicial, partidas: 0 };
    const ganoA = m.ganador === m.equipoA;

    // Los dos contra el estado PREVIO del rival, igual que en el incremental.
    const na = actualizar(a, b, ganoA ? 1 : 0, { tau: cfg.glicko.tau });
    const nb = actualizar(b, a, ganoA ? 0 : 1, { tau: cfg.glicko.tau });

    porEquipo.set(m.equipoA, { ...na, partidas: a.partidas + 1 });
    porEquipo.set(m.equipoB, { ...nb, partidas: b.partidas + 1 });
    ultima = m;
  }

  const ahora = new Date().toISOString();
  const filas = [...porEquipo.entries()].map(([team_id, e]) => ({
    juego,
    team_id,
    rating: e.rating,
    rd: e.rd,
    vol: e.vol,
    partidas: e.partidas,
    actualizado_en: ahora,
  }));

  for (let i = 0; i < filas.length; i += POR_LOTE) {
    await upsert('eslo_ratings', filas.slice(i, i + POR_LOTE), {
      onConflict: 'juego,team_id',
      fetchImpl: fetchImplSupabase,
    });
  }

  await upsert(
    'eslo_estado',
    [
      {
        juego,
        ultimo_inicio: new Date(ultima.inicio * 1000).toISOString(),
        ultimo_match_id: ultima.matchId,
        partidas_aplicadas: partidas.length,
        actualizado_en: ahora,
      },
    ],
    { onConflict: 'juego', fetchImpl: fetchImplSupabase },
  );

  return { partidas: partidas.length, equipos: filas.length, hasta: ultima.inicio };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const juego = process.argv[2] ?? 'cs2';
  const r = await sembrarRatings(juego);
  console.log(`${juego}: ${r.partidas} partidas dobladas, ${r.equipos} equipos con rating`);
  console.log(`  estado hasta: ${new Date(r.hasta * 1000).toISOString()}`);
  const top = await seleccionar('eslo_ratings', `?select=team_id,rating,rd,partidas&juego=eq.${juego}&order=rating.desc&limit=5`);
  console.log('  mejores 5:', top.map((t) => `#${t.team_id} ${Number(t.rating).toFixed(0)} (rd ${Number(t.rd).toFixed(0)}, ${t.partidas}p)`).join(' · '));
}
