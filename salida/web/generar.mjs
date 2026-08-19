// Genera el panel web con datos REALES de Supabase. Escribe un HTML
// estático: así ninguna llave viaja al navegador (la service_role se queda
// acá) y la página funciona abriéndola del disco, sin servidor.
//
// Se regenera corriendo este script; la tarea programada del Programador de
// tareas lo llama después de calificar (ver n8n/README.md).
//
// Lenguaje visual: el MISMO del panel principal (index.html). Antes era otro
// —fondo #171615, IBM Plex Mono, acento naranja, todo inline— y abrir uno
// después del otro se sentía como entrar a dos sitios distintos. Ahora el
// CSS, la barra lateral y el envoltorio salen de salida/web/estilo.mjs, así
// que no se pueden separar sin querer. Las métricas sí siguen siendo las de
// Dota: no hay goles, no hay λ, y un Bo3 no tiene empate.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { seleccionar } from '../../datos/supabase.mjs';
import { partidasDeLaLiga, seriesDeLaLiga, historicoConLiga } from '../../datos/liga.mjs';
import { grillaDePosiciones } from './grilla.mjs';
import { ratings, ratingDeEquipo, probabilidadGanar } from '../../motor/elo.mjs';
import { distribucionMarcadores, probabilidadPartidaDesdeSerie } from '../../motor/series.mjs';
import { EQUIPOS_TI2026 } from '../../datos/equipos-ti2026.mjs';
import { enVenezuela, hora12 } from '../formato.mjs';
import { esc, logo, escudo, kpi, cabecera, documento, barraLateral, copiarAssets } from './estilo.mjs';
import { cargarLogos } from '../../datos/logos-dota.mjs';

const LEAGUE_ID_TI2026 = 19719;

// Base ingenua por formato: sin información, 50/50 en los formatos sin
// empate. Brier = (0.5-1)² + (0.5-0)² = 0.5. Para bo2 son tres clases.
const BASE_INGENUA = { bo1: 0.5, bo2: 2 / 3, bo3: 0.5, bo5: 0.5 };

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

// --- barra lateral, igual en el panel y en las fichas ------------------------

// `calificadas` va en el contador, y `activo` marca dónde estás parado. Las
// dos páginas de Dota comparten esta barra con el panel principal: se navega
// entre las tres sin que cambie el sitio debajo de los pies.
function barraDota({ calificadas = null, dondeEstoy = 'panel' } = {}) {
  return barraLateral({
    bloques: [
      {
        etiqueta: 'Volver',
        enlaces: [
          {
            href: 'index.html',
            texto: 'Todos los juegos',
            color: '#3b82f6',
            logoHtml: `<span class="ph" style="width:28px;height:28px;background:#3b82f61f;border-color:#3b82f659"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5m7-7-7 7 7 7"/></svg></span>`,
          },
        ],
      },
      {
        etiqueta: 'Dota 2 · TI2026',
        enlaces: [
          {
            href: 'dota.html',
            texto: 'Panel de Dota',
            color: '#ef4444',
            contador: calificadas,
            activo: dondeEstoy === 'panel',
            logoHtml: logo('D2', '#ef4444', 28, 'dota2'),
          },
        ],
      },
    ],
    nota:
      'Los porcentajes salen del Elo, calculado sólo con partidas anteriores al inicio de cada serie. Ninguna predicción se reescribe después de guardarse.',
  });
}

// --- piezas del panel --------------------------------------------------------

