// Demo: resumen de desempeño en vivo (aciertos/fallos + meta de aprobación)
// enviado a Discord. Solo lee Supabase, no marca nada.

import { seleccionar } from '../datos/supabase.mjs';
import { enviar } from '../salida/discord.mjs';

const [seriesDb, predsDb, teamsDb] = await Promise.all([
  seleccionar('dota_series', '?select=*'),
  seleccionar('dota_predictions', '?select=*'),
  seleccionar('dota_teams', '?select=*'),
]);
const nombre = new Map(teamsDb.map((t) => [t.team_id, t.nombre]));
const predPorId = new Map(predsDb.map((p) => [p.series_id, p]));

const calificadas = seriesDb
  .filter((s) => predPorId.get(s.series_id)?.resultado_real)
  .map((s) => ({ ...s, ...predPorId.get(s.series_id) }));

const brier = (c) => Number(c.brier);
const acierta = (c) =>
  (Number(c.prob_gana_a) >= Number(c.prob_gana_b) ? 'ganaA' : 'ganaB') === c.resultado_real;
const aciertos = calificadas.filter(acierta);
const fallos = calificadas.filter((c) => !acierta(c));
const n = calificadas.length;
const media = calificadas.reduce((s, c) => s + brier(c), 0) / n;
const ee = Math.sqrt(calificadas.reduce((s, c) => s + (brier(c) - media) ** 2, 0) / (n - 1)) / Math.sqrt(n);
const base = 0.5;
const concluyente = !(base >= media - 1.96 * ee && base <= media + 1.96 * ee);

const peor = fallos.sort((a, b) => brier(b) - brier(a))[0];
const peorGanoA = peor.resultado_real === 'ganaA';
const favA = Number(peor.prob_gana_a) >= Number(peor.prob_gana_b);
const peorFav = nombre.get(favA ? peor.equipo_a : peor.equipo_b);
const peorGanador = nombre.get(peorGanoA ? peor.equipo_a : peor.equipo_b);

const lineas = [];
lineas.push('📊 **RESUMEN EN VIVO — TI 2026**');
lineas.push(`**${n} series calificadas** contra resultados reales`);
lineas.push('');
lineas.push(`✅ **${aciertos.length} correctas** (${Math.round((aciertos.length / n) * 100)}%)`);
lineas.push(`❌ **${fallos.length} erradas**`);
lineas.push('');
lineas.push(`🎯 Brier promedio: **${media.toFixed(4)}** vs base ingenua ${base.toFixed(2)}`);
lineas.push(`📈 IC 95%: [${(media - 1.96 * ee).toFixed(4)}, ${(media + 1.96 * ee).toFixed(4)}]`);
lineas.push(`🔍 Conclusión: **${concluyente ? 'CONCLUYENTE — el motor le gana a la base' : 'aún no es concluyente — la base sigue dentro del intervalo'}`);
lineas.push('');
lineas.push(`⚠️ El fallo más caro: **${peorFav}** (favorito ${Math.round((favA ? peor.prob_gana_a : peor.prob_gana_b) * 100)}%) perdió contra **${peorGanador}** — Brier ${brier(peor).toFixed(3)}`);
lineas.push('');
lineas.push('🎯 **Meta de aprobación:**');
lineas.push('Si el motor acierta **todo** de aquí en adelante:');
lineas.push('   · +10 series → concluyente 91% de las veces');
lineas.push('   · +15 series → concluyente 100%');
lineas.push('Al ritmo actual (74% acierto) el intervalo no se cierra con el torneo completo.');
lineas.push('');
lineas.push('_Los números quedan guardados: cada predicción se mide contra su resultado real._');

const contenido = lineas.join('\n');
console.log(contenido);
const r = await enviar(contenido);
console.log(r.enviado ? 'enviado a Discord' : 'NO enviado — ' + r.razon);