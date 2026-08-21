import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estiloATexto, esc, renderizar, envolverVista, partesDelDisenio } from '../salida/web/plantilla.mjs';

// --- estilos -------------------------------------------------------------

test('camelCase se convierte a kebab-case', () => {
  assert.equal(estiloATexto({ backgroundColor: '#fff', fontSize: '12px' }), 'background-color:#fff;font-size:12px');
});

// React escribe los números sueltos en px; las propiedades sin unidad, no.
test('un número suelto sale en px, salvo las propiedades sin unidad', () => {
  assert.equal(estiloATexto({ width: 30 }), 'width:30px');
  assert.equal(estiloATexto({ opacity: 1 }), 'opacity:1');
  assert.equal(estiloATexto({ fontWeight: 800 }), 'font-weight:800');
});

test('las propiedades vacías o nulas no ensucian la salida', () => {
  assert.equal(estiloATexto({ color: '#fff', border: null, margin: '', padding: false }), 'color:#fff');
});

test('un estilo que ya viene en texto se deja tal cual', () => {
  assert.equal(estiloATexto('display:none'), 'display:none');
  assert.equal(estiloATexto(null), '');
});

// --- escapado ------------------------------------------------------------

// Los nombres de equipo vienen de OpenDota. Sin escapar, uno con <script>
// sería XSS almacenado en una página que se publica.
test('esc neutraliza lo que puede romper el HTML', () => {
  assert.equal(esc('<script>"x"&y</script>'), '&lt;script&gt;&quot;x&quot;&amp;y&lt;/script&gt;');
});

test('esc convierte null en cadena vacía, no en "null"', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

// --- interpolación -------------------------------------------------------

test('una clave suelta se resuelve y se escapa', () => {
  assert.equal(renderizar('<p>{{ nombre }}</p>', { nombre: 'Team <b>' }), '<p>Team &lt;b&gt;</p>');
});

test('una ruta con punto se resuelve contra el ámbito', () => {
  assert.equal(renderizar('{{ a.b.c }}', { a: { b: { c: 'hondo' } } }), 'hondo');
});

test('una ruta que no existe sale vacía en vez de reventar', () => {
  assert.equal(renderizar('[{{ no.existe.nada }}]', {}), '[]');
});

test('style="{{ obj }}" se serializa a CSS', () => {
  assert.equal(renderizar('<div style="{{ s }}"></div>', { s: { color: 'red' } }), '<div style="color:red"></div>');
});

test('un manejador sale como data-accion, no como atributo on*', () => {
  const html = renderizar('<div onClick="{{ ir }}"></div>', { ir: 'ir:home' });
  assert.equal(html, '<div data-accion="ir:home"></div>');
  assert.ok(!html.includes('onClick'));
});

test('un manejador vacío no deja atributo suelto', () => {
  assert.equal(renderizar('<div onClick="{{ nada }}"></div>', { nada: '' }), '<div></div>');
});

// --- sc-if ---------------------------------------------------------------

test('sc-if dibuja sólo si la condición es cierta', () => {
  assert.equal(renderizar('<sc-if value="{{ v }}">SÍ</sc-if>', { v: true }), 'SÍ');
  assert.equal(renderizar('<sc-if value="{{ v }}">SÍ</sc-if>', { v: false }), '');
});

test('sc-if anidados cierran donde corresponde', () => {
  const t = '<sc-if value="{{ a }}">A<sc-if value="{{ b }}">B</sc-if>C</sc-if>D';
  assert.equal(renderizar(t, { a: true, b: true }), 'ABCD');
  assert.equal(renderizar(t, { a: true, b: false }), 'ACD');
  assert.equal(renderizar(t, { a: false, b: true }), 'D');
});

// --- sc-for --------------------------------------------------------------

test('sc-for repite una vez por elemento y expone el alias', () => {
  const t = '<sc-for list="{{ xs }}" as="x">[{{ x.n }}]</sc-for>';
  assert.equal(renderizar(t, { xs: [{ n: 1 }, { n: 2 }, { n: 3 }] }), '[1][2][3]');
});

test('sc-for con lista vacía o ausente no dibuja nada', () => {
  assert.equal(renderizar('<sc-for list="{{ xs }}" as="x">X</sc-for>', { xs: [] }), '');
  assert.equal(renderizar('<sc-for list="{{ xs }}" as="x">X</sc-for>', {}), '');
});

test('dentro de un sc-for se sigue viendo el ámbito de afuera', () => {
  const t = '<sc-for list="{{ xs }}" as="x">{{ titulo }}:{{ x }}|</sc-for>';
  assert.equal(renderizar(t, { titulo: 'T', xs: ['a', 'b'] }), 'T:a|T:b|');
});

test('un sc-for dentro de un sc-if funciona', () => {
  const t = '<sc-if value="{{ v }}"><sc-for list="{{ xs }}" as="x">{{ x }}</sc-for></sc-if>';
  assert.equal(renderizar(t, { v: true, xs: [1, 2] }), '12');
  assert.equal(renderizar(t, { v: false, xs: [1, 2] }), '');
});

// --- envolver vistas -----------------------------------------------------

test('envolverVista mete el ancla dentro del sc-if, no fuera', () => {
  const t = '<sc-if value="{{ viewHome }}">HOLA</sc-if>';
  const out = envolverVista(t, 'viewHome', 'home');
  assert.ok(out.includes('<sc-if value="{{ viewHome }}"><div data-vista="home"'));
  assert.equal(renderizar(out, { viewHome: true }), '<div data-vista="home" style="display: contents">HOLA</div>');
});

test('el envoltorio usa display:contents para no alterar el layout', () => {
  const out = envolverVista('<sc-if value="{{ v }}">X</sc-if>', 'v', 'uno');
  assert.ok(out.includes('style="display: contents"'));
});

test('envolverVista no toca la plantilla si la clave no está', () => {
  const t = '<sc-if value="{{ otra }}">X</sc-if>';
  assert.equal(envolverVista(t, 'viewHome', 'home'), t);
});

// --- partes del diseño ---------------------------------------------------

test('partesDelDisenio saca el cuerpo y el estilo del helmet', () => {
  const archivo = '<html><body><x-dc><helmet><style>body{color:red}</style></helmet><div>CUERPO</div></x-dc></body></html>';
  const { cuerpo, estiloHelmet } = partesDelDisenio(archivo);
  assert.equal(estiloHelmet.trim(), 'body{color:red}');
  assert.ok(cuerpo.includes('<div>CUERPO</div>'));
  assert.ok(!cuerpo.includes('<helmet>'));
});

test('se descartan las pistas del editor y los style-hover', () => {
  const archivo = '<x-dc><div hint-placeholder-val="{{ true }}" style-hover="color:red" id="a">X</div></x-dc>';
  const { cuerpo } = partesDelDisenio(archivo);
  assert.ok(!cuerpo.includes('hint-placeholder'));
  assert.ok(!cuerpo.includes('style-hover'));
  assert.ok(cuerpo.includes('id="a"'));
});

test('un archivo sin <x-dc> falla claro en vez de dar cualquier cosa', () => {
  assert.throws(() => partesDelDisenio('<html></html>'), /no se encontró <x-dc>/);
});