// Una serie calificada: los dos equipos con su probabilidad, el marcador
// real, el Brier y el veredicto. Toda la fila enlaza a su ficha.
function filaSerie(c, nombre, escudoDe) {
  const pa = Number(c.prob_gana_a);
  const pb = Number(c.prob_gana_b);
  const favA = pa >= pb;
  const acerto = (favA ? 'ganaA' : 'ganaB') === c.resultado_real;
  const brier = Number(c.brier);
  const base = BASE_INGENUA[c.formato] ?? 0.5;
  const peor = brier > base;

  const marcador = `${c.victorias_a ?? '-'}–${c.victorias_b ?? '-'}`;
  const ganador =
    c.resultado_real === 'ganaA' ? nombre(c.equipo_a) : c.resultado_real === 'ganaB' ? nombre(c.equipo_b) : 'empate';

  const lado = (id, prob, esFav, gano) => `
        <div class="slado">
          <span class="sfav">${esFav ? '▶' : ''}</span>
          ${escudoDe(id)}
          <span class="sname${gano ? ' gano' : ''}">${esc(nombre(id))}</span>
          <span class="sprob">${pct(prob)}%</span>
        </div>`;

  return `
      <a class="srow${peor ? ' mala' : ''}" href="${esc(archivoDeFicha(c.series_id))}" title="Ver la ficha de esta serie">
        <div>
          ${lado(c.equipo_a, pa, favA, c.resultado_real === 'ganaA')}
          ${lado(c.equipo_b, pb, !favA, c.resultado_real === 'ganaB')}
          <div class="sbar"><i style="width:${pct(pa)}%;background:#ef4444"></i><i style="width:${pct(pb)}%;background:#7f1d1d"></i></div>
        </div>
        <div>
          <div class="smarc">${esc(marcador)}</div>
          <div class="sgan">${esc(ganador)}</div>
        </div>
        <div class="sbrier" style="color:${peor ? '#f87171' : 'var(--text)'}">${brier.toFixed(3)}</div>
        <div class="sver"><span class="res ${acerto ? 'b-green' : 'b-red'}">${acerto ? 'ACERTÓ' : 'FALLÓ'}</span></div>
      </a>`;
}

// Una serie predicha que todavía no se juega: hay predicción y hora, no hay
// resultado ni juicio.
function filaPendiente(p, nombre, escudoDe) {
  const pa = Number(p.prob_gana_a);
  const pb = Number(p.prob_gana_b);
  const favA = pa >= pb;

  const lado = (id, prob, esFav) => `
        <div class="slado">
          <span class="sfav">${esFav ? '▶' : ''}</span>
          ${escudoDe(id)}
          <span class="sname">${esc(nombre(id))}</span>
          <span class="sprob">${pct(prob)}%</span>
        </div>`;

  return `
      <a class="srow" href="${esc(archivoDeFicha(p.series_id))}" style="grid-template-columns:minmax(0,1fr) 96px" title="Ver la ficha de esta serie">
        <div>
          ${lado(p.equipo_a, pa, favA)}
          ${lado(p.equipo_b, pb, !favA)}
          <div class="sbar"><i style="width:${pct(pa)}%;background:#ef4444"></i><i style="width:${pct(pb)}%;background:#7f1d1d"></i></div>
        </div>
        <div style="text-align:right">
          <div class="smarc">${esc(hora12(enVenezuela(p.start_time).hora))}</div>
          <div class="sgan">${esc(p.formato.toUpperCase())}</div>
        </div>
      </a>`;
}

function tarjetaSeccion(titulo, derecha, cuerpo, pie = '') {
  return `
    <section class="card">
      ${cabecera(titulo, derecha)}
      ${cuerpo}
      ${pie ? `<div class="spie">${esc(pie)}</div>` : ''}
    </section>`;
}

function vacio(mensaje) {
  return `<div class="vacio">${esc(mensaje)}</div>`;
}

