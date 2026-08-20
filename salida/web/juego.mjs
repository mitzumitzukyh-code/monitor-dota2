// Páginas por juego de los juegos de bo3.gg (CS2, LoL, Valorant) y sus
// fichas por partida. Dota tiene dota.html + serie-*.html (salida/web/
// generar.mjs) porque su historia es distinta: nació primero y su panel
// reconstruye los ratings replayeando el histórico. Estos juegos no
// necesitan nada de eso: los ratings con los que se predijo (rating_a,
// rd_a, ...), el ranking de fuerza, el torneo y la cuota ya están GUARDADOS
// en Supabase (tablas eslo_*), así que esta página sólo los pinta — no
// recalcula, no vuelve a pedir lo que ya existe (regla 5).
//
// Un solo generador para los tres juegos: se corre con las claves en los
// argumentos y comparte las lecturas de Supabase entre todos.
//
//   node --env-file=.env salida/web/juego.mjs cs2 lol valorant
//
// Genera una página por juego (cs2.html, lol.html, valorant.html) y una
// ficha por partida predicha, calificada o pendiente (partida-<id>.html).
// Todo sale de salida/web/estilo.mjs, el mismo sistema visual que el panel
// principal y el de Dota: no hay un tercer diseño acá.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { seleccionar } from '../../datos/supabase.mjs';
import { datosDeEquipos, nombresDeTorneos } from '../../datos/juegos/bo3.mjs';
import { probabilidadGanar } from '../../motor/glicko2.mjs';
import { enVenezuela, hora12 } from '../formato.mjs';
import { esc, logo, escudo, kpi, cabecera, documento, barraLateral, copiarAssets } from './estilo.mjs';

// Los tres juegos que se generan acá. Dota no entra: su página y sus fichas
// son de salida/web/generar.mjs, con otra fuente (OpenDota) y otro motor
// (Elo). `oscuro` es la versión profunda del color para la barra de
// probabilidad, como el #7f1d1d que usa el panel de Dota.
export const JUEGOS = [
  { clave: 'lol', nombre: 'League of Legends', corto: 'LoL', color: '#3b82f6', oscuro: '#1e3a8a', pagina: 'lol.html' },
  { clave: 'valorant', nombre: 'Valorant', corto: 'VAL', color: '#f43f5e', oscuro: '#881337', pagina: 'valorant.html' },
  { clave: 'cs2', nombre: 'Counter-Strike 2', corto: 'CS2', color: '#f59e0b', oscuro: '#78350f', pagina: 'cs2.html' },
];

// Base ingenua de los juegos de bo3.gg: una sola clase (gana A o gana B),
// sin empate. Brier de adivinar = (0.5-1)² + (0.5-0)² = 0.25. No depende
// del formato: el match de bo3.gg se predice y se califica como una
// observación binaria, pase lo que pase con el bo_type.
export const BASE_ESLO = 0.25;

// Cuántos equipos entran en el ranking de fuerza. CS2 tiene 4.031 con
// rating: listarlos todos no es ranking, es un volcado.
const CANTIDAD_RANKING = 20;

function pct(x) {
  return (x * 100).toFixed(1);
}

function fechaYHora(iso) {
  const { fecha, hora, valida } = enVenezuela(iso);
  return valida ? `${fecha} · ${hora12(hora)}` : '—';
}

// Los match_id son bigint, pero el saneado no cuesta: un id con un carácter
// raro no puede escapar del directorio ni romper el archivo en Windows.
export function archivoDeFicha(matchId) {
  return 'partida-' + String(matchId).replace(/[^a-zA-Z0-9._-]/g, '-') + '.html';
}

// Favorito del motor: prob_a >= 0.5 (prob_b = 1 - prob_a, así que ese corte
// es lo mismo que comparar los dos).
function favoritoEsA(p) {
  return Number(p.prob_a) >= 0.5;
}

// Mismas métricas que el panel de Dota (juez/calcularMetricas en
// salida/web/generar.mjs), pero con base fija 0.25: acá no hay formatos con
// empate, así que la base no se pondera por formato.
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

  const aciertos = calificadas.filter((c) => (favoritoEsA(c) ? 'ganaA' : 'ganaB') === c.resultado_real).length;
  const mejoresQueBase = calificadas.filter((c) => Number(c.brier) < BASE_ESLO).length;

  return {
    n,
    media,
    mediana,
    sd,
    ee,
    baseMedia: BASE_ESLO,
    ic95: [media - 1.96 * ee, media + 1.96 * ee],
    // Con n chico el intervalo se come la base: decirlo es parte del trabajo.
    concluyente: !(BASE_ESLO >= media - 1.96 * ee && BASE_ESLO <= media + 1.96 * ee),
    aciertos,
    mejoresQueBase,
  };
}

