// Renderizador del dialecto de plantilla de Claude Design.
//
// POR QUÉ EXISTE, Y POR QUÉ NO SE TRANSCRIBIÓ EL DISEÑO A MANO
// `disenio.dc.html` es el archivo que sale de claude.ai/design tal cual, sin
// una sola línea tocada. Este módulo lo lee y lo rellena con datos reales.
// La alternativa —copiar el marcado a un generador— tiene un problema fatal:
// la copia empieza a separarse del original en el primer cambio, y entonces
// hay dos diseños otra vez, que es exactamente el lío que este proyecto ya
// pasó una vez. Así, el diseño manda: se baja el archivo nuevo, se vuelve a
// generar, y punto.
//
// El dialecto es chico. Esto es todo lo que hay que entender:
//
//   {{ expr }}                  interpolación; expr es una ruta (n.label) o
//                               una clave suelta (viewHome)
//   style="{{ obj }}"           objeto de estilo de React -> texto CSS
//   <sc-if value="{{ x }}">     se dibuja si x es cierto
//   <sc-for list="{{ xs }}" as="n">  se repite por cada elemento
//   onClick="{{ f }}"           el valor es una CADENA, no una función: sale
//                               como data-accion, y un script chico la ata
//
// Lo que se ignora a propósito: `hint-placeholder-*` (son pistas del editor
// visual, no salida) y `style-hover` (no existe en HTML; los hover reales
// viven en el <style> que agrega generar.mjs).

const AUTOCERRADAS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'use', 'stop']);

