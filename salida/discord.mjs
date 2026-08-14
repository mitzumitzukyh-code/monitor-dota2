// Avisos por Discord. Dos cosas separadas a propósito:
//
//   - armar el mensaje (funciones puras, sin red -- se prueban solas)
//   - enviarlo (una sola función que toca la red)
//
// El webhook va en .env (DISCORD_WEBHOOK), nunca en el código. Si no está
// configurado, avisar() no revienta: lo dice y devuelve enviado:false, para
// que el flujo de la tarea programada no se caiga por eso.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { seleccionar } from '../datos/supabase.mjs';

// Venezuela es UTC−4 todo el año. Duplicado a propósito respecto al panel
// web: este módulo no debe depender del generador de HTML.
function horaVenezuela(iso) {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const local = new Date(ms - 4 * 3600 * 1000).toISOString();
  return `${local.slice(0, 10)} ${local.slice(11, 16)}`;
}

const BASE_INGENUA = { bo1: 0.5, bo2: 2 / 3, bo3: 0.5, bo5: 0.5 };

function pct(x) {
  return (Number(x) * 100).toFixed(1);
}

// Discord corta a 2000 caracteres. Mejor recortar nosotros con un aviso
// claro que dejar que lo corte a la mitad de una línea.
export function recortar(texto, limite = 1900) {
  if (texto.length <= limite) return texto;
  return texto.slice(0, limite - 40).trimEnd() + '\n… (recortado, ver el panel)';
}

// Predicciones nuevas: lo que el motor cree que va a pasar, antes de que
// pase. Sin resultado todavía.
export function mensajePredicciones(pendientes, nombre) {
  if (pendientes.length === 0) return null;

  const lineas = pendientes.map((p) => {
    const pa = Number(p.prob_gana_a);
    const pb = Number(p.prob_gana_b);
    const favA = pa >= pb;
    const fav = favA ? nombre(p.equipo_a) : nombre(p.equipo_b);
    const otro = favA ? nombre(p.equipo_b) : nombre(p.equipo_a);
    return `\`${horaVenezuela(p.start_time)}\` **${fav} ${pct(favA ? pa : pb)}%** vs ${otro} ${pct(favA ? pb : pa)}%  ·  ${p.formato.toUpperCase()}`;
  });

  const titulo = pendientes.length === 1 ? '**1 serie nueva predicha**' : `**${pendientes.length} series nuevas predichas**`;
  return recortar(
    [titulo, ...lineas, '', '_Hora de Venezuela. La predicción queda congelada: no se reescribe._'].join('\n'),
  );
}

// Series que ya se jugaron y se calificaron: el juicio contra la realidad.
export function mensajeResultados(calificadas, nombre, metricas) {
  if (calificadas.length === 0) return null;

  const lineas = calificadas.map((c) => {
    const pa = Number(c.prob_gana_a);
    const pb = Number(c.prob_gana_b);
    const favA = pa >= pb;
    const acerto = (favA ? 'ganaA' : 'ganaB') === c.resultado_real;
    const ganador = c.resultado_real === 'ganaA' ? nombre(c.equipo_a) : c.resultado_real === 'ganaB' ? nombre(c.equipo_b) : 'empate';
    const brier = Number(c.brier);
    const base = BASE_INGENUA[c.formato] ?? 0.5;
    return `${acerto ? '✅' : '❌'} ${nombre(c.equipo_a)} vs ${nombre(c.equipo_b)} → **${ganador}** ${c.victorias_a}–${c.victorias_b}  ·  daba ${pct(favA ? pa : pb)}% al favorito  ·  Brier ${brier.toFixed(3)}${brier > base ? ' (peor que ' + base.toFixed(2) + ')' : ''}`;
  });

  const partes = [calificadas.length === 1 ? '**1 serie calificada**' : `**${calificadas.length} series calificadas**`, ...lineas];

  if (metricas?.n) {
    partes.push('');
    partes.push(
      `Acumulado: **Brier ${metricas.media.toFixed(4)}** vs ${metricas.baseMedia.toFixed(3)} de adivinar · ${metricas.aciertos}/${metricas.n} favoritos acertados`,
    );
    if (!metricas.concluyente) {
      partes.push(`_Con n=${metricas.n} el intervalo contiene la base: todavía no concluye nada._`);
    }
  }

  return recortar(partes.join('\n'));
}

export async function enviar(contenido, { fetchImpl = fetch, webhook = process.env.DISCORD_WEBHOOK } = {}) {
  if (!webhook) {
    return { enviado: false, razon: 'falta DISCORD_WEBHOOK en .env' };
  }
  const res = await fetchImpl(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: contenido }),
  });
  if (!res.ok) {
    return { enviado: false, razon: `Discord respondió ${res.status}: ${await res.text()}` };
  }
  return { enviado: true };
}