export function construirHtml({ calificadas, pendientes, nombre, metricas, fuerzas, generadoEn, seriesLiga = [], destacados = new Set(), logos = new Map() }) {
  // Escudo por team_id. Sin archivo de logos caen todos a las iniciales, que
  // es como se veía hasta ahora: nada se rompe por un escudo que falta.
  const escudoDe = (id) => escudo(nombre(id), logos.get(id), '#ef4444', 22);
  // La grilla se arma de las series REALES del torneo, no de las predichas:
  // hay series de TI que el sistema nunca llegó a predecir y aun así cuentan
  // para la posición.
  const g = grillaDePosiciones(seriesLiga, nombre, { destacados, pendientes });

  const m = metricas;
  const deltaBrier = m.n ? m.media - m.baseMedia : 0;
  const peorQueBase = Boolean(m.n) && deltaBrier > 0;

  const kpis = [
    kpi({
      etiqueta: 'Brier',
      valor: m.n ? m.media.toFixed(4) : '—',
      color: peorQueBase ? '#ef4444' : '#22c55e',
      pie: m.n
        ? `<span style="color:${peorQueBase ? '#f87171' : 'var(--green)'};font-weight:800">${deltaBrier >= 0 ? '+' : '−'}${Math.abs(deltaBrier).toFixed(4)}</span><span>vs <b>${m.baseMedia.toFixed(3)}</b> = adivinar</span>`
        : '',
      nota: peorQueBase ? 'Por encima de la base: peor que adivinar' : m.n ? 'Por debajo de la base' : null,
      alerta: peorQueBase,
    }),
    kpi({
      etiqueta: 'Mediana',
      valor: m.n ? m.mediana.toFixed(4) : '—',
      color: '#3b82f6',
      pie: m.n ? `<span><b>${m.mejoresQueBase}</b> de ${m.n} series bajo la base</span>` : '',
      nota: 'Menos sensible a un upset suelto que la media',
    }),
    kpi({
      etiqueta: 'Favorito acertado',
      valor: m.n ? pct(m.aciertos / m.n) : '—',
      sufijo: m.n ? '%' : '',
      color: '#22c55e',
      dash: m.n ? (m.aciertos / m.n) * 163.4 : 0,
      pie: m.n ? `<span><b>${m.aciertos}</b> de ${m.n} series</span>` : '',
      nota: 'El más probable de los dos ganó la serie',
    }),
    kpi({
      etiqueta: 'Series calificadas',
      valor: String(m.n),
      color: '#f59e0b',
      pie: m.n > 1 ? `<span>IC 95% <b>[${m.ic95[0].toFixed(3)}, ${m.ic95[1].toFixed(3)}]</b></span>` : '',
      nota: m.n && !m.concluyente
        ? 'El intervalo contiene la base: NO concluyente'
        : m.n
          ? 'Intervalo separado de la base'
          : null,
      alerta: Boolean(m.n) && !m.concluyente,
    }),
  ].join('\n    ');

  const cuerpoCalificadas = calificadas.length
    ? calificadas.map((c) => filaSerie(c, nombre, escudoDe)).join('')
    : vacio(
        'Todavía no hay series calificadas. Aparecen acá en cuanto una serie predicha termina y el juez la cruza contra el resultado real de OpenDota.',
      );

  const cuerpoPendientes = pendientes.length
    ? pendientes.map((p) => filaPendiente(p, nombre, escudoDe)).join('')
    : vacio(
        'Ninguna serie próxima con los dos equipos definidos. En el formato suizo de TI los cruces de la ronda siguiente salen del resultado de la actual, así que el calendario los publica como TBD y no se puede predecir sobre eso. En cuanto se definan, el flujo los predice antes de que empiecen.',
      );

  const filasFuerzas = fuerzas
    .map(
      (f, i) => `
      <div class="frow">
        <span class="fpos">${i + 1}</span>
        <span class="fnom">${f.teamId == null ? '' : escudoDe(f.teamId)}${esc(f.nombre)}</span>
        <span class="frat">${Math.round(f.rating)}</span>
      </div>`,
    )
    .join('');

  const lectura = m.n
    ? peorQueBase
      ? `El motor va por encima de la base ingenua (${m.media.toFixed(4)} contra ${m.baseMedia.toFixed(3)}): en esta muestra está prediciendo peor que tirar una moneda. Con n=${m.n} el intervalo de confianza contiene la base, así que el resultado no distingue entre "el motor no sirve" y "mala suerte". La mediana (${m.mediana.toFixed(4)}) y las ${m.mejoresQueBase} de ${m.n} series por debajo de la base apuntan al otro lado: la media está arrastrada por los upsets, no por un sesgo parejo. La evidencia con peso sigue siendo el backtest de 8.116 series históricas (bo3 = 0.4735), no estas ${m.n}.`
      : `El motor va por debajo de la base ingenua en esta muestra. Con n=${m.n} todavía es poca cosa: el backtest de 8.116 series históricas (bo3 = 0.4735) sigue siendo la evidencia con peso.`
    : 'Sin series calificadas todavía, no hay nada que juzgar.';

  const contenido = `
  <header class="topbar">
    <div><h1>Dota 2</h1><div class="sub">Elo · The International 2026</div></div>
    <div class="stamp">Generado ${esc(generadoEn)}</div>
  </header>

  <section class="kpis">
    ${kpis}
  </section>

  <div class="aviso${peorQueBase ? ' rojo' : ''}">${esc(lectura)}</div>

  <section class="card ancho">
    ${cabecera(g.titulo, `${seriesLiga.length} ${seriesLiga.length === 1 ? 'serie' : 'series'} jugadas en TI2026`)}
    <div class="scroll">${g.html}</div>
  </section>

  <section class="mid">
    ${tarjetaSeccion(
      'Series calificadas',
      `${m.n} ${m.n === 1 ? 'serie' : 'series'} · ▶ = favorito del motor`,
      cuerpoCalificadas,
      calificadas.length ? 'Fila tintada = Brier por encima de su base ingenua' : '',
    )}
    <div>
      ${tarjetaSeccion(
        'Próximas series predichas',
        `${pendientes.length} ${pendientes.length === 1 ? 'serie' : 'series'}`,
        cuerpoPendientes,
      )}
      <div class="ancho">
        ${tarjetaSeccion('Fuerza Elo · los 16 de TI2026', 'Rating al momento de generar', filasFuerzas)}
      </div>
    </div>
  </section>

  <footer>
    Los porcentajes salen del Elo (motor/elo.mjs) convertido a probabilidad de serie (motor/series.mjs),
    calculado sólo con partidas anteriores al inicio de cada serie. Ninguna predicción se reescribe
    después de guardarse. El Brier de cada serie es la suma de (predicho − real)² sobre las clases del
    formato; la base ingenua de un Bo3 es 0.5.
  </footer>`;

  return documento({
    titulo: 'MONITOR-ESPORTS · Panel de Dota 2',
    pagina: 'dota.html',
    imagen: 'og-image-dota.png',
    descripcion:
      'Predicciones de Dota 2 en The International 2026, calificadas serie por serie contra el resultado real. Brier, favorito acertado y la llave del Main Event.',
    sidebar: barraDota({ calificadas: m.n || null, dondeEstoy: 'panel' }),
    contenido,
  });
}

