// Demo: predicciones con formato profesional (emojis, confianza, día).
// Datos reales de Supabase. No marca nada.

import { seleccionar } from '../datos/supabase.mjs';
import { enviar } from '../salida/discord.mjs';
import { agruparPorDia } from '../salida/formato.mjs';

const [seriesDb, predsDb, teamsDb] = await Promise.all([
  seleccionar('dota_series', '?select=*'),
  seleccionar('dota_predictions', '?select=*'),
  seleccionar('dota_teams', '?select=*'),
]);
const nombrePorId = new Map(teamsDb.map((t) => [t.team_id, t.nombre]));
const nombre = (id) => nombrePorId.get(id) ?? `#${id}`;
const predPorId = new Map(predsDb.map((p) => [p.series_id, p]));

const pendientes = [];
for (const s of seriesDb) {
  const p = predPorId.get(s.series_id);
  if (!p || p.resultado_real) continue;
  pendientes.push({ ...s, ...p });
}

// Emoji según la confianza del favorito (probabilidad del más probable).
function emojiConfianza(probFav) {
  if (probFav >= 70) return '🟥';
  if (probFav >= 56) return '🟨';
  return '⚖️';
}

const lineas = [];
lineas.push('🔮 **PRÓXIMAS SERIES — TI 2026**');
lineas.push('');
for (const grupo of agruparPorDia(pendientes, 'start_time')) {
  lineas.push(`📅 **${grupo.titulo}**`);
  for (const p of grupo.items) {
    const pa = Number(p.prob_gana_a);
    const pb = Number(p.prob_gana_b);
    const favA = pa >= pb;
    const fav = favA ? nombre(p.equipo_a) : nombre(p.equipo_b);
    const otro = favA ? nombre(p.equipo_b) : nombre(p.equipo_a);
    const probFav = Math.round((favA ? pa : pb) * 100);
    const probOtro = 100 - probFav;
    const emoji = emojiConfianza(probFav);
    const parejo = probFav <= 55 ? '  _muy parejo_' : '';
    lineas.push(`${emoji} \`${p._hora}\` **${fav}** ${probFav}% — ${otro} ${probOtro}%${parejo}`);
  }
  lineas.push('');
}
lineas.push('🟥 favorito claro · 🟨 favorito · ⚖️ muy parejo');
lineas.push('_Probabilidad del motor Elo sobre partidas reales. Hora de Venezuela. Queda guardado para medirse después._');

const contenido = lineas.join('\n');
console.log(contenido);
const r = await enviar(contenido);
console.log(r.enviado ? 'enviado a Discord' : 'NO enviado — ' + r.razon);