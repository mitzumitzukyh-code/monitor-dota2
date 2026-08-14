// Genera el panel web con datos REALES de Supabase. Escribe un HTML
// estático: así ninguna llave viaja al navegador (la service_role se queda
// acá) y la página funciona abriéndola del disco, sin servidor.
//
// Se regenera corriendo este script; la tarea programada del Programador de
// tareas lo llama después de calificar (ver n8n/README.md).
//
// Lenguaje visual: el mismo del panel de LaLiga (design system Modernist,
// oscuro, IBM Plex Mono, acento #ff563c, sin radios, reglas de 2px), para
// que los dos monitores se lean como el mismo sistema. Pero las métricas
// son las de Dota: no hay goles, no hay λ, y un Bo3 no tiene empate.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { seleccionar } from '../../datos/supabase.mjs';
import { partidasDeLaLiga, historicoConLiga } from '../../datos/liga.mjs';
import { ratings, ratingDeEquipo, probabilidadGanar } from '../../motor/elo.mjs';
import { distribucionMarcadores, probabilidadPartidaDesdeSerie } from '../../motor/series.mjs';
import { EQUIPOS_TI2026 } from '../../datos/equipos-ti2026.mjs';
import { enVenezuela, hora12 } from '../formato.mjs';

const LEAGUE_ID_TI2026 = 19719;

// Base ingenua por formato: sin información, 50/50 en los formatos sin
// empate. Brier = (0.5-1)² + (0.5-0)² = 0.5. Para bo2 son tres clases.
const BASE_INGENUA = { bo1: 0.5, bo2: 2 / 3, bo3: 0.5, bo5: 0.5 };

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pct(x) {
  return (x * 100).toFixed(1);
}

// Fechas y horas salen del módulo compartido con los avisos de Discord, así
// el panel y Discord nunca muestran la misma serie a horas distintas.
export { enVenezuela, hora12 };

// Fecha + hora en reloj de 12 horas, que es como se lee.
function fechaYHora(iso) {
  const { fecha, hora, valida } = enVenezuela(iso);
  return valida ? `${fecha} · ${hora12(hora)}` : '—';
}

