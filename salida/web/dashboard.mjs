// Panel principal, con el diseño nuevo (web.html) cableado a datos REALES.
//
// QUÉ SE DEJÓ FUERA DEL DISEÑO, Y POR QUÉ
//
// El mock traía partes que hoy no se pueden llenar sin inventar:
//
//   gráfico de 30 días      necesita historial; hay 6 calificadas en CS2,
//   sparklines, deltas      2 en LoL, 0 en Valorant. Un delta de "+12.3% vs
//                           el período anterior" sobre 2 partidas es un
//                           número que parece decir algo y no dice nada.
//   filtro por región       bo3.gg no trae región.
//   "Futuros Torneos"       con fases y equipos: no se guarda esa estructura.
//   PREMIUM / Upgrade       cobro y multiusuario están prohibidos hasta que
//                           el Brier le gane a la base de forma concluyente
//                           (ver CLAUDE.md). Montar el escaparate de algo que
//                           todavía no se sabe si sirve sería al revés.
//
// Todo eso aparece solo cuando haya con qué. Nada de recuadros en cero
// fingiendo ser un dato.
//
// Los logos oficiales van INCRUSTADOS como data URI, no enlazados. Las URLs
// del mock (Wikipedia Special:FilePath) estaban rotas: dos 404, una 429 y la
// que respondía 200 devolvía HTML en vez de una imagen (verificado el
// 2026-08-18). Los SVG buenos salieron de Wikimedia Commons y pesan entre
// 900 B y 7 KB, menos que la petición de red que se ahorran.
//
// Si algún archivo de logos/ falta, se cae al cuadro de color con iniciales:
// un logo ausente no puede tumbar el panel.

import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seleccionar } from '../../datos/supabase.mjs';
import { datosDeEquipos, nombresDeTorneos } from '../../datos/juegos/bo3.mjs';
import { enVenezuela, hora12 } from '../formato.mjs';

// Mismo criterio que salida/resumen-global.mjs: los Brier de Dota y los de
// bo3.gg NO están en la misma escala (Dota puntúa sobre tres clases). Cada
// juego se muestra contra SU base.
const BASE_DOTA = { bo1: 0.5, bo2: 2 / 3, bo3: 0.5, bo5: 0.5 };
const BASE_ESLO = 0.25;
const MINIMO_POR_JUEGO = 275;

const JUEGOS = [
  { clave: 'dota2', nombre: 'Dota 2', corto: 'D2', color: '#ef4444' },
  { clave: 'lol', nombre: 'League of Legends', corto: 'LoL', color: '#3b82f6' },
  { clave: 'valorant', nombre: 'Valorant', corto: 'VAL', color: '#f43f5e' },
  { clave: 'cs2', nombre: 'Counter-Strike 2', corto: 'CS2', color: '#f59e0b' },
];


