// Las series PRÓXIMAS, que es lo único que el histórico versionado no puede
// saber. Sale de Supabase; sin credenciales devuelve null y el panel usa lo
// que sí tiene.
//
// QUÉ SE ENCIENDE CON CREDENCIALES, Y QUÉ NO
// Se enciende: la rejilla de "Próximas series" del Inicio, con la predicción
// ya guardada de cada una.
//
// NO se enciende la cuota ni la ventaja contra el mercado, y no es un
// pendiente: **Dota no tiene cuotas en ninguna tabla**. `eslo_cuotas` es de
// los juegos de bo3.gg (CS2, LoL, Valorant), va por `match_id` de partida y
// no por serie de Dota. Mientras el panel se genere del histórico de Dota,
// esas dos columnas salen «—» aunque el .env esté completo. Decirlo acá
// evita que alguien pierda una tarde buscando el cable que falta.

import { seleccionar } from '../../datos/supabase.mjs';

export function hayCredenciales() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Devuelve las series que todavía no empezaron, con su predicción si la
// tienen. null si no hay credenciales o si Supabase no respondió — el panel
// se genera igual, que es lo que importa.
// `fetchImpl` existe para poder probar esto sin credenciales ni red: es el
// mismo punto de inyección que usa seleccionar().
export async function proximasSeries({ cuantas = 4, ahora = Date.now(), fetchImpl } = {}) {
  if (!hayCredenciales()) return null;
  const opciones = fetchImpl ? { fetchImpl } : undefined;
  try {
    const [series, predicciones, equipos] = await Promise.all([
      seleccionar('dota_series', '?select=*&terminada=eq.false&order=start_time.asc', opciones),
      seleccionar('dota_predictions', '?select=*', opciones),
      seleccionar('dota_teams', '?select=*', opciones),
    ]);

    const nombre = new Map(equipos.map((e) => [e.team_id, e.nombre]));
    const predPorSerie = new Map(predicciones.map((p) => [p.series_id, p]));
    return series
      // El feed sigue listando series que YA empezaron: es el mismo bug real
      // que documenta CLAUDE.md. Acá sólo se muestran las que faltan.
      .filter((s) => new Date(s.start_time).getTime() > ahora)
      .slice(0, cuantas)
      .map((s) => {
        const p = predPorSerie.get(s.series_id) ?? null;
        return {
          seriesId: s.series_id,
          torneo: s.league_name,
          formato: String(s.formato || '').toLowerCase(),
          nombreA: nombre.get(s.equipo_a) ?? `#${s.equipo_a}`,
          nombreB: nombre.get(s.equipo_b) ?? `#${s.equipo_b}`,
          inicio: s.start_time,
          prediccion: p
            ? { ganaA: Number(p.prob_gana_a), empate: Number(p.prob_empate), ganaB: Number(p.prob_gana_b) }
            : null,
        };
      });
  } catch (e) {
    return { error: e.message.slice(0, 120) };
  }
}