export function calcularMetricas(calificadas) {
  const n = calificadas.length;
  if (n === 0) return { n: 0 };

  const briers = calificadas.map((c) => Number(c.brier));
  const media = briers.reduce((s, x) => s + x, 0) / n;
  const varianza = n > 1 ? briers.reduce((s, x) => s + (x - media) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(varianza);
  const ee = n > 1 ? sd / Math.sqrt(n) : 0;
  const ordenados = briers.slice().sort((a, b) => a - b);
  const mediana = n % 2 ? ordenados[(n - 1) / 2] : (ordenados[n / 2 - 1] + ordenados[n / 2]) / 2;

  // Base ingenua ponderada por los formatos que de verdad se evaluaron.
  const baseMedia = calificadas.reduce((s, c) => s + (BASE_INGENUA[c.formato] ?? 0.5), 0) / n;

  const aciertos = calificadas.filter((c) => {
    const favorito = Number(c.prob_gana_a) >= Number(c.prob_gana_b) ? 'ganaA' : 'ganaB';
    return favorito === c.resultado_real;
  }).length;

  const mejoresQueBase = calificadas.filter((c) => Number(c.brier) < (BASE_INGENUA[c.formato] ?? 0.5)).length;

  return {
    n,
    media,
    mediana,
    sd,
    ee,
    baseMedia,
    ic95: [media - 1.96 * ee, media + 1.96 * ee],
    // Con n chico el intervalo se come la base: decirlo es parte del trabajo.
    concluyente: !(baseMedia >= media - 1.96 * ee && baseMedia <= media + 1.96 * ee),
    aciertos,
    mejoresQueBase,
  };
}

// Los series_id traen ':' (ej. "mfiWqjJT5B:0003") y Windows no lo admite en
// nombres de archivo.
export function archivoDeFicha(seriesId) {
  return 'serie-' + String(seriesId).replace(/[^a-zA-Z0-9._-]/g, '-') + '.html';
}

// Últimos resultados de un equipo ANTES de un instante dado, más reciente
// primero. Para la fila de forma de la ficha.
export function formaDeEquipo(partidas, teamId, antesDe, cuantas = 6) {
  return partidas
    .filter((p) => p.start_time < antesDe && (p.radiant_team_id === teamId || p.dire_team_id === teamId))
    .sort((a, b) => b.start_time - a.start_time)
    .slice(0, cuantas)
    .map((p) => {
      const esRadiant = p.radiant_team_id === teamId;
      return { gano: esRadiant === Boolean(p.radiant_win), start_time: p.start_time };
    });
}

function tarjeta({ etiqueta, valor, sufijo = '', delta, referencia, nota, alerta = false }) {
  return `      <div style="padding: 20px 24px; border-right: 1px solid rgba(243,242,242,0.18);${alerta ? ' background: rgba(124,20,5,0.22);' : ''}">
        <div style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.12em; color: #9b9797; margin-bottom: 10px;">${esc(etiqueta)}</div>
        <div style="font-family: 'IBM Plex Mono', monospace; font-size: clamp(26px, 3.4vw, 40px); font-weight: 500; line-height: 1; font-variant-numeric: tabular-nums;">${esc(valor)}${sufijo ? `<span style="font-size: 20px; color: #bab6b6;">${esc(sufijo)}</span>` : ''}</div>
${delta || referencia ? `        <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-top: 10px; font-family: 'IBM Plex Mono', monospace; font-size: 11px;">
${delta ? `          <span style="color: #ff563c;">${esc(delta)}</span>\n` : ''}${referencia ? `          <span style="color: #9b9797;">${esc(referencia)}</span>\n` : ''}        </div>\n` : ''}${nota ? `        <div style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #9b9797; margin-top: 6px;">${esc(nota)}</div>\n` : ''}      </div>`;
}

function filaSerie(c, nombre) {
  const pa = Number(c.prob_gana_a);
  const pb = Number(c.prob_gana_b);
  const favA = pa >= pb;
  const favorito = favA ? 'ganaA' : 'ganaB';
  const acerto = favorito === c.resultado_real;
  const brier = Number(c.brier);
  const base = BASE_INGENUA[c.formato] ?? 0.5;
  const peor = brier > base;

  const marcador = `${c.victorias_a ?? '-'}–${c.victorias_b ?? '-'}`;
  const ganador = c.resultado_real === 'ganaA' ? nombre(c.equipo_a) : c.resultado_real === 'ganaB' ? nombre(c.equipo_b) : 'empate';

  return `          <a href="${esc(archivoDeFicha(c.series_id))}" style="display: grid; grid-template-columns: minmax(0,1fr) 92px 62px 70px; gap: 16px; align-items: center; padding: 12px 24px; border-bottom: 1px solid rgba(243,242,242,0.14); color: inherit; text-decoration: none;${peor ? ' background: rgba(124,20,5,0.18);' : ''}" title="Ver la ficha de esta serie">
            <div style="min-width: 0;">
              <div style="display: grid; grid-template-columns: 14px minmax(0,1fr) auto; gap: 10px; align-items: center; font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-variant-numeric: tabular-nums;">
                <span style="font-size: 10px; color: ${favA ? '#ff563c' : '#9b9797'};">${favA ? '▶' : ''}</span>
                <span style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${c.resultado_real === 'ganaA' ? '#f3f2f2' : '#9b9797'};">${esc(nombre(c.equipo_a))}</span>
                <span style="color: #ff563c; font-weight: 500;">${pct(pa)}<span style="color: #9b9797;">%</span></span>
              </div>
              <div style="display: grid; grid-template-columns: 14px minmax(0,1fr) auto; gap: 10px; align-items: center; font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-variant-numeric: tabular-nums; margin-top: 6px;">
                <span style="font-size: 10px; color: ${!favA ? '#ff563c' : '#9b9797'};">${!favA ? '▶' : ''}</span>
                <span style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${c.resultado_real === 'ganaB' ? '#f3f2f2' : '#9b9797'};">${esc(nombre(c.equipo_b))}</span>
                <span style="color: #ff563c; font-weight: 500;">${pct(pb)}<span style="color: #9b9797;">%</span></span>
              </div>
              <div style="display: flex; height: 8px; margin-top: 10px; background: rgba(243,242,242,0.08);">
                <div style="width: ${pct(pa)}%; background: #ff563c;"></div>
                <div style="width: ${pct(pb)}%; border: 1px solid #ff9783; box-sizing: border-box;"></div>
              </div>
            </div>
            <div style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #9b9797; letter-spacing: 0.06em;">
              <div style="color: #f3f2f2; font-size: 14px; font-variant-numeric: tabular-nums;">${esc(marcador)}</div>
              <div style="margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(ganador)}</div>
            </div>
            <div style="font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-variant-numeric: tabular-nums; text-align: right; color: ${peor ? '#ff9783' : '#f3f2f2'};">${brier.toFixed(3)}</div>
            <div style="font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-align: right; color: ${acerto ? '#f3f2f2' : '#9b9797'};">${acerto ? '■ ACIERTO' : '◇ FALLO'}</div>
          </a>`;
}

function seccion(titulo, derecha, cuerpo) {
  return `      <div>
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 24px; flex-wrap: wrap; padding: 14px 24px; border-bottom: 1px solid rgba(243,242,242,0.28);">
          <span style="font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600; letter-spacing: 0.14em;">${esc(titulo)}</span>
          <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #9b9797; letter-spacing: 0.08em;">${esc(derecha)}</span>
        </div>
${cuerpo}
      </div>`;
}

function vacio(mensaje) {
  return `        <div style="padding: 28px 24px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #9b9797; line-height: 1.6;">${esc(mensaje)}</div>`;
}

export function construirHtml({ calificadas, pendientes, nombre, metricas, fuerzas, generadoEn }) {
  const m = metricas;
  const deltaBrier = m.n ? m.media - m.baseMedia : 0;
  const peorQueBase = m.n && deltaBrier > 0;

  const tarjetas = [
    tarjeta({
      etiqueta: 'BRIER',
      valor: m.n ? m.media.toFixed(4) : '—',
      delta: m.n ? (deltaBrier >= 0 ? '+' : '−') + Math.abs(deltaBrier).toFixed(4) : null,
      referencia: m.n ? `vs ${m.baseMedia.toFixed(3)} = adivinar sin datos` : null,
      nota: peorQueBase ? 'POR ENCIMA DE LA BASE: peor que adivinar' : m.n ? 'por debajo de la base' : null,
      alerta: peorQueBase,
    }),
    tarjeta({
      etiqueta: 'MEDIANA',
      valor: m.n ? m.mediana.toFixed(4) : '—',
      referencia: m.n ? `${m.mejoresQueBase} de ${m.n} series bajo la base` : null,
      nota: 'menos sensible a un upset suelto que la media',
    }),
    tarjeta({
      etiqueta: 'FAVORITO ACERTADO',
      valor: m.n ? pct(m.aciertos / m.n) : '—',
      sufijo: m.n ? '%' : '',
      referencia: m.n ? `${m.aciertos} de ${m.n} series` : null,
      nota: 'el más probable de los dos ganó la serie',
    }),
    tarjeta({
      etiqueta: 'SERIES CALIFICADAS',
      valor: String(m.n),
      referencia: m.n > 1 ? `IC 95% [${m.ic95[0].toFixed(3)}, ${m.ic95[1].toFixed(3)}]` : null,
      nota: m.n && !m.concluyente ? 'el intervalo contiene la base: NO concluyente' : m.n ? 'intervalo separado de la base' : null,
      alerta: Boolean(m.n) && !m.concluyente,
    }),
  ].join('\n');

  const cuerpoCalificadas = calificadas.length
    ? calificadas.map((c) => filaSerie(c, nombre)).join('\n')
    : vacio('Todavía no hay series calificadas. Aparecen acá en cuanto una serie predicha termina y el juez la cruza contra el resultado real de OpenDota.');

  const cuerpoPendientes = pendientes.length
    ? pendientes
        .map((p) => {
          const pa = Number(p.prob_gana_a);
          const pb = Number(p.prob_gana_b);
          return `          <a href="${esc(archivoDeFicha(p.series_id))}" style="display: grid; grid-template-columns: minmax(0,1fr) 96px; gap: 16px; align-items: center; padding: 12px 24px; border-bottom: 1px solid rgba(243,242,242,0.14); color: inherit; text-decoration: none;" title="Ver la ficha de esta serie">
            <div style="min-width: 0;">
              <div style="display: grid; grid-template-columns: 14px minmax(0,1fr) auto; gap: 10px; align-items: center; font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-variant-numeric: tabular-nums;">
                <span style="font-size: 10px; color: ${pa >= pb ? '#ff563c' : '#9b9797'};">${pa >= pb ? '▶' : ''}</span>
                <span style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(nombre(p.equipo_a))}</span>
                <span style="color: #ff563c; font-weight: 500;">${pct(pa)}<span style="color:#9b9797;">%</span></span>
              </div>
              <div style="display: grid; grid-template-columns: 14px minmax(0,1fr) auto; gap: 10px; align-items: center; font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-variant-numeric: tabular-nums; margin-top: 6px;">
                <span style="font-size: 10px; color: ${pb > pa ? '#ff563c' : '#9b9797'};">${pb > pa ? '▶' : ''}</span>
                <span style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(nombre(p.equipo_b))}</span>
                <span style="color: #ff563c; font-weight: 500;">${pct(pb)}<span style="color:#9b9797;">%</span></span>
              </div>
              <div style="display: flex; height: 8px; margin-top: 10px; background: rgba(243,242,242,0.08);">
                <div style="width: ${pct(pa)}%; background: #ff563c;"></div>
                <div style="width: ${pct(pb)}%; border: 1px solid #ff9783; box-sizing: border-box;"></div>
              </div>
            </div>
            <div style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #9b9797; text-align: right;">
              <div style="color: #f3f2f2; font-size: 14px; font-variant-numeric: tabular-nums;">${esc(hora12(enVenezuela(p.start_time).hora))}</div>
              <div style="margin-top: 4px;">${esc(p.formato.toUpperCase())}</div>
            </div>
          </a>`;
        })
        .join('\n')
    : vacio(
        'Ninguna serie próxima con los dos equipos definidos. En el formato suizo de TI los cruces de la ronda siguiente salen del resultado de la actual, así que el calendario los publica como TBD y no se puede predecir sobre eso. En cuanto se definan, el flujo los predice antes de que empiecen.',
      );

  const filasFuerzas = fuerzas
    .map(
      (f, i) => `          <div style="display: grid; grid-template-columns: 26px minmax(0,1fr) 64px; gap: 12px; align-items: center; padding: 9px 24px; border-bottom: 1px solid rgba(243,242,242,0.1);">
            <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #9b9797; font-variant-numeric: tabular-nums;">${i + 1}</span>
            <span style="font-family: 'IBM Plex Mono', monospace; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(f.nombre)}</span>
            <span style="font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-variant-numeric: tabular-nums; text-align: right; color: #ff563c;">${Math.round(f.rating)}</span>
          </div>`,
    )
    .join('\n');

  const lectura = m.n
    ? peorQueBase
      ? `El motor va por encima de la base ingenua (${m.media.toFixed(4)} contra ${m.baseMedia.toFixed(3)}): en esta muestra está prediciendo peor que tirar una moneda. Con n=${m.n} el intervalo de confianza contiene la base, así que el resultado no distingue entre "el motor no sirve" y "mala suerte". La mediana (${m.mediana.toFixed(4)}) y las ${m.mejoresQueBase} de ${m.n} series por debajo de la base apuntan al otro lado: la media está arrastrada por los upsets, no por un sesgo parejo. La evidencia con peso sigue siendo el backtest de 8.116 series históricas (bo3 = 0.4735), no estas ${m.n}.`
      : `El motor va por debajo de la base ingenua en esta muestra. Con n=${m.n} todavía es poca cosa: el backtest de 8.116 series históricas (bo3 = 0.4735) sigue siendo la evidencia con peso.`
    : 'Sin series calificadas todavía, no hay nada que juzgar.';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monitor Dota 2 · The International 2026</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; background: #171615; }
  a { color: #ff563c; text-decoration: none; }
  a:hover { color: #ff9783; }
  ::selection { background: rgba(255,86,60,0.35); }
</style>
</head>
<body>
<div style="min-height: 100vh; background: #171615; color: #f3f2f2; font-family: 'Archivo', sans-serif; font-size: 14px; -webkit-font-smoothing: antialiased;">

  <div style="display: flex; align-items: stretch; justify-content: space-between; flex-wrap: wrap; border-bottom: 2px solid rgba(243,242,242,0.45); padding: 0 24px;">
    <div style="display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; padding: 14px 0;">
      <span style="font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 600; letter-spacing: 0.14em;">MONITOR DOTA 2</span>
      <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.1em; color: #9b9797;">ELO · THE INTERNATIONAL 2026 · GENERADO ${esc(generadoEn)}</span>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); border-bottom: 2px solid rgba(243,242,242,0.45);">
${tarjetas}
  </div>

  <div style="padding: 16px 24px; border-bottom: 2px solid rgba(243,242,242,0.45); font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #bab6b6; line-height: 1.65; max-width: 96ch;">${esc(lectura)}</div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); border-bottom: 2px solid rgba(243,242,242,0.45);">

    <div style="border-right: 2px solid rgba(243,242,242,0.45);">
${seccion('SERIES CALIFICADAS', `${m.n} ${m.n === 1 ? "SERIE" : "SERIES"} · ▶ = FAVORITO DEL MOTOR`, cuerpoCalificadas)}
${calificadas.length ? `      <div style="padding: 12px 24px 20px; font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #9b9797; letter-spacing: 0.06em;">FILA TINTADA = BRIER POR ENCIMA DE SU BASE INGENUA</div>` : ''}
    </div>

    <div>
${seccion('PRÓXIMAS SERIES PREDICHAS', `${pendientes.length} ${pendientes.length === 1 ? "SERIE" : "SERIES"}`, cuerpoPendientes)}
${seccion('FUERZA ELO · LOS 16 DE TI2026', 'RATING AL MOMENTO DE GENERAR', filasFuerzas)}
    </div>

  </div>

  <div style="padding: 16px 24px 40px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #9b9797; line-height: 1.7; max-width: 100ch;">
    Los porcentajes salen del Elo (motor/elo.mjs) convertido a probabilidad de serie (motor/series.mjs), calculado sólo con partidas anteriores al inicio de cada serie. Ninguna predicción se reescribe después de guardarse. El Brier de cada serie es la suma de (predicho − real)² sobre las clases del formato; la base ingenua de un Bo3 es 0.5.
  </div>

</div>
</body>
</html>
`;
}

function envoltorio(titulo, contenido) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; background: #171615; }
  a { color: #ff563c; text-decoration: none; }
  a:hover { color: #ff9783; }
  ::selection { background: rgba(255,86,60,0.35); }
</style>
</head>
<body>
<div style="min-height: 100vh; background: #171615; color: #f3f2f2; font-family: 'Archivo', sans-serif; font-size: 14px; -webkit-font-smoothing: antialiased;">
${contenido}
</div>
</body>
</html>
`;
}

export function construirFicha({ serie, nombre, p, marcadores, ratingA, ratingB, formaA, formaB, generadoEn }) {
  const nombreA = nombre(serie.equipo_a);
  const nombreB = nombre(serie.equipo_b);
  const pa = Number(serie.prob_gana_a);
  const pb = Number(serie.prob_gana_b);
  const empate = Number(serie.prob_empate);
  const favA = pa >= pb;
  const base = BASE_INGENUA[serie.formato] ?? 0.5;

  // Una serie pendiente tiene predicción pero todavía no resultado: se
  // puede mostrar de dónde sale el número y qué marcadores son posibles,
  // pero no hay resultado ni Brier que enseñar. Inventar un juicio acá
  // sería justamente lo que el proyecto no hace.
  const calificada = Boolean(serie.resultado_real);
  const brier = calificada ? Number(serie.brier) : null;
  const acerto = calificada && (favA ? 'ganaA' : 'ganaB') === serie.resultado_real;

  const marcadorReal =
    calificada && serie.victorias_a != null && serie.victorias_b != null
      ? `${serie.victorias_a}–${serie.victorias_b}`
      : null;
  const ordenados = marcadores.slice().sort((a, b) => b.prob - a.prob);
  const filaReal = marcadores.find((m) => m.marcador === marcadorReal);
  const puestoReal = filaReal ? ordenados.findIndex((m) => m.marcador === marcadorReal) + 1 : null;
  const maxProb = Math.max(...marcadores.map((m) => m.prob));

  const filasMarcadores = marcadores
    .map((m) => {
      const esReal = m.marcador === marcadorReal;
      const quien = m.gana === 'A' ? nombreA : m.gana === 'B' ? nombreB : 'empate';
      return `        <div style="display: grid; grid-template-columns: 58px minmax(0,1fr) 120px 62px; gap: 14px; align-items: center; padding: 10px 24px; border-bottom: 1px solid rgba(243,242,242,0.12);${esReal ? ' background: rgba(255,86,60,0.16);' : ''}">
          <span style="font-family: 'IBM Plex Mono', monospace; font-size: 15px; font-variant-numeric: tabular-nums; color: ${esReal ? '#f3f2f2' : '#bab6b6'};">${esc(m.marcador)}</span>
          <div style="height: 10px; background: rgba(243,242,242,0.08);">
            <div style="width: ${((m.prob / maxProb) * 100).toFixed(1)}%; height: 100%; background: ${esReal ? '#ff563c' : 'rgba(255,86,60,0.42)'};"></div>
          </div>
          <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #9b9797; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(quien)}</span>
          <span style="font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-variant-numeric: tabular-nums; text-align: right; color: ${esReal ? '#ff563c' : '#f3f2f2'};">${pct(m.prob)}<span style="color:#9b9797;">%</span></span>
        </div>`;
    })
    .join('\n');

  const forma = (lista) =>
    lista.length
      ? lista
          .map(
            (f) =>
              `<span style="display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:600; ${f.gano ? 'background:#ff563c; color:#171615;' : 'border:1px solid rgba(243,242,242,0.35); color:#9b9797;'}">${f.gano ? 'V' : 'D'}</span>`,
          )
          .join('')
      : `<span style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:#9b9797;">sin partidas previas registradas</span>`;

  const diferencia = ratingA - ratingB;
  const masProbable = marcadores.reduce((mejor, m) => (m.prob > mejor.prob ? m : mejor), marcadores[0]);

  const narrativa = (
    calificada
      ? [
          `El motor daba ${pct(favA ? pa : pb)}% a ${esc(favA ? nombreA : nombreB)} y ${acerto ? 'acertó' : 'falló'}.`,
          marcadorReal && puestoReal
            ? `El marcador real ${marcadorReal} era el ${puestoReal}.º más probable de ${marcadores.length} (${pct(filaReal.prob)}%).`
            : '',
          brier > base
            ? `El Brier de esta serie (${brier.toFixed(4)}) quedó por encima de su base ingenua (${base.toFixed(3)}): en esta serie el modelo aportó menos que tirar una moneda.`
            : `El Brier de esta serie (${brier.toFixed(4)}) quedó por debajo de su base ingenua (${base.toFixed(3)}).`,
        ]
      : [
          `Serie sin jugar: esta predicción ya está guardada y no se va a reescribir, así que cuando termine se puede juzgar contra lo que de verdad pasó.`,
          `El motor da ${pct(favA ? pa : pb)}% a ${esc(favA ? nombreA : nombreB)}, y el marcador más probable es ${masProbable.marcador} con ${pct(masProbable.prob)}%.`,
        ]
  )
    .concat([
      `Todo sale de una diferencia de ${Math.abs(Math.round(diferencia))} puntos de Elo, que da ${pct(p)}% de ganar UNA partida y ${pct(pa)}% de ganar el ${serie.formato.toUpperCase()}.`,
    ])
    .filter(Boolean)
    .join(' ');

  const contenido = `  <div style="display: flex; align-items: stretch; justify-content: space-between; flex-wrap: wrap; border-bottom: 2px solid rgba(243,242,242,0.45); padding: 0 24px;">
    <div style="display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; padding: 14px 0;">
      <a href="index.html" style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.12em;">← PANEL</a>
      <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.1em; color: #9b9797;">FICHA DE SERIE · ${esc(serie.formato.toUpperCase())} · ${esc(fechaYHora(serie.start_time))} VET</span>
      ${calificada ? '' : `<span style="font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.12em; padding: 3px 8px; background: #ff563c; color: #171615;">SIN JUGAR</span>`}
    </div>
  </div>

  <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 24px; flex-wrap: wrap; padding: 22px 24px; border-bottom: 2px solid rgba(243,242,242,0.45);">
    <div style="font-family: 'Archivo', sans-serif; font-size: clamp(24px, 4vw, 40px); font-weight: 600; line-height: 1.1;">
      <span style="color: ${!calificada || serie.resultado_real === 'ganaA' ? '#f3f2f2' : '#9b9797'};">${esc(nombreA)}</span>
      <span style="color: #ff563c;"> vs </span>
      <span style="color: ${!calificada || serie.resultado_real === 'ganaB' ? '#f3f2f2' : '#9b9797'};">${esc(nombreB)}</span>
    </div>
    <div style="text-align: right; font-family: 'IBM Plex Mono', monospace;">
${
  calificada
    ? `      <div style="font-size: 11px; letter-spacing: 0.12em; color: #9b9797;">RESULTADO REAL</div>
      <div style="font-size: 28px; font-variant-numeric: tabular-nums; margin-top: 4px;">${esc(marcadorReal ?? '—')}</div>
      <div style="font-size: 10px; letter-spacing: 0.08em; margin-top: 6px; color: ${acerto ? '#f3f2f2' : '#9b9797'};">${acerto ? '■ ACIERTO' : '◇ FALLO'}</div>`
    : `      <div style="font-size: 11px; letter-spacing: 0.12em; color: #9b9797;">EMPIEZA</div>
      <div style="font-size: 22px; font-variant-numeric: tabular-nums; margin-top: 4px;">${esc(hora12(enVenezuela(serie.start_time).hora))}</div>
      <div style="font-size: 10px; letter-spacing: 0.08em; margin-top: 6px; color: #9b9797;">${esc(enVenezuela(serie.start_time).fecha)} · VET</div>`
}
    </div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); border-bottom: 2px solid rgba(243,242,242,0.45);">
${tarjeta({ etiqueta: 'GANA ' + nombreA.toUpperCase(), valor: pct(pa), sufijo: '%', nota: calificada && serie.resultado_real === 'ganaA' ? 'ocurrió' : null })}
${empate > 0 ? tarjeta({ etiqueta: 'EMPATE', valor: pct(empate), sufijo: '%', nota: calificada && serie.resultado_real === 'empate' ? 'ocurrió' : null }) + '\n' : ''}${tarjeta({ etiqueta: 'GANA ' + nombreB.toUpperCase(), valor: pct(pb), sufijo: '%', nota: calificada && serie.resultado_real === 'ganaB' ? 'ocurrió' : null })}
${
  calificada
    ? tarjeta({
        etiqueta: 'BRIER DE LA SERIE',
        valor: brier.toFixed(4),
        delta: (brier - base >= 0 ? '+' : '−') + Math.abs(brier - base).toFixed(4),
        referencia: `vs ${base.toFixed(3)} = base ingenua`,
        alerta: brier > base,
      })
    : tarjeta({
        etiqueta: 'BRIER DE LA SERIE',
        valor: '—',
        referencia: `se calcula al terminar, contra ${base.toFixed(3)}`,
        nota: 'la predicción de arriba queda congelada',
      })
}
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); border-bottom: 2px solid rgba(243,242,242,0.45);">

    <div style="border-right: 2px solid rgba(243,242,242,0.45);">
      <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 14px 24px; border-bottom: 1px solid rgba(243,242,242,0.28);">
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600; letter-spacing: 0.14em;">MARCADORES POSIBLES</span>
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #9b9797; letter-spacing: 0.08em;">DERIVADO DE p = ${pct(p)}% POR PARTIDA</span>
      </div>
${filasMarcadores}
      <div style="padding: 12px 24px 20px; font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #9b9797; letter-spacing: 0.06em;">${calificada ? 'FILA TINTADA = MARCADOR QUE DE VERDAD PASÓ · BARRA RELATIVA AL MÁS PROBABLE' : 'BARRA RELATIVA AL MÁS PROBABLE · TODAVÍA NO PASÓ NINGUNO'}</div>
    </div>

    <div>
      <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 14px 24px; border-bottom: 1px solid rgba(243,242,242,0.28);">
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600; letter-spacing: 0.14em;">DE DÓNDE SALE</span>
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #9b9797; letter-spacing: 0.08em;">ELO AL MOMENTO DE PREDECIR</span>
      </div>
      <div style="display: grid; grid-template-columns: minmax(0,1fr) 76px; gap: 14px; align-items: center; padding: 12px 24px; border-bottom: 1px solid rgba(243,242,242,0.12);">
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(nombreA)}</span>
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 16px; font-variant-numeric: tabular-nums; text-align: right; color: #ff563c;">${Math.round(ratingA)}</span>
      </div>
      <div style="display: grid; grid-template-columns: minmax(0,1fr) 76px; gap: 14px; align-items: center; padding: 12px 24px; border-bottom: 1px solid rgba(243,242,242,0.12);">
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(nombreB)}</span>
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 16px; font-variant-numeric: tabular-nums; text-align: right; color: #ff563c;">${Math.round(ratingB)}</span>
      </div>
      <div style="display: grid; grid-template-columns: minmax(0,1fr) 76px; gap: 14px; align-items: center; padding: 12px 24px; border-bottom: 1px solid rgba(243,242,242,0.28);">
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #9b9797; letter-spacing: 0.08em;">DIFERENCIA → p POR PARTIDA</span>
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-variant-numeric: tabular-nums; text-align: right;">${diferencia >= 0 ? '+' : '−'}${Math.abs(Math.round(diferencia))}</span>
      </div>

      <div style="padding: 14px 24px; border-bottom: 1px solid rgba(243,242,242,0.28);">
        <div style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.12em; color: #9b9797; margin-bottom: 10px;">FORMA ANTES DE LA SERIE · MÁS RECIENTE A LA IZQUIERDA</div>
        <div style="display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 14px; align-items: center; margin-bottom: 8px;">
          <span style="font-family: 'IBM Plex Mono', monospace; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(nombreA)}</span>
          <div style="display: flex; gap: 4px;">${forma(formaA)}</div>
        </div>
        <div style="display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 14px; align-items: center;">
          <span style="font-family: 'IBM Plex Mono', monospace; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(nombreB)}</span>
          <div style="display: flex; gap: 4px;">${forma(formaB)}</div>
        </div>
      </div>
    </div>

  </div>

  <div style="padding: 16px 24px; border-bottom: 2px solid rgba(243,242,242,0.45); font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #bab6b6; line-height: 1.65; max-width: 96ch;">${esc(narrativa)}</div>

  <div style="padding: 16px 24px 40px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #9b9797; line-height: 1.7; max-width: 100ch;">
    Los marcadores salen de la misma p de partida que produjo la predicción guardada (se recupera invirtiendo la fórmula del formato), así que no agregan ningún supuesto nuevo: la suma de los marcadores de cada equipo da exactamente su probabilidad de serie. Los ratings Elo están reconstruidos con partidas anteriores al momento en que se hizo la predicción, nunca con lo que pasó después. Generado ${esc(generadoEn)}.
  </div>`;

  return envoltorio(`${nombreA} vs ${nombreB} · Monitor Dota 2`, contenido);
}

async function main() {
  const [seriesDb, predsDb, teamsDb] = await Promise.all([
    seleccionar('dota_series', '?select=*&order=start_time'),
    seleccionar('dota_predictions', '?select=*'),
    seleccionar('dota_teams', '?select=*'),
  ]);

  const predPorId = new Map(predsDb.map((p) => [p.series_id, p]));
  const nombrePorId = new Map(teamsDb.map((t) => [t.team_id, t.nombre]));
  const nombre = (id) => nombrePorId.get(id) ?? EQUIPOS_TI2026.find((e) => e.teamId === id)?.nombre ?? `#${id}`;

  const calificadas = [];
  const pendientes = [];
  for (const s of seriesDb) {
    const p = predPorId.get(s.series_id);
    if (p && p.resultado_real) calificadas.push({ ...s, ...p });
    else if (p) pendientes.push({ ...s, ...p });
  }
  calificadas.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));

  // Ratings frescos: histórico de disco + lo que ya se jugó del torneo.
  const historicoBase = JSON.parse(await readFile(new URL('../../datos/historico.json', import.meta.url), 'utf8'));
  const partidasLiga = await partidasDeLaLiga(LEAGUE_ID_TI2026);
  const { partidas } = historicoConLiga(historicoBase, partidasLiga);
  const r = ratings(partidas, Date.now() / 1000);
  const fuerzas = EQUIPOS_TI2026.map((e) => ({ nombre: e.nombre, rating: ratingDeEquipo(r, e.teamId) })).sort(
    (a, b) => b.rating - a.rating,
  );

  const metricas = calcularMetricas(calificadas);
  const generadoEn = fechaYHora(new Date().toISOString()) + ' VET';

  const html = construirHtml({ calificadas, pendientes, nombre, metricas, fuerzas, generadoEn });
  const destino = new URL('./index.html', import.meta.url);
  await writeFile(destino, html);

  // Una ficha por serie, calificada o pendiente. Los ratings se reconstruyen
  // al momento en que se PREDIJO (creada_en), no con los de ahora: así la
  // ficha no muestra información que no existía cuando se hizo la
  // predicción. Si falta creada_en se cae al inicio de la serie.
  let fichas = 0;
  for (const s of [...calificadas, ...pendientes]) {
    const inicio = Math.floor(new Date(s.creada_en ?? s.start_time).getTime() / 1000);
    const rMomento = ratings(partidas, inicio);
    const p = probabilidadPartidaDesdeSerie(Number(s.prob_gana_a), s.formato);
    const marcadores = distribucionMarcadores(p, s.formato);

    const ficha = construirFicha({
      serie: s,
      nombre,
      p,
      marcadores,
      ratingA: ratingDeEquipo(rMomento, s.equipo_a),
      ratingB: ratingDeEquipo(rMomento, s.equipo_b),
      formaA: formaDeEquipo(partidas, s.equipo_a, inicio),
      formaB: formaDeEquipo(partidas, s.equipo_b, inicio),
      generadoEn,
    });
    await writeFile(new URL('./' + archivoDeFicha(s.series_id), import.meta.url), ficha);
    fichas++;
  }

  console.log(`Panel generado: ${fileURLToPath(destino)}`);
  console.log(`  ${calificadas.length} series calificadas, ${pendientes.length} pendientes, ${fuerzas.length} equipos`);
  console.log(`  ${fichas} fichas de serie generadas`);
  if (metricas.n) {
    console.log(`  Brier ${metricas.media.toFixed(4)} vs base ${metricas.baseMedia.toFixed(3)} · concluyente: ${metricas.concluyente ? 'sí' : 'NO (n chico)'}`);
  }
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