// Los logos oficiales se INCRUSTAN como data URI al generar, no se enlazan.
// Las URLs del mock (Wikipedia Special:FilePath) devolvian 404 en dos casos y
// 429 en otro, verificado el 2026-08-18: enlazarlas dejaria huecos justo
// cuando Wikimedia limite por tasa. Incrustados, el panel no depende de nadie
// al abrirse y funciona sin conexion.
//
// Son SVG de Wikimedia Commons, entre 900 B y 7 KB: pesan menos que una
// peticion de red.
const LOGOS = new Map();
for (const clave of ['dota2', 'lol', 'valorant', 'cs2']) {
  try {
    const svg = readFileSync(new URL(`./logos/${clave}.svg`, import.meta.url), 'utf8');
    LOGOS.set(clave, 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64'));
  } catch {
    // Sin el archivo se cae al cuadro de color con iniciales. Un logo que
    // falta no puede tumbar el panel.
  }
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const pct1 = (x) => (x * 100).toFixed(1);

function fechaCorta(iso) {
  const { fecha, valida } = enVenezuela(iso);
  if (!valida) return '—';
  const [a, m, d] = fecha.split('-');
  return `${d}/${m}/${a}`;
}

// --- piezas ------------------------------------------------------------------

function logo(corto, color, tam = 26, clave = null) {
  const src = clave ? LOGOS.get(clave) : null;
  if (src) {
    return `<img class="lg" width="${tam}" height="${tam}" src="${src}" alt="${esc(corto)}">`;
  }
  return `<span class="ph" style="width:${tam}px;height:${tam}px;background:${color}1f;color:${color};border-color:${color}59">${esc(corto)}</span>`;
}

function kpi({ etiqueta, valor, color, pie, dash }) {
  const donut =
    dash == null
      ? ''
      : `<svg class="donut" viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="26"/><circle class="prog" cx="32" cy="32" r="26" stroke-dasharray="${dash.toFixed(1)} 999"/></svg>`;
  return `
    <div class="kpi" style="--ac:${color};--ac12:${color}14;--ac18:${color}2e;--ac25:${color}4d">
      <div class="kpi-top"><div class="kpi-label">${esc(etiqueta)}</div>${donut}</div>
      <div class="kpi-num">${esc(valor)}</div>
      <div class="kpi-foot">${pie}</div>
    </div>`;
}

function filaJuego(j) {
  const { def, n, aciertos, predichas, vsBase } = j;
  if (n === 0) {
    return `
      <div class="stat-row">
        <div class="tile">${logo(def.corto, def.color, 38, def.clave)}</div>
        <div class="stat-name">${esc(def.nombre)}</div>
        <div><div class="pct dim">—</div><div class="frac">${predichas} predichas · 0 calificadas</div></div>
        <div class="spark"><span class="delta dim">sin datos</span></div>
      </div>`;
  }
  const tasa = aciertos / n;
  return `
    <div class="stat-row">
      <div class="tile">${logo(def.corto, def.color, 38, def.clave)}</div>
      <div class="stat-name">${esc(def.nombre)}</div>
      <div>
        <div class="pct">${pct1(tasa)}%</div>
        <div class="frac">${aciertos} / ${n} calificadas</div>
        <div class="bar"><i style="width:${(tasa * 100).toFixed(1)}%;background:${def.color}"></i></div>
      </div>
      <div class="spark">
        <span class="delta" style="color:${vsBase < 0 ? 'var(--green)' : 'var(--red)'}">${vsBase < 0 ? '' : '+'}${(vsBase * 100).toFixed(0)}% vs base</span>
        <span class="frac">${n}/${MINIMO_POR_JUEGO} para concluir</span>
      </div>
    </div>`;
}


// Escudo del equipo: el logo real si bo3.gg lo trae, y si no las iniciales.
// Antes SIEMPRE eran las tres primeras letras del nombre, que para "PCI" o
// "JUS" no dice absolutamente nada.
function escudo(nombre, logo, color) {
  const abrev = String(nombre ?? '?').slice(0, 3).toUpperCase();
  if (logo) {
    return `<img class="tmlogo" src="${esc(logo)}" width="26" height="26" alt="${esc(abrev)}" title="${esc(nombre)}" loading="lazy">`;
  }
  return `<span class="tm" style="background:${color}" title="${esc(nombre)}">${esc(abrev)}</span>`;
}

function filaPartida(p) {
  const ganoA = p.resultadoReal === 'ganaA';
  const marcador =
    p.marcadorA == null
      ? '<span class="sep">—</span>'
      : `<span class="${ganoA ? 'w' : 'l'}">${p.marcadorA}</span><span class="sep">-</span><span class="${ganoA ? 'l' : 'w'}">${p.marcadorB}</span>`;

  const cuota = p.cuota == null ? '—' : p.cuota.toFixed(2);
  return `
    <div class="trow">
      <div class="t-cell">
        <div class="ttile">${logo(p.def.corto, p.def.color, 26, p.def.clave)}</div>
        <div title="${esc(p.torneo ?? p.def.nombre)}"><div class="t-name">${esc(p.torneo ?? p.def.nombre)}</div><div class="t-sub">${esc(p.def.nombre)}${p.tier ? ' · TIER ' + String(p.tier).toUpperCase() : ''}</div></div>
      </div>
      <div class="match">
        ${escudo(p.nombreA, p.logoA, p.def.color)}
        ${marcador}
        ${escudo(p.nombreB, p.logoB, p.def.color + '99')}
      </div>
      <span class="fecha">${esc(fechaCorta(p.inicio))}</span>
      <span><span class="badge ${p.acerto ? 'b-green' : 'b-red'}">${esc(cuota)}</span></span>
      <span><span class="res ${p.acerto ? 'b-green' : 'b-red'}">${p.acerto ? 'ACERTÓ' : 'FALLÓ'}</span></span>
    </div>`;
}

function tablaPartidas(titulo, color, icono, filas) {
  const cuerpo = filas.length
    ? filas.map(filaPartida).join('')
    : `<div class="vacio">Todavía no hay partidas calificadas acá.</div>`;
  return `
    <div class="card">
      <div class="card-h">
        <span class="hdot" style="background:${color}26">${icono}</span>
        <span class="card-title">${esc(titulo)}</span>
      </div>
      <div class="thead"><span>Juego</span><span>Encuentro</span><span>Fecha</span><span>Cuota</span><span>Resultado</span></div>
      ${cuerpo}
    </div>`;
}

// --- documento ---------------------------------------------------------------

export function construirDashboard({ juegos, recientes, generadoEn }) {
  const conDatos = juegos.filter((j) => j.n > 0);
  const totalCalificadas = conDatos.reduce((s, j) => s + j.n, 0);
  const totalAciertos = conDatos.reduce((s, j) => s + j.aciertos, 0);
  const totalPredichas = juegos.reduce((s, j) => s + j.predichas, 0);
  const tasa = totalCalificadas ? totalAciertos / totalCalificadas : 0;

  const aciertos = recientes.filter((p) => p.acerto).slice(0, 6);
  const fallos = recientes.filter((p) => !p.acerto).slice(0, 6);

  const botonesJuego = juegos
    .map(
      (j) => `
      <div class="game-btn" style="border-color:${j.def.color}59">
        <span class="gwrap">${logo(j.def.corto, j.def.color, 28, j.def.clave)}</span>
        <span>${esc(j.def.nombre)}</span>
        <span class="gcount">${j.n || '—'}</span>
      </div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MONITOR-ESPORTS · Panel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#05080c; --side:#070b10; --card:#0c141d; --card2:#0a121b;
  --border:#1b2634; --text:#e5eaf1; --mut:#94a0b0; --dim:#5d6a7a;
  --green:#22c55e; --red:#ef4444; --blue:#3b82f6; --yellow:#f59e0b;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);font-size:14px;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:#1c2733;border-radius:4px}

/* Placa clara detras del logo: varios SVG oficiales estan pensados para
   fondo blanco y algunos son casi negros (CS2 usa #1E202F), asi que sobre el
   panel oscuro desaparecian. */
.lg{border-radius:6px;object-fit:contain;background:#e9edf3;padding:3px;flex:none}
.ph{display:inline-flex;align-items:center;justify-content:center;border-radius:7px;border:1px solid;font-size:8px;font-weight:800;letter-spacing:.02em;flex:none}

#sidebar{position:fixed;inset:0 auto 0 0;width:232px;background:var(--side);border-right:1px solid var(--border);padding:20px 14px;display:flex;flex-direction:column;gap:6px;z-index:50}
.brand{display:flex;align-items:center;gap:10px;padding:2px 6px 18px}
.brand-icon{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;flex:none}
.brand b{font-size:16px;font-weight:800;display:block;line-height:1.1}
.brand span{font-size:9px;font-weight:700;letter-spacing:.35em;color:var(--blue)}
.side-label{font-size:10px;font-weight:700;letter-spacing:.15em;color:var(--dim);padding:16px 8px 8px;border-top:1px solid var(--border);margin-top:12px}
.game-btn{display:flex;align-items:center;gap:11px;width:100%;padding:11px 12px;border-radius:10px;background:#0a121b;border:1px solid;font-size:11px;font-weight:800;letter-spacing:.04em;color:var(--text);margin-bottom:8px}
.gcount{margin-left:auto;color:var(--dim);font-weight:700}
.side-note{margin-top:auto;font-size:11px;color:var(--dim);line-height:1.6;border-top:1px solid var(--border);padding-top:14px}

main{margin-left:232px;padding:22px 26px}
.topbar{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.topbar h1{font-size:22px;font-weight:800}
.topbar .sub{color:var(--mut);font-size:12px;margin-top:3px}
.stamp{margin-left:auto;color:var(--dim);font-size:11px}

.card{background:var(--card);border:1px solid var(--border);border-radius:12px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:16px}
.kpi{padding:18px 20px;display:flex;flex-direction:column;gap:12px;background:linear-gradient(180deg,var(--ac12),transparent 65%),var(--card);border:1px solid var(--ac25);border-radius:12px}
.kpi-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.kpi-label{font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--mut);text-transform:uppercase;padding-top:6px}
.kpi-num{font-size:32px;font-weight:800;letter-spacing:-.02em}
.donut{width:62px;height:62px;flex:none;transform:rotate(-90deg)}
.donut .track{fill:none;stroke:var(--ac18);stroke-width:6}
.donut .prog{fill:none;stroke:var(--ac);stroke-width:6;stroke-linecap:round}
.kpi-foot{border-top:1px solid var(--border);padding-top:12px;display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--mut);margin-top:auto;flex-wrap:wrap}
.kpi-foot b{color:var(--text)}

.aviso{margin-top:16px;border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.07);border-radius:12px;padding:14px 18px;font-size:13px;line-height:1.6;color:#fcd9a0}
.aviso b{color:#fbbf24}

.mid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.ancho{margin-top:16px}
@media(max-width:1100px){.mid{grid-template-columns:1fr}}
.card-h{display:flex;align-items:center;gap:10px;padding:15px 20px;border-bottom:1px solid var(--border)}
.card-title{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.hdot{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none}
.hdot svg{width:13px;height:13px}
.stat-row{display:grid;grid-template-columns:52px 1fr 1fr 130px;gap:14px;align-items:center;padding:15px 20px;border-top:1px solid var(--border)}
.stat-row:first-of-type{border-top:none}
.tile{width:52px;height:52px;border-radius:10px;background:#101a26;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex:none}
.stat-name{font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;line-height:1.3}
.pct{font-size:17px;font-weight:800}
.pct.dim{color:var(--dim)}
.frac{font-size:11px;color:var(--dim);margin-top:2px}
.bar{height:4px;background:#1a2532;border-radius:4px;margin-top:8px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:4px}
.spark{display:flex;flex-direction:column;align-items:flex-end;gap:3px;text-align:right}
.delta{font-size:11px;font-weight:800}
.delta.dim{color:var(--dim);font-weight:600}

.thead,.trow{display:grid;grid-template-columns:1.4fr 1.2fr .8fr .55fr .8fr;gap:10px;align-items:center;padding:10px 20px}
.thead{font-size:9.5px;font-weight:700;letter-spacing:.12em;color:var(--dim);text-transform:uppercase;border-bottom:1px solid var(--border)}
.trow{padding:12px 20px;border-top:1px solid var(--border)}
.trow:first-of-type{border-top:none}
.t-cell{display:flex;align-items:center;gap:8px;min-width:0}
.ttile{width:38px;height:38px;border-radius:8px;background:#101a26;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex:none}
.t-name{font-size:12px;font-weight:700;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t-cell>div:last-child{min-width:0;overflow:hidden}
.t-sub{font-size:9px;color:var(--dim);letter-spacing:.08em;text-transform:uppercase;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.match{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800}
.tm{width:30px;height:24px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;flex:none}
/* Logo de equipo: se enlaza al CDN de bo3.gg. Si falla, el navegador muestra
   el alt con las iniciales.
   Placa OSCURA, al reves que la de los juegos: los escudos de esports estan
   pensados para fondo oscuro y muchos son blancos -- sobre la placa clara
   desaparecian. Los logos de JUEGO son al reves (CS2 es casi negro), por eso
   cada uno lleva la suya. */
.tmlogo{width:26px;height:26px;border-radius:6px;object-fit:contain;background:#151f2b;border:1px solid var(--border);padding:2px;flex:none;font-size:8px;color:var(--mut)}
.match .w{color:#fff}.match .l{color:var(--dim)}.match .sep{color:var(--dim);font-weight:600}
.fecha{font-size:11px;color:var(--mut)}
.badge{display:inline-block;padding:4px 8px;border-radius:6px;font-size:10px;font-weight:800}
.b-green{background:rgba(34,197,94,.12);color:var(--green)}
.b-red{background:rgba(239,68,68,.12);color:#f87171}
.res{font-size:9.5px;font-weight:800;letter-spacing:.08em;padding:5px 9px;border-radius:6px}
.vacio{padding:26px 20px;color:var(--dim);font-size:12px;text-align:center}

footer{margin-top:20px;padding:16px 20px;border-top:1px solid var(--border);color:var(--dim);font-size:11px;line-height:1.7}
@media(max-width:900px){#sidebar{display:none}main{margin-left:0;padding:16px}}
</style>
</head>
<body>

<aside id="sidebar">
  <div class="brand">
    <div class="brand-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg></div>
    <div><b>MONITOR</b><span>ESPORTS</span></div>
  </div>

  <div class="side-label">JUEGOS · CALIFICADAS</div>
  ${botonesJuego}

  <div class="side-label">DETALLE</div>
  <a class="game-btn" href="dota.html" style="border-color:#ef444459;text-decoration:none">
    <span class="gwrap">${logo("D2", "#ef4444", 28, "dota2")}</span>
    <span>PANEL DE DOTA</span>
  </a>

  <div class="side-note">
    Los porcentajes salen de un cálculo matemático sobre los resultados reales.
    Ningún número de este panel se escribe a mano.
  </div>
</aside>

<main>
  <header class="topbar">
    <div><h1>Panel</h1><div class="sub">Cómo va el motor contra la realidad</div></div>
    <div class="stamp">Generado ${esc(generadoEn)}</div>
  </header>

  <section class="kpis">
    ${kpi({
      etiqueta: 'Acierto global',
      valor: totalCalificadas ? `${pct1(tasa)}%` : '—',
      color: '#22c55e',
      dash: totalCalificadas ? (tasa * 163.4) : 0,
      pie: `<span><b>${totalAciertos}</b> de ${totalCalificadas} calificadas</span>`,
    })}
    ${kpi({
      etiqueta: 'Predicciones vivas',
      valor: String(totalPredichas - totalCalificadas),
      color: '#3b82f6',
      pie: `<span>de <b>${totalPredichas}</b> hechas en total</span>`,
    })}
    ${kpi({
      etiqueta: 'Juegos monitoreados',
      valor: String(juegos.length),
      color: '#a855f7',
      pie: `<span><b>${conDatos.length}</b> con resultados</span>`,
    })}
    ${kpi({
      etiqueta: 'Muestra para concluir',
      valor: `${totalCalificadas}/${MINIMO_POR_JUEGO}`,
      color: '#f59e0b',
      dash: Math.min(1, totalCalificadas / MINIMO_POR_JUEGO) * 163.4,
      pie: `<span>hace falta por <b>cada juego</b></span>`,
    })}
  </section>

  <div class="aviso">
    <b>Estos números todavía no dicen nada.</b> Hacen falta ~${MINIMO_POR_JUEGO} partidas calificadas
    <b>por juego</b> para que el resultado deje de ser compatible con el azar, y el que más lleva
    va por ${Math.max(0, ...juegos.map((j) => j.n))}. Sumar los cuatro juegos no cuenta: son motores calibrados por separado.
  </div>

  <section class="card ancho">
    <div class="card-h"><span class="card-title">Por juego</span></div>
    ${juegos.map(filaJuego).join('')}
  </section>

  <section class="mid">
    ${tablaPartidas(
      'Acertadas',
      '#22c55e',
      '<svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3"><path d="m5 13 4 4L19 7"/></svg>',
      aciertos,
    )}
    ${tablaPartidas(
      'Falladas',
      '#ef4444',
      '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3"><path d="M6 6l12 12M18 6 6 18"/></svg>',
      fallos,
    )}
  </section>

  <footer>
    El <b>% vs base</b> es lo único comparable entre juegos: negativo significa mejor que adivinar.
    Los Brier crudos NO son comparables entre sí — Dota puntúa sobre tres clases (con empate) y los
    demás sobre una, así que sus escalas son distintas.<br>
    La <b>cuota</b> es la mejor disponible en el mercado al momento de predecir, no la de una sola casa.
    Se guarda para poder medirse contra el mercado; este panel no apuesta ni recomienda apostar.
  </footer>
</main>

</body>
</html>
`;
}

// --- datos -------------------------------------------------------------------

export async function reunirDatos({ fetchImpl, fetchImplSupabase } = {}) {
  const [eslo, dotaPred, dotaSeries, teamsDota, cuotas] = await Promise.all([
    seleccionar('eslo_predicciones', '?select=*&order=match_id.asc', { fetchImpl: fetchImplSupabase }),
    seleccionar('dota_predictions', '?select=*&order=series_id.asc', { fetchImpl: fetchImplSupabase }),
    seleccionar('dota_series', '?select=*&order=series_id.asc', { fetchImpl: fetchImplSupabase }),
    seleccionar('dota_teams', '?select=*&order=team_id.asc', { fetchImpl: fetchImplSupabase }),
    seleccionar('eslo_cuotas', '?select=*&order=capturado_en.asc,match_id.asc', { fetchImpl: fetchImplSupabase }),
  ]);

  // La cuota que vale es la ÚLTIMA antes del saque, y la mejor del mercado si
  // está (max_coeff); si no, la del proveedor.
  const cuotaPorPartida = new Map();
  for (const c of cuotas) cuotaPorPartida.set(c.match_id, c);

  const serieDota = new Map(dotaSeries.map((s) => [s.series_id, s]));
  const nombreDota = new Map(teamsDota.map((t) => [t.team_id, t.nombre]));

  const juegos = [];
  const recientes = [];

  for (const def of JUEGOS) {
    if (def.clave === 'dota2') {
      const calificadas = dotaPred.filter((p) => p.resultado_real && p.brier != null);
      const aciertos = calificadas.filter(
        (p) => (Number(p.prob_gana_a) >= Number(p.prob_gana_b) ? 'ganaA' : 'ganaB') === p.resultado_real,
      );
      const brier = calificadas.length
        ? calificadas.reduce((s, p) => s + Number(p.brier), 0) / calificadas.length
        : 0;
      const base = calificadas.length
        ? calificadas.reduce((s, p) => s + (BASE_DOTA[serieDota.get(p.series_id)?.formato] ?? 0.5), 0) /
          calificadas.length
        : 0.5;

      juegos.push({
        def,
        predichas: dotaPred.length,
        n: calificadas.length,
        aciertos: aciertos.length,
        vsBase: base ? (brier - base) / base : 0,
      });

      for (const p of calificadas) {
        const s = serieDota.get(p.series_id);
        if (!s) continue;
        const favA = Number(p.prob_gana_a) >= Number(p.prob_gana_b);
        recientes.push({
          def,
          inicio: s.start_time,
          nombreA: nombreDota.get(s.equipo_a) ?? `#${s.equipo_a}`,
          nombreB: nombreDota.get(s.equipo_b) ?? `#${s.equipo_b}`,
          marcadorA: s.victorias_a,
          marcadorB: s.victorias_b,
          resultadoReal: p.resultado_real,
          acerto: (favA ? 'ganaA' : 'ganaB') === p.resultado_real,
          formato: s.formato,
          torneo: s.league_name ?? null,
          tier: null,
          cuota: null,
        });
      }
      continue;
    }

    const suyas = eslo.filter((p) => p.juego === def.clave);
    const calificadas = suyas.filter((p) => p.resultado_real && p.brier != null);
    const aciertos = calificadas.filter((p) => (Number(p.prob_a) >= 0.5) === (p.resultado_real === 'ganaA'));
    const brier = calificadas.length
      ? calificadas.reduce((s, p) => s + Number(p.brier), 0) / calificadas.length
      : 0;

    juegos.push({
      def,
      predichas: suyas.length,
      n: calificadas.length,
      aciertos: aciertos.length,
      vsBase: calificadas.length ? (brier - BASE_ESLO) / BASE_ESLO : 0,
    });

    for (const p of calificadas) {
      const c = cuotaPorPartida.get(p.match_id);
      const favA = Number(p.prob_a) >= 0.5;
      recientes.push({
        def,
        juego: def.clave,
        equipoA: p.equipo_a,
        equipoB: p.equipo_b,
        inicio: p.inicio_programado,
        marcadorA: p.marcador_a,
        marcadorB: p.marcador_b,
        resultadoReal: p.resultado_real,
        acerto: favA === (p.resultado_real === 'ganaA'),
        formato: p.formato,
        torneoId: p.torneo_id,
        tier: p.tier,
        // La mejor del mercado si está; si no, la del proveedor.
        cuota: c ? Number(c.max_coeff_a ?? c.coeff_a) : null,
      });
    }
  }

  // Nombres de equipo de bo3.gg, por juego (el endpoint está acotado por
  // disciplina: sin el filtro devuelve vacío para todo lo que no sea CS2).
  for (const def of JUEGOS) {
    if (def.clave === 'dota2') continue;
    const suyas = recientes.filter((p) => p.juego === def.clave);
    if (suyas.length === 0) continue;
    const equipos = await datosDeEquipos(suyas.flatMap((p) => [p.equipoA, p.equipoB]), {
      juego: def.clave,
      fetchImpl,
    });
    for (const p of suyas) {
      const a = equipos.get(p.equipoA);
      const b = equipos.get(p.equipoB);
      p.nombreA = a?.nombre ?? `#${p.equipoA}`;
      p.nombreB = b?.nombre ?? `#${p.equipoB}`;
      p.logoA = a?.logo ?? null;
      p.logoB = b?.logo ?? null;
    }

    // El torneo se resuelve por id, en una petición por juego. Se guarda el id
    // y no el nombre para no congelarlo ni duplicarlo (ver
    // sql/migracion-torneo.sql).
    const torneos = await nombresDeTorneos(suyas.map((p) => p.torneoId), { juego: def.clave, fetchImpl });
    for (const p of suyas) p.torneo = torneos.get(p.torneoId) ?? null;
  }

  recientes.sort((a, b) => new Date(b.inicio) - new Date(a.inicio));

  const { fecha, hora, valida } = enVenezuela(new Date().toISOString());
  return {
    juegos,
    recientes,
    generadoEn: valida ? `${fecha} · ${hora12(hora)} VET` : '—',
  };
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  const datos = await reunirDatos();
  const destino = new URL('./index.html', import.meta.url);
  await writeFile(destino, construirDashboard(datos), 'utf8');
  const conDatos = datos.juegos.filter((j) => j.n > 0);
  console.log(`panel generado: ${datos.juegos.length} juegos, ${conDatos.reduce((s, j) => s + j.n, 0)} calificadas`);
}
