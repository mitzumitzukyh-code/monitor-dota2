// Genera el panel a partir de `disenio.dc.html`, el archivo que sale de
// claude.ai/design tal cual.
//
//   node salida/web/generar.mjs
//
// Escribe:
//   index.html        el panel: Inicio, Predicciones, Clasificación,
//                     Calidad, Cambios y las cuatro estáticas
//   serie-<id>.html   la ficha de cada una de las últimas series juzgadas,
//                     con URL propia y compartible
//
// No necesita credenciales: todo sale de datos/historico.json, versionado.
//
// EL DISEÑO NO SE TOCA. Si hay que cambiar un color o una caja, se cambia en
// claude.ai/design, se baja el archivo encima de disenio.dc.html y se vuelve
// a generar. Ver CLAUDE.md, "La interfaz web: un solo diseño, y es este".

import { readFile, writeFile, readdir, unlink, mkdir, copyFile } from 'node:fs/promises';
import { resumen } from './datos.mjs';
import { valores, C } from './valores.mjs';
import { renderizar, partesDelDisenio, envolverVista, esc } from './plantilla.mjs';

const AQUI = new URL('./', import.meta.url);
const RAIZ = new URL('../../', import.meta.url);
const FICHAS = 60; // cuántas series recientes llevan página propia

// Marca real del repo. El diseño apunta a ./logo-monitor.png, que no está en
// este proyecto; el logotipo bueno vive en assets/.
async function logoIncrustado() {
  // El mark solo: el diseño ya pone "MONITOR eSPORTS" en texto al lado, y el
  // logotipo horizontal trae el nombre dentro — juntos se ve duplicado.
  for (const nombre of ['logo-mark.svg', 'logo-mark-simple.svg']) {
    try {
      const svg = await readFile(new URL(`assets/${nombre}`, RAIZ), 'utf8');
      return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
    } catch { /* siguiente */ }
  }
  return null;
}

// Lo que el diseño resuelve con `style-hover` y con su runtime, acá va como
// CSS de verdad. Es lo único que se agrega al estilo del diseño.
const ESTILO_EXTRA = `
  html { background: ${C.fondo}; }
  body { min-width: 1440px; }
  [data-accion] { cursor: pointer; }
  [data-accion]:hover { filter: brightness(1.18); }
  [data-vista][hidden] { display: none !important; }
  a { color: inherit; text-decoration: none; }
  /* Foco visible: el diseño no trae ninguno y sin esto el panel no se puede
     recorrer con el teclado. */
  [data-accion]:focus-visible { outline: 2px solid ${C.acento}; outline-offset: 2px; border-radius: 6px; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

// Cada vista del diseño vive dentro de su propio <sc-if>. Acá se le pone el
// ancla que usa el script para mostrar una a la vez.
const VISTAS = [
  ['viewHome', 'home'], ['viewPreds', 'preds'], ['viewBoard', 'board'],
  ['viewCalidad', 'calidad'], ['viewNews', 'news'], ['viewMatch', 'match'],
  ['viewAbout', 'about'], ['viewFaq', 'faq'], ['viewTerms', 'terms'],
  ['viewContacto', 'contacto'],
];

function marcarVistas(plantilla) {
  let out = plantilla;
  for (const [clave, nombre] of VISTAS) out = envolverVista(out, clave, nombre);
  return out;
}

const CLIENTE = `
(function(){
  'use strict';
  var vistas = document.querySelectorAll('[data-vista]');
  function ir(v){
    for (var i=0;i<vistas.length;i++) vistas[i].hidden = vistas[i].getAttribute('data-vista') !== v;
    try { history.replaceState(null,'','#'+v); } catch(e){}
    window.scrollTo(0,0);
    // el rail y la nav se repintan marcando el activo
    var botones = document.querySelectorAll('[data-accion^="ir:"]');
    for (var j=0;j<botones.length;j++){
      var destino = botones[j].getAttribute('data-accion').slice(3);
      botones[j].setAttribute('aria-current', destino===v ? 'page' : 'false');
    }
  }
  var filtro='todos', orden='cierra';
  function filas(){ return Array.prototype.slice.call(document.querySelectorAll('[data-fila]')); }
  function aplicar(){
    var f = filas();
    f.forEach(function(el){
      var ok = filtro==='todos' || el.getAttribute('data-juego')===filtro;
      el.hidden = !ok;
    });
    var visibles = f.filter(function(el){ return !el.hidden; });
    var clave = { edge:'data-edge', motor:'data-motor', cierra:'data-cierra' }[orden];
    visibles.sort(function(a,b){
      var va=a.getAttribute(clave), vb=b.getAttribute(clave);
      if (orden==='cierra') return vb.localeCompare(va);
      return parseFloat(vb)-parseFloat(va);
    });
    var padre = visibles[0] && visibles[0].parentNode;
    if (padre) visibles.forEach(function(el){ padre.appendChild(el); });
  }
  document.addEventListener('click', function(ev){
    var el = ev.target.closest('[data-accion]');
    if (!el) return;
    var a = el.getAttribute('data-accion');
    if (a.indexOf('ir:')===0){ ev.preventDefault(); ir(a.slice(3)); return; }
    if (a.indexOf('ficha:')===0){ location.href = 'serie-'+a.slice(6)+'.html'; return; }
    if (a.indexOf('filtro:')===0){ filtro = a.slice(7); aplicar(); return; }
    if (a.indexOf('orden:')===0){ orden = a.slice(6); aplicar(); return; }
  });
  document.addEventListener('keydown', function(ev){
    if (ev.key!=='Enter' && ev.key!==' ') return;
    var el = ev.target.closest('[data-accion]');
    if (el){ ev.preventDefault(); el.click(); }
  });
  var inicial = (location.hash||'#home').slice(1);
  ir(document.querySelector('[data-vista="'+inicial+'"]') ? inicial : 'home');
})();
`;

function documento({ cuerpo, estiloDisenio, titulo, conCliente }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="Predicciones de esports calificadas contra el resultado real. No apuesta ni recomienda apostar.">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${estiloDisenio}${ESTILO_EXTRA}</style>
</head>
<body>
${cuerpo}
${conCliente ? `<script>${CLIENTE}</script>` : ''}
</body>
</html>
`;
}

