// Predice las series de TI2026 que todavía no se jugaron y las guarda en
// Supabase. series_id = el id del fixture de dota.haglund.dev (no existe
// series_id de OpenDota todavía -- la serie no pasó). Ver CLAUDE.md.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ratings, ratingDeEquipo, probabilidadGanar } from '../motor/elo.mjs';
import { probabilidadSerie } from '../motor/series.mjs';
import { proximosPartidos, fixturesResueltos } from '../datos/fixtures.mjs';
import { partidasDeLaLiga, historicoConLiga } from '../datos/liga.mjs';
import { upsert, seleccionar } from '../datos/supabase.mjs';

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
  refrescarLiga = true,
  fetchImplFixtures,
  fetchImplSupabase,
  fetchImplLiga,
} = {}) {
  const partidos = await proximosPartidos({ fetchImpl: fetchImplFixtures });
  const fixtures = fixturesResueltos(partidos, subcadenaLiga);

  const predicciones = [];
  const sinFormato = [];
  const yaEmpezaron = [];
  const yaPredichas = [];

  // Regla 6 en producción: el feed sigue listando series que YA empezaron
  // (verificado con datos reales). Predecirlas usaría ratings que incluyen
  // partidas de esa misma serie -- fuga temporal. Se descartan de una.
  const candidatas = [];
  for (const f of fixtures) {
    if (new Date(f.startsAt).getTime() / 1000 <= ahora) {
      yaEmpezaron.push(f);
      continue;
    }
    candidatas.push(f);
  }

  // Una predicción es un compromiso registrado: una vez guardada no se
  // reescribe, aunque después haya ratings más frescos. Si se sobreescribe,
  // el Brier ya calculado deja de corresponder a lo que se predijo y el
  // auto-juicio se vuelve mentira.
  if (candidatas.length > 0) {
    const existentes = await seleccionar(
      'dota_predictions',
      `?select=series_id&series_id=in.(${candidatas.map((f) => `"${f.id}"`).join(',')})`,
      { fetchImpl: fetchImplSupabase },
    );
    const yaGuardadas = new Set(existentes.map((p) => p.series_id));
    for (let i = candidatas.length - 1; i >= 0; i--) {
      if (yaGuardadas.has(candidatas[i].id)) {
        yaPredichas.push(candidatas[i]);
        candidatas.splice(i, 1);
      }
    }
  }

  // Misma serie puede llegar con ids distintos: cada fuente (haglund.dev vs
  // bo3.gg) tiene su propio id para el MISMO partido. Si una serie ya quedó
  // predicha cuando haglund estaba caído (con id de bo3.gg) y haglund vuelve
  // listándola con su id, sin esto se predeciría dos veces y el Brier sería
  // mentira. Se busca por par de equipos + cercanía temporal: dos series del
  // mismo par no se juegan el mismo día, así que 12h de ventana alcanza.
  if (candidatas.length > 0) {
    const seriesLiga = await seleccionar(
      'dota_series',
      `?select=series_id,equipo_a,equipo_b,start_time&league_id=eq.${leagueId}`,
      { fetchImpl: fetchImplSupabase },
    );
    const MS_VENTANA_MISMA_SERIE = 12 * 3600 * 1000;
    const yaExisteElPar = (f) =>
      seriesLiga.some((s) => {
        const mismoPar =
          (s.equipo_a === f.equipoA && s.equipo_b === f.equipoB) ||
          (s.equipo_a === f.equipoB && s.equipo_b === f.equipoA);
        if (!mismoPar) return false;
        const diff = Math.abs(new Date(s.start_time).getTime() - new Date(f.startsAt).getTime());
        return diff <= MS_VENTANA_MISMA_SERIE;
      });
    for (let i = candidatas.length - 1; i >= 0; i--) {
      if (yaExisteElPar(candidatas[i])) {
        yaPredichas.push(candidatas[i]);
        candidatas.splice(i, 1);
      }
    }
  }

  if (candidatas.length === 0) {
    return { predicciones, sinFormato, yaEmpezaron, yaPredichas, agregadasDeLaLiga: 0 };
  }

  const historicoBase = historico ?? JSON.parse(await readFile(new URL('../datos/historico.json', import.meta.url), 'utf8'));

  // El histórico en disco es un snapshot. Sin refrescar, predecir una ronda
  // de TI ignora todo lo que pasó en las rondas anteriores del mismo torneo.
  let historicoReal = historicoBase;
  let agregadasDeLaLiga = 0;
  if (refrescarLiga) {
    const partidasLiga = await partidasDeLaLiga(leagueId, { fetchImpl: fetchImplLiga });
    const fusion = historicoConLiga(historicoBase, partidasLiga);
    historicoReal = fusion.partidas;
    agregadasDeLaLiga = fusion.agregadas;
  }

  const r = ratings(historicoReal, ahora);

  for (const f of candidatas) {
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

  return { predicciones, sinFormato, yaEmpezaron, yaPredichas, agregadasDeLaLiga };
}

async function main() {
  const { predicciones, sinFormato, yaEmpezaron, yaPredichas, agregadasDeLaLiga } = await predecirProximos();
  if (agregadasDeLaLiga > 0) {
    console.log(`${agregadasDeLaLiga} partidas nuevas del torneo agregadas al histórico en memoria (ratings frescos).`);
  }
  console.log(`${predicciones.length} predicciones nuevas guardadas.`);
  for (const p of predicciones) {
    console.log(
      `  ${p.fixture.nombreA} vs ${p.fixture.nombreB} (${p.formato}, ${p.fixture.startsAt}): A=${(p.prediccion.ganaA * 100).toFixed(1)}% empate=${(p.prediccion.empate * 100).toFixed(1)}% B=${(p.prediccion.ganaB * 100).toFixed(1)}%`,
    );
  }
  if (yaEmpezaron.length > 0) {
    console.log(`${yaEmpezaron.length} series ya empezadas, saltadas (regla 6, no se predice sobre el presente).`);
  }
  if (yaPredichas.length > 0) {
    console.log(`${yaPredichas.length} series ya tenían predicción guardada, no se tocaron.`);
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
