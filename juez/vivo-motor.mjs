// Predice las series de TI2026 que todavía no se jugaron y las guarda en
// Supabase. series_id = el id del fixture de dota.haglund.dev (no existe
// series_id de OpenDota todavía -- la serie no pasó). Ver CLAUDE.md.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ratings, ratingDeEquipo, probabilidadGanar } from '../motor/elo.mjs';
import { probabilidadSerie } from '../motor/series.mjs';
import { proximosPartidos, fixturesResueltos } from '../datos/fixtures.mjs';
import { upsert } from '../datos/supabase.mjs';

const LEAGUE_ID_TI2026 = 19719;

function formatoDesdeMatchType(matchType) {
  const normalizado = (matchType || '').trim().toLowerCase();
  if (['bo1', 'bo2', 'bo3', 'bo5'].includes(normalizado)) return normalizado;
  return null; // no se puede predecir sin saber el formato -- nunca se adivina
}

export async function predecirProximos({
  subcadenaLiga = 'TI 2026',
  leagueId = LEAGUE_ID_TI2026,
  historico,
  ahora = Date.now() / 1000,
  fetchImplFixtures,
  fetchImplSupabase,
} = {}) {
  const partidos = await proximosPartidos({ fetchImpl: fetchImplFixtures });
  const fixtures = fixturesResueltos(partidos, subcadenaLiga);

  const historicoReal = historico ?? JSON.parse(await readFile(new URL('../datos/historico.json', import.meta.url), 'utf8'));
  const r = ratings(historicoReal, ahora);

  const predicciones = [];
  const sinFormato = [];

  for (const f of fixtures) {
    const formato = formatoDesdeMatchType(f.matchType);
    if (!formato) {
      sinFormato.push(f);
      continue;
    }

    const ratingA = ratingDeEquipo(r, f.equipoA);
    const ratingB = ratingDeEquipo(r, f.equipoB);
    const p = probabilidadGanar(ratingA, ratingB);
    const prediccion = probabilidadSerie(p, formato);

    predicciones.push({
      fixture: f,
      leagueId,
      formato,
      prediccion,
    });
  }

  if (predicciones.length > 0) {
    await upsert(
      'dota_teams',
      predicciones.flatMap((p) => [
        { team_id: p.fixture.equipoA, nombre: p.fixture.nombreA },
        { team_id: p.fixture.equipoB, nombre: p.fixture.nombreB },
      ]),
      { onConflict: 'team_id', fetchImpl: fetchImplSupabase },
    );

    await upsert(
      'dota_series',
      predicciones.map((p) => ({
        series_id: p.fixture.id,
        league_id: p.leagueId,
        league_name: p.fixture.leagueName,
        formato: p.formato,
        equipo_a: p.fixture.equipoA,
        equipo_b: p.fixture.equipoB,
        start_time: p.fixture.startsAt,
      })),
      { onConflict: 'series_id', fetchImpl: fetchImplSupabase },
    );

    await upsert(
      'dota_predictions',
      predicciones.map((p) => ({
        series_id: p.fixture.id,
        prob_gana_a: p.prediccion.ganaA,
        prob_empate: p.prediccion.empate,
        prob_gana_b: p.prediccion.ganaB,
      })),
      { onConflict: 'series_id', fetchImpl: fetchImplSupabase },
    );
  }

  return { predicciones, sinFormato };
}

async function main() {
  const { predicciones, sinFormato } = await predecirProximos();
  console.log(`${predicciones.length} predicciones guardadas.`);
  for (const p of predicciones) {
    console.log(
      `  ${p.fixture.nombreA} vs ${p.fixture.nombreB} (${p.formato}, ${p.fixture.startsAt}): A=${(p.prediccion.ganaA * 100).toFixed(1)}% empate=${(p.prediccion.empate * 100).toFixed(1)}% B=${(p.prediccion.ganaB * 100).toFixed(1)}%`,
    );
  }
  if (sinFormato.length > 0) {
    console.log(`${sinFormato.length} partidos sin formato reconocible, no se predijeron:`, sinFormato.map((f) => f.matchType));
  }
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
