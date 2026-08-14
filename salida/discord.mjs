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

// Cuántos días de diferencia hay entre una fecha local y hoy.
function diasDesdeHoy(fechaLocal, ahora) {
  const hoy = horaVenezuela(ahora.toISOString()).split(' ')[0];
  return Math.round((new Date(fechaLocal + 'T00:00:00Z') - new Date(hoy + 'T00:00:00Z')) / 86400000);
}

// "hoy 22:00" se entiende de una; "2026-08-14 22:00" hay que descifrarlo.
export function cuandoEnPalabras(iso, ahora = new Date()) {
  const completo = horaVenezuela(iso);
  if (completo === '—') return '—';
  const [fecha, hora] = completo.split(' ');

  const dias = diasDesdeHoy(fecha, ahora);
  if (dias === 0) return `hoy ${hora}`;
  if (dias === 1) return `mañana ${hora}`;
  if (dias === -1) return `ayer ${hora}`;
  const [, mes, dia] = fecha.split('-');
  return `${dia}/${mes} ${hora}`;
}

// El nombre del día para agrupar. En hora de Venezuela una jornada de TI
// cruza la medianoche (las 02:00 y 05:00 UTC caen 22:00 y 01:00 acá), así
// que agrupar por día evita repetir "ayer"/"hoy" en cada renglón.
export function diaEnPalabras(fechaLocal, ahora = new Date()) {
  const dias = diasDesdeHoy(fechaLocal, ahora);
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Mañana';
  if (dias === -1) return 'Ayer';
  const [, mes, dia] = fechaLocal.split('-');
  return `${dia}/${mes}`;
}

// Agrupa por día local, en orden cronológico, con la hora de cada elemento.
// Tolera que a una fila le falte la fecha: la manda a un grupo aparte en vez
// de tumbar el aviso completo (encontrado por una prueba, no en producción).
export function agruparPorDia(items, campoFecha = 'start_time', ahora = new Date()) {
  const SIN_FECHA = '9999-99-99';
  const porDia = new Map();

  for (const it of items) {
    const completo = horaVenezuela(it[campoFecha]);
    const valida = completo !== '—' && completo.includes(' ');
    const fecha = valida ? completo.split(' ')[0] : SIN_FECHA;
    const hora = valida ? completo.split(' ')[1] : '';
    if (!porDia.has(fecha)) porDia.set(fecha, []);
    porDia.get(fecha).push({ ...it, _hora: hora, _fecha: valida ? fecha : null });
  }

  return [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0])) // SIN_FECHA queda al final
    .map(([fecha, lista]) => ({
      fecha: fecha === SIN_FECHA ? null : fecha,
      titulo: fecha === SIN_FECHA ? 'Sin fecha' : diaEnPalabras(fecha, ahora),
      items: lista.sort((a, b) => (a._hora ?? '').localeCompare(b._hora ?? '')),
    }));
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

// Los grupos por día dejan un renglón vacío al cerrar, que se suma al que
// separa las secciones. Colapsar es más simple que llevar la cuenta.
function limpiarVacios(lineas) {
  const salida = [];
  for (const l of lineas) {
    if (l === '' && salida[salida.length - 1] === '') continue;
    salida.push(l);
  }
  while (salida[salida.length - 1] === '') salida.pop();
  return salida;
}

// Predicciones nuevas: lo que el motor cree que va a pasar, antes de que
// pase. En lenguaje llano -- nada de jerga.
export function mensajePredicciones(pendientes, nombre, ahora = new Date()) {
  if (pendientes.length === 0) return null;

  const lineas = [];
  for (const grupo of agruparPorDia(pendientes, 'start_time', ahora)) {
    lineas.push(`**${grupo.titulo}**`);
    for (const p of grupo.items) {
      const pa = Number(p.prob_gana_a);
      const pb = Number(p.prob_gana_b);
      const favA = pa >= pb;
      const fav = favA ? nombre(p.equipo_a) : nombre(p.equipo_b);
      const otro = favA ? nombre(p.equipo_b) : nombre(p.equipo_a);
      const probFav = Math.round((favA ? pa : pb) * 100);
      const parejo = probFav <= 55 ? ' — muy parejo' : '';
      const cuando = p._hora ? `\`${p._hora}\`  ` : '';
      lineas.push(`${cuando}**${fav}** ${probFav}% vs ${otro} ${100 - probFav}%${parejo}`);
    }
    lineas.push('');
  }

  const titulo = pendientes.length === 1 ? '🔮 **Viene 1 serie**' : `🔮 **Vienen ${pendientes.length} series**`;
  return recortar(
    limpiarVacios([titulo, '', ...lineas, '', '_Hora de Venezuela. Estos números quedan guardados tal cual, para poder medirlos después._']).join('\n'),
  );
}

