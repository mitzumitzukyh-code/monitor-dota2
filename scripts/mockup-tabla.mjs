// Mockup del diseño propuesto de tabla: genera un HTML aparte (NO toca el
// panel real) con datos reales de la fase de grupos de TI2026.

import { partidasDeLaLiga, seriesDeLaLiga } from '../datos/liga.mjs';
import { seleccionar } from '../datos/supabase.mjs';
import { tablaDePosiciones } from '../juez/tabla.mjs';

const [partidas, teams] = await Promise.all([
  partidasDeLaLiga(19719),
  seleccionar('dota_teams', '?select=*'),
]);
const nombre = new Map(teams.map((t) => [t.team_id, t.nombre]));
const series = seriesDeLaLiga(partidas);
const grupos = series.filter((s) => s.startTime < Date.UTC(2026, 7, 20) / 1000);
const filas = tablaDePosiciones(grupos);

// Racha real: últimas series de cada equipo (W/L).
const racha = new Map();
for (const s of grupos) {
  const ganoA = s.victoriasA > s.victoriasB;
  for (const [id, gano] of [[s.equipoA, ganoA], [s.equipoB, !ganoA]]) {
    if (!racha.has(id)) racha.set(id, []);
    racha.get(id).push(gano);
  }
}
for (const lista of racha.values()) lista.reverse();

// Mapas ganados-perdidos por equipo.
const mapas = new Map();
for (const s of grupos) {
  for (const [id, g, p] of [
    [s.equipoA, s.victoriasA, s.victoriasB],
    [s.equipoB, s.victoriasB, s.victoriasA],
  ]) {
    if (!mapas.has(id)) mapas.set(id, [0, 0]);
    const m = mapas.get(id);
    m[0] += g;
    m[1] += p;
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cubo = (gano) =>
  `<span style="display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:2px; background:${gano ? '#3fbf6f' : '#e0523f'};"></span>`;

// Head-to-head entre empatados: el par que se enfrentó entre sí.
function h2h(lista) {
  const textos = [];
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      const s = grupos.find(
        (x) =>
          (x.equipoA === lista[i] && x.equipoB === lista[j]) ||
          (x.equipoA === lista[j] && x.equipoB === lista[i]),
      );
      if (!s) continue;
      const ganoA = s.victoriasA > s.victoriasB;
      const gano = ganoA ? s.equipoA : s.equipoB;
      const ganoNombre = esc(nombre.get(gano));
      const otroNombre = esc(nombre.get(gano === s.equipoA ? s.equipoB : s.equipoA));
      textos.push(`<span style="color:#8a8481;">· ${ganoNombre} le ganó a ${otroNombre}</span>`);
    }
  }
  return textos.length ? textos.join(' ') : '';
}

const TEAMS_2026 = new Set([
  9572001, 9247354, 10150538, 5017210, 8255888, 10150413, 2586976, 10136357,
  8261500, 7119388, 9823272, 10149530, 9467224, 9964962, 726228, 2163,
]);

const filas16 = filas.filter((f) => TEAMS_2026.has(f.teamId));