// Desglose por torneo: cuántas calificadas, cuántas acertadas y Brier medio
// de cada uno. La unidad de la página es el torneo — a diferencia de Dota,
// que tiene uno solo (TI2026) —, así que esto es lo que responde "¿en qué
// torneos sirve y en cuáles no?". Ordenados por la partida más reciente de
// cada torneo: los torneos activos arriba, los viejos abajo.
export function agruparPorTorneo(calificadas, nombres = new Map()) {
  const porTorneo = new Map();
  for (const c of calificadas) {
    const id = c.torneo_id ?? null;
    const g = porTorneo.get(id) ?? { torneoId: id, tier: c.tier ?? null, n: 0, aciertos: 0, briers: [], partidas: [] };
    g.n++;
    g.briers.push(Number(c.brier));
    g.partidas.push(c);
    if ((favoritoEsA(c) ? 'ganaA' : 'ganaB') === c.resultado_real) g.aciertos++;
    porTorneo.set(id, g);
  }

  return [...porTorneo.values()]
    .map((g) => ({
      torneoId: g.torneoId,
      nombre: g.torneoId != null ? (nombres.get(g.torneoId) ?? `#${g.torneoId}`) : 'Sin torneo',
      tier: g.tier,
      n: g.n,
      aciertos: g.aciertos,
      brier: g.briers.reduce((s, x) => s + x, 0) / g.n,
      partidas: g.partidas.sort((a, b) => String(a.inicio_programado).localeCompare(String(b.inicio_programado))),
    }))
    .sort((a, b) => {
      const ultimaA = a.partidas[a.partidas.length - 1].inicio_programado;
      const ultimaB = b.partidas[b.partidas.length - 1].inicio_programado;
      return String(ultimaB).localeCompare(String(ultimaA));
    });
}

// --- barra lateral, la misma en la página del juego y en sus fichas --------

function barraEsports(juego, { calificadas = new Map(), dondeEstoy = 'panel' } = {}) {
  // Los cuatro juegos navegan a su página. Dota va sin contador: este
  // generador no carga sus datos (viven en tablas dota_*, otro motor), y un
  // número que no se conoce no se inventa.
  const enlaces = [
    { href: 'dota.html', texto: 'Dota 2 · TI2026', color: '#ef4444', logoHtml: logo('D2', '#ef4444', 28, 'dota2') },
    ...JUEGOS.map((j) => ({
      href: j.pagina,
      texto: j.nombre,
      color: j.color,
      contador: calificadas.get(j.clave) || null,
      logoHtml: logo(j.corto, j.color, 28, j.clave),
    })),
  ];

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
        etiqueta: 'Juegos · calificadas',
        enlaces: enlaces.map((e) => ({ ...e, activo: e.href === juego.pagina && dondeEstoy === 'panel' })),
      },
    ],
    nota: 'Los porcentajes salen del Glicko-2 (motor/glicko2.mjs) calibrado contra el histórico de bo3.gg. Cada predicción guarda el rating y la RD con los que se hizo y nunca se reescribe.',
  });
}

// --- piezas de la página ----------------------------------------------------