// Las filas de la tabla llevan los datos que el filtro y el orden necesitan.
function anotarFilas(html, filas) {
  let i = 0;
  return html.replace(/<div data-accion="ficha:(\d+)" style="([^"]*grid-template-columns: minmax\(0, 1\.7fr\)[^"]*)"/g, (m, id, estilo) => {
    const f = filas[i++];
    if (!f) return m;
    return `<div data-fila data-juego="${esc(f.juego)}" data-edge="${esc(f._pa)}" data-motor="${esc(f._pa)}" data-cierra="${esc(f.cierra)}" data-accion="ficha:${id}" style="${estilo}"`;
  });
}

// Arte propio para la banda de las tarjetas. Hoy no hay ninguno: el key art
// del diseño es de los publishers y este sitio se publica. Si algún día se
// consigue arte con derechos claros, se pone en assets/arte-dota.jpg y esto
// lo recoge solo.
async function arteIncrustado() {
  try {
    const img = await readFile(new URL('assets/arte-dota.jpg', RAIZ));
    return 'data:image/jpeg;base64,' + img.toString('base64');
  } catch {
    return null;
  }
}

// El artefacto de Pages es SÓLO salida/web, así que lo que se quede en la
// raíz del repo no llega al sitio. Se copian los iconos al generar en vez de
// versionar una segunda copia: el original manda y no hay dos verdades.
const ICONOS = ['favicon.svg', 'favicon.ico', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];

async function copiarIconos() {
  const destino = new URL('assets/', AQUI);
  await mkdir(destino, { recursive: true });
  let n = 0;
  for (const icono of ICONOS) {
    try {
      await copyFile(new URL(`assets/${icono}`, RAIZ), new URL(icono, destino));
      n += 1;
    } catch { /* si no está, el sitio funciona igual */ }
  }
  return n;
}

async function limpiarFichasViejas() {
  const archivos = await readdir(AQUI);
  await Promise.all(archivos.filter((a) => /^serie-\d+\.html$/.test(a)).map((a) => unlink(new URL(a, AQUI))));
}

async function main() {
  const archivo = await readFile(new URL('disenio.dc.html', AQUI), 'utf8');
  const { cuerpo: plantilla, estiloHelmet } = partesDelDisenio(archivo);

  const r = await resumen();
  const [logo, arte] = await Promise.all([logoIncrustado(), arteIncrustado()]);

  // El diseño enlaza ./logo-monitor.png, que no existe en este repo.
  const conLogo = marcarVistas(
    logo
      ? plantilla.replace(/src="\.\/logo-monitor\.png"/g, `src="${logo}"`)
      : plantilla.replace(/<img src="\.\/logo-monitor\.png"[^>]*>/g, '')
  );

  await limpiarFichasViejas();

  // --- panel ---
  const v = valores(r, { vista: 'home', arte });
  let cuerpo = anotarFilas(renderizar(conLogo, v), v.tabla);
  await writeFile(new URL('index.html', AQUI), documento({
    cuerpo, estiloDisenio: estiloHelmet, titulo: 'Monitor eSports', conCliente: true,
  }));

  // --- fichas, una por serie reciente ---
  const recientes = r.series.slice(-FICHAS);
  for (const s of recientes) {
    const vf = valores(r, { vista: 'match', serie: s, arte });
    const cf = renderizar(conLogo, vf);
    await writeFile(new URL(`serie-${s.seriesId}.html`, AQUI), documento({
      cuerpo: cf, estiloDisenio: estiloHelmet, titulo: `${s.nombreA} vs ${s.nombreB} · Monitor eSports`, conCliente: true,
    }));
  }

  const iconos = await copiarIconos();

  const g = r.calidad.global;
  console.log(`index.html + ${recientes.length} fichas · ${iconos} iconos`);
  console.log(`${g.cantidad} series · brier ${g.brier.toFixed(4)} vs base ${g.base.toFixed(4)} · acierto ${(g.acierto * 100).toFixed(2)} %`);
  console.log(`logotipo: ${logo ? 'assets/logo-mark.svg' : 'no encontrado'} · arte: ${arte ? 'assets/arte-dota.jpg' : 'degradado por juego'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

export { documento, marcarVistas };
