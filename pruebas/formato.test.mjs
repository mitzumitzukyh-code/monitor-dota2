import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enVenezuela, hora12, diaEnPalabras, cuandoEnPalabras, agruparPorDia } from '../salida/formato.mjs';

test('enVenezuela: resta 4 horas', () => {
  const r = enVenezuela('2026-08-14T05:00:00Z');
  assert.equal(r.fecha, '2026-08-14');
  assert.equal(r.hora, '01:00');
  assert.equal(r.valida, true);
});

test('enVenezuela: cuando cruza medianoche, la FECHA también retrocede', () => {
  // 02:00 UTC del 15 son las 10 pm del 14 acá.
  assert.equal(enVenezuela('2026-08-15T02:00:00Z').fecha, '2026-08-14');
  assert.equal(enVenezuela('2026-08-14T02:00:00Z').fecha, '2026-08-13');
});

test('enVenezuela: fecha inválida se marca como no válida, no revienta', () => {
  const r = enVenezuela('cualquier cosa');
  assert.equal(r.valida, false);
  assert.equal(r.completo, '—');
});

// --- hora12: reloj de 12 horas, como habla la gente

test('hora12: la tarde y la noche van en pm', () => {
  assert.equal(hora12('22:00'), '10 pm');
  assert.equal(hora12('13:00'), '1 pm');
  assert.equal(hora12('23:59'), '11:59 pm');
});

test('hora12: la mañana va en am', () => {
  assert.equal(hora12('01:00'), '1 am');
  assert.equal(hora12('11:00'), '11 am');
  assert.equal(hora12('01:45'), '1:45 am');
});

test('hora12: mediodía es 12 pm y medianoche 12 am (el caso que se equivoca siempre)', () => {
  assert.equal(hora12('12:00'), '12 pm');
  assert.equal(hora12('12:30'), '12:30 pm');
  assert.equal(hora12('00:00'), '12 am');
  assert.equal(hora12('00:30'), '12:30 am');
});

test('hora12: los minutos en cero no se muestran (nadie dice "10:00 pm")', () => {
  assert.equal(hora12('22:00'), '10 pm');
  assert.ok(!hora12('22:00').includes(':'));
});

test('hora12: nunca devuelve hora militar', () => {
  for (let h = 0; h < 24; h++) {
    const salida = hora12(`${String(h).padStart(2, '0')}:00`);
    assert.match(salida, /^(1[0-2]|[1-9]) (am|pm)$/, `h=${h} dio "${salida}"`);
    const numero = Number(salida.split(' ')[0]);
    assert.ok(numero >= 1 && numero <= 12, `h=${h} dio ${numero}, fuera de 1-12`);
  }
});

test('hora12: entrada basura da — en vez de reventar', () => {
  assert.equal(hora12(''), '—');
  assert.equal(hora12(undefined), '—');
  assert.equal(hora12('99:99'), '—');
  assert.equal(hora12('no es hora'), '—');
});

// --- días

test('diaEnPalabras: hoy, ayer y mañana', () => {
  const ahora = new Date('2026-08-14T15:00:00Z'); // 11 am del 14 en Venezuela
  assert.equal(diaEnPalabras('2026-08-14', ahora), 'Hoy');
  assert.equal(diaEnPalabras('2026-08-13', ahora), 'Ayer');
  assert.equal(diaEnPalabras('2026-08-15', ahora), 'Mañana');
  assert.equal(diaEnPalabras('2026-08-20', ahora), '20/08');
});

test('cuandoEnPalabras: junta el día en palabras con la hora de 12 horas', () => {
  const ahora = new Date('2026-08-14T15:00:00Z');
  assert.equal(cuandoEnPalabras('2026-08-15T02:00:00Z', ahora), 'hoy 10 pm');
  assert.equal(cuandoEnPalabras('2026-08-15T05:00:00Z', ahora), 'mañana 1 am');
});

// --- agrupado

test('agruparPorDia: agrupa por día local y trae la hora ya en 12 horas', () => {
  const ahora = new Date('2026-08-14T15:00:00Z');
  const grupos = agruparPorDia(
    [{ id: 'a', start_time: '2026-08-15T02:00:00Z' }, { id: 'b', start_time: '2026-08-15T05:00:00Z' }],
    'start_time',
    ahora,
  );
  // 02:00 UTC del 15 => 10 pm del 14 (hoy) · 05:00 UTC => 1 am del 15 (mañana)
  assert.equal(grupos.length, 2);
  assert.equal(grupos[0].titulo, 'Hoy');
  assert.equal(grupos[0].items[0]._hora, '10 pm');
  assert.equal(grupos[1].titulo, 'Mañana');
  assert.equal(grupos[1].items[0]._hora, '1 am');
});

test('agruparPorDia: ordena por hora real, no por el texto de 12 horas', () => {
  // "10 pm" y "1 am" como texto ordenarían mal ("1" < "10"): tiene que usar
  // la hora de 24h para ordenar.
  const ahora = new Date('2026-08-14T15:00:00Z');
  const grupos = agruparPorDia(
    [
      { id: 'tarde', start_time: '2026-08-15T03:00:00Z' }, // 11 pm del 14
      { id: 'temprano', start_time: '2026-08-14T18:00:00Z' }, // 2 pm del 14
    ],
    'start_time',
    ahora,
  );
  assert.equal(grupos.length, 1, 'los dos caen el mismo día local');
  assert.deepEqual(grupos[0].items.map((i) => i.id), ['temprano', 'tarde']);
});

test('agruparPorDia: una fila sin fecha va a un grupo aparte al final', () => {
  const grupos = agruparPorDia([{ id: 'sin' }, { id: 'con', start_time: '2026-08-14T05:00:00Z' }]);
  assert.equal(grupos[grupos.length - 1].titulo, 'Sin fecha');
  assert.equal(grupos[grupos.length - 1].items[0].id, 'sin');
  assert.equal(grupos[grupos.length - 1].items[0]._hora, '', 'sin hora, para no dejar un hueco raro');
});