// Una partida calificada: los dos equipos con su probabilidad, el marcador
// real, el Brier y el veredicto. Toda la fila enlaza a su ficha.
function filaCalificada(c, juego, nombre, escudoDe) {
  const pa = Number(c.prob_a);
  const pb = Number(c.prob_b);
  const favA = pa >= 0.5;
  const acerto = (favA ? 'ganaA' : 'ganaB') === c.resultado_real;
  const brier = Number(c.brier);
  const peor = brier > BASE_ESLO;
  const marcador = `${c.marcador_a ?? '-'}–${c.marcador_b ?? '-'}`;
  const ganador = c.resultado_real === 'ganaA' ? nombre(c.equipo_a) : nombre(c.equipo_b);
  const contexto = [c.torneo_id ? `torneo ${c.torneo_id}` : '', c.tier ? `tier ${String(c.tier).toUpperCase()}` : '']
    .filter(Boolean)
    .join(' · ');

  const lado = (id, prob, esFav, gano) => `
        <div class="slado">
          <span class="sfav">${esFav ? '▶' : ''}</span>
          ${escudoDe(id)}
          <span class="sname${gano ? ' gano' : ''}">${esc(nombre(id))}</span>
          <span class="sprob">${pct(prob)}%</span>
        </div>`;

  return `
      <a class="srow${peor ? ' mala' : ''}" href="${esc(archivoDeFicha(c.match_id))}" title="${esc(contexto || 'Ver la ficha de esta partida')}" style="--ac:${juego.color}">
        <div>
          ${lado(c.equipo_a, pa, favA, c.resultado_real === 'ganaA')}
          ${lado(c.equipo_b, pb, !favA, c.resultado_real === 'ganaB')}
          <div class="sbar"><i style="width:${pct(pa)}%;background:${juego.color}"></i><i style="width:${pct(pb)}%;background:${juego.oscuro}"></i></div>
        </div>
        <div>
          <div class="smarc">${esc(marcador)}</div>
          <div class="sgan">${esc(ganador)}</div>
        </div>
        <div class="sbrier" style="color:${peor ? '#f87171' : 'var(--text)'}">${brier.toFixed(3)}</div>
        <div class="sver"><span class="res ${acerto ? 'b-green' : 'b-red'}">${acerto ? 'ACERTÓ' : 'FALLÓ'}</span></div>
      </a>`;
}

