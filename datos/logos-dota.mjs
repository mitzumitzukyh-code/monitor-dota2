// Escudos de los equipos de Dota.
//
// POR QUÉ EXISTE
// Los otros tres juegos ya salían con escudo en el panel (bo3.gg lo trae en
// /teams) y Dota salía con el nombre pelado. Esto lo empareja.
//
// POR QUÉ UN ARCHIVO Y NO UNA COLUMNA EN SUPABASE
// Se consideró `dota_teams.logo`. Se descartó: obliga a correr una migración
// a mano y, sobre todo, Dota se muda a bo3.gg después de TI (ver CLAUDE.md),
// y ahí los escudos van a venir de la misma fuente que los de CS2, LoL y
// Valorant. Una columna que nace obsoleta en cinco días no vale el paso
// manual. El archivo se lee del disco, no cuesta ninguna petición por corrida
// (regla 5) y se borra de un plumazo cuando llegue la mudanza.
//
// DE DÓNDE SALEN
// OpenDota /teams/{id} -> logo_url. Se refresca corriendo
// `node scripts/logos-dota.mjs`, que sólo pregunta por los equipos que
// todavía no están en el archivo.
//
// Verificado con llamadas reales el 2026-08-18: los 16 de TI2026 devolvieron
// logo_url, incluidos los recién creados (Iron Wing, TEAM VISION, HULIGANI).
// Las URLs devuelven PNG de verdad —magic bytes 89504e47— aunque el CDN de
// Steam las sirva como application/octet-stream.

import { readFileSync } from 'node:fs';
import { fetchConReintentos } from './reintentar.mjs';

const BASE = 'https://api.opendota.com/api/teams';
const ARCHIVO = new URL('./logos-dota.json', import.meta.url);

// Cadena vacía = se preguntó y ese equipo no tiene escudo. Sirve para que el
// script no lo vuelva a preguntar en cada corrida.
export function cargarLogos() {
  try {
    const crudo = JSON.parse(readFileSync(ARCHIVO, 'utf8'));
    return new Map(Object.entries(crudo).map(([id, url]) => [Number(id), url || null]));
  } catch {
    // Sin el archivo, los escudos se caen a las iniciales. Un archivo que
    // falta no puede tumbar el panel.
    return new Map();
  }
}

// Devuelve la URL, o '' si el equipo existe pero no tiene escudo, o null si no
// se pudo saber (y entonces no se guarda: se vuelve a preguntar después).
export async function logoDeEquipo(teamId, { fetchImpl = fetchConReintentos } = {}) {
  const r = await fetchImpl(`${BASE}/${teamId}`);
  // Un 404 es respuesta firme: ese team_id no existe en OpenDota y no va a
  // aparecer mañana. Se marca como preguntado para no volver a pedirlo.
  if (r.status === 404) return '';
  if (!r.ok) return null;

  const t = await r.json();
  const url = typeof t?.logo_url === 'string' ? t.logo_url.trim() : '';
  return url || '';
}