const cuerpo = filas16
  .map((f, i) => {
    const corte = i === 7; // 8 pasan al Main Event
    const m = mapas.get(f.teamId) ?? [0, 0];
    const r = (racha.get(f.teamId) ?? []).slice(0, 6).map(cubo).join('');
    const dif = m[0] - m[1];
    const difColor = dif > 0 ? '#3fbf6f' : dif < 0 ? '#e0523f' : '#8a8481';
    const fila = `
    <div style="display:flex; align-items:center; gap:14px; padding:9px 24px; ${i % 2 ? 'background:rgba(243,242,242,0.02);' : ''}">
      <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:${i < 8 ? '#ff563c' : '#8a8481'}; width:20px; text-align:right;">${f.posicion}</span>
      <span style="font-weight:600; font-size:14px; width:150px;">${esc(nombre.get(f.teamId))}</span>
      <span style="font-family:'IBM Plex Mono',monospace; font-size:13px; width:56px;">${f.ganadas}-${f.perdidas}</span>
      <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:${difColor}; width:64px; font-variant-numeric:tabular-nums;">${m[0]}-${m[1]} <span style="color:#5c5858;">(±${Math.abs(dif)})</span></span>
      <span style="flex:1; white-space:nowrap;">${r}</span>
    </div>`;
    const cabecera = i === 0 ? `
    <div style="display:flex; align-items:center; gap:14px; padding:8px 24px; border-bottom:1px solid rgba(243,242,242,0.18); font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:0.1em; color:#8a8481;">
      <span style="width:20px; text-align:right;">POS</span>
      <span style="width:150px;">EQUIPO</span>
      <span style="width:56px;">SERIES</span>
      <span style="width:64px;">MAPAS</span>
      <span>ÚLTIMAS SERIES</span>
    </div>` : '';
    const notaEmpate = h2h(filas16.filter((x) => x.ganadas === f.ganadas && x.perdidas === f.perdidas).map((x) => x.teamId));
    const nota = i > 0 && filas16[i - 1].posicion !== f.posicion && notaEmpate
      ? `<div style="padding:2px 24px 8px; font-family:'IBM Plex Mono',monospace; font-size:11px;">${notaEmpate}</div>`
      : '';
    const corteHtml = corte ? `
    <div style="border-top:2px dashed rgba(255,86,60,0.5); margin:0 24px; display:flex; justify-content:center;">
      <span style="font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:0.12em; color:#ff563c; background:#171615; padding:0 10px; transform:translateY(-7px);">CORTE · 8 PASAN AL MAIN EVENT</span>
    </div>` : '';
    return `${cabecera}${fila}${nota}${corteHtml}`;
  })
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diseño propuesto · Tabla del TI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>html,body{margin:0;padding:0;background:#171615;}::selection{background:rgba(255,86,60,0.35);}</style>
</head>
<body>
<div style="min-height:100vh; background:#171615; color:#f3f2f2; font-family:'Archivo',sans-serif; font-size:14px; -webkit-font-smoothing:antialiased;">
  <div style="display:flex; align-items:baseline; justify-content:space-between; gap:24px; flex-wrap:wrap; padding:14px 24px; border-bottom:2px solid rgba(243,242,242,0.45);">
    <span style="font-family:'IBM Plex Mono',monospace; font-size:13px; font-weight:600; letter-spacing:0.14em;">TABLA DEL TI · DISEÑO PROPUESTO</span>
    <span style="font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:0.1em; color:#9b9797;">FASE DE GRUPOS · DATOS REALES · ${grupos.length} SERIES</span>
  </div>

  <div style="padding:20px 24px; max-width:760px;">
    ${cuerpo}
  </div>

  <div style="padding:0 24px 24px; font-family:'IBM Plex Mono',monospace; font-size:11px; color:#8a8481; line-height:1.8; max-width:90ch;">
    <b style="color:#bab6b6;">Qué cambia vs la tabla actual (posición + récord):</b><br>
    · <b style="color:#bab6b6;">Mapas</b> y diferencia: 2-0 y 2-1 no pesan igual, y es dato real de la fuente.<br>
    · <b style="color:#bab6b6;">Racha</b>: las últimas series del equipo, para ver la inercia (como en la grilla, pero en la tabla).<br>
    · <b style="color:#bab6b6;">Línea de corte</b> en 8: el Main Event es de 8 equipos (hecho del formato), sin inventar desempates internos.<br>
    · <b style="color:#bab6b6;">Head-to-head</b> entre empatados: nota, NO criterio de orden — los que van 3-3 siguen compartiendo posición.<br>
    · El orden de los empatados sigue siendo incidental (sale del teamId): no se finge un desempate que no existe.
  </div>
</div>
</body>
</html>`;

await import('node:fs/promises').then((fs) => fs.writeFile('mockup-tabla.html', html));
console.log('mockup-tabla.html generado (con los récords reales de grupos)');