// Una partida predicha que todavía no se juega: hay predicción y hora, no
// hay resultado ni juicio.
function filaPendiente(p, juego, nombre, escudoDe) {
  const pa = Number(p.prob_a);
  const pb = Number(p.prob_b);
  const favA = pa >= 0.5;
  const contexto = [p.torneo_id ? `torneo ${p.torneo_id}` : '', p.tier ? `tier ${String(p.tier).toUpperCase()}` : '']
    .filter(Boolean)
    .join(' · ');

  const lado = (id, prob, esFav) => `
        <div class="slado">
          <span class="sfav">${esFav ? '▶' : ''}</span>
          ${escudoDe(id)}
          <span class="sname">${esc(nombre(id))}</span>
          <span class="sprob">${pct(prob)}%</span>
        </div>`;

  return `
      <a class="srow" href="${esc(archivoDeFicha(p.match_id))}" title="${esc(contexto || 'Ver la ficha de esta partida')}" style="--ac:${juego.color};grid-template-columns:minmax(0,1fr) 96px">
        <div>
          ${lado(p.equipo_a, pa, favA)}
          ${lado(p.equipo_b, pb, !favA)}
          <div class="sbar"><i style="width:${pct(pa)}%;background:${juego.color}"></i><i style="width:${pct(pb)}%;background:${juego.oscuro}"></i></div>
        </div>
        <div style="text-align:right">
          <div class="smarc">${esc(hora12(enVenezuela(p.inicio_programado).hora))}</div>
          <div class="sgan">${esc(String(p.formato ?? '').toUpperCase())}</div>
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

// --- la página de un juego --------------------------------------------------

export function construirPagina({
  juego,
  calificadas,
  pendientes,
  torneos,
  ranking,
  totalEquipos,
  nombre,
  logos = new Map(),
  metricas,
  generadoEn,
}) {
  const escudoDe = (id) => escudo(nombre(id), logos.get(id), juego.color, 22);
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
      pie: m.n ? `<span><b>${m.mejoresQueBase}</b> de ${m.n} partidas bajo la base</span>` : '',
      nota: 'Menos sensible a un upset suelto que la media',
    }),
    kpi({
      etiqueta: 'Favorito acertado',
      valor: m.n ? pct(m.aciertos / m.n) : '—',
      sufijo: m.n ? '%' : '',
      color: '#22c55e',
      dash: m.n ? (m.aciertos / m.n) * 163.4 : 0,
      pie: m.n ? `<span><b>${m.aciertos}</b> de ${m.n} partidas</span>` : '',
      nota: 'El más probable de los dos ganó la partida',
    }),
    kpi({
      etiqueta: 'Partidas calificadas',
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
    ? calificadas.map((c) => filaCalificada(c, juego, nombre, escudoDe)).join('')
    : vacio('Todavía no hay partidas calificadas. Aparecen acá en cuanto una partida predicha termina y el ciclo la cruza contra el resultado real de bo3.gg.');

  const cuerpoPendientes = pendientes.length
    ? pendientes.map((p) => filaPendiente(p, juego, nombre, escudoDe)).join('')
    : vacio('Ninguna partida próxima predicha. En cuanto el calendario publique una con los dos equipos definidos, el ciclo la predice antes de que empiece.');

  // Desglose por torneo: una fila por torneo con sus números. La grid es la
  // misma de las tablas del panel (.thead/.trow), así no hay un tercer layout.
  const filasTorneos = torneos.length
    ? torneos
        .map((t) => {
          const peor = t.brier > BASE_ESLO;
          return `
      <div class="trow">
        <div class="t-cell"><div class="t-name">${esc(t.nombre)}</div><div class="t-sub">${t.n} ${t.n === 1 ? 'partida calificada' : 'partidas calificadas'}</div></div>
        <div>${t.tier ? `<span class="badge b-gris">TIER ${esc(String(t.tier).toUpperCase())}</span>` : '<span class="badge b-gris">—</span>'}</div>
        <div><div class="pct">${t.n}</div><div class="frac">calificadas</div></div>
        <div><div class="pct">${pct(t.aciertos / t.n)}%</div><div class="frac">${t.aciertos} de ${t.n} acertadas</div></div>
        <div style="text-align:right"><div class="pct" style="color:${peor ? '#f87171' : 'var(--green)'}">${t.brier.toFixed(4)}</div><div class="frac">vs 0.250 base</div></div>
      </div>`;
        })
        .join('')
    : vacio('Sin partidas calificadas no hay desglose por torneo que mostrar.');

  const filasRanking = ranking.length
    ? ranking
        .map(
          (r, i) => `
      <div class="frow rd">
        <span class="fpos">${i + 1}</span>
        <span class="fnom">${escudoDe(r.teamId)}${esc(r.nombre)}</span>
        <span class="frat">${Math.round(r.rating)}</span>
        <span class="fnum">±${Math.round(r.rd)}</span>
        <span class="fnum">${r.partidas}</span>
      </div>`,
        )
        .join('')
    : vacio('Sin equipos con rating todavía.');

  const lectura = m.n
    ? peorQueBase
      ? `El motor va por encima de la base ingenua (${m.media.toFixed(4)} contra ${m.baseMedia.toFixed(3)}): en esta muestra está prediciendo peor que tirar una moneda. Con n=${m.n} el intervalo de confianza contiene la base, así que el resultado no distingue entre "el motor no sirve" y "mala suerte". La mediana (${m.mediana.toFixed(4)}) y las ${m.mejoresQueBase} de ${m.n} partidas por debajo de la base apuntan al otro lado: la media está arrastrada por los upsets, no por un sesgo parejo. La evidencia con peso es el backtest histórico (motor/glicko2.mjs calibrado por juego), no estas ${m.n}.`
      : `El motor va por debajo de la base ingenua en esta muestra (${m.media.toFixed(4)} contra ${m.baseMedia.toFixed(3)}). Con n=${m.n} todavía es poca cosa: la evidencia con peso es el backtest histórico, no estas ${m.n} partidas.`
    : 'Sin partidas calificadas todavía, no hay nada que juzgar.';

  const contenido = `
  <header class="topbar">
    <div><h1>${esc(juego.nombre)}</h1><div class="sub">Glicko-2 · bo3.gg</div></div>
    <div class="stamp">Generado ${esc(generadoEn)}</div>
  </header>

  <section class="kpis">
    ${kpis}
  </section>

  <div class="aviso${peorQueBase ? ' rojo' : ''}">${esc(lectura)}</div>

  <section class="card ancho">
    ${cabecera('Por torneo', `${torneos.length} ${torneos.length === 1 ? 'torneo' : 'torneos'} con calificadas`)}
    <div class="thead"><span>Torneo</span><span>Tier</span><span>Calificadas</span><span>Aciertos</span><span>Brier medio</span></div>
    ${filasTorneos}
  </section>

  <section class="mid">
    ${tarjetaSeccion(
      'Partidas calificadas',
      `${m.n} ${m.n === 1 ? 'partida' : 'partidas'} · ▶ = favorito del motor`,
      cuerpoCalificadas,
      calificadas.length ? 'Fila tintada = Brier por encima de su base ingenua (0.25)' : '',
    )}
    <div>
      ${tarjetaSeccion(
        'Próximas partidas predichas',
        `${pendientes.length} ${pendientes.length === 1 ? 'partida' : 'partidas'}`,
        cuerpoPendientes,
      )}
      <div class="ancho">
        ${tarjetaSeccion(
          'Fuerza · top ' + ranking.length + ' de ' + totalEquipos,
          'Rating y RD al momento de generar',
          `
        <div class="fhead"><span>#</span><span>Equipo</span><span>Rating</span><span>RD</span><span>Partidas</span></div>
        ${filasRanking}`,
        )}
      </div>
    </div>
  </section>

  <footer>
    Los porcentajes salen del Glicko-2 (motor/glicko2.mjs) calibrado contra el histórico de bo3.gg. Cada predicción
    guarda el rating y la RD con los que se hizo y nunca se reescribe después de guardarse. El Brier es de una sola
    clase: (p − real)² con p la probabilidad predicha de la partida; la base ingenua es 0.25. El rating del ranking
    es el estado actual del Glicko-2; RD es la incertidumbre de esa estimación.
  </footer>`;

  return documento({
    titulo: `MONITOR-ESPORTS · ${juego.nombre}`,
    pagina: juego.pagina,
    // Los cuatro logos van en el CSS: la barra lateral de estas páginas
    // navega entre todos los juegos, así que un logo que falta se vería
    // como una placa clara vacía (el span se dibuja, la imagen no).
    imagen: 'og-image.png',
    descripcion: `Predicciones de ${juego.nombre} calificadas partida por partida contra el resultado real de bo3.gg. Brier, favorito acertado, desglose por torneo y ranking de fuerza.`,
    sidebar: barraEsports(juego, { calificadas: new Map(JUEGOS.map((j) => [j.clave, null])), dondeEstoy: 'panel' }),
    contenido,
  });
}

// --- la ficha de una partida ------------------------------------------------

export function construirFicha({
  partida,
  juego,
  nombre,
  logos = new Map(),
  cuota = null,
  nombreTorneo = null,
  generadoEn,
}) {
  const nombreA = nombre(partida.equipo_a);
  const nombreB = nombre(partida.equipo_b);
  const pa = Number(partida.prob_a);
  const pb = Number(partida.prob_b);
  const favA = pa >= 0.5;

  const calificada = Boolean(partida.resultado_real);
  const brier = calificada ? Number(partida.brier) : null;
  const acerto = calificada && (favA ? 'ganaA' : 'ganaB') === partida.resultado_real;
  const marcadorReal =
    calificada && partida.marcador_a != null && partida.marcador_b != null
      ? `${partida.marcador_a}–${partida.marcador_b}`
      : null;

  // El estado congelado al predecir. Con él se REPRODUCE la probabilidad
  // guardada (probabilidadGanar usa rating y rd, no vol): así la ficha
  // demuestra de dónde salió el número en vez de repetirlo.
  const tieneEstado =
    partida.rating_a != null && partida.rd_a != null && partida.rating_b != null && partida.rd_b != null;
  const pReproducida = tieneEstado
    ? probabilidadGanar(
        { rating: Number(partida.rating_a), rd: Number(partida.rd_a), vol: 0 },
        { rating: Number(partida.rating_b), rd: Number(partida.rd_b), vol: 0 },
      )
    : null;
  const reproduceGuardada = pReproducida != null && Math.abs(pReproducida - pa) < 1e-9;

  // La mejor del mercado si está; si no, la del proveedor (mismo criterio
  // que el panel principal).
  const cuotaA = cuota ? Number(cuota.max_coeff_a ?? cuota.coeff_a) : null;
  const cuotaB = cuota ? Number(cuota.max_coeff_b ?? cuota.coeff_b) : null;
  const hayCuota = (x) => x != null && Number.isFinite(x) && x > 0;
  const muestraCuota = hayCuota(cuotaA) || hayCuota(cuotaB);

  const escudoDe = (id) => escudo(nombre(id), logos.get(id), juego.color, 26);
  const escudoGrande = (id) => escudo(nombre(id), logos.get(id), juego.color, 40);

  const narrativa = (
    calificada
      ? [
          `El motor daba ${pct(favA ? pa : pb)}% a ${favA ? nombreA : nombreB} y ${acerto ? 'acertó' : 'falló'}.`,
          brier > BASE_ESLO
            ? `El Brier de esta partida (${brier.toFixed(4)}) quedó por encima de su base ingenua (${BASE_ESLO.toFixed(3)}): acá el modelo aportó menos que tirar una moneda.`
            : `El Brier de esta partida (${brier.toFixed(4)}) quedó por debajo de su base ingenua (${BASE_ESLO.toFixed(3)}).`,
        ]
      : [
          `Partida sin jugar: esta predicción ya está guardada y no se va a reescribir, así que cuando termine se puede juzgar contra lo que de verdad pasó.`,
          `El motor da ${pct(favA ? pa : pb)}% a ${favA ? nombreA : nombreB}.`,
        ]
  )
    .concat(
      tieneEstado
        ? [
            `Sale del estado Glicko-2 guardado al predecir: ${nombreA} ${Math.round(Number(partida.rating_a))} ± ${Math.round(Number(partida.rd_a))}, ${nombreB} ${Math.round(Number(partida.rating_b))} ± ${Math.round(Number(partida.rd_b))}.${
              reproduceGuardada
                ? ' Con esos cuatro números se reproduce la predicción guardada: la incertidumbre de los dos equipos se combina, así que una RD alta jala el porcentaje hacia 50%.'
                : ''
            }`,
          ]
        : [`La predicción no trae el estado del rating guardado (predicción anterior a esa columna).`],
    )
    .concat(
      muestraCuota
        ? [`El mercado pagaba ${hayCuota(cuotaA) ? cuotaA.toFixed(2) : '—'} por ${nombreA} y ${hayCuota(cuotaB) ? cuotaB.toFixed(2) : '—'} por ${nombreB}, la mejor disponible al momento de predecir.`]
        : [],
    )
    .filter(Boolean)
    .join(' ');

  const kpis = [
    kpi({
      etiqueta: 'Gana ' + nombreA,
      valor: pct(pa),
      sufijo: '%',
      color: juego.color,
      dash: pa * 163.4,
      nota: calificada && partida.resultado_real === 'ganaA' ? 'ocurrió' : null,
    }),
    kpi({
      etiqueta: 'Gana ' + nombreB,
      valor: pct(pb),
      sufijo: '%',
      color: '#3b82f6',
      dash: pb * 163.4,
      nota: calificada && partida.resultado_real === 'ganaB' ? 'ocurrió' : null,
    }),
    muestraCuota
      ? kpi({
          etiqueta: 'Cuota ' + nombreA,
          valor: hayCuota(cuotaA) ? cuotaA.toFixed(2) : '—',
          color: juego.color,
          nota: 'mejor del mercado al predecir',
        })
      : '',
    muestraCuota
      ? kpi({
          etiqueta: 'Cuota ' + nombreB,
          valor: hayCuota(cuotaB) ? cuotaB.toFixed(2) : '—',
          color: '#3b82f6',
          nota: 'mejor del mercado al predecir',
        })
      : '',
    calificada
      ? kpi({
          etiqueta: 'Brier de la partida',
          valor: brier.toFixed(4),
          color: brier > BASE_ESLO ? '#ef4444' : '#22c55e',
          pie: `<span style="color:${brier > BASE_ESLO ? '#f87171' : 'var(--green)'};font-weight:800">${brier - BASE_ESLO >= 0 ? '+' : '−'}${Math.abs(brier - BASE_ESLO).toFixed(4)}</span><span>vs <b>${BASE_ESLO.toFixed(3)}</b> = base ingenua</span>`,
          alerta: brier > BASE_ESLO,
        })
      : kpi({
          etiqueta: 'Brier de la partida',
          valor: '—',
          color: '#5d6a7a',
          pie: `<span>se calcula al terminar, contra <b>${BASE_ESLO.toFixed(3)}</b></span>`,
          nota: 'la predicción de arriba queda congelada',
        }),
  ]
    .filter(Boolean)
    .join('\n    ');

  const filasEstado = [
    tieneEstado
      ? `
      <div class="drow"><span class="fnom">${escudoDe(partida.equipo_a)}${esc(nombreA)}</span><span class="dval">${Math.round(Number(partida.rating_a))} <span style="font-size:12px;color:var(--mut)">± ${Math.round(Number(partida.rd_a))}</span></span></div>
      <div class="drow"><span class="fnom">${escudoDe(partida.equipo_b)}${esc(nombreB)}</span><span class="dval">${Math.round(Number(partida.rating_b))} <span style="font-size:12px;color:var(--mut)">± ${Math.round(Number(partida.rd_b))}</span></span></div>
      <div class="drow"><span class="dlab">p por partida (Glicko-2, reproducida)</span><span class="dval neutro">${pct(pReproducida)}%</span></div>`
      : `
      <div class="drow"><span class="fnom">${escudoDe(partida.equipo_a)}${esc(nombreA)}</span><span class="dval neutro">—</span></div>
      <div class="drow"><span class="fnom">${escudoDe(partida.equipo_b)}${esc(nombreB)}</span><span class="dval neutro">—</span></div>`,
    `<div class="drow"><span class="dlab">Formato</span><span class="dval neutro">${esc(String(partida.formato ?? '—').toUpperCase())}</span></div>`,
    `<div class="drow"><span class="dlab">Torneo</span><span class="dval neutro">${esc(nombreTorneo ?? '—')}${partida.tier ? ` · <span class="badge b-gris">TIER ${esc(String(partida.tier).toUpperCase())}</span>` : ''}</span></div>`,
  ].join('\n    ');

  const cuerpoMercado = muestraCuota
    ? `
      <div class="drow"><span class="fnom">${escudoDe(partida.equipo_a)}${esc(nombreA)}</span><span class="dval">${hayCuota(cuotaA) ? cuotaA.toFixed(2) : '—'}</span></div>
      <div class="drow"><span class="fnom">${escudoDe(partida.equipo_b)}${esc(nombreB)}</span><span class="dval">${hayCuota(cuotaB) ? cuotaB.toFixed(2) : '—'}</span></div>
      <div class="spie">La mejor del mercado al momento de predecir; sin ella, la del proveedor</div>`
    : vacio('No se capturó cuota para esta partida antes de que empezara.');

  const contenido = `
  <header class="topbar">
    <div>
      <div class="hero-lab">Ficha de partida · ${esc(String(partida.formato ?? '—').toUpperCase())} · ${esc(fechaYHora(partida.inicio_programado))} VET</div>
    </div>
    <div class="stamp">Generado ${esc(generadoEn)}</div>
  </header>

  <div class="hero">
    <h1>
      <span class="heq${calificada && partida.resultado_real !== 'ganaA' ? ' perdio' : ''}">${escudoGrande(partida.equipo_a)}${esc(nombreA)}</span><span class="vs">vs</span><span class="heq${calificada && partida.resultado_real !== 'ganaB' ? ' perdio' : ''}">${escudoGrande(partida.equipo_b)}${esc(nombreB)}</span>
    </h1>
    <div class="hero-lado">
${
  calificada
    ? `      <div class="hero-lab">RESULTADO REAL</div>
      <div class="hero-num">${esc(marcadorReal ?? '—')}</div>
      <div style="margin-top:7px"><span class="res ${acerto ? 'b-green' : 'b-red'}">${acerto ? 'ACERTÓ' : 'FALLÓ'}</span></div>`
    : `      <div class="hero-lab">EMPIEZA</div>
      <div class="hero-num">${esc(hora12(enVenezuela(partida.inicio_programado).hora))}</div>
      <div style="margin-top:7px"><span class="badge b-gris">${esc(enVenezuela(partida.inicio_programado).fecha)} · VET</span> <span class="badge b-red">SIN JUGAR</span></div>`
}
    </div>
  </div>

  <section class="kpis">
    ${kpis}
  </section>

  <section class="mid">
    <section class="card">
      ${cabecera('De dónde sale', 'Glicko-2 al momento de predecir')}
      ${filasEstado}
      <div class="spie">rating y RD congelados en la fila de la predicción: nunca se reescriben</div>
    </section>

    <section class="card">
      ${cabecera('El mercado', 'Cuota al momento de predecir')}
      ${cuerpoMercado}
    </section>
  </section>

  <div class="narr">${esc(narrativa)}</div>

  <footer>
    El porcentaje es el que se guardó al predecir (prob_a, motor/glicko2.mjs) y se reproduce con el estado
    congelado en la fila: la ficha no recalcula nada sobre datos que no existían. El Brier es de una sola clase,
    (p − real)², contra 0.25 de adivinar. La cuota es la mejor del mercado al momento de predecir; este panel no
    apuesta ni recomienda apostar.
  </footer>`;

  return documento({
    titulo: `${nombreA} vs ${nombreB} · ${juego.nombre}`,
    // Igual que la página del juego: la barra lateral muestra los cuatro
    // juegos, así que los cuatro logos van en el CSS de la ficha también.
    sidebar: barraEsports(juego, { dondeEstoy: 'ficha' }),
    contenido,
  });
}

// --- datos y generación -----------------------------------------------------

export async function generarJuegos(claves, { fetchImpl, fetchImplSupabase } = {}) {
  const pedidos = claves.filter((c) => JUEGOS.some((j) => j.clave === c));
  if (pedidos.length === 0) throw new Error('Decir qué juegos generar: cs2, lol, valorant (o varios).');

  // Lecturas compartidas entre los juegos: una sola pasada por tabla, por
  // mucho que se generen los tres (regla 5).
  const [preds, ratingsDb, cuotas] = await Promise.all([
    seleccionar('eslo_predicciones', '?select=*&order=match_id.asc', { fetchImpl: fetchImplSupabase }),
    seleccionar('eslo_ratings', '?select=*&order=juego.asc,team_id.asc', { fetchImpl: fetchImplSupabase }),
    seleccionar('eslo_cuotas', '?select=*&order=capturado_en.asc,match_id.asc', { fetchImpl: fetchImplSupabase }),
  ]);

  // La cuota que vale es la ÚLTIMA captura antes del saque: el Map se
  // sobreescribe y la que queda es la de más abajo del order ascendente.
  const cuotaPorPartida = new Map();
  for (const c of cuotas) cuotaPorPartida.set(c.match_id, c);

  const { fecha, hora, valida } = enVenezuela(new Date().toISOString());
  const generadoEn = valida ? `${fecha} · ${hora12(hora)} VET` : '—';
  const calificadasPorJuego = new Map();

  for (const juego of JUEGOS) {
    if (!pedidos.includes(juego.clave)) continue;

    const suyas = preds.filter((p) => p.juego === juego.clave);
    const calificadas = suyas.filter((p) => p.resultado_real && p.brier != null);
    const pendientes = suyas.filter((p) => !p.resultado_real);
    calificadas.sort((a, b) => String(a.inicio_programado).localeCompare(String(b.inicio_programado)));

    const ids = [...new Set(suyas.flatMap((p) => [p.equipo_a, p.equipo_b]).filter(Boolean))];
    const [equipos, torneosNombres] = await Promise.all([
      datosDeEquipos(ids, { juego: juego.clave, fetchImpl }),
      nombresDeTorneos(suyas.map((p) => p.torneo_id).filter(Boolean), { juego: juego.clave, fetchImpl }),
    ]);
    const nombre = (id) => equipos.get(id)?.nombre ?? `#${id}`;
    const logos = new Map([...equipos].map(([id, e]) => [id, e.logo]));

    const conRating = ratingsDb.filter((r) => r.juego === juego.clave && r.partidas > 0);
    const ranking = conRating
      .slice()
      .sort((a, b) => Number(b.rating) - Number(a.rating) || Number(a.rd) - Number(b.rd))
      .slice(0, CANTIDAD_RANKING)
      .map((r) => ({ teamId: r.team_id, nombre: nombre(r.team_id), rating: Number(r.rating), rd: Number(r.rd), partidas: r.partidas }));

    const metricas = calcularMetricas(calificadas);
    const torneos = agruparPorTorneo(calificadas, torneosNombres);
    calificadasPorJuego.set(juego.clave, metricas.n);

    const html = construirPagina({
      juego,
      calificadas,
      pendientes,
      torneos,
      ranking,
      totalEquipos: conRating.length,
      nombre,
      logos,
      metricas,
      generadoEn,
    });
    await writeFile(new URL('./' + juego.pagina, import.meta.url), html);

    // Una ficha por partida predicha, calificada o pendiente. A diferencia de
    // Dota, no hay que reconstruir ratings: los que se usaron ya están en la
    // fila y la ficha los reproduce (construirFicha), así que ninguna ficha
    // ve información que no existía al predecir (regla 6).
    let fichas = 0;
    for (const p of [...calificadas, ...pendientes]) {
      const ficha = construirFicha({
        partida: p,
        juego,
        nombre,
        logos,
        cuota: cuotaPorPartida.get(p.match_id) ?? null,
        nombreTorneo: torneosNombres.get(p.torneo_id) ?? null,
        generadoEn,
      });
      await writeFile(new URL('./' + archivoDeFicha(p.match_id), import.meta.url), ficha);
      fichas++;
    }

    console.log(`Página de ${juego.clave}: ${juego.pagina}`);
    console.log(`  ${calificadas.length} calificadas, ${pendientes.length} pendientes, ${fichas} fichas, ${ranking.length} en el ranking`);
    if (metricas.n) {
      console.log(`  Brier ${metricas.media.toFixed(4)} vs base ${metricas.baseMedia.toFixed(3)} · concluyente: ${metricas.concluyente ? 'sí' : 'NO (n chico)'}`);
    }
  }

  return { calificadasPorJuego };
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  const claves = process.argv.slice(2);
  generarJuegos(claves)
    .then(async () => {
      const assets = await copiarAssets(new URL('./assets/', import.meta.url));
      if (!assets.copiado) console.warn(`  (sin assets: ${assets.razon})`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}