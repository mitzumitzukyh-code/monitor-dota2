// Resumen de cómo va cada juego, todo junto. Va a Discord una vez al día.
//
// EL PROBLEMA QUE RESUELVE, Y QUE NO ES OBVIO
//
// Los Brier de Dota y los de CS2/LoL NO están en la misma escala:
//
//   Dota      juez/backtest.mjs:brierDeSerie() suma sobre TRES clases
//             (ganaA, empate, ganaB). Una moneda da 0.50.
//   CS2/LoL   juez/vivo-esports.mjs usa un solo término, (p - real)².
//             Una moneda da 0.25.
//
// Poner 0.4260 (Dota) al lado de 0.2371 (CS2) haría ver a CS2 el doble de
// bueno sin serlo. Por eso acá NUNCA se comparan los Brier crudos entre
// juegos: cada uno se muestra contra SU base, y la columna que sí es
// comparable es el porcentaje respecto a esa base.
//
// Ese porcentaje también aguanta el caso de bo2, donde el empate es real y la
// base ingenua es 2/3 en vez de 1/2 -- por eso se calcula por fila y no se
// asume una constante.

import { fileURLToPath } from 'node:url';
import { seleccionar } from '../datos/supabase.mjs';
import { enviar, recortar } from './discord.mjs';

// Base ingenua de Dota por formato: sin información, repartir entre las
// clases posibles. Mismos valores que usa el panel y los avisos de Dota.
const BASE_DOTA = { bo1: 0.5, bo2: 2 / 3, bo3: 0.5, bo5: 0.5 };

// CS2 y LoL predicen a una sola cara: la base de un 50-50 es (0.5-1)² = 0.25.
const BASE_ESLO = 0.25;

// Cuántas partidas calificadas hace falta EN UN JUEGO para que su número
// signifique algo. Sale del cálculo real hecho el 2026-08-15 sobre el tamaño
// de efecto observado: con la diferencia que se ve contra la base ingenua,
// hacen falta ~275 para que el intervalo de confianza deje de contener a la
// base.
//
// Es POR JUEGO, no en total. Sumar los cuatro y decir "ya llegamos" sería el
// truco más fácil de hacerse trampa: 30 partidas repartidas entre cuatro
// juegos no son 30 de nada.
const MINIMO_POR_JUEGO = 275;

function fila(nombre, predichas, calificadas) {
  const n = calificadas.length;
  if (n === 0) return { nombre, predichas, n: 0 };

  const brier = calificadas.reduce((s, c) => s + c.brier, 0) / n;
  const base = calificadas.reduce((s, c) => s + c.base, 0) / n;
  const aciertos = calificadas.filter((c) => c.acerto).length;

  return {
    nombre,
    predichas,
    n,
    brier,
    base,
    // Lo único comparable entre juegos: cuánto mejor (negativo) o peor
    // (positivo) que su propia base ingenua.
    vsBase: (brier - base) / base,
    aciertos,
  };
}

export function mensajeResumenGlobal(filas, { ahora = new Date() } = {}) {
  const conDatos = filas.filter((f) => f.n > 0);
  const totalCalificadas = conDatos.reduce((s, f) => s + f.n, 0);

  const cab = '        PREDICHAS  CALIF.   BRIER   BASE   VS BASE  ACIERTOS';
  const cuerpo = filas.map((f) => {
    const nom = f.nombre.padEnd(7);
    const pre = String(f.predichas).padStart(8);
    if (f.n === 0) return `${nom}${pre}${String(0).padStart(8)}       —      —        —         —`;

    const pct = (f.vsBase * 100).toFixed(0);
    const signo = f.vsBase <= 0 ? '' : '+';
    return (
      `${nom}${pre}${String(f.n).padStart(8)}  ` +
      `${f.brier.toFixed(4)}  ${f.base.toFixed(3)}  ${(signo + pct + '%').padStart(7)}  ` +
      `${String(f.aciertos + '/' + f.n).padStart(8)}`
    );
  });

  const partes = [`📊 **Cómo vamos** — ${filas.length} juegos`, '', '```', cab, ...cuerpo, '```'];

  // La advertencia no es adorno: con muestras chicas el número parece decir
  // algo y no dice nada. Va SIEMPRE que ningún juego llegue solo al mínimo, y
  // va ARRIBA de cualquier lectura optimista.
  const maduros = conDatos.filter((f) => f.n >= MINIMO_POR_JUEGO);

  if (maduros.length === 0) {
    const mejor = conDatos.reduce((m, f) => (f.n > (m?.n ?? -1) ? f : m), null);
    const falta = mejor ? MINIMO_POR_JUEGO - mejor.n : MINIMO_POR_JUEGO;
    partes.push(
      `⚠️ **Ningún juego tiene muestra suficiente todavía.** ` +
        `El que más lleva es **${mejor?.nombre ?? '—'}** con **${mejor?.n ?? 0}**, y le faltan **${falta}** ` +
        `para que su número signifique algo. Total acumulado: ${totalCalificadas}.`,
    );
  } else {
    const mejores = maduros.filter((f) => f.vsBase < 0).length;
    partes.push(
      `${mejores} de ${maduros.length} juegos **con muestra suficiente** van mejor que su base ingenua.` +
        (maduros.length < conDatos.length ? ' Los demás siguen sin muestra.' : ''),
    );
  }

  partes.push('');
  partes.push(
    '_`VS BASE` es lo único comparable entre juegos: negativo = mejor que adivinar. ' +
      'Los Brier crudos NO son comparables entre sí — Dota puntúa sobre tres clases (empate incluido) ' +
      'y CS2/LoL sobre una, así que sus escalas son distintas._',
  );

  return recortar(partes.join('\n'));
}

