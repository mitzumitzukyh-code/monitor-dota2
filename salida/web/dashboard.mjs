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
//
// El CSS, la barra lateral y el envoltorio del documento viven en
// salida/web/estilo.mjs, compartidos con el panel de Dota y sus fichas: los
// tres tienen que verse como el mismo sitio.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { seleccionar } from '../../datos/supabase.mjs';
import { datosDeEquipos, nombresDeTorneos } from '../../datos/juegos/bo3.mjs';
import { enVenezuela, hora12 } from '../formato.mjs';
import { esc, pct1, logo, escudo, kpi, documento, barraLateral, copiarAssets } from './estilo.mjs';
// Las fichas de Dota las genera salida/web/generar.mjs; las de CS2/LoL/
// Valorant, salida/web/juego.mjs. El panel enlaza a las dos clases, así la
// fila de cualquier partida lleva a su ficha.
import { archivoDeFicha as archivoDeFichaDota } from './generar.mjs';
import { archivoDeFicha as archivoDeFichaEsports } from './juego.mjs';

// Mismo criterio que salida/resumen-global.mjs: los Brier de Dota y los de
// bo3.gg NO están en la misma escala (Dota puntúa sobre tres clases). Cada
// juego se muestra contra SU base.
const BASE_DOTA = { bo1: 0.5, bo2: 2 / 3, bo3: 0.5, bo5: 0.5 };
const BASE_ESLO = 0.25;
const MINIMO_POR_JUEGO = 275;

// Cuántas filas se dibujan en cada tabla. La vista "todos" muestra las más
// recientes sin importar el juego; al filtrar por uno se muestran más de ese,
// porque si no, filtrar CS2 podía dejar la tabla vacía cuando las últimas seis
// eran de otro juego.
const TOPE_GLOBAL = 6;
const TOPE_POR_JUEGO = 8;

const JUEGOS = [
  { clave: 'dota2', nombre: 'Dota 2', corto: 'D2', color: '#ef4444' },
  { clave: 'lol', nombre: 'League of Legends', corto: 'LoL', color: '#3b82f6' },
  { clave: 'valorant', nombre: 'Valorant', corto: 'VAL', color: '#f43f5e' },
  { clave: 'cs2', nombre: 'Counter-Strike 2', corto: 'CS2', color: '#f59e0b' },
];


function fechaCorta(iso) {
  const { fecha, valida } = enVenezuela(iso);
  if (!valida) return '—';
  const [a, m, d] = fecha.split('-');
  return `${d}/${m}/${a}`;
}

// --- piezas ------------------------------------------------------------------

