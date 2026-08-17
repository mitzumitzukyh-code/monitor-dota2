// Demo: tabla propuesta en Discord con emojis para la racha. Datos reales.

import { partidasDeLaLiga, seriesDeLaLiga } from '../datos/liga.mjs';
import { seleccionar } from '../datos/supabase.mjs';
import { tablaDePosiciones } from '../juez/tabla.mjs';
import { enviar } from '../salida/discord.mjs';

const [partidas, teams] = await Promise.all([
  partidasDeLaLiga(19719),
  seleccionar('dota_teams', '?select=*'),
]);
const nombre = new Map(teams.map((t) => [t.team_id, t.nombre]));
const series = seriesDeLaLiga(partidas);
const grupos = series.filter((s) => s.startTime < Date.UTC(2026, 7, 20) / 1000);
const filas = tablaDePosiciones(grupos);

const racha = new Map();
for (const s of grupos) {
  const ganoA = s.victoriasA > s.victoriasB;
  for (const [id, gano] of [[s.equipoA, ganoA], [s.equipoB, !ganoA]]) {
    if (!racha.has(id)) racha.set(id, []);
    racha.get(id).push(gano);
  }
}
for (const l of racha.values()) l.reverse();

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

const cubo = (gano) => (gano ? '🟥' : '⬛');

const lineas = [];
lineas.push('🏆 TABLA DEL TI — FASE DE GRUPOS');
lineas.push(`${grupos.length} series jugadas · 8 pasan al Main Event`);
lineas.push('');
lineas.push('POS EQUIPO             SERIES  MAPAS  RACHA');
for (const f of filas) {
  const m = mapas.get(f.teamId) ?? [0, 0];
  const r = (racha.get(f.teamId) ?? []).slice(0, 6).map(cubo).join('');
  lineas.push(
    `${String(f.posicion).padStart(3)} ${(nombre.get(f.teamId) ?? '?').padEnd(16)} ${f.ganadas}-${f.perdidas} ${String(m[0]).padStart(2)}-${String(m[1]).padEnd(2)} ${r}`,
  );
  if (f.posicion === 8) lineas.push('  ··· CORTE ···');
}
lineas.push('');
lineas.push('🟥 ganada · ⬛ perdida, en orden.');

const contenido = '```' + lineas.join('\n') + '```';
console.log(contenido);
const r = await enviar(contenido);
console.log(r.enviado ? 'enviado a Discord' : 'NO enviado — ' + r.razon);