// Avisos de Discord para los juegos que corren sobre bo3.gg (CS2 hoy, y lo
// que venga). Separado de salida/discord.mjs, que es de Dota y lee tablas
// dota_*: mezclarlos habría hecho un módulo que consulta dos esquemas y no
// sirve bien para ninguno.
//
// Misma división que en Dota, y por la misma razón: armar el mensaje son
// funciones puras que se prueban sin red, y enviarlo es una sola función.
// Cambiar a Telegram después es tocar `enviar`, no estas.

import { fileURLToPath } from 'node:url';
import { seleccionar, parchear } from '../datos/supabase.mjs';
import { nombresDeEquipos } from '../datos/juegos/bo3.mjs';
import { enviar, recortar } from './discord.mjs';
import { agruparPorDia } from './formato.mjs';

// CS2 mueve ~34 partidas al día contando todos los tiers. Avisar de todas es
// ruido que nadie lee. `s` y `a` son los torneos que importan; el resto se
// sigue prediciendo y calificando (sirve para medir el motor), sólo que no se
// anuncia.
export const TIERS_QUE_SE_AVISAN = new Set(['s', 'a']);

// Cuánto hacia adelante se anuncia. Discord corta a 2.000 caracteres, y LoL
// tiene 55 partidas de tier s/a pendientes a la vez: en un solo mensaje se
// truncaban (1.887 caracteres y con el aviso de recorte). Anunciar lo de las
// próximas 24 h no es sólo por el límite -- es lo que de verdad sirve leer.
// Lo de pasado mañana se anuncia mañana, en su propio mensaje.
export const HORAS_DE_ANTICIPACION = 24;

const NOMBRE_JUEGO = { cs2: 'CS2', lol: 'LoL', valorant: 'Valorant', dota2: 'Dota 2' };

function limpiarVacios(lineas) {
  const salida = [];
  for (const l of lineas) {
    if (l === '' && salida[salida.length - 1] === '') continue;
    salida.push(l);
  }
  while (salida[salida.length - 1] === '') salida.pop();
  return salida;
}

// --- mensajes (puros) --------------------------------------------------------

export function mensajePredicciones(predicciones, nombre, juego, ahora = new Date()) {
  if (predicciones.length === 0) return null;

  const lineas = [];
  for (const grupo of agruparPorDia(predicciones, 'inicio_programado', ahora)) {
    lineas.push(`**${grupo.titulo}**`);
    for (const p of grupo.items) {
      const pa = Number(p.prob_a);
      const favA = pa >= 0.5;
      const fav = favA ? nombre(p.equipo_a) : nombre(p.equipo_b);
      const otro = favA ? nombre(p.equipo_b) : nombre(p.equipo_a);
      const probFav = Math.round((favA ? pa : 1 - pa) * 100);

      // La incertidumbre se dice en palabras, no con el RD crudo: un "rd 300"
      // no le dice nada a nadie. Es la ventaja de Glicko-2 sobre Elo y hay que
      // poder leerla.
      const rdMax = Math.max(Number(p.rd_a), Number(p.rd_b));
      const aviso = rdMax >= 150 ? ' — poco historial, mucha incertidumbre' : probFav <= 55 ? ' — muy parejo' : '';
      const cuando = p._hora ? `\`${p._hora}\`  ` : '';
      lineas.push(`${cuando}**${fav}** ${probFav}% vs ${otro} ${100 - probFav}%${aviso}`);
    }
    lineas.push('');
  }

  const n = predicciones.length;
  const titulo = `🔮 **${NOMBRE_JUEGO[juego] ?? juego} · ${n === 1 ? 'viene 1 partida' : `vienen ${n} partidas`}**`;
  return recortar(
    limpiarVacios([
      titulo,
      '',
      ...lineas,
      '',
      '_Hora de Venezuela. Estos números quedan guardados tal cual, para poder medirlos después._',
    ]).join('\n'),
  );
}

export function mensajeResultados(calificadas, nombre, juego, metricas, ahora = new Date()) {
  if (calificadas.length === 0) return null;

  const lineas = [];
  for (const grupo of agruparPorDia(calificadas, 'inicio_programado', ahora)) {
    lineas.push(`**${grupo.titulo}**`);
    for (const c of grupo.items) {
      const pa = Number(c.prob_a);
      const favA = pa >= 0.5;
      const ganoA = c.resultado_real === 'ganaA';
      const acerto = favA === ganoA;
      const ganador = ganoA ? nombre(c.equipo_a) : nombre(c.equipo_b);
      const perdedor = ganoA ? nombre(c.equipo_b) : nombre(c.equipo_a);
      const favorito = favA ? nombre(c.equipo_a) : nombre(c.equipo_b);
      const probFav = Math.round((favA ? pa : 1 - pa) * 100);
      const marcador =
        c.marcador_a == null ? '' : ` ${ganoA ? `${c.marcador_a}–${c.marcador_b}` : `${c.marcador_b}–${c.marcador_a}`}`;

      const comentario = acerto ? `le dábamos ${probFav}%` : `íbamos con ${favorito}, ${probFav}%`;
      const cuando = c._hora ? `\`${c._hora}\` ` : '';
      lineas.push(`${cuando}${acerto ? '✅' : '❌'} **${ganador}** le ganó${marcador} a ${perdedor}  _(${comentario})_`);
    }
    lineas.push('');
  }

  const partes = [
    `🎯 **${NOMBRE_JUEGO[juego] ?? juego} · ${calificadas.length === 1 ? 'terminó 1 partida' : `terminaron ${calificadas.length} partidas`}**`,
    '',
    ...lineas,
  ];

  if (metricas?.n) {
    partes.push('');
    partes.push(`**Acertamos ${metricas.aciertos} de ${metricas.n}.**`);
    partes.push(
      metricas.brier < 0.25
        ? 'El sistema quedó mejor que tirar una moneda.'
        : 'El sistema quedó por debajo de tirar una moneda: los fallos fueron con mucha confianza, y eso pesa más que los aciertos ajustados.',
    );
    if (!metricas.concluyente) {
      partes.push(`Con ${metricas.n} partidas todavía no alcanza para saber si sirve de verdad.`);
    }
    partes.push('');
    partes.push(
      `_Hora de Venezuela. Para el que quiera el número: Brier ${metricas.brier.toFixed(4)} contra 0.250 de adivinar._`,
    );
  }

  return recortar(limpiarVacios(partes).join('\n'));
}

