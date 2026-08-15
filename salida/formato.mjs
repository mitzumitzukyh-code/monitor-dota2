// Fechas y horas para lo que ve el usuario. Compartido entre el panel web y
// los avisos de Discord: antes estaba duplicado en los dos y era cuestión de
// tiempo que se fueran separando.
//
// Dos decisiones, las dos porque el que lee no es el que hizo el modelo:
//   - Hora de Venezuela (VET, UTC−4 todo el año, sin horario de verano).
//   - Reloj de 12 horas con am/pm: "10 pm", no "22:00".

// Venezuela es UTC−4 fijo. OJO: la conversión mueve también la FECHA -- las
// 02:00 UTC del 15 son las 10 pm del 14 acá.
export function enVenezuela(iso) {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return { fecha: '—', hora: '—', completo: '—', valida: false };
  const local = new Date(ms - 4 * 3600 * 1000).toISOString();
  const fecha = local.slice(0, 10);
  const hora = local.slice(11, 16);
  return { fecha, hora, completo: `${fecha} ${hora}`, valida: true };
}

// "22:00" -> "10 pm" · "01:45" -> "1:45 am" · "12:00" -> "12 pm" (mediodía)
// · "00:30" -> "12:30 am". Los minutos en cero no se muestran: nadie dice
// "10:00 pm" hablando.
export function hora12(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{1,2}:\d{2}$/.test(hhmm)) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  if (h > 23 || m > 59) return '—';

  const sufijo = h < 12 ? 'am' : 'pm';
  const hora = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hora} ${sufijo}` : `${hora}:${String(m).padStart(2, '0')} ${sufijo}`;
}

function diasDesdeHoy(fechaLocal, ahora) {
  const hoy = enVenezuela(ahora.toISOString()).fecha;
  return Math.round((new Date(fechaLocal + 'T00:00:00Z') - new Date(hoy + 'T00:00:00Z')) / 86400000);
}

// El nombre del día, para agrupar sin repetir "ayer"/"hoy" en cada renglón.
export function diaEnPalabras(fechaLocal, ahora = new Date()) {
  const dias = diasDesdeHoy(fechaLocal, ahora);
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Mañana';
  if (dias === -1) return 'Ayer';
  const [, mes, dia] = fechaLocal.split('-');
  return `${dia}/${mes}`;
}

// "hoy 10 pm" se entiende de una; "2026-08-14 22:00" hay que descifrarlo.
export function cuandoEnPalabras(iso, ahora = new Date()) {
  const { fecha, hora, valida } = enVenezuela(iso);
  if (!valida) return '—';
  const dia = diaEnPalabras(fecha, ahora);
  return `${dia === 'Hoy' ? 'hoy' : dia === 'Mañana' ? 'mañana' : dia === 'Ayer' ? 'ayer' : dia} ${hora12(hora)}`;
}

// Agrupa por día local, en orden cronológico, con la hora de cada elemento ya
// en formato de 12 horas. Tolera que a una fila le falte la fecha: la manda a
// un grupo aparte en vez de tumbar todo el mensaje.
export function agruparPorDia(items, campoFecha = 'start_time', ahora = new Date()) {
  const SIN_FECHA = '9999-99-99';
  const porDia = new Map();

  for (const it of items) {
    const { fecha, hora, valida } = enVenezuela(it[campoFecha]);
    const clave = valida ? fecha : SIN_FECHA;
    if (!porDia.has(clave)) porDia.set(clave, []);
    porDia.get(clave).push({
      ...it,
      _hora: valida ? hora12(hora) : '',
      _hora24: valida ? hora : '',
      _fecha: valida ? fecha : null,
    });
  }

  return [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0])) // SIN_FECHA queda al final
    .map(([fecha, lista]) => ({
      fecha: fecha === SIN_FECHA ? null : fecha,
      titulo: fecha === SIN_FECHA ? 'Sin fecha' : diaEnPalabras(fecha, ahora),
      // Se ordena por la hora de 24h, que sí es comparable como texto.
      items: lista.sort((a, b) => (a._hora24 ?? '').localeCompare(b._hora24 ?? '')),
    }));
}

// Un "día de juego" de TI no es un día de calendario en Venezuela: las series
// arrancan a las 10 pm y siguen hasta las 6 am, así que una sola jornada cae
// partida en dos fechas. Verificado con los datos reales de TI2026: dentro de
// una jornada los huecos entre tandas son de 3 a 5 horas, y entre una jornada
// y la siguiente son de ~21 horas. Cortar por hueco separa limpio; cortar por
// fecha partiría cada noche en dos mensajes.
export const HORAS_DE_HUECO = 8;

export function bloquesDeJuego(items, campoFecha = 'start_time', horasDeHueco = HORAS_DE_HUECO) {
  const conFecha = items
    .map((it) => ({ it, ms: new Date(it[campoFecha]).getTime() }))
    .filter((x) => Number.isFinite(x.ms))
    .sort((a, b) => a.ms - b.ms);

  const bloques = [];
  let actual = null;
  for (const { it, ms } of conFecha) {
    if (actual && ms - actual.ultimoMs <= horasDeHueco * 3600 * 1000) {
      actual.items.push(it);
      actual.ultimoMs = ms;
      continue;
    }
    actual = { items: [it], primerMs: ms, ultimoMs: ms };
    bloques.push(actual);
  }

  return bloques.map((b) => ({
    items: b.items,
    inicio: new Date(b.primerMs).toISOString(),
    ultimoInicio: new Date(b.ultimoMs).toISOString(),
  }));
}
