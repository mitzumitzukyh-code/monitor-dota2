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
import { cp } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

// Dónde vive el sitio publicado. Hace falta para las tarjetas sociales:
// og:image y twitter:image TIENEN que ser URL absolutas o WhatsApp, X,
// Discord y Telegram no muestran nada (lo dice assets/README.md y es cierto).
// Verificado el 2026-08-19 con una petición real: la página responde 200.
//
// Ojo con el SUBDIRECTORIO: el sitio es .../monitor-esports/, no la raíz del
// dominio. Por eso todo lo demás —favicon, manifest, iconos— va con ruta
// RELATIVA. Las rutas absolutas que traía assets/head-snippet.html
// (`/assets/favicon.svg`) apuntarían a mitzumitzukyh-code.github.io/assets/,
// que no existe.
export const SITIO = (process.env.SITIO_URL ?? 'https://mitzumitzukyh-code.github.io/monitor-esports').replace(/\/+$/, '');

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
// PARA CAMBIAR UN LOGO: pon el archivo en salida/web/logos/ con el nombre del
// juego (dota2, lol, valorant, cs2) y vuelve a generar. No hay que tocar
// código. Se prueban estas extensiones EN ORDEN y gana la primera que exista,
// así que un .png puesto al lado de un .svg no lo pisa: hay que borrar el
// .svg o el .svg sigue mandando.
//
// El orden pone SVG primero a propósito: escala sin pixelarse y suele pesar
// menos. Un PNG de 500x500 puede pesar 100 KB para dibujarse a 26 px.
const FORMATOS = [
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
];

export const LOGOS = new Map();
for (const clave of ['dota2', 'lol', 'valorant', 'cs2']) {
  for (const [extension, tipo] of FORMATOS) {
    try {
      // Se lee como binario siempre: un SVG es texto pero base64 no distingue,
      // y así el mismo camino sirve para PNG.
      const datos = readFileSync(new URL(`./logos/${clave}${extension}`, import.meta.url));
      LOGOS.set(clave, `data:${tipo};base64,` + datos.toString('base64'));
      break;
    } catch {
      // Sin el archivo se prueba la extensión siguiente, y si no hay ninguna
      // se cae al cuadro de color con iniciales. Un logo que falta no puede
      // tumbar el panel.
    }
  }
}

export function logo(corto, color, tam = 26, clave = null) {
  const src = clave ? LOGOS.get(clave) : null;
  if (src) return `<img class="lg" width="${tam}" height="${tam}" src="${src}" alt="${esc(corto)}">`;
  return `<span class="ph" style="width:${tam}px;height:${tam}px;background:${color}1f;color:${color};border-color:${color}59">${esc(corto)}</span>`;
}

