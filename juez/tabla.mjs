// Tabla de posiciones del torneo, calculada de las partidas reales.
//
// No hay fuente gratis de "standings" (Liquipedia requiere llave aprobada,
// ver CLAUDE.md). Pero en formato suizo la tabla ES el récord de series
// ganadas-perdidas, y eso se reconstruye entero de las partidas que OpenDota
// ya devuelve: seriesDeLaLiga() agrupa las partidas en series y dice quién
// ganó cada una. Cero fuentes nuevas, cero peticiones extra -- el flujo de
// calificar ya baja esas partidas.
//
// OJO con lo que esto NO es: no es el bracket oficial ni el seeding. Los
// desempates reales del suizo (Neustadtl, head-to-head) no se replican acá.
// Los empatados comparten número de posición (1,2,2,4...) justamente para no
// inventar un orden que suene oficial y no lo sea; el renglón en que aparece
// cada uno dentro del empate es incidental (sale del teamId).

// Una serie está decidida cuando alguien ganó más partidas que el otro. Un
// Bo2 puede quedar 1-1: eso es empate real, no lo gana nadie (ver CLAUDE.md).
export function ganadorDeSerie(serie) {
  if (serie.victoriasA > serie.victoriasB) return serie.equipoA;
  if (serie.victoriasB > serie.victoriasA) return serie.equipoB;
  return null;
}

// Récord de series por equipo. `series` es lo que devuelve seriesDeLaLiga().
export function tablaDePosiciones(series) {
  const registro = new Map();
  const anotar = (id) => {
    if (!registro.has(id)) registro.set(id, { teamId: id, ganadas: 0, perdidas: 0, empatadas: 0 });
    return registro.get(id);
  };

  for (const s of series) {
    const ganador = ganadorDeSerie(s);
    const a = anotar(s.equipoA);
    const b = anotar(s.equipoB);
    if (ganador === null) {
      a.empatadas++;
      b.empatadas++;
      continue;
    }
    const ganoA = ganador === s.equipoA;
    (ganoA ? a : b).ganadas++;
    (ganoA ? b : a).perdidas++;
  }

  const filas = [...registro.values()].map((r) => ({ ...r, jugadas: r.ganadas + r.perdidas + r.empatadas }));

  // Orden: diferencia primero (es lo que ordena un suizo), luego victorias
  // absolutas. El tercer criterio es el teamId y no el nombre: ordenar por
  // nombre obligaría a pasar el diccionario acá y ataría esta función pura a
  // la capa de presentación. El nombre se resuelve al pintar.
  filas.sort(
    (x, y) =>
      y.ganadas - y.perdidas - (x.ganadas - x.perdidas) ||
      y.ganadas - x.ganadas ||
      x.teamId - y.teamId,
  );

  // Los que tienen el mismo récord comparten posición (1,2,2,4...): decir que
  // uno es 2do y otro 3ro cuando van 3-1 los dos sería inventar un desempate.
  let posicion = 0;
  let anterior = null;
  filas.forEach((f, i) => {
    const clave = `${f.ganadas}-${f.perdidas}-${f.empatadas}`;
    if (clave !== anterior) {
      posicion = i + 1;
      anterior = clave;
    }
    f.posicion = posicion;
  });

  return filas;
}

// "3-1" · con empates (Bo2) "3-1-1".
export function record(fila) {
  return fila.empatadas > 0
    ? `${fila.ganadas}-${fila.perdidas}-${fila.empatadas}`
    : `${fila.ganadas}-${fila.perdidas}`;
}
