// Refresca datos/logos-dota.json con los escudos de OpenDota.
//
// Sólo pregunta por los equipos que TODAVÍA NO están en el archivo, así que
// correrlo dos veces seguidas no gasta ni una petición (regla 5). Corre solo
// cuando aparezcan equipos nuevos:
//
//   node --env-file=.env scripts/logos-dota.mjs
//
// Los equipos salen de dota_teams (los que de verdad se han predicho) más los
// 16 de TI2026, por si alguno todavía no tiene serie guardada.

import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { seleccionar } from '../datos/supabase.mjs';
import { logoDeEquipo } from '../datos/logos-dota.mjs';
import { EQUIPOS_TI2026 } from '../datos/equipos-ti2026.mjs';

const ARCHIVO = new URL('../datos/logos-dota.json', import.meta.url);

// Entre petición y petición: OpenDota permite 60 por minuto y no hay ningún
// apuro por terminar medio segundo antes.
const PAUSA_MS = 1100;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let guardados = {};
try {
  guardados = JSON.parse(readFileSync(ARCHIVO, 'utf8'));
} catch {
  // Primera corrida: el archivo todavía no existe.
}

const equipos = new Map(EQUIPOS_TI2026.map((e) => [e.teamId, e.nombre]));
try {
  for (const t of await seleccionar('dota_teams', '?select=team_id,nombre&order=team_id.asc')) {
    equipos.set(t.team_id, t.nombre);
  }
} catch (e) {
  // Sin Supabase se trabaja con los 16 de TI2026 y ya. Es peor no hacer nada.
  console.warn(`  (sin Supabase: ${e.message}). Sigo con los ${equipos.size} de TI2026.`);
}

const faltantes = [...equipos.entries()].filter(([id]) => !(String(id) in guardados));

if (faltantes.length === 0) {
  console.log(`Nada que pedir: los ${equipos.size} equipos ya están en el archivo.`);
  process.exit(0);
}

console.log(`${equipos.size} equipos conocidos, ${faltantes.length} sin escudo guardado. Preguntando a OpenDota...`);

let conLogo = 0;
let sinLogo = 0;
let fallidos = 0;

for (const [i, [id, nombre]] of faltantes.entries()) {
  if (i > 0) await dormir(PAUSA_MS);

  const logo = await logoDeEquipo(id);
  // null = no se pudo saber. NO se guarda: mejor volver a preguntar la próxima
  // vez que grabar "no tiene" por una caída pasajera de OpenDota.
  if (logo === null) {
    fallidos++;
    console.log(`  ${nombre} (${id}): no se pudo saber, queda pendiente`);
    continue;
  }

  guardados[String(id)] = logo;
  if (logo) {
    conLogo++;
    console.log(`  ${nombre} (${id}): ok`);
  } else {
    sinLogo++;
    console.log(`  ${nombre} (${id}): OpenDota no tiene escudo`);
  }
}

// Ordenado por id para que el diff del archivo sea legible y no cambie de
// orden en cada corrida.
const ordenado = Object.fromEntries(Object.keys(guardados).sort((a, b) => Number(a) - Number(b)).map((k) => [k, guardados[k]]));
await writeFile(ARCHIVO, JSON.stringify(ordenado, null, 2) + '\n', 'utf8');

console.log(`\n${conLogo} con escudo, ${sinLogo} sin escudo, ${fallidos} pendientes. Total guardado: ${Object.keys(ordenado).length}.`);