// Escudo de equipo: el logo real si la fuente lo trae, y si no las iniciales.
// CS2, LoL y Valorant salen de bo3.gg (/teams -> image_url); Dota, de
// datos/logos-dota.json (OpenDota). La URL es opcional a propósito: un equipo
// nuevo sin escudo todavía se dibuja con sus iniciales en vez de romper.
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
.game-btn.activo{background:#101a26;box-shadow:inset 3px 0 0 var(--gc,currentColor)}
.game-btn.pulsable{cursor:pointer;font-family:inherit;text-align:left}
.game-btn.pulsable:hover{background:#101a26}
/* Fila oculta por el filtro de juego. Se oculta con CSS y no borrando del
   DOM para que volver a "todos" no cueste nada.
   La clase .primera la pone el script sobre la primera fila VISIBLE: la raya
   arriba de cada fila y la de mas arriba no debe llevarla, pero con el filtro
   puesto esa ya no es la primera del HTML. */
.trow[hidden],.stat-row[hidden],.vacio[hidden]{display:none}
.trow.primera,.stat-row.primera{border-top:none}
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

.nota-filtro{margin-top:12px;font-size:12px;color:var(--mut);line-height:1.6;padding:10px 14px;border-left:3px solid var(--blue);background:#0a121b;border-radius:0 8px 8px 0}
.nota-filtro b{color:var(--text)}
.nota-filtro[hidden]{display:none}
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
.slado{display:grid;grid-template-columns:12px 22px minmax(0,1fr) auto;gap:9px;align-items:center;font-size:13px}
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
.fnom{min-width:0;display:flex;align-items:center;gap:9px;overflow:hidden;white-space:nowrap}
.fnom>img,.fnom>span{flex:none}
.frat{text-align:right;font-weight:800;font-variant-numeric:tabular-nums;color:var(--red)}

/* --- ficha de serie ------------------------------------------------------ */
.hero{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:18px}
.hero h1{font-size:clamp(20px,3vw,32px);font-weight:800;letter-spacing:-.02em;line-height:1.15;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.heq{display:flex;align-items:center;gap:11px}
.heq .tmlogo,.heq .tm{width:40px;height:40px}
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
/* En el telefono la barra pasa a ser una tira arriba, con los juegos como
   fichas que se acomodan solas. Antes se escondia entera (display:none), y
   con eso desaparecian el filtro por juego y el enlace al panel de Dota: en
   un telefono no habia forma de llegar a ninguno de los dos. */
@media(max-width:900px){
  #sidebar{position:static;width:auto;display:block;overflow:visible;padding:14px 16px;border-right:none;border-bottom:1px solid var(--border)}
  #sidebar .side-label{border-top:none;margin-top:0;padding:12px 2px 8px}
  #sidebar .game-btn{display:inline-flex;width:auto;margin:0 8px 8px 0}
  .side-note{margin-top:6px}
  main{margin-left:0;padding:16px}
}
`;

// La marca sale del paquete de assets (assets/logo-mark-simple.svg), no de un
// SVG escrito a mano acá: así el cuadrito del panel y el favicon son el mismo
// dibujo. Se incrusta como data URI —pesa 821 B— para que no dependa de una
// petición más ni de que la carpeta assets/ esté publicada.
//
// Si el archivo no está, se cae al rayo dibujado a mano de siempre: una marca
// que falta no puede tumbar el panel.
const RAYO_DE_RESPALDO = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>`;

const ICONO_MARCA = (() => {
  try {
    const svg = readFileSync(new URL('../../assets/logo-mark-simple.svg', import.meta.url), 'utf8');
    const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
    return `<img src="${uri}" width="38" height="38" alt="" style="display:block;border-radius:10px">`;
  } catch {
    return RAYO_DE_RESPALDO;
  }
})();

// Barra lateral. `bloques` es una lista de { etiqueta, enlaces }, y cada
// enlace { href, texto, logoHtml, color, contador, activo }. El panel
// principal la usa para los cuatro juegos; el de Dota, para volver.
export function barraLateral({ bloques = [], nota = '' } = {}) {
  const secciones = bloques
    .map(({ etiqueta, enlaces }) => {
      const items = enlaces
        .map((e) => {
          // Tres formas, y la diferencia importa:
          //   href     -> enlace de verdad, va a otra página
          //   filtro   -> botón que filtra ESTA página sin recargar
          //   ninguno  -> caja muerta; se dibuja como caja, no como enlace,
          //               porque un <a> que no lleva a ningún lado se ve
          //               igual de pulsable y no hace nada.
          const etiquetaHtml = e.href ? 'a' : e.filtro ? 'button' : 'div';
          const atrHref = e.href ? ` href="${esc(e.href)}"` : '';
          const atrFiltro = e.filtro ? ` type="button" data-filtro="${esc(e.filtro)}"` : '';
          return `
  <${etiquetaHtml} class="game-btn${e.filtro ? ' pulsable' : ''}${e.activo ? ' activo' : ''}"${atrHref}${atrFiltro} style="border-color:${e.color}59;--gc:${e.color}">
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

// Iconos, manifest y tarjeta social. Sale de assets/head-snippet.html, con
// dos correcciones obligadas por dónde se publica de verdad el sitio:
//
//   1. RUTAS RELATIVAS, no `/assets/...`. El sitio vive en un subdirectorio
//      (.../monitor-esports/), así que una ruta absoluta se va a la raíz del
//      dominio y da 404.
//   2. og:image y twitter:image SÍ absolutas, con SITIO delante: una ruta
//      relativa ahí y ninguna red social muestra la tarjeta.
//
// `pagina` es el archivo (index.html / dota.html) para armar canonical y
// og:url. Las fichas de serie no llevan tarjeta social: son cientos y
// ninguna se comparte suelta.
function cabeza({ titulo, descripcion, pagina, imagen }) {
  const social = pagina
    ? `
<link rel="canonical" href="${esc(SITIO)}/${esc(pagina)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MONITOR-ESPORTS">
<meta property="og:locale" content="es_VE">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:url" content="${esc(SITIO)}/${esc(pagina)}">
<meta property="og:image" content="${esc(SITIO)}/assets/${esc(imagen)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="MONITOR-ESPORTS: el motor predice, la realidad califica.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(titulo)}">
<meta name="twitter:description" content="${esc(descripcion)}">
<meta name="twitter:image" content="${esc(SITIO)}/assets/${esc(imagen)}">`
    : '';

  return `<link rel="icon" href="assets/favicon.ico" sizes="32x32">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="manifest" href="assets/site.webmanifest">
<meta name="theme-color" content="#05080c">
<meta name="apple-mobile-web-app-title" content="Monitor">
<meta name="description" content="${esc(descripcion)}">${social}`;
}

// El documento entero. Todo lo que se publica pasa por acá, así que ningún
// panel puede quedarse con una tipografía, un fondo o un favicon distinto.
export function documento({
  titulo,
  sidebar,
  contenido,
  descripcion = 'Panel de predicciones de esports (Dota 2, LoL, Valorant, CS2) calificadas partida por partida contra el resultado real. No apuesta ni recomienda apostar.',
  pagina = null,
  imagen = 'og-image.png',
}) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(titulo)}</title>
${cabeza({ titulo, descripcion, pagina, imagen })}
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

// Copia assets/ al directorio que se publica y corrige el manifest.
//
// El artefacto de Pages es SÓLO salida/web (ver el workflow), así que lo que
// se quede en la raíz del repo no llega al sitio. Se copia al generar en vez
// de versionar una segunda copia: el original manda y no hay dos verdades.
//
// El manifest del paquete trae rutas absolutas (`/assets/icon-192.png`,
// `start_url: /index.html`). Bajo un subdirectorio eso apunta a la raíz del
// dominio, así que se reescribe relativo al vuelo. No se toca el archivo
// original.
// Lo que NO se publica. Son archivos del paquete que sirven para trabajar con
// la marca, no para que los pida un navegador: publicarlos sólo engorda el
// sitio. brand-preview.png solo pesa más que todos los iconos juntos.
const NO_SE_PUBLICAN = new Set(['brand-preview.png', 'README.md', 'head-snippet.html']);

export async function copiarAssets(destino) {
  const origen = new URL('../../assets/', import.meta.url);
  try {
    await cp(origen, destino, {
      recursive: true,
      // Devolver false salta el archivo. El directorio raíz siempre pasa, si
      // no, no se copiaría nada.
      filter: (ruta) => !NO_SE_PUBLICAN.has(basename(ruta)),
    });
  } catch (e) {
    // Sin assets el panel se ve igual: pierde favicon y tarjeta social, no
    // datos. No vale tumbar la generación por esto.
    return { copiado: false, razon: e.message };
  }

  try {
    const manifest = JSON.parse(readFileSync(new URL('site.webmanifest', destino), 'utf8'));
    manifest.start_url = './index.html';
    manifest.scope = './';
    manifest.icons = manifest.icons.map((i) => ({ ...i, src: String(i.src).replace(/^\/assets\//, './') }));
    await writeFile(new URL('site.webmanifest', destino), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  } catch {
    // El manifest es lo menos crítico del paquete: si no se pudo arreglar,
    // el resto de los iconos sigue funcionando.
  }

  return { copiado: true };
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