// Series que ya se jugaron: el juicio contra la realidad, en lenguaje llano.
// El número técnico (Brier) va al pie para quien lo quiera, no en cada línea.
export function mensajeResultados(calificadas, nombre, metricas, ahora = new Date()) {
  if (calificadas.length === 0) return null;

  // El fallo con más confianza es la historia del día: vale marcarlo.
  let peorFallo = null;
  for (const c of calificadas) {
    const pa = Number(c.prob_gana_a);
    const pb = Number(c.prob_gana_b);
    const favA = pa >= pb;
    if ((favA ? 'ganaA' : 'ganaB') === c.resultado_real) continue;
    const confianza = favA ? pa : pb;
    if (!peorFallo || confianza > peorFallo.confianza) peorFallo = { id: c.series_id, confianza };
  }

  const lineas = [];
  for (const grupo of agruparPorDia(calificadas, 'start_time', ahora)) {
    lineas.push(`**${grupo.titulo}**`);
    for (const c of grupo.items) {
      const pa = Number(c.prob_gana_a);
      const pb = Number(c.prob_gana_b);
      const favA = pa >= pb;
      const acerto = (favA ? 'ganaA' : 'ganaB') === c.resultado_real;
      const ganoA = c.resultado_real === 'ganaA';
      const ganador = ganoA ? nombre(c.equipo_a) : nombre(c.equipo_b);
      const perdedor = ganoA ? nombre(c.equipo_b) : nombre(c.equipo_a);
      const marcadorGanador = ganoA ? `${c.victorias_a}–${c.victorias_b}` : `${c.victorias_b}–${c.victorias_a}`;
      const favorito = favA ? nombre(c.equipo_a) : nombre(c.equipo_b);
      const probFav = Math.round((favA ? pa : pb) * 100);

      const comentario = acerto
        ? `le dábamos ${probFav}%`
        : `íbamos con ${favorito}, ${probFav}%${peorFallo && peorFallo.id === c.series_id ? ' — el golpe del día' : ''}`;

      const cuando = c._hora ? `\`${c._hora}\` ` : '';
      lineas.push(`${cuando}${acerto ? '✅' : '❌'} **${ganador}** le ganó ${marcadorGanador} a ${perdedor}  _(${comentario})_`);
    }
    lineas.push('');
  }

  const partes = [
    calificadas.length === 1 ? '🎯 **Terminó 1 serie**' : `🎯 **Terminaron ${calificadas.length} series**`,
    '',
    ...lineas,
  ];

  if (metricas?.n) {
    partes.push('');
    partes.push(`**Acertamos ${metricas.aciertos} de ${metricas.n}.**`);

    if (metricas.media > metricas.baseMedia) {
      partes.push(
        'Aun así el sistema quedó por debajo de tirar una moneda: los fallos fueron con mucha confianza, y eso pesa más que los aciertos ajustados.',
      );
    } else {
      partes.push('El sistema quedó mejor que tirar una moneda.');
    }

    if (!metricas.concluyente) {
      partes.push(`Con ${metricas.n} series todavía no alcanza para saber si sirve de verdad. Hace falta más torneo.`);
    }

    partes.push('');
    partes.push(`_Hora de Venezuela. Para el que quiera el número: Brier ${metricas.media.toFixed(4)} contra ${metricas.baseMedia.toFixed(3)} de adivinar._`);
  }

  return recortar(limpiarVacios(partes).join('\n'));
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
