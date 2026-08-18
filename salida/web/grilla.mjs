// Grilla de posiciones para el panel web. Dos formas distintas porque el
// torneo tiene dos formatos distintos:
//
//   - Fase de grupos de TI2026: suizo de 16 equipos. NO hay grupos ni llave;
//     los equipos se agrupan por récord (4-0, 3-1, ...). Es lo que se dibuja
//     hoy y es lo único verificado contra datos reales.
//   - Main Event (20-23 ago): eliminación directa. Ahí sí hay llave, con la
//     forma del cuadro de un mundial. Ver `grillaLlave` y su advertencia.
//
// Todo sale de las series reales del torneo (seriesDeLaLiga), no de lo que el
// sistema haya predicho: hay series de TI que nunca se predijeron y aun así
// cuentan para la posición.

// El Main Event arranca el 20 de agosto de 2026. El cambio de vista es por
// fecha y no por estructura porque la fuente no trae etiqueta de ronda ni de
// fase -- no hay forma de deducir "esto es playoff" de los datos mismos.
export const INICIO_MAIN_EVENT = Date.UTC(2026, 7, 20) / 1000;

import { esc } from './estilo.mjs';

// Camino de cada equipo: sus series en orden cronológico, ganada o perdida.
// El número de ronda sale del ORDEN, no de la fuente (que no lo trae). En un
// suizo eso coincide con la ronda real mientras nadie se salte una.
export function caminosDeEquipos(series) {
  const porEquipo = new Map();
  for (const s of series) {
    if (s.victoriasA === s.victoriasB) continue; // Bo2 empatado: no lo gana nadie
    const ganoA = s.victoriasA > s.victoriasB;
    for (const [id, gano, rival] of [
      [s.equipoA, ganoA, s.equipoB],
      [s.equipoB, !ganoA, s.equipoA],
    ]) {
      if (!porEquipo.has(id)) porEquipo.set(id, []);
      porEquipo.get(id).push({ t: s.startTime, gano, rival });
    }
  }

  const filas = [];
  for (const [teamId, lista] of porEquipo) {
    lista.sort((a, b) => a.t - b.t);
    const ganadas = lista.filter((x) => x.gano).length;
    filas.push({
      teamId,
      camino: lista,
      ganadas,
      perdidas: lista.length - ganadas,
      jugadas: lista.length,
    });
  }

  return filas.sort(
    (a, b) => b.ganadas - b.perdidas - (a.ganadas - a.perdidas) || b.ganadas - a.ganadas || a.teamId - b.teamId,
  );
}

// Un tono por récord: verde arriba, rojo abajo. NO significa clasificado ni
// eliminado -- la regla de corte del suizo de TI no se puede deducir de los
// datos, así que el color sólo dice "va mejor / va peor".
function tonoPorDiferencia(dif, maxDif) {
  if (maxDif === 0) return { borde: '#1b2634', fondo: '#0a121b' };
  const t = (dif + maxDif) / (2 * maxDif); // 0 = peor, 1 = mejor
  const tono = Math.round(0 + t * 130); // 0 rojo -> 130 verde
  return { borde: `hsla(${tono}, 62%, 52%, 0.45)`, fondo: `hsla(${tono}, 62%, 52%, 0.08)` };
}

function celdaCamino(camino) {
  return camino
    .map(
      (x) =>
        `<span title="${x.gano ? 'ganó' : 'perdió'}" style="display:inline-block; width:9px; height:9px; border-radius:3px; margin-right:3px; background:${
          x.gano ? '#22c55e' : '#ef4444'
        };"></span>`,
    )
    .join('');
}

