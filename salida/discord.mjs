// Avisos por Discord. Dos cosas separadas a propósito:
//
//   - armar el mensaje (funciones puras, sin red -- se prueban solas)
//   - enviarlo (una sola función que toca la red)
//
// El webhook va en .env (DISCORD_WEBHOOK), nunca en el código. Si no está
// configurado, avisar() no revienta: lo dice y devuelve enviado:false, para
// que el flujo de la tarea programada no se caiga por eso.

import { fileURLToPath } from 'node:url';
import { seleccionar, parchear } from '../datos/supabase.mjs';
import { partidasDeLaLiga, seriesDeLaLiga } from '../datos/liga.mjs';

import { enVenezuela, hora12, cuandoEnPalabras, diaEnPalabras, agruparPorDia, bloquesDeJuego } from './formato.mjs';
import { tablaDePosiciones, record } from '../juez/tabla.mjs';

export { enVenezuela, hora12, cuandoEnPalabras, diaEnPalabras, agruparPorDia, bloquesDeJuego };

const BASE_INGENUA = { bo1: 0.5, bo2: 2 / 3, bo3: 0.5, bo5: 0.5 };

const LEAGUE_ID_TI2026 = 19719;

// Cuánto se espera desde el arranque de la última serie de una jornada antes
// de dar la jornada por cerrada. No basta con "ya se calificaron todas": un
// fixture puede publicarse tarde y sumarse a la misma tanda (real: la serie
// de las 5:45 am del 15 apareció después de que las de la 1 am ya estaban).
// Si se manda el resumen apenas se califica la última conocida, esa serie
// tardía se queda fuera del resumen para siempre.
const HORAS_PARA_CERRAR_JORNADA = 6;

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

// Resumen de cierre de una jornada: en qué acertamos, en qué fallamos, y
// cómo quedaron en la tabla los equipos que jugaron. Va DESPUÉS de los avisos
// por tanda (no los reemplaza): esos llegan calientes, serie por serie; este
// cierra el día de un vistazo.
export function mensajeResumenDia(calificadas, nombre, tabla, ahora = new Date()) {
  if (calificadas.length === 0) return null;

  const aciertos = [];
  const fallos = [];
  for (const c of calificadas) {
    const pa = Number(c.prob_gana_a);
    const pb = Number(c.prob_gana_b);
    const favA = pa >= pb;
    const favorito = favA ? nombre(c.equipo_a) : nombre(c.equipo_b);
    const probFav = Math.round((favA ? pa : pb) * 100);
    const ganoA = c.resultado_real === 'ganaA';
    const ganador = ganoA ? nombre(c.equipo_a) : nombre(c.equipo_b);
    const perdedor = ganoA ? nombre(c.equipo_b) : nombre(c.equipo_a);

    if ((favA ? 'ganaA' : 'ganaB') === c.resultado_real) {
      aciertos.push(`**${ganador}** ${probFav}% · le ganó a ${perdedor}`);
    } else {
      fallos.push(`**${ganador}** le ganó a ${perdedor} · íbamos con ${favorito} ${probFav}%`);
    }
  }

  // Los equipos de la jornada se marcan en la tabla; el resto va de contexto,
  // porque una posición sin ver contra quién no dice nada.
  const jugaron = new Set();
  for (const c of calificadas) {
    jugaron.add(c.equipo_a);
    jugaron.add(c.equipo_b);
  }

  const partes = [`📋 **Resumen de la jornada** — ${diaEnPalabras(enVenezuela(calificadas[0].start_time).fecha, ahora)}`, ''];

  partes.push(`**Acertamos ${aciertos.length} de ${calificadas.length}**`);
  partes.push('');
  if (aciertos.length) {
    partes.push('✅ **Le atinamos**');
    partes.push(...aciertos);
    partes.push('');
  }
  if (fallos.length) {
    partes.push('❌ **Nos equivocamos**');
    partes.push(...fallos);
    partes.push('');
  }

  if (tabla?.length) {
    // Dentro de un bloque de código Discord no renderiza negrita, por eso la
    // marca es un carácter (›) y no **.
    partes.push('🏆 **Tabla del TI** _(› = jugó esta jornada)_');
    partes.push('```');
    for (const f of tabla) {
      const nom = nombre(f.teamId);
      const marca = jugaron.has(f.teamId) ? '›' : ' ';
      partes.push(`${marca} ${String(f.posicion).padStart(2)}. ${nom.padEnd(16)} ${record(f)}`);
    }
    partes.push('```');
    partes.push('_Récord de series ganadas–perdidas en TI2026, calculado de las partidas reales. Entre equipos con el mismo récord no inventamos desempate._');
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
    body: JSON.stringify({
      content: contenido,
      // Los nombres de equipo vienen de una API de terceros y se meten tal
      // cual en el mensaje. Un equipo llamado "@everyone" haría que el bot
      // pingue a todo el servidor en cada aviso, y el nombre lo controla
      // quien lo registró en la fuente, no nosotros. Con parse vacío Discord
      // ignora TODA mención (@everyone, @here, roles y usuarios) venga de
      // donde venga: el mensaje se sigue viendo igual, pero no notifica.
      allowed_mentions: { parse: [] },
    }),
  });
  if (!res.ok) {
    return { enviado: false, razon: `Discord respondió ${res.status}: ${await res.text()}` };
  }
  return { enviado: true };
}

