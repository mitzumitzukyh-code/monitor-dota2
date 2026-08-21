// Los 133 valores que consume `disenio.dc.html`, calculados sobre datos
// reales del backtest.
//
// REGLA 1, QUE ES LA QUE MANDA ACÁ
// El diseño trae huecos para cosas que este proyecto no mide (cuota de la
// casa, ventaja contra el mercado, región del equipo, duración de partida).
// Esos huecos salen con el marcador vacío del propio diseño — «—» — y NO con
// un número inventado para que la pantalla se vea llena. Un panel con «—» es
// honesto; uno con un número bonito que no salió de ningún cálculo es
// exactamente lo que la regla 1 prohíbe.
//
// Lo que sí sale de cálculo real: las probabilidades, el Brier, el acierto,
// los ratings Elo congelados al predecir, la distribución de marcadores, el
// ranking de fuerza y el changelog.
//
// Lo que se enciende sólo con credenciales de Supabase: las series próximas,
// las cuotas y por lo tanto la ventaja contra el mercado.

import { COEFICIENTES, K_FACTOR, ESCALA, DELTA_BO2 } from '../../config.mjs';
import { marcadoresDeSerie, BASE_INGENUA } from './datos.mjs';

const VACIO = '—';

const pct = (x, d = 1) => (x * 100).toFixed(d) + ' %';
const n4 = (x) => Number(x).toFixed(4);
const miles = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// --- paleta del diseño ---------------------------------------------------
// Copiada del propio archivo, no reinventada. Si el diseño cambia un color,
// cambia acá al regenerar y en ningún otro sitio.
export const C = {
  fondo: '#05070A', panel: '#080A0E', tarjeta: '#0D1015', interior: '#11141A',
  linea: '#1a1e26', lineaMedia: '#242933', lineaFuerte: '#343943',
  tinta: '#F2F4F7', tintaMedia: '#A7ADB8', tintaSuave: '#8B95A5', tintaApagada: '#6F7784',
  acento: '#FF2638', ok: '#19E68C', aviso: '#FFB000',
};
const COLOR_JUEGO = { 'DOTA 2': '#9A3CFF', CS2: '#F5C400', LOL: '#00CFFF', VALORANT: '#23F28A' };
const colorJuego = (j) => COLOR_JUEGO[j] ?? C.tintaApagada;

// --- piezas de estilo que el diseño arma en su clase lógica --------------

const chipJuego = (j) => {
  const c = colorJuego(j);
  return { fontSize: '9px', fontWeight: 800, letterSpacing: '0.1em', padding: '5px 9px', borderRadius: '7px', color: c, border: `1px solid ${c}66`, background: 'rgba(5,7,10,0.80)', whiteSpace: 'nowrap', display: 'inline-block' };
};

const escudo = (nombre, juego, size = 30) => {
  const c = colorJuego(juego);
  return { width: `${size}px`, height: `${size}px`, flex: 'none', borderRadius: '8px', border: `1px solid ${c}55`, background: 'rgba(5,7,10,0.9)', color: c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `${size * 0.38}px`, fontWeight: 800, letterSpacing: '0.02em' };
};

