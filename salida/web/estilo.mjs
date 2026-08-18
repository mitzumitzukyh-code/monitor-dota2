// El sistema visual del panel, en un solo lugar.
//
// POR QUÉ EXISTE
// Había dos diseños distintos conviviendo: el panel principal (index.html)
// con el diseño nuevo, y el panel de Dota + sus fichas todavía con el viejo
// (fondo #171615, IBM Plex Mono, acento naranja, todo con estilos inline).
// Abrir uno después del otro se sentía como entrar a dos sitios distintos.
//
// Ahora los tres documentos —panel principal, panel de Dota y ficha de
// serie— salen de este mismo CSS. Si mañana cambia un color, cambia en los
// tres o no cambia en ninguno: no hay forma de que se separen sin querer.
//
// Nada de esto toca los NÚMEROS. Este módulo sólo sabe de colores, cajas y
// tipografía; de dónde salen los datos es asunto de quien lo llame.

import { readFileSync } from 'node:fs';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const pct1 = (x) => (x * 100).toFixed(1);

// Un color por juego, el mismo en todos los documentos.
export const COLOR = { dota2: '#ef4444', lol: '#3b82f6', valorant: '#f43f5e', cs2: '#f59e0b' };

// Los logos oficiales se INCRUSTAN como data URI al generar, no se enlazan.
// Las URLs del mock (Wikipedia Special:FilePath) devolvían 404 en dos casos y
// 429 en otro, verificado el 2026-08-18: enlazarlas dejaría huecos justo
// cuando Wikimedia limite por tasa. Incrustados, el panel no depende de nadie
// al abrirse y funciona sin conexión.
//
// Son SVG de Wikimedia Commons, entre 900 B y 7 KB: pesan menos que la
// petición de red que se ahorran.
export const LOGOS = new Map();
for (const clave of ['dota2', 'lol', 'valorant', 'cs2']) {
  try {
    const svg = readFileSync(new URL(`./logos/${clave}.svg`, import.meta.url), 'utf8');
    LOGOS.set(clave, 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64'));
  } catch {
    // Sin el archivo se cae al cuadro de color con iniciales. Un logo que
    // falta no puede tumbar el panel.
  }
}

export function logo(corto, color, tam = 26, clave = null) {
  const src = clave ? LOGOS.get(clave) : null;
  if (src) return `<img class="lg" width="${tam}" height="${tam}" src="${src}" alt="${esc(corto)}">`;
  return `<span class="ph" style="width:${tam}px;height:${tam}px;background:${color}1f;color:${color};border-color:${color}59">${esc(corto)}</span>`;
}

// Escudo de equipo: el logo real si la fuente lo trae, y si no las iniciales.
// Dota no tiene logo guardado (dota_teams sólo guarda team_id y nombre), así
// que sus escudos siempre caen a las iniciales -- por eso el parámetro es
// opcional y no un error.
export function escudo(nombre, url, color, tam = 26) {
  const abrev = String(nombre ?? '?').slice(0, 3).toUpperCase();
  if (url) {
    return `<img class="tmlogo" src="${esc(url)}" width="${tam}" height="${tam}" alt="${esc(abrev)}" title="${esc(nombre)}" loading="lazy">`;
  }
  return `<span class="tm" style="background:${color}" title="${esc(nombre)}">${esc(abrev)}</span>`;
}

export const CSS = `
:root{
  --bg:#05080c; --side:#070b10; --card:#0c141d; --card2:#0a121b;
  --border:#1b2634; --text:#e5eaf1; --mut:#94a0b0; --dim:#5d6a7a;
  --green:#22c55e; --red:#ef4444; --blue:#3b82f6; --yellow:#f59e0b;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);font-size:14px;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:#1c2733;border-radius:4px}

/* Placa clara detras del logo del juego: varios SVG oficiales estan pensados
   para fondo blanco y algunos son casi negros (CS2 usa #1E202F), asi que
   sobre el panel oscuro desaparecian. */
.lg{border-radius:6px;object-fit:contain;background:#e9edf3;padding:3px;flex:none}
.ph{display:inline-flex;align-items:center;justify-content:center;border-radius:7px;border:1px solid;font-size:8px;font-weight:800;letter-spacing:.02em;flex:none}

#sidebar{position:fixed;inset:0 auto 0 0;width:232px;background:var(--side);border-right:1px solid var(--border);padding:20px 14px;display:flex;flex-direction:column;gap:6px;z-index:50;overflow-y:auto}
.brand{display:flex;align-items:center;gap:10px;padding:2px 6px 18px}
.brand-icon{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;flex:none}
.brand b{font-size:16px;font-weight:800;display:block;line-height:1.1}
.brand span{font-size:9px;font-weight:700;letter-spacing:.35em;color:var(--blue)}
.side-label{font-size:10px;font-weight:700;letter-spacing:.15em;color:var(--dim);padding:16px 8px 8px;border-top:1px solid var(--border);margin-top:12px}
.game-btn{display:flex;align-items:center;gap:11px;width:100%;padding:11px 12px;border-radius:10px;background:#0a121b;border:1px solid;font-size:11px;font-weight:800;letter-spacing:.04em;color:var(--text);margin-bottom:8px}
.game-btn.activo{background:#101a26}
.gcount{margin-left:auto;color:var(--dim);font-weight:700}
.side-note{margin-top:auto;font-size:11px;color:var(--dim);line-height:1.6;border-top:1px solid var(--border);padding-top:14px}

main{margin-left:232px;padding:22px 26px}
.topbar{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.topbar h1{font-size:22px;font-weight:800}
.topbar .sub{color:var(--mut);font-size:12px;margin-top:3px}
.stamp{margin-left:auto;color:var(--dim);font-size:11px;text-align:right;line-height:1.6}

.card{background:var(--card);border:1px solid var(--border);border-radius:12px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:16px}
.kpi{padding:18px 20px;display:flex;flex-direction:column;gap:12px;background:linear-gradient(180deg,var(--ac12),transparent 65%),var(--card);border:1px solid var(--ac25);border-radius:12px}
.kpi-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.kpi-label{font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--mut);text-transform:uppercase;padding-top:6px}
.kpi-num{font-size:32px;font-weight:800;letter-spacing:-.02em}
.kpi-num small{font-size:18px;font-weight:700;color:var(--mut);margin-left:2px}
.donut{width:62px;height:62px;flex:none;transform:rotate(-90deg)}
.donut .track{fill:none;stroke:var(--ac18);stroke-width:6}
.donut .prog{fill:none;stroke:var(--ac);stroke-width:6;stroke-linecap:round}
.kpi-foot{border-top:1px solid var(--border);padding-top:12px;display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--mut);margin-top:auto;flex-wrap:wrap}
.kpi-foot b{color:var(--text)}
.kpi-nota{font-size:11px;color:var(--dim);line-height:1.5}
.kpi.alerta{border-color:rgba(239,68,68,.45)}
.kpi.alerta .kpi-nota{color:#f87171}

.aviso{margin-top:16px;border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.07);border-radius:12px;padding:14px 18px;font-size:13px;line-height:1.6;color:#fcd9a0}
.aviso b{color:#fbbf24}
.aviso.rojo{border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.07);color:#fca5a5}
.aviso.rojo b{color:#f87171}

.mid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.ancho{margin-top:16px}
@media(max-width:1100px){.mid{grid-template-columns:1fr}}
.card-h{display:flex;align-items:center;gap:10px;padding:15px 20px;border-bottom:1px solid var(--border)}
.card-title{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.card-right{margin-left:auto;font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--dim);text-transform:uppercase;text-align:right}
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
.tm{min-width:30px;height:24px;padding:0 5px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;flex:none}
/* Logo de equipo: se enlaza al CDN de la fuente. Si falla, el navegador
   muestra el alt con las iniciales.
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
.b-gris{background:#131d29;color:var(--mut)}
.res{font-size:9.5px;font-weight:800;letter-spacing:.08em;padding:5px 9px;border-radius:6px}
.vacio{padding:26px 20px;color:var(--dim);font-size:12px;text-align:center;line-height:1.7}

/* --- serie: dos equipos con su probabilidad, barra y veredicto ----------- */
.srow{display:grid;grid-template-columns:minmax(0,1fr) 92px 60px 74px;gap:14px;align-items:center;padding:13px 20px;border-top:1px solid var(--border)}
.srow:first-of-type{border-top:none}
.srow:hover{background:#0a1119}
.srow.mala{background:rgba(239,68,68,.06)}
.srow.mala:hover{background:rgba(239,68,68,.1)}
.slado{display:grid;grid-template-columns:12px minmax(0,1fr) auto;gap:9px;align-items:center;font-size:13px}
.slado+.slado{margin-top:5px}
.sfav{font-size:9px;color:var(--ac,var(--red))}
.sname{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mut)}
.sname.gano{color:var(--text);font-weight:700}
.sprob{font-weight:800;font-variant-numeric:tabular-nums}
.sbar{display:flex;height:5px;margin-top:9px;border-radius:4px;overflow:hidden;background:#1a2532}
.sbar i{display:block;height:100%}
.smarc{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums}
.sgan{font-size:10px;color:var(--dim);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sbrier{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;text-align:right}
.sver{text-align:right}
.spie{padding:11px 20px 16px;font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--dim);text-transform:uppercase;border-top:1px solid var(--border)}

/* --- ranking de fuerza --------------------------------------------------- */
.frow{display:grid;grid-template-columns:24px minmax(0,1fr) 64px;gap:12px;align-items:center;padding:9px 20px;border-top:1px solid var(--border);font-size:13px}
.frow:first-of-type{border-top:none}
.fpos{font-size:11px;color:var(--dim);font-weight:700;font-variant-numeric:tabular-nums}
.fnom{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.frat{text-align:right;font-weight:800;font-variant-numeric:tabular-nums;color:var(--red)}

/* --- ficha de serie ------------------------------------------------------ */
.hero{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:18px}
.hero h1{font-size:clamp(22px,3.4vw,34px);font-weight:800;letter-spacing:-.02em;line-height:1.15}
.hero .vs{color:var(--red);margin:0 6px}
.hero .perdio{color:var(--dim)}
.hero-lado{text-align:right;flex:none}
.hero-lab{font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--dim);text-transform:uppercase}
.hero-num{font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:2px}
.mrow{display:grid;grid-template-columns:54px minmax(0,1fr) 110px 62px;gap:12px;align-items:center;padding:10px 20px;border-top:1px solid var(--border)}
.mrow:first-of-type{border-top:none}
.mrow.real{background:rgba(239,68,68,.1)}
.mmarc{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--mut)}
.mrow.real .mmarc{color:var(--text)}
.mbar{height:8px;background:#1a2532;border-radius:4px;overflow:hidden}
.mbar i{display:block;height:100%;border-radius:4px;background:rgba(239,68,68,.42)}
.mrow.real .mbar i{background:var(--red)}
.mquien{font-size:11px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mprob{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;text-align:right}
.drow{display:grid;grid-template-columns:minmax(0,1fr) 76px;gap:12px;align-items:center;padding:12px 20px;border-top:1px solid var(--border)}
.drow:first-of-type{border-top:none}
.dlab{font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--dim);text-transform:uppercase}
.dval{text-align:right;font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--red)}
.dval.neutro{color:var(--text);font-size:14px}
.forma{padding:14px 20px;border-top:1px solid var(--border)}
.frm{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;margin-top:9px}
.frm:first-of-type{margin-top:0}
.pill{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:5px;font-size:10px;font-weight:800}
.pill.v{background:var(--green);color:#04140a}
.pill.d{background:#131d29;color:var(--dim);border:1px solid var(--border)}
.narr{margin-top:16px;border:1px solid var(--border);background:var(--card);border-radius:12px;padding:16px 20px;font-size:13px;line-height:1.7;color:#c3cddb}

footer{margin-top:20px;padding:16px 20px;border-top:1px solid var(--border);color:var(--dim);font-size:11px;line-height:1.7}
.scroll{overflow-x:auto}
@media(max-width:900px){#sidebar{display:none}main{margin-left:0;padding:16px}}
`;

const ICONO_MARCA = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>`;

// Barra lateral. `bloques` es una lista de { etiqueta, enlaces }, y cada
// enlace { href, texto, logoHtml, color, contador, activo }. El panel
// principal la usa para los cuatro juegos; el de Dota, para volver.
export function barraLateral({ bloques = [], nota = '' } = {}) {
  const secciones = bloques
    .map(({ etiqueta, enlaces }) => {
      const items = enlaces
        .map((e) => {
          // Sin href se dibuja como caja, no como enlace: un <a> que no lleva
          // a ningún lado se ve igual de pulsable y no hace nada.
          const etiquetaHtml = e.href ? 'a' : 'div';
          const atrHref = e.href ? ` href="${esc(e.href)}"` : '';
          return `
  <${etiquetaHtml} class="game-btn${e.activo ? ' activo' : ''}"${atrHref} style="border-color:${e.color}59">
    <span class="gwrap">${e.logoHtml}</span>
    <span>${esc(e.texto)}</span>
    ${e.contador == null ? '' : `<span class="gcount">${esc(e.contador)}</span>`}
  </${etiquetaHtml}>`;
        })
        .join('');
      return `  <div class="side-label">${esc(etiqueta)}</div>${items}`;
    })
    .join('\n');

  return `<aside id="sidebar">
  <a class="brand" href="index.html">
    <div class="brand-icon">${ICONO_MARCA}</div>
    <div><b>MONITOR</b><span>ESPORTS</span></div>
  </a>

${secciones}

  <div class="side-note">${nota}</div>
</aside>`;
}

// El documento entero. Todo lo que se publica pasa por acá, así que ningún
// panel puede quedarse con una tipografía o un fondo distinto.
export function documento({ titulo, sidebar, contenido }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(titulo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>

${sidebar}

<main>
${contenido}
</main>

</body>
</html>
`;
}