// Estado local de qué ya se avisó, para que la tarea que corre cada hora no
// repita el mismo aviso. Se guarda en disco (un solo usuario, una sola
// máquina); si se borra, el próximo aviso repite y ya.
const RUTA_ESTADO = new URL('./avisados.json', import.meta.url);

export async function leerAvisados(ruta = RUTA_ESTADO) {
  try {
    const datos = JSON.parse(await readFile(ruta, 'utf8'));
    return { predichas: new Set(datos.predichas ?? []), calificadas: new Set(datos.calificadas ?? []) };
  } catch {
    return { predichas: new Set(), calificadas: new Set() };
  }
}

export async function guardarAvisados(avisados, ruta = RUTA_ESTADO) {
  await writeFile(
    ruta,
    JSON.stringify({ predichas: [...avisados.predichas], calificadas: [...avisados.calificadas] }, null, 1),
  );
}

export function calcularMetricasSimple(calificadas) {
  const n = calificadas.length;
  if (n === 0) return { n: 0 };
  const briers = calificadas.map((c) => Number(c.brier));
  const media = briers.reduce((s, x) => s + x, 0) / n;
  const ee = n > 1 ? Math.sqrt(briers.reduce((s, x) => s + (x - media) ** 2, 0) / (n - 1)) / Math.sqrt(n) : 0;
  const baseMedia = calificadas.reduce((s, c) => s + (BASE_INGENUA[c.formato] ?? 0.5), 0) / n;
  const aciertos = calificadas.filter(
    (c) => (Number(c.prob_gana_a) >= Number(c.prob_gana_b) ? 'ganaA' : 'ganaB') === c.resultado_real,
  ).length;
  return {
    n,
    media,
    baseMedia,
    aciertos,
    concluyente: !(baseMedia >= media - 1.96 * ee && baseMedia <= media + 1.96 * ee),
  };
}

export async function avisar({ fetchImpl, fetchImplSupabase, rutaEstado } = {}) {
  const [seriesDb, predsDb, teamsDb] = await Promise.all([
    seleccionar('dota_series', '?select=*', { fetchImpl: fetchImplSupabase }),
    seleccionar('dota_predictions', '?select=*', { fetchImpl: fetchImplSupabase }),
    seleccionar('dota_teams', '?select=*', { fetchImpl: fetchImplSupabase }),
  ]);

  const nombrePorId = new Map(teamsDb.map((t) => [t.team_id, t.nombre]));
  const nombre = (id) => nombrePorId.get(id) ?? `#${id}`;
  const predPorId = new Map(predsDb.map((p) => [p.series_id, p]));

  const calificadas = [];
  const pendientes = [];
  for (const s of seriesDb) {
    const p = predPorId.get(s.series_id);
    if (!p) continue;
    if (p.resultado_real) calificadas.push({ ...s, ...p });
    else pendientes.push({ ...s, ...p });
  }

  const avisados = await leerAvisados(rutaEstado);
  const nuevasPredichas = pendientes.filter((p) => !avisados.predichas.has(p.series_id));
  const nuevasCalificadas = calificadas.filter((c) => !avisados.calificadas.has(c.series_id));

  const enviados = [];

  const msgPred = mensajePredicciones(nuevasPredichas, nombre);
  if (msgPred) {
    const r = await enviar(msgPred, { fetchImpl });
    enviados.push({ tipo: 'predicciones', cuantas: nuevasPredichas.length, ...r });
    if (r.enviado) for (const p of nuevasPredichas) avisados.predichas.add(p.series_id);
  }

  const msgRes = mensajeResultados(nuevasCalificadas, nombre, calcularMetricasSimple(calificadas));
  if (msgRes) {
    const r = await enviar(msgRes, { fetchImpl });
    enviados.push({ tipo: 'resultados', cuantas: nuevasCalificadas.length, ...r });
    if (r.enviado) for (const c of nuevasCalificadas) avisados.calificadas.add(c.series_id);
  }

  // Sólo se marca como avisado lo que de verdad se envió, así un webhook
  // caído no hace perder el aviso para siempre.
  if (enviados.some((e) => e.enviado)) await guardarAvisados(avisados, rutaEstado);

  return { enviados, nuevasPredichas: nuevasPredichas.length, nuevasCalificadas: nuevasCalificadas.length };
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  avisar()
    .then((r) => {
      if (r.enviados.length === 0) {
        console.log('Nada nuevo que avisar.');
        return;
      }
      for (const e of r.enviados) {
        console.log(`${e.tipo}: ${e.cuantas} · ${e.enviado ? 'enviado' : 'NO enviado — ' + e.razon}`);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