// El registro de "qué ya se avisó" vive en Supabase, en dos columnas de
// dota_predictions (avisado_prediccion_en / avisado_resultado_en), no en un
// archivo.
//
// Por qué: en GitHub Actions no hay disco que persista entre corridas. Con
// un archivo local, el estado se perdía cada vez y Discord mandaba los
// mismos avisos cada hora. En la base también sobrevive a cambiar de
// máquina.
export async function marcarAvisado(seriesIds, columna, { fetchImpl } = {}) {
  if (seriesIds.length === 0) return;
  const lista = seriesIds.map((id) => `"${id}"`).join(',');
  await parchear(
    'dota_predictions',
    `?series_id=in.(${lista})`,
    { [columna]: new Date().toISOString() },
    { fetchImpl },
  );
}

// De todas las series (calificadas y pendientes), devuelve la jornada que ya
// cerró y todavía no se resumió. Devuelve una sola: si hay varias atrasadas,
// sale la más vieja primero y las siguientes en corridas posteriores, para no
// disparar tres mensajes de golpe.
export function jornadaParaResumir(todas, ahora = new Date()) {
  for (const bloque of bloquesDeJuego(todas)) {
    const todasCalificadas = bloque.items.every((s) => s.resultado_real);
    if (!todasCalificadas) continue;

    const asentada = ahora.getTime() - new Date(bloque.ultimoInicio).getTime() >= HORAS_PARA_CERRAR_JORNADA * 3600 * 1000;
    if (!asentada) continue;

    if (bloque.items.every((s) => s.avisado_resumen_en)) continue;

    return bloque;
  }
  return null;
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

export async function avisar({ fetchImpl, fetchImplSupabase } = {}) {
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

  // Lo pendiente de avisar sale de las columnas de la base, no de un archivo.
  const nuevasPredichas = pendientes.filter((p) => !p.avisado_prediccion_en);
  const nuevasCalificadas = calificadas.filter((c) => !c.avisado_resultado_en);

  const enviados = [];

  const msgPred = mensajePredicciones(nuevasPredichas, nombre);
  if (msgPred) {
    const r = await enviar(msgPred, { fetchImpl });
    enviados.push({ tipo: 'predicciones', cuantas: nuevasPredichas.length, ...r });
    // Sólo se marca lo que DE VERDAD se envió: si Discord está caído, el
    // aviso queda pendiente y sale en la corrida siguiente en vez de
    // perderse para siempre.
    if (r.enviado) {
      await marcarAvisado(nuevasPredichas.map((p) => p.series_id), 'avisado_prediccion_en', {
        fetchImpl: fetchImplSupabase,
      });
    }
  }

  const msgRes = mensajeResultados(nuevasCalificadas, nombre, calcularMetricasSimple(calificadas));
  if (msgRes) {
    const r = await enviar(msgRes, { fetchImpl });
    enviados.push({ tipo: 'resultados', cuantas: nuevasCalificadas.length, ...r });
    if (r.enviado) {
      await marcarAvisado(nuevasCalificadas.map((c) => c.series_id), 'avisado_resultado_en', {
        fetchImpl: fetchImplSupabase,
      });
    }
  }

  // Resumen de cierre de jornada. Va de último a propósito: si el mismo ciclo
  // acaba de avisar la última serie del día, el resumen llega detrás y no
  // antes.
  const jornada = jornadaParaResumir([...calificadas, ...pendientes]);
  if (jornada) {
    // La tabla sale de las partidas reales del torneo, no de lo que
    // predijimos: hay series de TI que el sistema nunca llegó a predecir y
    // aun así cuentan para la posición. Una sola petición a OpenDota, dentro
    // del presupuesto (regla 5).
    let tabla = [];
    try {
      const partidasLiga = await partidasDeLaLiga(LEAGUE_ID_TI2026, { fetchImpl });
      tabla = tablaDePosiciones(seriesDeLaLiga(partidasLiga));
    } catch (e) {
      // Sin tabla el resumen sigue valiendo: se manda con aciertos y fallos.
      tabla = [];
    }

    const msgResumen = mensajeResumenDia(jornada.items, nombre, tabla);
    if (msgResumen) {
      const r = await enviar(msgResumen, { fetchImpl });
      enviados.push({ tipo: 'resumen', cuantas: jornada.items.length, ...r });
      if (r.enviado) {
        await marcarAvisado(jornada.items.map((s) => s.series_id), 'avisado_resumen_en', {
          fetchImpl: fetchImplSupabase,
        });
      }
    }
  }

  return {
    enviados,
    nuevasPredichas: nuevasPredichas.length,
    nuevasCalificadas: nuevasCalificadas.length,
    jornadaResumida: jornada ? jornada.items.length : 0,
  };
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