// --- lectura de las dos fuentes ---------------------------------------------

export async function reunirFilas({ fetchImplSupabase } = {}) {
  const [eslo, dotaPred, dotaSeries] = await Promise.all([
    seleccionar('eslo_predicciones', '?select=*&order=match_id.asc', { fetchImpl: fetchImplSupabase }),
    seleccionar('dota_predictions', '?select=*&order=series_id.asc', { fetchImpl: fetchImplSupabase }),
    seleccionar('dota_series', '?select=series_id,formato&order=series_id.asc', { fetchImpl: fetchImplSupabase }),
  ]);

  const formatoPorSerie = new Map(dotaSeries.map((s) => [s.series_id, s.formato]));

  const deEslo = (juego) => {
    const suyas = eslo.filter((p) => p.juego === juego);
    const calificadas = suyas
      .filter((p) => p.resultado_real && p.brier != null)
      .map((p) => ({
        brier: Number(p.brier),
        base: BASE_ESLO,
        acerto: (Number(p.prob_a) >= 0.5) === (p.resultado_real === 'ganaA'),
      }));
    return { predichas: suyas.length, calificadas };
  };

  const dotaCalificadas = dotaPred
    .filter((p) => p.resultado_real && p.brier != null)
    .map((p) => ({
      brier: Number(p.brier),
      base: BASE_DOTA[formatoPorSerie.get(p.series_id)] ?? 0.5,
      acerto:
        (Number(p.prob_gana_a) >= Number(p.prob_gana_b) ? 'ganaA' : 'ganaB') === p.resultado_real,
    }));

  // Los juegos de bo3.gg salen de esta lista: agregar uno nuevo es una línea,
  // no tocar la función.
  const deBo3 = [
    ['CS2', 'cs2'],
    ['LoL', 'lol'],
    ['Valorant', 'valorant'],
  ].map(([nombre, juego]) => {
    const d = deEslo(juego);
    return fila(nombre, d.predichas, d.calificadas);
  });

  return [...deBo3, fila('Dota 2', dotaPred.length, dotaCalificadas)];
}

export async function enviarResumenGlobal({ fetchImpl, fetchImplSupabase } = {}) {
  const filas = await reunirFilas({ fetchImplSupabase });
  return enviar(mensajeResumenGlobal(filas), { fetchImpl });
}

// --- una vez al día ----------------------------------------------------------

// El "ya lo mandé hoy" se guarda en eslo_estado con una clave que no es un
// juego. Es reutilizar una tabla para algo que no es exactamente lo suyo, y se
// hace a propósito: la alternativa era una migración más para guardar una sola
// fecha. Si algún día hay varios marcadores así, conviene una tabla aparte.
const CLAVE_ESTADO = 'resumen-global';

// Día en hora de Venezuela: el resumen es para leerlo por la mañana de acá, no
// a las 8 pm del día anterior en UTC.
function diaVenezuela(fecha) {
  return new Date(fecha.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function enviarResumenDiario({ fetchImpl, fetchImplSupabase, ahora = new Date() } = {}) {
  const { upsert } = await import('../datos/supabase.mjs');

  const estado = await seleccionar('eslo_estado', `?select=*&juego=eq.${CLAVE_ESTADO}`, {
    fetchImpl: fetchImplSupabase,
  });
  const ultimo = estado[0]?.ultimo_inicio ? diaVenezuela(new Date(estado[0].ultimo_inicio)) : null;
  const hoy = diaVenezuela(ahora);

  if (ultimo === hoy) return { enviado: false, razon: 'ya se envió hoy' };

  const r = await enviarResumenGlobal({ fetchImpl, fetchImplSupabase });

  // Sólo se marca si DE VERDAD se envió: si Discord está caído, el resumen
  // sale en la corrida siguiente en vez de perderse el día entero.
  if (r.enviado) {
    await upsert(
      'eslo_estado',
      [{ juego: CLAVE_ESTADO, ultimo_inicio: ahora.toISOString(), actualizado_en: ahora.toISOString() }],
      { onConflict: 'juego', fetchImpl: fetchImplSupabase },
    );
  }

  return r;
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  // Con --forzar se manda aunque ya se haya enviado hoy (para probar).
  const forzar = process.argv.includes('--forzar');
  const r = forzar ? await enviarResumenGlobal() : await enviarResumenDiario();
  console.log(r.enviado ? 'resumen global enviado' : 'no enviado — ' + r.razon);
}
