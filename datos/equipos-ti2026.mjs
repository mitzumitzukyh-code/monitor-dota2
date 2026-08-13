// Mapeo nombre -> team_id para los 16 equipos de The International 2026.
// Construido con datos reales: team_id sacado de partidas ya jugadas
// (OpenDota /proMatches, leagueid=19719), nombres cruzados contra el
// calendario real de dota.haglund.dev -- los 16 calzan con solo normalizar
// mayúsculas/espacios (ver CLAUDE.md). "TBD" (cupo de bracket sin definir
// todavía) no se mapea a propósito.

export const EQUIPOS_TI2026 = [
  { teamId: 9572001, nombre: 'TEAM VISION' },
  { teamId: 9247354, nombre: 'Team Falcons' },
  { teamId: 10150538, nombre: 'LGD Gaming' },
  { teamId: 5017210, nombre: 'Team Resilience' },
  { teamId: 8255888, nombre: 'BoomBoys' },
  { teamId: 10150413, nombre: 'Iron Wing' },
  { teamId: 2586976, nombre: 'OG' },
  { teamId: 10136357, nombre: 'Nigma Galaxy' },
  { teamId: 8261500, nombre: 'Xtreme Gaming' },
  { teamId: 7119388, nombre: 'Team Spirit' },
  { teamId: 9823272, nombre: 'Team Yandex' },
  { teamId: 10149530, nombre: 'HULIGANI' },
  { teamId: 9467224, nombre: 'Aurora Gaming' },
  { teamId: 9964962, nombre: 'GamerLegion' },
  { teamId: 726228, nombre: 'Vici Gaming' },
  { teamId: 2163, nombre: 'Team Liquid' },
];

function normalizar(nombre) {
  return nombre.trim().toLowerCase();
}

const NOMBRE_A_ID = new Map(EQUIPOS_TI2026.map((e) => [normalizar(e.nombre), e.teamId]));

// null si el nombre no calza con ninguno de los 16 (ej. "TBD", o un nombre
// mal escrito) -- nunca adivina.
export function teamIdPorNombre(nombre) {
  if (!nombre) return null;
  return NOMBRE_A_ID.get(normalizar(nombre)) ?? null;
}
