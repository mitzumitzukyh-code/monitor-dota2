// Calendario de próximos partidos. OpenDota no tiene fixtures (solo
// partidas ya jugadas) -- ver CLAUDE.md. Fuente: dota.haglund.dev, que
// cachea el calendario real de Liquipedia. Sin llave, sin límite
// documentado; no golpear más de una vez cada 15-30 min (regla 5).

import { fileURLToPath } from 'node:url';
import { teamIdPorNombre } from './equipos-ti2026.mjs';
import { fetchConReintentos } from './reintentar.mjs';

const URL_FIXTURES = 'https://dota.haglund.dev/v1/matches';

export async function proximosPartidos({ fetchImpl = fetchConReintentos } = {}) {
  const res = await fetchImpl(URL_FIXTURES);
  if (!res.ok) throw new Error(`dota.haglund.dev respondió ${res.status}`);
  return res.json();
}

// Filtra a los partidos de una liga por substring del nombre (ej. "TI 2026")
// y resuelve los nombres de equipo a team_id de OpenDota. Se salta
// cualquier partido donde algún equipo no calce (ej. "TBD", cupo de
// bracket sin definir) -- nunca inventa un cruce.
export function fixturesResueltos(partidos, subcadenaLiga) {
  const resueltos = [];

  for (const p of partidos) {
    if (!p.leagueName || !p.leagueName.includes(subcadenaLiga)) continue;
    if (!p.startsAt || !p.teams || p.teams.length !== 2) continue;

    const [ta, tb] = p.teams;
    if (!ta || !tb) continue;

    const equipoA = teamIdPorNombre(ta.name);
    const equipoB = teamIdPorNombre(tb.name);
    if (!equipoA || !equipoB) continue;

    resueltos.push({
      id: p.id,
      leagueName: p.leagueName,
      matchType: p.matchType,
      startsAt: p.startsAt,
      equipoA,
      nombreA: ta.name,
      equipoB,
      nombreB: tb.name,
    });
  }

  return resueltos;
}

async function main() {
  const subcadena = process.argv[2] || 'TI 2026';
  const partidos = await proximosPartidos();
  const resueltos = fixturesResueltos(partidos, subcadena);
  console.log(`${resueltos.length} de ${partidos.length} partidos calzan con "${subcadena}" y tienen ambos equipos identificados.`);
  console.log(JSON.stringify(resueltos, null, 2));
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
