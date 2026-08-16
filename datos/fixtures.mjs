// Calendario de próximos partidos. OpenDota no tiene fixtures (solo
// partidas ya jugadas) -- ver CLAUDE.md. Fuente principal:
// dota.haglund.dev, que cachea el calendario real de Liquipedia. Sin llave,
// sin límite documentado; no golpear más de una vez cada 15-30 min (regla 5).
//
// RESPALDO (2026-08-16): haglund.dev se cayó (HTTP 500 sostenido, corridas
// 112+ del ciclo fallando) y dejó al pipeline sin calendario justo antes del
// Main Event. bo3.gg ya traía el calendario de TI2026 con status=upcoming
// explícito (verificado con llamadas reales: tournament_id=5134, Bo3, equipos
// reales de TI), así que el fallback usa esa misma fuente multijuego del
// repo. El motor no cambia: esto solo elige de dónde salen los fixtures.

import { fileURLToPath } from 'node:url';
import { teamIdPorNombre } from './equipos-ti2026.mjs';
import { fetchConReintentos } from './reintentar.mjs';
import { proximasPartidasConNombres } from './juegos/bo3.mjs';

const URL_FIXTURES = 'https://dota.haglund.dev/v1/matches';

// Verificado con llamadas reales (2026-08-16): el tournament_id de The
// International 2026 en bo3.gg. Los partidos venían con los equipos reales de
// TI (TEAM VISION, BoomBoys, Team Liquid, Team Yandex, Nigma Galaxy, Team
// Falcons) y fechas del Main Event (20-23 de agosto).
const TI2026_BO3_TOURNAMENT_ID = 5134;

export async function proximosPartidos({ fetchImpl = fetchConReintentos } = {}) {
  try {
    const res = await fetchImpl(URL_FIXTURES);
    if (!res.ok) throw new Error(`dota.haglund.dev respondió ${res.status}`);
    return res.json();
  } catch (err) {
    // haglund caído (como el 2026-08-16): no se puede predecir sin calendario,
    // pero sí se puede usar el de bo3.gg, que trae la misma info y mejor
    // (status=upcoming explícito). Se avisa por consola para que quede en el
    // log de GitHub Actions.
    console.warn(`  dota.haglund.dev no respondió (${err.message}); usando bo3.gg como respaldo.`);
    return proximosPartidosDesdeBo3gg({ fetchImpl });
  }
}

// Misma forma de salida que haglund (id, leagueName, matchType, startsAt,
// teams) para que fixturesResueltos() no sepa de dónde vino el partido.
// leagueName se fija a 'TI 2026' porque bo3.gg no trae el nombre del torneo
// en /matches -- solo el tournament_id, que ya está verificado arriba.
export async function proximosPartidosDesdeBo3gg({ fetchImpl = fetchConReintentos } = {}) {
  const proximas = await proximasPartidasConNombres('dota2', { fetchImpl });
  return proximas
    .filter((p) => p.tournamentId === TI2026_BO3_TOURNAMENT_ID)
    .filter((p) => p.nombreA && p.nombreB) // TBD (cupo de bracket sin definir): nunca inventar cruces
    .map((p) => ({
      id: String(p.matchId),
      leagueName: 'TI 2026',
      matchType: p.formato,
      startsAt: p.inicio ? new Date(p.inicio * 1000).toISOString() : null,
      teams: [{ name: p.nombreA }, { name: p.nombreB }],
    }));
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