function filaJuego(j) {
  const { def, n, aciertos, predichas, vsBase } = j;
  if (n === 0) {
    return `
      <div class="stat-row" data-juego="${esc(def.clave)}">
        <div class="tile">${logo(def.corto, def.color, 38, def.clave)}</div>
        <div class="stat-name">${esc(def.nombre)}</div>
        <div><div class="pct dim">—</div><div class="frac">${predichas} predichas · 0 calificadas</div></div>
        <div class="spark"><span class="delta dim">sin datos</span></div>
      </div>`;
  }
  const tasa = aciertos / n;
  return `
    <div class="stat-row" data-juego="${esc(def.clave)}">
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


function filaPartida(p) {
  const ganoA = p.resultadoReal === 'ganaA';
  const marcador =
    p.marcadorA == null
      ? '<span class="sep">—</span>'
      : `<span class="${ganoA ? 'w' : 'l'}">${p.marcadorA}</span><span class="sep">-</span><span class="${ganoA ? 'l' : 'w'}">${p.marcadorB}</span>`;

  const cuota = p.cuota == null ? '—' : p.cuota.toFixed(2);
  // `hidden` de entrada en las que no entran en la vista "todos": así el HTML
  // servido ya se ve bien aunque el navegador no ejecute el script.
  return `
    <a class="trow" data-juego="${esc(p.def.clave)}"${p.enGlobal ? ' data-global="1"' : ' hidden'} href="${esc(p.enlace)}" title="Ver la ficha de esta partida">
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
    </a>`;
}

function tablaPartidas(titulo, color, icono, filas) {
  const cuerpo = filas.length
    ? filas.map(filaPartida).join('')
    : `<div class="vacio">Todavía no hay partidas calificadas acá.</div>`;
  return `
    <div class="card" data-tabla>
      <div class="card-h">
        <span class="hdot" style="background:${color}26">${icono}</span>
        <span class="card-title">${esc(titulo)}</span>
      </div>
      <div class="thead"><span>Juego</span><span>Encuentro</span><span>Fecha</span><span>Cuota</span><span>Resultado</span></div>
      ${cuerpo}
      <div class="vacio" data-vacio hidden>Ese juego no tiene ninguna acá todavía.</div>
    </div>`;
}

// Qué filas se dibujan: las más recientes en general (vista "todos") MÁS las
// más recientes de cada juego, para que el filtro tenga qué mostrar. Se
// dibujan todas de una vez y el filtro sólo esconde: así cambiar de juego no
// recarga ni pide nada.
function filasParaTabla(recientes, acerto) {
  const suyas = recientes.filter((p) => p.acerto === acerto);
  const enGlobal = new Set(suyas.slice(0, TOPE_GLOBAL));

  const elegidas = new Set(enGlobal);
  for (const def of JUEGOS) {
    for (const p of suyas.filter((x) => x.def.clave === def.clave).slice(0, TOPE_POR_JUEGO)) elegidas.add(p);
  }

  return [...elegidas]
    .sort((a, b) => new Date(b.inicio) - new Date(a.inicio))
    .map((p) => ({ ...p, enGlobal: enGlobal.has(p) }));
}

// --- documento ---------------------------------------------------------------

export function construirDashboard({ juegos, recientes, generadoEn }) {
  const conDatos = juegos.filter((j) => j.n > 0);
  const totalCalificadas = conDatos.reduce((s, j) => s + j.n, 0);
  const totalAciertos = conDatos.reduce((s, j) => s + j.aciertos, 0);
  const totalPredichas = juegos.reduce((s, j) => s + j.predichas, 0);
  const tasa = totalCalificadas ? totalAciertos / totalCalificadas : 0;

  const aciertos = filasParaTabla(recientes, true);
  const fallos = filasParaTabla(recientes, false);
  // La barra lateral sale del módulo compartido: es la misma pieza que usan
  // el panel de Dota y las fichas, así que navegar entre los tres no cambia
  // de sitio a mitad de camino.
  const sidebar = barraLateral({
    bloques: [
      {
        // Los cuatro FILTRAN esta misma página; no llevan a otra. Antes sólo
        // Dota era pulsable (es el único con página propia) y los otros tres
        // parecían botones muertos. Filtrar es lo que de verdad hacía falta:
        // ver un juego a la vez sin salir del panel.
        etiqueta: 'Juegos · calificadas',
        enlaces: [
          {
            filtro: 'todos',
            activo: true,
            texto: 'Todos los juegos',
            color: '#3b82f6',
            contador: juegos.reduce((s, j) => s + j.n, 0) || '—',
            logoHtml: `<span class="ph" style="width:28px;height:28px;background:#3b82f61f;border-color:#3b82f659"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.4" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></span>`,
          },
          ...juegos.map((j) => ({
            filtro: j.def.clave,
            texto: j.def.nombre,
            color: j.def.color,
            contador: j.n || '—',
            logoHtml: logo(j.def.corto, j.def.color, 28, j.def.clave),
          })),
        ],
      },
      {
        etiqueta: 'Detalle',
        enlaces: [
          {
            href: 'dota.html',
            texto: 'Panel de Dota',
            color: '#ef4444',
            logoHtml: logo('D2', '#ef4444', 28, 'dota2'),
          },
          {
            href: 'cs2.html',
            texto: 'Counter-Strike 2',
            color: '#f59e0b',
            logoHtml: logo('CS2', '#f59e0b', 28, 'cs2'),
          },
          {
            href: 'lol.html',
            texto: 'League of Legends',
            color: '#3b82f6',
            logoHtml: logo('LoL', '#3b82f6', 28, 'lol'),
          },
          {
            href: 'valorant.html',
            texto: 'Valorant',
            color: '#f43f5e',
            logoHtml: logo('VAL', '#f43f5e', 28, 'valorant'),
          },
        ],
      },
    ],
    nota: 'Los porcentajes salen de un cálculo matemático sobre los resultados reales. Ningún número de este panel se escribe a mano.',
  });

  return documento({
    titulo: 'MONITOR-ESPORTS · Panel',
    pagina: 'index.html',
    imagen: 'og-image.png',
    descripcion:
      'El motor predice, la realidad califica. Acierto, Brier y muestra por juego en Dota 2, LoL, Valorant y CS2, contra resultados reales. No apuesta ni recomienda apostar.',
    sidebar,
    contenido: `
  <header class="topbar">
    <div><h1>Panel</h1><div class="sub">Cómo va el motor contra la realidad · <span class="badge b-gris" data-etiqueta-filtro>Todos los juegos</span></div></div>
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

  <div class="nota-filtro" data-nota-filtro hidden>
    Los cuatro números de arriba son de <b>todos los juegos</b> y no cambian con el filtro.
    Lo que se filtra es de acá para abajo.
  </div>

  <div class="aviso">
    <b>Estos números todavía no dicen nada.</b> Hacen falta ~${MINIMO_POR_JUEGO} partidas calificadas
    <b>por juego</b> para que el resultado deje de ser compatible con el azar, y el que más lleva
    va por ${Math.max(0, ...juegos.map((j) => j.n))}. Sumar los cuatro juegos no cuenta: son motores calibrados por separado.
  </div>

  <section class="card ancho" data-por-juego>
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

<script>
// Filtro por juego. Sólo esconde y muestra filas que YA están en la página:
// no pide nada, no recalcula nada y ningún número cambia por filtrar.
//
// El HTML se sirve con el filtro "todos" ya aplicado (las filas que no entran
// vienen con el atributo hidden), así que sin JavaScript la página se ve
// lo que se pierde es poder cambiar de juego, no el contenido.
(function () {
  var botones = [].slice.call(document.querySelectorAll('[data-filtro]'));
  var tablas = [].slice.call(document.querySelectorAll('[data-tabla]'));
  var etiqueta = document.querySelector('[data-etiqueta-filtro]');
  if (!botones.length) return;

  // La raya de separación va ARRIBA de cada fila, y la primera no la lleva.
  // Con el filtro puesto, "la primera" ya no es la misma del HTML, así que hay
  // que moverla o queda una raya suelta bajo la cabecera.
  function primera(visibles) {
    visibles.forEach(function (f, i) {
      f.classList.toggle('primera', i === 0);
    });
  }

  function aplicar(filtro, nombre) {
    botones.forEach(function (b) {
      var suyo = b.dataset.filtro === filtro;
      b.classList.toggle('activo', suyo);
      b.setAttribute('aria-pressed', suyo ? 'true' : 'false');
    });

    tablas.forEach(function (t) {
      var visibles = [];
      [].slice.call(t.querySelectorAll('.trow')).forEach(function (f) {
        var ok = filtro === 'todos' ? f.dataset.global === '1' : f.dataset.juego === filtro;
        f.hidden = !ok;
        if (ok) visibles.push(f);
      });
      primera(visibles);
      var vacio = t.querySelector('[data-vacio]');
      if (vacio) vacio.hidden = visibles.length > 0;
    });

    // La tabla comparativa de arriba se reduce al juego elegido. Con "todos"
    // vuelven los cuatro, que es cuando comparar tiene sentido.
    var comparativa = document.querySelector('[data-por-juego]');
    if (comparativa) {
      var filasJuego = [].slice.call(comparativa.querySelectorAll('.stat-row'));
      var vistas = [];
      filasJuego.forEach(function (f) {
        var ok = filtro === 'todos' || f.dataset.juego === filtro;
        f.hidden = !ok;
        if (ok) vistas.push(f);
      });
      primera(vistas);
    }

    if (etiqueta) etiqueta.textContent = nombre;

    // Los KPI de arriba son globales SIEMPRE. Con un filtro puesto, un
    // "Acierto global 63.2%" justo encima de una tabla que solo muestra CS2 se
    // lee como si fuera de CS2, y no lo es. Se dice, en vez de inventar KPI
    // por juego que nadie pidio.
    var nota = document.querySelector('[data-nota-filtro]');
    if (nota) nota.hidden = filtro === 'todos';
    // Queda en la URL para poder compartir "el panel filtrado por CS2".
    try {
      var u = new URL(location.href);
      if (filtro === 'todos') u.searchParams.delete('juego');
      else u.searchParams.set('juego', filtro);
      history.replaceState(null, '', u);
    } catch (e) {}
  }

  botones.forEach(function (b) {
    b.addEventListener('click', function () {
      aplicar(b.dataset.filtro, b.querySelector('span:nth-of-type(2)').textContent);
    });
  });

  // Se aplica SIEMPRE al cargar, no solo cuando la URL trae ?juego=cs2.
  // Ademas de dejar el filtro pedido, normaliza la raya de la primera fila:
  // el CSS lo intentaba con :first-of-type, que ahi no sirve porque el primer
  // <div> hermano es la cabecera de la tarjeta, no la primera fila. Resultado:
  // la primera fila llevaba raya propia encima del borde de la cabecera, dos
  // lineas pegadas.
  var inicial = 'todos';
  try {
    var pedido = new URL(location.href).searchParams.get('juego');
    if (pedido && botones.filter(function (b) { return b.dataset.filtro === pedido; })[0]) inicial = pedido;
  } catch (e) {}

  var suyo = botones.filter(function (b) { return b.dataset.filtro === inicial; })[0];
  if (suyo) aplicar(inicial, suyo.querySelector('span:nth-of-type(2)').textContent);
})();
</script>
`,
  });
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
          enlace: archivoDeFichaDota(s.series_id),
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
        enlace: archivoDeFichaEsports(p.match_id),
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

  // Los iconos y la tarjeta social viven en assets/ (raíz del repo), pero el
  // artefacto de Pages es sólo salida/web: hay que copiarlos ahí o el sitio
  // sale sin favicon.
  const assets = await copiarAssets(new URL('./assets/', import.meta.url));
  if (!assets.copiado) console.warn(`  (sin assets: ${assets.razon})`);
  const conDatos = datos.juegos.filter((j) => j.n > 0);
  console.log(`panel generado: ${datos.juegos.length} juegos, ${conDatos.reduce((s, j) => s + j.n, 0)} calificadas`);
}