const inicial = (n) => String(n || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();

const navStyle = (on) => ({ cursor: 'pointer', display: 'flex', alignItems: 'center', height: '100%', color: on ? C.acento : C.tintaMedia, borderBottom: `2px solid ${on ? C.acento : 'transparent'}`, textShadow: on ? '0 0 14px rgba(255,38,56,0.55)' : 'none', whiteSpace: 'nowrap' });

const railStyle = (on, abajo) => ({ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '7px', padding: '13px 4px', margin: abajo ? 'auto 8px 0' : '0 8px', borderRadius: '10px', color: on ? C.acento : C.tintaApagada, background: on ? 'rgba(255,38,56,0.08)' : 'transparent', border: `1px solid ${on ? '#FF263866' : 'transparent'}`, boxShadow: on ? 'inset 0 0 18px rgba(255,38,56,0.14)' : 'none' });

const pillGame = (color, activo) => ({ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', padding: '9px 14px', borderRadius: '999px', border: `1px solid ${activo ? color : '#242933'}`, color: activo ? color : C.tintaMedia, background: activo ? 'rgba(255,255,255,0.035)' : '#0D1015', boxShadow: activo ? `0 0 12px ${color}40` : 'none', whiteSpace: 'nowrap' });

const tab = (on) => ({ cursor: 'pointer', fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', padding: '7px 11px', borderRadius: '7px', border: `1px solid ${on ? C.lineaFuerte : C.lineaMedia}`, background: on ? C.interior : 'transparent', color: on ? C.tinta : C.tintaApagada });

const dot = (estado) => {
  const c = estado === 'ok' ? C.ok : estado === 'respaldo' ? C.aviso : C.acento;
  return { width: '7px', height: '7px', borderRadius: '999px', background: c, boxShadow: `0 0 7px ${c}88`, display: 'inline-block', flex: 'none' };
};

const gauge = (p, color) => {
  const len = Math.PI * 22;
  return { dash: `${(Math.max(0, Math.min(1, p)) * len).toFixed(2)} ${len.toFixed(2)}`, color };
};
const ringDash = (p, r) => {
  const len = 2 * Math.PI * r;
  return `${((Math.max(0, Math.min(100, p)) / 100) * len).toFixed(2)} ${len.toFixed(2)}`;
};

// El Brier contra su base decide el color, y un resultado PEOR va en ámbar,
// nunca en rojo: el rojo es la marca. Es una regla escrita del diseño.
const estiloBrier = (brier, base, grande) => {
  const mejor = brier < base;
  return { fontFamily: "'JetBrains Mono', monospace", fontSize: grande ? '15px' : '12px', fontWeight: 700, padding: grande ? '8px 12px' : '5px 9px', borderRadius: '7px', whiteSpace: 'nowrap', lineHeight: 1, color: mejor ? C.ok : C.aviso, border: `1px solid ${mejor ? '#0C9B60' : '#D88B00'}`, background: mejor ? 'rgba(25,230,140,0.09)' : 'rgba(255,176,0,0.09)' };
};
const textoBrier = (brier, base) => (brier < base ? '−' : '+') + Math.abs(brier - base).toFixed(3);

// --- una serie juzgada, en la forma que espera el diseño -----------------

const JUEGO = 'DOTA 2'; // el histórico versionado es de Dota; los otros tres viven en Supabase

function serieComoPartido(s, arte) {
  const marcadores = marcadoresDeSerie(s);
  const mejor = marcadores.slice().sort((a, b) => b.prob - a.prob)[0];
  const pa = s.prediccion.ganaA * 100;
  return {
    id: String(s.seriesId),
    juego: JUEGO,
    torneo: s.torneo,
    formato: s.formato.toUpperCase(),
    cierra: VACIO, // sólo tiene sentido en una serie que aún no empezó
    a: s.nombreA,
    b: s.nombreB,
    chip: chipJuego(JUEGO),
    inicialA: inicial(s.nombreA),
    inicialB: inicial(s.nombreB),
    escudoA: escudo(s.nombreA, JUEGO),
    escudoB: escudo(s.nombreB, JUEGO),
    probA: pct(s.prediccion.ganaA),
    // Sin cuotas guardadas no hay mercado contra el que medirse. Se dice, no
    // se rellena.
    mercadoA: VACIO,
    cuotaA: VACIO,
    edge: textoBrier(s.brier, s.base),
    edgeStyle: estiloBrier(s.brier, s.base),
    barStyle: { width: `${pa}%`, height: '100%', background: C.acento, boxShadow: '0 0 9px rgba(255,38,56,0.7)' },
    arteStyle: arteStyle(arte, JUEGO),
    mejorMarcador: mejor ? `${mejor.marcador} (${(mejor.prob * 100).toFixed(1)} %)` : VACIO,
    motor: 'Elo',
    coef: `K=${K_FACTOR} · escala=${ESCALA}`,
    onClick: `ficha:${s.seriesId}`,
  };
}

function serieComoFila(s) {
  const color = colorJuego(JUEGO);
  const pa = s.prediccion.ganaA * 100;
  return {
    a: s.nombreA, b: s.nombreB, torneo: s.torneo, juego: JUEGO, chip: chipJuego(JUEGO),
    formato: s.formato.toUpperCase(),
    inicialA: inicial(s.nombreA), inicialB: inicial(s.nombreB),
    escudoA: escudo(s.nombreA, JUEGO, 26), escudoB: escudo(s.nombreB, JUEGO, 26),
    gaugeColor: color, gaugeDash: gauge(s.prediccion.ganaA, color).dash,
    probA: pct(s.prediccion.ganaA),
    probStyle: { fontFamily: "'JetBrains Mono', monospace", fontSize: '16px', fontWeight: 800, color, lineHeight: 1 },
    // «Tendencia» en el diseño es el movimiento del rating. Acá se muestra el
    // Brier de la serie, que es el dato real que tenemos de ella.
    tend: n4(s.brier),
    tendStyle: { fontFamily: "'JetBrains Mono', monospace", fontSize: '10.5px', fontWeight: 700, color: s.brier < s.base ? C.ok : C.aviso, marginTop: '4px' },
    mercadoA: VACIO,
    edge: textoBrier(s.brier, s.base),
    edgeStyle: estiloBrier(s.brier, s.base),
    cierra: s.fecha,
    rowStyle: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) 92px 60px 190px 96px 92px 96px', gap: '10px', padding: '14px 18px 14px 15px', borderBottom: `1px solid ${C.linea}`, borderLeft: `3px solid ${color}99`, fontSize: '12px', alignItems: 'center', cursor: 'pointer' },
    onClick: `ficha:${s.seriesId}`,
    _pa: pa,
  };
}

// --- el objeto entero ----------------------------------------------------

// La banda superior de cada tarjeta.
//
// El diseño trae key art oficial de cada publisher en su carpeta arte/, y su
// propio README avisa: "verificar derechos de uso antes de publicar". Este
// sitio SE PUBLICA en GitHub Pages, así que no se usa. En su lugar va un
// degradado en el color del juego, que mantiene la composición de la tarjeta
// (chip y torneo sobre la banda, con el fundido al fondo) sin meter una
// imagen con derechos sin resolver.
//
// Para poner arte propio: pásalo como data URI en `arte` desde generar.mjs.
function arteStyle(uri, juego, pos) {
  const c = colorJuego(juego);
  if (!uri) {
    return {
      position: 'absolute', inset: 0,
      background: `radial-gradient(120% 140% at 20% 0%, ${c}2e, transparent 60%), linear-gradient(180deg, #12141b 0%, #0D1015 100%)`,
    };
  }
  return { position: 'absolute', inset: 0, backgroundImage: `url("${uri}")`, backgroundSize: 'cover', backgroundPosition: pos || 'center', backgroundRepeat: 'no-repeat' };
}

export function valores(r, { vista = 'home', serie = null, cuantasFilas = 150, arte = null } = {}) {
  const g = r.calidad.global;
  const recientes = r.series.slice(-24).reverse();
  const cal = r.calidad;

  const nav = [
    ['INICIO', 'home', 'ir:home'], ['PREDICCIONES', 'preds', 'ir:preds'],
    ['CLASIFICACIÓN', 'board', 'ir:board'], ['CALIDAD', 'calidad', 'ir:calidad'],
    ['CAMBIOS', 'news', 'ir:news'],
  ];

  const filas = r.series.slice(-cuantasFilas).reverse().map(serieComoFila);

  // Las tres peores del histórico: es el equivalente honesto de «mayor
  // desvío», midiendo contra la base ingenua en vez de contra una cuota que
  // no tenemos.
  const peores = r.series.slice().sort((a, b) => (b.brier - b.base) - (a.brier - a.base)).slice(0, 3);

  const base = {
    // --- chrome ---
    navItems: nav.map(([label, v, accion]) => ({ label, onClick: accion, style: navStyle(v === vista) })),
    railHome: railStyle(vista === 'home'), railPreds: railStyle(vista === 'preds' || vista === 'match'),
    railBoard: railStyle(vista === 'board'), railCalidad: railStyle(vista === 'calidad'),
    railNews: railStyle(vista === 'news'), railAjustes: railStyle(vista === 'contacto', true),
    goHome: 'ir:home', goPreds: 'ir:preds', goBoard: 'ir:board', goCalidad: 'ir:calidad',
    goNews: 'ir:news', goAbout: 'ir:about', goFaq: 'ir:faq', goTerms: 'ir:terms',
    goContacto: 'ir:contacto', goBack: 'ir:preds',

    // Todas las vistas se emiten y el script muestra una. La ficha es la
    // excepción: vive en su propia página, con URL propia.
    viewHome: true, viewPreds: true, viewBoard: true, viewCalidad: true, viewNews: true,
    viewAbout: true, viewFaq: true, viewTerms: true, viewContacto: true,
    viewMatch: false,

    esMock: false, hayError: false, errorMsg: '',
    cicloTexto: `Histórico versionado · ${miles(r.partidas.length)} partidas · ${miles(g.cantidad)} series juzgadas`,
    mostrarSidebar: true, mostrarSalud: true,
    fuentes: [
      { nombre: 'OpenDota', estado: 'ok', detalle: `${miles(r.partidas.length)} partidas`, dot: dot('ok') },
      { nombre: 'Supabase', estado: 'caido', detalle: 'sin credenciales', dot: dot('caido') },
      { nombre: 'Cuotas', estado: 'caido', detalle: 'requiere Supabase', dot: dot('caido') },
    ],

    // --- Inicio ---
    partidos: recientes.slice(0, 4).map((s) => serieComoPartido(s, arte)),
    topEdge: peores.map((s) => ({
      titulo: `${s.nombreA} vs ${s.nombreB}`,
      edge: textoBrier(s.brier, s.base),
      edgeStyle: estiloBrier(s.brier, s.base),
      detalle: `${s.formato.toUpperCase()} · Brier ${n4(s.brier)} vs base ${n4(s.base)}`,
      onClick: `ficha:${s.seriesId}`,
    })),

    // --- Predicciones ---
    filtros: [], predsUltima: r.series.at(-1)?.fecha ?? VACIO,
    pTodos: { onClick: 'filtro:todos', style: pillGame(C.acento, true) },
    pDota: { onClick: 'filtro:DOTA 2', style: pillGame(colorJuego('DOTA 2'), false) },
    pCs2: { onClick: 'filtro:CS2', style: pillGame(colorJuego('CS2'), false) },
    pLol: { onClick: 'filtro:LOL', style: pillGame(colorJuego('LOL'), false) },
    pVal: { onClick: 'filtro:VALORANT', style: pillGame(colorJuego('VALORANT'), false) },
    ordenEdge: 'orden:edge', ordenMotor: 'orden:motor', ordenCierre: 'orden:cierra',
    tabla: filas,

    // --- Calidad (datos reales del backtest) ---
    brier: Object.values(cal.porFormato).map((f) => ({
      formato: f.formato.toUpperCase(), motor: n4(f.brier), ingenua: n4(f.base),
      barStyle: { width: `${Math.max(0, Math.min(100, (1 - f.brier / f.base) * 700))}%`, height: '100%', background: f.brier < f.base ? C.ok : C.aviso },
      mejora: `${f.brier < f.base ? '−' : '+'}${(Math.abs(1 - f.brier / f.base) * 100).toFixed(1)} % · n=${miles(f.cantidad)}`,
    })),
    duelo: Object.entries(COEFICIENTES ?? {}).map(([juego, c]) => ({
      juego: juego.toUpperCase(), motor: c.motor ?? 'Elo',
      coef: c.motor === 'glicko2' ? `τ=${c.tau ?? VACIO} · RD=${c.rdInicial ?? VACIO}` : `K=${c.kFactor ?? K_FACTOR} · escala=${c.escala ?? ESCALA}`,
      dif: VACIO, t: VACIO,
      veredicto: 'El duelo Elo vs Glicko-2 está en CLAUDE.md; acá no se recalcula.',
      chip: chipJuego(juego.toUpperCase() === 'DOTA2' ? 'DOTA 2' : juego.toUpperCase()),
    })),
    metodo: [
      `Pasada cronológica sobre ${miles(r.partidas.length)} partidas reales: al predecir una serie el código sólo ve partidas anteriores a su primera partida.`,
      'La probabilidad sale del rating Elo de ANTES de la serie, y una vez guardada no se reescribe.',
      `La base ingenua no es una sola: bo1/bo3/bo5 se deciden entre dos clases (0.5) y bo2 admite empate real, así que son tres (${n4(BASE_INGENUA.bo2)}).`,
      `Los coeficientes (K=${K_FACTOR}, escala=${ESCALA}, deltaBo2=${DELTA_BO2}) salieron de un barrido documentado en config.mjs.`,
    ],
    limites: [
      'El Elo no expresa incertidumbre: un equipo con 29 partidas produce probabilidades tan extremas como uno con 334.',
      'Glicko-2 le gana a Elo en CS2 de forma concluyente, pero en Dota el intervalo contiene el cero. Por eso Dota sigue en Elo.',
      'Sin cuotas guardadas no hay forma de medirse contra el mercado. Las columnas existen y salen vacías.',
      'Esto no dice que el motor sirva para apostar. No se aceptan apuestas ni se recomienda apostar.',
    ],

    // --- Cambios ---
    changelog: r.cambios.map((c) => {
      const col = { 'CORRECCIÓN': C.aviso, MOTOR: C.acento, DATOS: '#00CFFF', 'DISEÑO': C.ok }[c.tipo] ?? C.tintaApagada;
      return { ...c, chip: { fontSize: '9px', fontWeight: 800, letterSpacing: '0.1em', padding: '5px 9px', borderRadius: '7px', color: col, border: `1px solid ${col}55`, background: 'rgba(5,7,10,0.8)', whiteSpace: 'nowrap', display: 'inline-block' } };
    }),

    // --- páginas estáticas: copy del propio diseño ---
    cifras: [
      { n: String(Object.keys(cal.porFormato).length), t: 'formatos de serie cubiertos' },
      { n: '1', t: 'motor calibrado contra su histórico' },
      { n: miles(g.cantidad), t: 'series juzgadas contra el resultado real' },
    ],
    faq: [
      { q: '¿Esto es una casa de apuestas?', a: 'No. No se aceptan apuestas y no se recomienda apostar.' },
      { q: '¿De dónde sale el porcentaje?', a: `Del cálculo: rating Elo (K=${K_FACTOR}, escala=${ESCALA}) convertido a probabilidad de serie según el formato. Ningún modelo de lenguaje produce un número que llegue a esta pantalla.` },
      { q: '¿Por qué algunas columnas salen vacías?', a: 'Porque el dato no existe todavía. Las cuotas y las series próximas viven en Supabase; sin credenciales no hay de dónde sacarlas, y rellenarlas con algo inventado rompería la primera regla del proyecto.' },
      { q: '¿Qué es el Brier?', a: `El error cuadrático de la probabilidad contra lo que pasó. Más bajo es mejor. La referencia es la base ingenua: ${n4(BASE_INGENUA.bo3)} en bo1/bo3/bo5 y ${n4(BASE_INGENUA.bo2)} en bo2.` },
      { q: '¿Por qué Dota usa Elo y no Glicko-2?', a: 'Porque Glicko-2 no se ganó el puesto contra el histórico de Dota: el intervalo de confianza contiene el cero. Cada juego se gana su motor con su propio backtest.' },
    ],
    terms: [
      { h: '1. NATURALEZA DEL SERVICIO', p: 'Monitor eSports publica la salida de un modelo estadístico con fines informativos. No es un servicio de apuestas ni de asesoramiento financiero.' },
      { h: '2. SIN GARANTÍA DE RESULTADO', p: 'Una probabilidad no es una predicción cerrada. El rendimiento histórico de la sección Calidad no garantiza el rendimiento futuro.' },
      { h: '3. DATOS DE TERCEROS', p: 'Las partidas vienen de OpenDota. Se escapan todos los datos de terceros antes de mostrarlos, pero no se valida su esquema.' },
      { h: '4. DISPONIBILIDAD', p: 'El panel se genera del histórico versionado. Una caída de fuente puede dejar series sin predecir, y no se rellenan retroactivamente.' },
    ],
    contacto: [
      { canal: 'Errores de datos', para: 'Series mal emparejadas, torneos que faltan, marcadores erróneos', destino: 'el repositorio en GitHub' },
      { canal: 'Método y matemática', para: 'Dudas sobre el backtest, los coeficientes o la corrección de Bo2', destino: 'CLAUDE.md, que tiene el porqué de cada número' },
      { canal: 'Avisos del ciclo', para: 'Notificación por Discord de cada predicción publicada', destino: 'salida/discord-esports.mjs' },
    ],

    // --- ficha: se rellena en generarFicha() ---
    ...fichaVacia(),
    // --- pantallas del diseño sin dato en este proyecto ---
    ...clasificacionValores(r),
    ...calidadValores(r),
  };

  if (serie) Object.assign(base, ficha(serie, r, arte));
  return base;
}

// --- ficha ---------------------------------------------------------------

function fichaVacia() {
  return {
    mJuego: '', mChip: {}, mTorneo: '', mFormato: '', mInicio: '', mCierra: '',
    mTeamA: '', mTeamB: '', mInicialA: '', mInicialB: '', mEscudoA: {}, mEscudoB: {},
    mRatingA: '', mRdA: '', mRatingB: '', mRdB: '', mProbA: '', mProbB: '',
    mMercadoA: VACIO, mMercadoB: VACIO, mEdge: '', mEdgeStyle: {},
    mMarcadores: [], mCongelado: [], mH2h: [],
    mEmbed: false, mSinStream: true, mArteStyle: {}, mReproductor: false, mPoster: false,
    mStreamUrl: '', mStreamLabel: '', mStreamPage: '#', mStreamNota: '',
    mPlataforma: 'YOUTUBE', useTwitch: '', useYoutube: '', ytTab: tab(true), twTab: tab(false),
  };
}

export function ficha(s, r, arte) {
  const marcadores = marcadoresDeSerie(s);
  const maxP = Math.max(...marcadores.map((m) => m.prob), 1e-9);
  const h2h = r.series.filter((o) => o.startTime < s.startTime
    && ((o.equipoA === s.equipoA && o.equipoB === s.equipoB) || (o.equipoA === s.equipoB && o.equipoB === s.equipoA)))
    .slice(-5).reverse();

  return {
    viewMatch: true, viewHome: false, viewPreds: false, viewBoard: false,
    viewCalidad: false, viewNews: false, viewAbout: false, viewFaq: false,
    viewTerms: false, viewContacto: false,
    mJuego: JUEGO, mChip: chipJuego(JUEGO), mTorneo: s.torneo, mFormato: s.formato.toUpperCase(),
    mInicio: s.fecha, mCierra: VACIO,
    mTeamA: s.nombreA, mTeamB: s.nombreB,
    mInicialA: inicial(s.nombreA), mInicialB: inicial(s.nombreB),
    mEscudoA: escudo(s.nombreA, JUEGO, 44), mEscudoB: escudo(s.nombreB, JUEGO, 44),
    mRatingA: Math.round(s.ratingA), mRatingB: Math.round(s.ratingB),
    // El Elo no tiene desviación: es el límite conocido del motor, y se dice.
    mRdA: 'n/a (Elo)', mRdB: 'n/a (Elo)',
    mProbA: pct(s.prediccion.ganaA), mProbB: pct(s.prediccion.ganaB),
    mMercadoA: VACIO, mMercadoB: VACIO,
    mEdge: textoBrier(s.brier, s.base), mEdgeStyle: estiloBrier(s.brier, s.base, true),
    mMarcadores: marcadores.map((m) => ({
      label: m.marcador, pct: (m.prob * 100).toFixed(1) + ' %',
      barStyle: { width: `${(m.prob / maxP) * 100}%`, height: '100%', background: m.esReal ? C.acento : C.lineaFuerte },
    })),
    mCongelado: [
      { k: 'Motor', v: 'Elo' },
      { k: 'Coeficientes', v: `K=${K_FACTOR} · escala=${ESCALA}` },
      { k: 'Rating al predecir', v: `${Math.round(s.ratingA)} vs ${Math.round(s.ratingB)}` },
      { k: 'Clase real', v: s.real },
      { k: 'Brier', v: `${n4(s.brier)} (base ${n4(s.base)})` },
    ],
    mH2h: h2h.map((o) => ({ fecha: o.fecha, evento: o.torneo, marcador: o.real === 'ganaA' ? `gana ${o.nombreA}` : o.real === 'ganaB' ? `gana ${o.nombreB}` : 'empate' })),
    mEmbed: false, mSinStream: true, mArteStyle: arteStyle(arte, JUEGO, 'center 35%'),
  };
}

// --- Clasificación -------------------------------------------------------

function clasificacionValores(r) {
  const lider = r.clasificacion[0]?.rating ?? 1;
  const filas = r.clasificacion.map((f, i) => ({
    pos: f.posicion,
    posColor: i === 0 ? '#F5C400' : i === 1 ? '#C7CDD9' : i === 2 ? '#C97B3D' : C.tintaApagada,
    equipo: f.nombre, escudo: escudo(f.nombre, JUEGO, 24), inicial: inicial(f.nombre),
    rating: miles(Math.round(f.rating)),
    // Sin dato de tendencia por equipo en el histórico: no se inventa.
    tendArrow: '', tendVal: VACIO, tendColor: C.tintaApagada,
    confPct: VACIO, ringDash: ringDash(0, 11), ringColor: colorJuego(JUEGO),
    barStyle: { width: `${Math.max(4, (f.rating / lider) * 100)}%`, height: '100%', background: colorJuego(JUEGO) },
    rivalEscudo: {}, rivalInicial: '', rival: VACIO, fecha: VACIO, hora: '', torneo: `${f.partidas} partidas`,
  }));

  return {
    clasifTabs: [{ key: 'dota2', label: 'DOTA 2', onClick: 'nada', style: { cursor: 'default', display: 'flex', alignItems: 'center', gap: '8px', padding: '13px 16px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', color: C.tinta, borderBottom: `2px solid ${colorJuego(JUEGO)}`, whiteSpace: 'nowrap' }, dotStyle: { width: '7px', height: '7px', borderRadius: '999px', background: colorJuego(JUEGO), display: 'inline-block', flex: 'none' } }],
    clasifRegionValue: 'todas',
    clasifRegionOptions: [{ v: 'todas', t: 'Sin regiones en el histórico' }],
    clasifOnRegion: 'nada',
    clasifKpis: [
      { label: 'EQUIPOS EN EL RANKING', value: String(r.clasificacion.length), ctx: 'con 20 partidas mínimo', delta: '', iconBg: 'rgba(154,60,255,0.12)', iconColor: '#9A3CFF', isUsers: true },
      { label: 'ACIERTO DEL FAVORITO', value: (r.calidad.global.acierto * 100).toFixed(1) + '%', ctx: 'sobre todo el histórico', delta: '', iconBg: 'rgba(25,230,140,0.12)', iconColor: C.ok, isTarget: true },
      { label: 'PARTIDAS APLICADAS', value: miles(r.partidas.length), ctx: 'al rating de cada equipo', delta: '', iconBg: 'rgba(0,207,255,0.12)', iconColor: '#00CFFF', isTrend: true },
      { label: 'SERIES JUZGADAS', value: miles(r.calidad.global.cantidad), ctx: 'contra su resultado real', delta: '', iconBg: 'rgba(255,176,0,0.12)', iconColor: C.aviso, isClock: true },
    ],
    clasifHistBars: [], clasifHistTicks: [],
    clasifMetrics: [],
    clasifRankingTitulo: 'RANKING DE FUERZA · DOTA 2',
    clasifVacio: filas.length === 0,
    clasifFilas: filas,
    clasifOrdenCalifStyle: { color: C.tinta }, clasifOrdenConfStyle: { color: C.tintaApagada },
    clasifOrdenCalifArrow: '↓', clasifOrdenConfArrow: '',
    clasifOrdenCalif: 'nada', clasifOrdenConf: 'nada',
    clasifEvoSeries: [], clasifEvoXLabels: [], clasifEvoYLabels: [],
    clasifScatter: [], clasifLeaders: [],
  };
}

// --- Calidad (el gauge y los históricos del diseño) ----------------------

function calidadValores(r) {
  const g = r.calidad.global;
  const acierto = Math.round(g.acierto * 100);
  return {
    calUltima: r.series.at(-1)?.fecha ?? VACIO,
    calGaugeDash: ringDash(acierto, 42), calGaugeVal: `${acierto}%`,
    calGaugeLabel: g.concluyente ? 'CONCLUYENTE' : 'NO CONCLUYENTE',
    calPrecision: `${acierto}%`, calPartidas: miles(g.cantidad), calCorrectas: miles(g.aciertos),
    calVariacion: `IC 95% [${n4(g.bajo)}, ${n4(g.alto)}]`,
    calConfDash: ringDash(0, 0), calConfVal: VACIO,
    calConfBarStyle: { width: `${acierto}%`, height: '100%', background: 'linear-gradient(90deg, #0B5F39, #19E68C)' },
    calGames: Object.values(r.calidad.porFormato).map((f) => ({
      key: f.formato.toUpperCase(), label: f.formato.toUpperCase(), color: colorJuego(JUEGO),
      score: Math.round(f.acierto * 100), estado: f.brier < f.base ? 'MEJOR QUE LA BASE' : 'PEOR QUE LA BASE',
      conf: Math.round((1 - f.brier / f.base) * 100), partidas: miles(f.cantidad),
      variacion: `${f.brier < f.base ? '−' : '+'}${Math.abs(f.brier - f.base).toFixed(4)}`,
      ringDash: ringDash(f.acierto * 100, 27), chip: chipJuego(JUEGO),
    })),
    calSpark: '', calTfs: [], calHistPts: [], calHistPoints: '', calHistAreaPoints: '',
    calFactores: [
      { nombre: 'Series juzgadas', estado: miles(g.cantidad), color: C.ok, icon: 'database' },
      { nombre: 'Intervalo de confianza', estado: g.concluyente ? 'CONCLUYENTE' : 'NO CONCLUYENTE', color: g.concluyente ? C.ok : C.aviso, icon: 'activity' },
      { nombre: 'Cuotas para comparar', estado: 'SIN DATO', color: C.tintaApagada, icon: 'hex' },
      { nombre: 'Motor', estado: 'ELO', color: colorJuego(JUEGO), icon: 'refresh' },
    ],
  };
}