// camelCase -> kebab-case, salvo las propiedades de SVG que ya vienen con
// guion o que son atributos (no se tocan).
function propCss(k) {
  return k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

// Un número suelto en una propiedad que lo admite se escribe en px, igual que
// hace React. `flex`, `opacity` y compañía no llevan unidad.
const SIN_UNIDAD = new Set([
  'opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink',
  'order', 'zoom', 'gridRow', 'gridColumn', 'strokeWidth', 'fillOpacity', 'strokeOpacity',
]);

export function estiloATexto(obj) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return Object.entries(obj)
    .filter(([, v]) => v != null && v !== false && v !== '')
    .map(([k, v]) => `${propCss(k)}:${typeof v === 'number' && !SIN_UNIDAD.has(k) ? v + 'px' : v}`)
    .join(';');
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Resuelve "n.label" o "viewHome" contra el ámbito actual. Sin eval: el
// dialecto sólo usa rutas de propiedades, y aceptar expresiones abriría la
// puerta a que la plantilla ejecute cualquier cosa.
function resolver(expr, ambito) {
  const ruta = expr.trim().split('.');
  let v = ambito;
  for (const paso of ruta) {
    if (v == null) return undefined;
    v = v[paso];
  }
  return v;
}

// --- tokenizado -----------------------------------------------------------
//
// Se recorre el HTML de una pasada buscando sólo lo que importa: las
// etiquetas sc-if / sc-for. Todo lo demás se copia literal, con las
// interpolaciones resueltas. No hace falta un parser de HTML completo, y
// mejor así: un parser que "arregle" el marcado lo cambiaría.

function cerrarEtiqueta(html, desde, nombre) {
  // Busca el </nombre> que corresponde, contando anidados.
  const abre = new RegExp(`<${nombre}\\b`, 'g');
  const cierra = new RegExp(`</${nombre}>`, 'g');
  let nivel = 1;
  let i = desde;
  while (nivel > 0) {
    abre.lastIndex = i;
    cierra.lastIndex = i;
    const a = abre.exec(html);
    const c = cierra.exec(html);
    if (!c) throw new Error(`plantilla: falta </${nombre}>`);
    if (a && a.index < c.index) {
      nivel += 1;
      i = a.index + 1;
    } else {
      nivel -= 1;
      i = c.index + 1;
      if (nivel === 0) return { fin: c.index, siguiente: c.index + `</${nombre}>`.length };
    }
  }
  throw new Error(`plantilla: falta </${nombre}>`);
}

function atributos(texto) {
  const out = {};
  for (const m of texto.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

// Interpola {{ }} en un fragmento sin etiquetas de control.
function interpolar(trozo, ambito) {
  return trozo.replace(/(\s([a-zA-Z-]+)=")?\{\{([^}]*)\}\}(")?/g, (todo, pre, attr, expr, post) => {
    const v = resolver(expr, ambito);

    // style="{{ obj }}" -> objeto de estilo serializado
    if (attr === 'style') return ` style="${esc(estiloATexto(v))}"`;

    // Los manejadores no viajan como funciones: el valor es una cadena que
    // identifica la acción, y el script del pie la ata.
    if (attr && /^on[A-Z]/.test(attr)) {
      return v == null || v === '' ? '' : ` data-accion="${esc(String(v))}"`;
    }

    if (attr) return ` ${attr}="${esc(v ?? '')}"`;
    return esc(v ?? '');
  });
}

export function renderizar(html, ambito) {
  let salida = '';
  let i = 0;

  while (i < html.length) {
    const sif = html.indexOf('<sc-if', i);
    const sfor = html.indexOf('<sc-for', i);
    const prox = [sif, sfor].filter((x) => x !== -1).sort((a, b) => a - b)[0];

    if (prox === undefined) {
      salida += interpolar(html.slice(i), ambito);
      break;
    }

    salida += interpolar(html.slice(i, prox), ambito);

    const finApertura = html.indexOf('>', prox);
    const cabecera = html.slice(prox, finApertura + 1);
    const attrs = atributos(cabecera);
    const esFor = prox === sfor && (sif === -1 || sfor < sif);
    const nombre = esFor ? 'sc-for' : 'sc-if';
    const { fin, siguiente } = cerrarEtiqueta(html, finApertura + 1, nombre);
    const cuerpo = html.slice(finApertura + 1, fin);

    if (esFor) {
      const lista = resolver((attrs.list || '').replace(/[{}]/g, ''), ambito) || [];
      const alias = attrs.as || 'item';
      for (const elemento of lista) {
        salida += renderizar(cuerpo, { ...ambito, [alias]: elemento });
      }
    } else {
      const cond = resolver((attrs.value || '').replace(/[{}]/g, ''), ambito);
      if (cond) salida += renderizar(cuerpo, ambito);
    }
    i = siguiente;
  }

  return salida;
}

// Envuelve el contenido de un <sc-if value="{{ clave }}"> con un div que
// lleva `data-vista`. Se usa para poder mostrar una vista a la vez sin tocar
// el diseño: el envoltorio va con `display: contents`, así que no existe para
// el layout — sólo da dónde agarrar para ocultar.
export function envolverVista(html, clave, nombre) {
  const marca = `<sc-if value="{{ ${clave} }}">`;
  const i = html.indexOf(marca);
  if (i === -1) return html;
  const desde = i + marca.length;
  const { fin } = cerrarEtiqueta(html, desde, 'sc-if');
  return (
    html.slice(0, desde) +
    `<div data-vista="${nombre}" style="display: contents">` +
    html.slice(desde, fin) +
    '</div>' +
    html.slice(fin)
  );
}

// Saca el cuerpo del diseño (lo de dentro de <x-dc>) y el <style> del helmet.
export function partesDelDisenio(archivo) {
  const dc = archivo.match(/<x-dc>([\s\S]*)<\/x-dc>/);
  if (!dc) throw new Error('disenio.dc.html: no se encontró <x-dc>');
  let cuerpo = dc[1];

  const helmet = cuerpo.match(/<helmet>([\s\S]*?)<\/helmet>/);
  const estiloHelmet = helmet ? [...helmet[1].matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') : '';
  if (helmet) cuerpo = cuerpo.replace(helmet[0], '');

  // Pistas del editor visual: no son salida.
  cuerpo = cuerpo.replace(/\shint-placeholder-[a-z]+="[^"]*"/g, '');
  // style-hover no existe en HTML; los hover reales van en el <style>.
  cuerpo = cuerpo.replace(/\sstyle-hover="[^"]*"/g, '');

  return { cuerpo, estiloHelmet };
}