// Brier acumulado de todo lo calificado, no sólo de lo que se avisa: la nota
// del motor se mide con todo lo que predijo.
export function calcularMetricas(calificadas) {
  const n = calificadas.length;
  if (n === 0) return { n: 0 };
  const briers = calificadas.map((c) => Number(c.brier));
  const brier = briers.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(briers.reduce((s, x) => s + (x - brier) ** 2, 0) / (n - 1)) : 0;
  const ee = n > 1 ? sd / Math.sqrt(n) : 0;
  const aciertos = calificadas.filter(
    (c) => (Number(c.prob_a) >= 0.5) === (c.resultado_real === 'ganaA'),
  ).length;
  return {
    n,
    brier,
    aciertos,
    // Concluyente = el intervalo NO contiene a la base ingenua de 0.25.
    concluyente: n > 1 && !(0.25 >= brier - 1.96 * ee && 0.25 <= brier + 1.96 * ee),
  };
}

async function marcar(matchIds, columna, { fetchImpl } = {}) {
  if (matchIds.length === 0) return;
  await parchear('eslo_predicciones', `?match_id=in.(${matchIds.join(',')})`, { [columna]: new Date().toISOString() }, { fetchImpl });
}

// --- ciclo de avisos ---------------------------------------------------------

export async function avisar(juego = 'cs2', { fetchImpl, fetchImplSupabase } = {}) {
  const todas = await seleccionar(
    'eslo_predicciones',
    `?select=*&juego=eq.${juego}&order=match_id.asc`,
    { fetchImpl: fetchImplSupabase },
  );

  const ahoraMs = Date.now();
  const deTier = (p) => TIERS_QUE_SE_AVISAN.has(String(p.tier ?? '').toLowerCase());

  // Sólo se anuncia lo que todavía no empezó: avisar de una partida en curso
  // no le sirve a nadie y encima invita a pensar que se predijo tarde.
  const limite = ahoraMs + HORAS_DE_ANTICIPACION * 3600 * 1000;
  const nuevasPredichas = todas.filter((p) => {
    if (p.avisado_prediccion_en || p.resultado_real || !deTier(p)) return false;
    const arranca = new Date(p.inicio_programado).getTime();
    // Ni lo que ya empezó (avisarlo no le sirve a nadie y hace pensar que se
    // predijo tarde) ni lo que falta mucho: eso se avisa cuando se acerque.
    return arranca > ahoraMs && arranca <= limite;
  });
  const nuevasCalificadas = todas.filter((p) => p.resultado_real && !p.avisado_resultado_en && deTier(p));

  const idsEquipos = [...nuevasPredichas, ...nuevasCalificadas].flatMap((p) => [p.equipo_a, p.equipo_b]);
  const nombres = idsEquipos.length ? await nombresDeEquipos(idsEquipos, { juego, fetchImpl }) : new Map();
  const nombre = (id) => nombres.get(id) ?? `#${id}`;

  const enviados = [];

  const msgPred = mensajePredicciones(nuevasPredichas, nombre, juego);
  if (msgPred) {
    const r = await enviar(msgPred, { fetchImpl });
    enviados.push({ tipo: 'predicciones', cuantas: nuevasPredichas.length, ...r });
    // Sólo se marca lo que DE VERDAD se envió: si Discord está caído, el aviso
    // queda pendiente para la corrida siguiente en vez de perderse.
    if (r.enviado) await marcar(nuevasPredichas.map((p) => p.match_id), 'avisado_prediccion_en', { fetchImpl: fetchImplSupabase });
  }

  const metricas = calcularMetricas(todas.filter((p) => p.resultado_real));
  const msgRes = mensajeResultados(nuevasCalificadas, nombre, juego, metricas);
  if (msgRes) {
    const r = await enviar(msgRes, { fetchImpl });
    enviados.push({ tipo: 'resultados', cuantas: nuevasCalificadas.length, ...r });
    if (r.enviado) await marcar(nuevasCalificadas.map((p) => p.match_id), 'avisado_resultado_en', { fetchImpl: fetchImplSupabase });
  }

  return { enviados, nuevasPredichas: nuevasPredichas.length, nuevasCalificadas: nuevasCalificadas.length };
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  const juegos = process.argv.slice(2).length ? process.argv.slice(2) : ['cs2'];
  for (const juego of juegos) {
    const r = await avisar(juego);
    if (r.enviados.length === 0) console.log(`${juego}: nada nuevo que avisar.`);
    else for (const e of r.enviados) console.log(`${juego} ${e.tipo}: ${e.cuantas} · ${e.enviado ? 'enviado' : 'NO enviado — ' + e.razon}`);
  }
}