// Tarjeta de número grande. `dash` dibuja el anillo (163.4 = la
// circunferencia del círculo de r=26 del SVG, así que dash = fracción*163.4).
export function kpi({ etiqueta, valor, sufijo = '', color, pie = '', dash, nota, alerta = false }) {
  const donut =
    dash == null
      ? ''
      : `<svg class="donut" viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="26"/><circle class="prog" cx="32" cy="32" r="26" stroke-dasharray="${dash.toFixed(1)} 999"/></svg>`;
  return `
    <div class="kpi${alerta ? ' alerta' : ''}" style="--ac:${color};--ac12:${color}14;--ac18:${color}2e;--ac25:${color}4d">
      <div class="kpi-top"><div class="kpi-label">${esc(etiqueta)}</div>${donut}</div>
      <div class="kpi-num">${esc(valor)}${sufijo ? `<small>${esc(sufijo)}</small>` : ''}</div>
      ${pie ? `<div class="kpi-foot">${pie}</div>` : ''}
      ${nota ? `<div class="kpi-nota">${esc(nota)}</div>` : ''}
    </div>`;
}

// Cabecera de tarjeta: título a la izquierda, contexto a la derecha.
export function cabecera(titulo, derecha = '', icono = '', color = '#3b82f6') {
  return `<div class="card-h">
        ${icono ? `<span class="hdot" style="background:${color}26">${icono}</span>` : ''}
        <span class="card-title">${esc(titulo)}</span>
        ${derecha ? `<span class="card-right">${esc(derecha)}</span>` : ''}
      </div>`;
}