// Grilla del suizo: una tarjeta por récord, los equipos adentro. Es el eco
// honesto del cuadro de grupos de un mundial -- mismas tarjetas de colores,
// pero agrupadas por lo que de verdad agrupa a un suizo.
export function grillaSuiza(series, nombre, { destacados = new Set() } = {}) {
  const filas = caminosDeEquipos(series);
  if (filas.length === 0) return '<div class="vacio">Todavía no hay series jugadas.</div>';

  const cubos = new Map();
  for (const f of filas) {
    const clave = `${f.ganadas}-${f.perdidas}`;
    if (!cubos.has(clave)) cubos.set(clave, { clave, dif: f.ganadas - f.perdidas, equipos: [] });
    cubos.get(clave).equipos.push(f);
  }

  const lista = [...cubos.values()].sort((a, b) => b.dif - a.dif);
  const maxDif = Math.max(...lista.map((c) => Math.abs(c.dif)), 1);

  const tarjetas = lista
    .map((cubo) => {
      const { borde, fondo } = tonoPorDiferencia(cubo.dif, maxDif);
      const equipos = cubo.equipos
        .map((f) => {
          const resaltado = destacados.has(f.teamId);
          return `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:7px 12px; ${
          resaltado ? 'background:rgba(239,68,68,0.10);' : ''
        }">
          <span style="font-size:13px; ${resaltado ? 'font-weight:600; color:#fca5a5;' : 'color:#c3cddb;'}">${esc(nombre(f.teamId))}</span>
          <span style="white-space:nowrap;">${celdaCamino(f.camino)}</span>
        </div>`;
        })
        .join('');

      return `
      <div style="border:1px solid ${borde}; background:${fondo}; border-radius:12px; overflow:hidden; min-width:0;">
        <div style="display:flex; align-items:baseline; justify-content:space-between; padding:10px 12px; border-bottom:1px solid ${borde};">
          <span style="font-size:15px; font-weight:800; letter-spacing:0.02em;">${esc(cubo.clave)}</span>
          <span style="font-size:9px; font-weight:700; letter-spacing:0.12em; color:#5d6a7a;">${cubo.equipos.length} ${
            cubo.equipos.length === 1 ? 'EQUIPO' : 'EQUIPOS'
          }</span>
        </div>
        ${equipos}
      </div>`;
    })
    .join('\n');

  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap:14px; padding:18px 20px;">
      ${tarjetas}
    </div>
    <div style="padding:0 20px 18px; font-size:11px; color:#5d6a7a; line-height:1.7;">
      Agrupados por récord de series ganadas–perdidas. Cada cuadrito es una serie en orden:
      <span style="display:inline-block; width:9px; height:9px; border-radius:3px; background:#22c55e;"></span> ganada,
      <span style="display:inline-block; width:9px; height:9px; border-radius:3px; background:#ef4444;"></span> perdida.<br>
      El color de la tarjeta dice quién va mejor, no quién clasificó: la regla de corte del suizo no viene en los datos y no se inventa.
    </div>`;
}

// Llave del Main Event. ADVERTENCIA: al 15 de agosto de 2026 no existe ni una
// sola serie de playoff en la fuente, así que esto NO está verificado contra
// datos reales -- se dibuja de las series posteriores a INICIO_MAIN_EVENT
// agrupándolas por ronda cronológica. Cuando arranquen los cruces reales hay
// que mirarlo y corregir, no darlo por bueno.
export function grillaLlave(series, nombre, { pendientes = [] } = {}) {
  const jugadas = series
    .filter((s) => s.startTime >= INICIO_MAIN_EVENT)
    .map((s) => ({
      inicio: s.startTime,
      equipoA: s.equipoA,
      equipoB: s.equipoB,
      victoriasA: s.victoriasA,
      victoriasB: s.victoriasB,
      jugada: true,
    }));

  // Las que todavía no se juegan importan MÁS que las jugadas: el 20 de
  // agosto, cuando arranca el Main Event, no habrá ni una serie terminada y
  // la llave saldría vacía justo el día que interesa. Verificado contra el
  // calendario real: los 4 cruces de la primera ronda ya están publicados.
  const porJugar = pendientes
    .filter((p) => {
      const t = Math.floor(new Date(p.start_time).getTime() / 1000);
      return Number.isFinite(t) && t >= INICIO_MAIN_EVENT;
    })
    .map((p) => ({
      inicio: Math.floor(new Date(p.start_time).getTime() / 1000),
      equipoA: p.equipo_a,
      equipoB: p.equipo_b,
      probA: p.prob_gana_a == null ? null : Number(p.prob_gana_a),
      probB: p.prob_gana_b == null ? null : Number(p.prob_gana_b),
      jugada: false,
    }));

  const playoff = [...jugadas, ...porJugar].sort((a, b) => a.inicio - b.inicio);

  if (playoff.length === 0) {
    return `
    <div class="vacio">
      <div style="font-size:11px; font-weight:700; letter-spacing:0.14em; margin-bottom:8px;">LLAVE SIN DEFINIR</div>
      <div style="font-size:13px;">El Main Event arranca el 20 de agosto. Los cruces aparecen acá en cuanto se jueguen.</div>
    </div>`;
  }

  // Ronda = tanda de series que arrancan el mismo día. Es lo mejor que se
  // puede hacer sin etiqueta de ronda en la fuente.
  const porDia = new Map();
  for (const s of playoff) {
    const dia = new Date(s.inicio * 1000).toISOString().slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(s);
  }

  const columnas = [...porDia.entries()]
    .map(([dia, lista], i) => {
      const cruces = lista
        .map((s) => {
          // En una serie ya jugada el ganador va resaltado y se muestra el
          // marcador. En una por jugar no hay ganador todavía: se muestra la
          // probabilidad, y NO se resalta a nadie -- pintar al favorito como
          // si ya hubiera ganado es exactamente lo que no se debe hacer.
          const ganoA = s.jugada ? s.victoriasA > s.victoriasB : null;
          const linea = (id, gano, derecha) => `
            <div style="display:flex; justify-content:space-between; gap:8px; padding:8px 11px; ${
              gano === true ? 'color:#e5eaf1; font-weight:600;' : gano === false ? 'color:#5d6a7a;' : 'color:#c3cddb;'
            }">
              <span style="font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(nombre(id))}</span>
              <span style="font-size:12px; font-weight:700; font-variant-numeric:tabular-nums;">${esc(derecha)}</span>
            </div>`;

          const pct = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);
          const derA = s.jugada ? String(s.victoriasA) : pct(s.probA);
          const derB = s.jugada ? String(s.victoriasB) : pct(s.probB);

          return `
          <div style="border:1px solid ${
            s.jugada ? '#1b2634' : '#243244'
          }; background:${s.jugada ? '#0c141d' : 'transparent'}; border-radius:10px; overflow:hidden; margin-bottom:12px; ${
            s.jugada ? '' : 'border-style:dashed;'
          }">
            ${linea(s.equipoA, s.jugada ? ganoA : null, derA)}
            <div style="height:1px; background:#1b2634;"></div>
            ${linea(s.equipoB, s.jugada ? !ganoA : null, derB)}
          </div>`;
        })
        .join('');

      return `
      <div style="min-width:200px;">
        <div style="font-size:10px; font-weight:700; letter-spacing:0.14em; color:#5d6a7a; margin-bottom:10px;">RONDA ${
          i + 1
        }</div>
        ${cruces}
      </div>`;
    })
    .join('');

  return `
    <div style="display:flex; gap:20px; padding:18px 20px; overflow-x:auto;">
      ${columnas}
    </div>
    <div style="padding:0 20px 18px; font-size:11px; color:#5d6a7a;">
      Las rondas salen de agrupar por día de juego: la fuente no trae etiqueta de ronda.
    </div>`;
}

// Decide qué dibujar. Mientras no haya ni una serie de playoff, manda el suizo.
export function grillaDePosiciones(series, nombre, opciones = {}) {
  const { pendientes = [] } = opciones;

  // El cambio de vista mira TAMBIÉN lo pendiente, no sólo lo jugado. Si sólo
  // mirara lo jugado, el 20 de agosto —cuando el Main Event ya arrancó pero
  // ninguna serie terminó— el panel seguiría mostrando el suizo, que a esa
  // altura ya no dice nada. Verificado contra el calendario real: los 4
  // cruces del 20 están publicados desde días antes.
  const hayPlayoffJugado = series.some((s) => s.startTime >= INICIO_MAIN_EVENT);
  const hayPlayoffPorJugar = pendientes.some((p) => {
    const t = Math.floor(new Date(p.start_time).getTime() / 1000);
    return Number.isFinite(t) && t >= INICIO_MAIN_EVENT;
  });

  return hayPlayoffJugado || hayPlayoffPorJugar
    ? { titulo: 'LLAVE DEL MAIN EVENT', html: grillaLlave(series, nombre, { pendientes }) }
    : { titulo: 'GRILLA DEL SUIZO', html: grillaSuiza(series, nombre, opciones) };
}
