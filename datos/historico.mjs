import { fileURLToPath } from 'node:url';

const BASE = 'https://api.opendota.com/api/proMatches';

export function segundosDesdeHace(meses, ahora = Date.now()) {
  const ms = ahora - meses * 30 * 24 * 60 * 60 * 1000;
  return Math.floor(ms / 1000);
}

export async function paginarProMatches({
  fetchImpl = fetch,
  cutoffTimestamp,
  esperaMs = 1500,
  esperaReintentoMs = 5000,
  maxReintentos = 5,
  maxPaginas = Infinity,
  onPagina,
} = {}) {
  let lessThan;
  const todas = [];
  let paginas = 0;

  while (paginas < maxPaginas) {
    const url = lessThan ? `${BASE}?less_than_match_id=${lessThan}` : BASE;
    let pagina;

    for (let intento = 0; ; intento++) {
      const res = await fetchImpl(url);
      if (res.status === 429) {
        if (intento >= maxReintentos) {
          throw new Error(`OpenDota respondió 429 repetidamente (${maxReintentos} reintentos) en ${url}`);
        }
        await new Promise((r) => setTimeout(r, esperaReintentoMs * (intento + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`OpenDota respondió ${res.status} en ${url}`);
      pagina = await res.json();
      break;
    }

    if (pagina.length === 0) break;

    todas.push(...pagina);
    paginas++;
    if (onPagina) await onPagina(pagina, todas);

    const masVieja = pagina[pagina.length - 1];
    if (masVieja.start_time < cutoffTimestamp) break;

    lessThan = masVieja.match_id;
    if (esperaMs > 0 && paginas < maxPaginas) {
      await new Promise((r) => setTimeout(r, esperaMs));
    }
  }

  return todas.filter((m) => m.start_time >= cutoffTimestamp);
}

export function limpiar(partidasCrudas) {
  return partidasCrudas.map((m) => ({
    match_id: m.match_id,
    series_id: m.series_id,
    series_type: m.series_type,
    leagueid: m.leagueid,
    league_name: m.league_name,
    start_time: m.start_time,
    radiant_team_id: m.radiant_team_id,
    radiant_name: m.radiant_name,
    dire_team_id: m.dire_team_id,
    dire_name: m.dire_name,
    radiant_win: m.radiant_win,
  }));
}

export function validar(partidas) {
  const problemas = [];
  const idsVistos = new Set();
  let sinEquipo = 0;
  let sinNombre = 0;

  for (const p of partidas) {
    if (idsVistos.has(p.match_id)) {
      problemas.push(`match_id duplicado: ${p.match_id}`);
    }
    idsVistos.add(p.match_id);

    if (typeof p.radiant_win !== 'boolean') {
      problemas.push(`match_id ${p.match_id}: radiant_win no es booleano`);
    }
    if (!p.radiant_team_id || !p.dire_team_id) {
      sinEquipo++;
    }
    if (!p.radiant_name || !p.dire_name) {
      sinNombre++;
    }
    if (!p.start_time || p.start_time <= 0) {
      problemas.push(`match_id ${p.match_id}: start_time inválido`);
    }
  }

  return {
    valido: problemas.length === 0,
    problemas,
    total: partidas.length,
    sinEquipo,
    sinNombre,
  };
}

async function main() {
  const meses = Number(process.argv[2]) || 15;
  const cutoffTimestamp = segundosDesdeHace(meses);
  console.log(`Bajando partidas profesionales desde hace ${meses} meses (cutoff ${new Date(cutoffTimestamp * 1000).toISOString()})...`);

  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(new URL('./cache/', import.meta.url), { recursive: true });

  let paginasVistas = 0;
  const crudas = await paginarProMatches({
    cutoffTimestamp,
    onPagina: async (pagina, acumuladas) => {
      paginasVistas++;
      const masVieja = pagina[pagina.length - 1];
      console.log(`  página ${paginasVistas}: ${acumuladas.length} partidas acumuladas, más vieja ${new Date(masVieja.start_time * 1000).toISOString()}`);
      if (paginasVistas % 20 === 0) {
        await writeFile(new URL('./cache/promatches-raw.json', import.meta.url), JSON.stringify(acumuladas));
      }
    },
  });
  console.log(`Bajadas ${crudas.length} partidas en total.`);

  const limpias = limpiar(crudas);
  const reporte = validar(limpias);
  console.log(JSON.stringify({ ...reporte, problemas: reporte.problemas.slice(0, 10) }, null, 2));

  await writeFile(
    new URL('./cache/promatches-raw.json', import.meta.url),
    JSON.stringify(crudas),
  );
  await writeFile(
    new URL('./historico.json', import.meta.url),
    JSON.stringify(limpias),
  );
  console.log('Guardado datos/cache/promatches-raw.json y datos/historico.json');
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