export function construirFicha({ serie, nombre, p, marcadores, ratingA, ratingB, formaA, formaB, generadoEn, logos = new Map() }) {
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
  const escudoDe = (id) => escudo(nombre(id), logos.get(id), '#ef4444', 26);
  // En el título va más grande: es el elemento principal de la página.
  const escudoGrande = (id) => escudo(nombre(id), logos.get(id), '#ef4444', 40);

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
      return `
      <div class="mrow${esReal ? ' real' : ''}">
        <span class="mmarc">${esc(m.marcador)}</span>
        <div class="mbar"><i style="width:${((m.prob / maxProb) * 100).toFixed(1)}%"></i></div>
        <span class="mquien">${esc(quien)}</span>
        <span class="mprob">${pct(m.prob)}%</span>
      </div>`;
    })
    .join('');

  const forma = (lista) =>
    lista.length
      ? lista.map((f) => `<span class="pill ${f.gano ? 'v' : 'd'}">${f.gano ? 'V' : 'D'}</span>`).join('')
      : `<span class="frac">sin partidas previas registradas</span>`;

  const diferencia = ratingA - ratingB;
  const masProbable = marcadores.reduce((mejor, m) => (m.prob > mejor.prob ? m : mejor), marcadores[0]);

  const narrativa = (
    calificada
      ? [
          `El motor daba ${pct(favA ? pa : pb)}% a ${favA ? nombreA : nombreB} y ${acerto ? 'acertó' : 'falló'}.`,
          marcadorReal && puestoReal
            ? `El marcador real ${marcadorReal} era el ${puestoReal}.º más probable de ${marcadores.length} (${pct(filaReal.prob)}%).`
            : '',
          brier > base
            ? `El Brier de esta serie (${brier.toFixed(4)}) quedó por encima de su base ingenua (${base.toFixed(3)}): en esta serie el modelo aportó menos que tirar una moneda.`
            : `El Brier de esta serie (${brier.toFixed(4)}) quedó por debajo de su base ingenua (${base.toFixed(3)}).`,
        ]
      : [
          `Serie sin jugar: esta predicción ya está guardada y no se va a reescribir, así que cuando termine se puede juzgar contra lo que de verdad pasó.`,
          `El motor da ${pct(favA ? pa : pb)}% a ${favA ? nombreA : nombreB}, y el marcador más probable es ${masProbable.marcador} con ${pct(masProbable.prob)}%.`,
        ]
  )
    .concat([
      `Todo sale de una diferencia de ${Math.abs(Math.round(diferencia))} puntos de Elo, que da ${pct(p)}% de ganar UNA partida y ${pct(pa)}% de ganar el ${serie.formato.toUpperCase()}.`,
    ])
    .filter(Boolean)
    .join(' ');

  const kpis = [
    kpi({
      etiqueta: 'Gana ' + nombreA,
      valor: pct(pa),
      sufijo: '%',
      color: '#ef4444',
      dash: pa * 163.4,
      nota: calificada && serie.resultado_real === 'ganaA' ? 'ocurrió' : null,
    }),
    empate > 0
      ? kpi({
          etiqueta: 'Empate',
          valor: pct(empate),
          sufijo: '%',
          color: '#94a0b0',
          nota: calificada && serie.resultado_real === 'empate' ? 'ocurrió' : null,
        })
      : '',
    kpi({
      etiqueta: 'Gana ' + nombreB,
      valor: pct(pb),
      sufijo: '%',
      color: '#3b82f6',
      dash: pb * 163.4,
      nota: calificada && serie.resultado_real === 'ganaB' ? 'ocurrió' : null,
    }),
    calificada
      ? kpi({
          etiqueta: 'Brier de la serie',
          valor: brier.toFixed(4),
          color: brier > base ? '#ef4444' : '#22c55e',
          pie: `<span style="color:${brier > base ? '#f87171' : 'var(--green)'};font-weight:800">${brier - base >= 0 ? '+' : '−'}${Math.abs(brier - base).toFixed(4)}</span><span>vs <b>${base.toFixed(3)}</b> = base ingenua</span>`,
          alerta: brier > base,
        })
      : kpi({
          etiqueta: 'Brier de la serie',
          valor: '—',
          color: '#5d6a7a',
          pie: `<span>se calcula al terminar, contra <b>${base.toFixed(3)}</b></span>`,
          nota: 'la predicción de arriba queda congelada',
        }),
  ]
    .filter(Boolean)
    .join('\n    ');

  const contenido = `
  <header class="topbar">
    <div>
      <div class="hero-lab">Ficha de serie · ${esc(serie.formato.toUpperCase())} · ${esc(fechaYHora(serie.start_time))} VET</div>
    </div>
    <div class="stamp">Generado ${esc(generadoEn)}</div>
  </header>

  <div class="hero">
    <h1>
      <span class="heq${calificada && serie.resultado_real !== 'ganaA' ? ' perdio' : ''}">${escudoGrande(serie.equipo_a)}${esc(nombreA)}</span><span class="vs">vs</span><span class="heq${calificada && serie.resultado_real !== 'ganaB' ? ' perdio' : ''}">${escudoGrande(serie.equipo_b)}${esc(nombreB)}</span>
    </h1>
    <div class="hero-lado">
${
  calificada
    ? `      <div class="hero-lab">RESULTADO REAL</div>
      <div class="hero-num">${esc(marcadorReal ?? '—')}</div>
      <div style="margin-top:7px"><span class="res ${acerto ? 'b-green' : 'b-red'}">${acerto ? 'ACERTÓ' : 'FALLÓ'}</span></div>`
    : `      <div class="hero-lab">EMPIEZA</div>
      <div class="hero-num">${esc(hora12(enVenezuela(serie.start_time).hora))}</div>
      <div style="margin-top:7px"><span class="badge b-gris">${esc(enVenezuela(serie.start_time).fecha)} · VET</span> <span class="badge b-red">SIN JUGAR</span></div>`
}
    </div>
  </div>

  <section class="kpis">
    ${kpis}
  </section>

  <section class="mid">
    <section class="card">
      ${cabecera('Marcadores posibles', `Derivado de p = ${pct(p)}% por partida`)}
      ${filasMarcadores}
      <div class="spie">${calificada ? 'Fila tintada = marcador que de verdad pasó · barra relativa al más probable' : 'Barra relativa al más probable · TODAVÍA NO PASÓ NINGUNO'}</div>
    </section>

    <section class="card">
      ${cabecera('De dónde sale', 'Elo al momento de predecir')}
      <div class="drow"><span class="fnom">${escudoDe(serie.equipo_a)}${esc(nombreA)}</span><span class="dval">${Math.round(ratingA)}</span></div>
      <div class="drow"><span class="fnom">${escudoDe(serie.equipo_b)}${esc(nombreB)}</span><span class="dval">${Math.round(ratingB)}</span></div>
      <div class="drow"><span class="dlab">Diferencia → p por partida</span><span class="dval neutro">${diferencia >= 0 ? '+' : '−'}${Math.abs(Math.round(diferencia))}</span></div>
      <div class="forma">
        <div class="dlab">Forma antes de la serie · más reciente a la izquierda</div>
        <div class="frm" style="margin-top:12px"><span class="fnom">${escudoDe(serie.equipo_a)}${esc(nombreA)}</span><span style="display:flex;gap:4px">${forma(formaA)}</span></div>
        <div class="frm"><span class="fnom">${escudoDe(serie.equipo_b)}${esc(nombreB)}</span><span style="display:flex;gap:4px">${forma(formaB)}</span></div>
      </div>
    </section>
  </section>

  <div class="narr">${esc(narrativa)}</div>

  <footer>
    Los marcadores salen de la misma p de partida que produjo la predicción guardada (se recupera
    invirtiendo la fórmula del formato), así que no agregan ningún supuesto nuevo: la suma de los
    marcadores de cada equipo da exactamente su probabilidad de serie. Los ratings Elo están
    reconstruidos con partidas anteriores al momento en que se hizo la predicción, nunca con lo que
    pasó después.
  </footer>`;

  return documento({
    titulo: `${nombreA} vs ${nombreB} · Monitor Dota 2`,
    sidebar: barraDota({ dondeEstoy: 'ficha' }),
    contenido,
  });
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
  const fuerzas = EQUIPOS_TI2026.map((e) => ({ teamId: e.teamId, nombre: e.nombre, rating: ratingDeEquipo(r, e.teamId) })).sort(
    (a, b) => b.rating - a.rating,
  );

  const metricas = calcularMetricas(calificadas);
  const generadoEn = fechaYHora(new Date().toISOString()) + ' VET';

  const seriesLiga = seriesDeLaLiga(partidasLiga);
  // Se destacan los equipos de la última jornada jugada, para que la grilla
  // diga de un vistazo quién se movió hoy.
  const ultima = calificadas.length ? calificadas[calificadas.length - 1].start_time : null;
  const destacados = new Set();
  if (ultima) {
    const desde = new Date(ultima).getTime() - 8 * 3600 * 1000;
    for (const c of calificadas) {
      if (new Date(c.start_time).getTime() < desde) continue;
      destacados.add(c.equipo_a);
      destacados.add(c.equipo_b);
    }
  }

  // El panel principal (index.html) lo genera salida/web/dashboard.mjs, que es
  // multijuego. Este archivo se quedó con lo que sigue siendo suyo: las FICHAS
  // por serie de Dota, que necesitan reconstruir los ratings al momento de la
  // predicción y no tienen equivalente en los otros juegos.
  //
  // El panel viejo se guarda como dota.html: sigue teniendo cosas que el
  // dashboard nuevo no muestra (fuerzas Elo de los 16, grilla del suizo, llave
  // del Main Event) y las fichas enlazan a él.
  // Los escudos salen de datos/logos-dota.json, no de la API: se leen del
  // disco en cada corrida y no cuestan ninguna petición (regla 5). Para
  // refrescarlos: node --env-file=.env scripts/logos-dota.mjs
  const logos = cargarLogos();

  const html = construirHtml({ calificadas, pendientes, nombre, metricas, fuerzas, generadoEn, seriesLiga, destacados, logos });
  const destino = new URL('./dota.html', import.meta.url);
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
      logos,
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

  const assets = await copiarAssets(new URL('./assets/', import.meta.url));
  if (!assets.copiado) console.warn(`  (sin assets: ${assets.razon})`);

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
