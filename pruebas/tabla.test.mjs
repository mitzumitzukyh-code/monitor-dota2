import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tablaDePosiciones, ganadorDeSerie, record } from '../juez/tabla.mjs';

// Mini torneo verificable a mano. 4 equipos, 4 series:
//   1 vs 2  -> 2-0 gana 1     1: G
//   3 vs 4  -> 1-2 gana 4     4: G
//   1 vs 4  -> 2-1 gana 1     1: GG
//   2 vs 3  -> 0-2 gana 3     3: G
// Récords: 1 -> 2-0 | 3 -> 1-1 | 4 -> 1-1 | 2 -> 0-2
const SERIES = [
  { equipoA: 1, equipoB: 2, victoriasA: 2, victoriasB: 0 },
  { equipoA: 3, equipoB: 4, victoriasA: 1, victoriasB: 2 },
  { equipoA: 1, equipoB: 4, victoriasA: 2, victoriasB: 1 },
  { equipoA: 2, equipoB: 3, victoriasA: 0, victoriasB: 2 },
];

test('ganadorDeSerie() devuelve el equipo con más partidas ganadas', () => {
  assert.equal(ganadorDeSerie({ equipoA: 7, equipoB: 9, victoriasA: 2, victoriasB: 1 }), 7);
  assert.equal(ganadorDeSerie({ equipoA: 7, equipoB: 9, victoriasA: 0, victoriasB: 2 }), 9);
});

test('ganadorDeSerie() devuelve null en un Bo2 empatado 1-1', () => {
  assert.equal(ganadorDeSerie({ equipoA: 7, equipoB: 9, victoriasA: 1, victoriasB: 1 }), null);
});

test('tablaDePosiciones() cuenta el récord de cada equipo', () => {
  const tabla = tablaDePosiciones(SERIES);
  const por = new Map(tabla.map((f) => [f.teamId, f]));

  assert.deepEqual(
    { g: por.get(1).ganadas, p: por.get(1).perdidas },
    { g: 2, p: 0 },
  );
  assert.deepEqual({ g: por.get(2).ganadas, p: por.get(2).perdidas }, { g: 0, p: 2 });
  assert.deepEqual({ g: por.get(3).ganadas, p: por.get(3).perdidas }, { g: 1, p: 1 });
  assert.deepEqual({ g: por.get(4).ganadas, p: por.get(4).perdidas }, { g: 1, p: 1 });
});

test('tablaDePosiciones() ordena por diferencia y pone al líder de primero', () => {
  const tabla = tablaDePosiciones(SERIES);
  assert.equal(tabla[0].teamId, 1);
  assert.equal(tabla[tabla.length - 1].teamId, 2);
});

test('tablaDePosiciones() da la MISMA posición a los que tienen el mismo récord', () => {
  const tabla = tablaDePosiciones(SERIES);
  const por = new Map(tabla.map((f) => [f.teamId, f]));
  // 3 y 4 van 1-1 los dos: comparten el 2do puesto, y el siguiente es 4to.
  assert.equal(por.get(1).posicion, 1);
  assert.equal(por.get(3).posicion, 2);
  assert.equal(por.get(4).posicion, 2);
  assert.equal(por.get(2).posicion, 4);
});

test('tablaDePosiciones() cuenta el empate de Bo2 sin dárselo a nadie', () => {
  const tabla = tablaDePosiciones([{ equipoA: 1, equipoB: 2, victoriasA: 1, victoriasB: 1 }]);
  for (const fila of tabla) {
    assert.equal(fila.ganadas, 0);
    assert.equal(fila.perdidas, 0);
    assert.equal(fila.empatadas, 1);
    assert.equal(fila.jugadas, 1);
  }
});

test('las victorias totales de la tabla cuadran con las series decididas', () => {
  const tabla = tablaDePosiciones(SERIES);
  const totalGanadas = tabla.reduce((s, f) => s + f.ganadas, 0);
  assert.equal(totalGanadas, SERIES.length);
});

test('record() muestra el empate solo cuando existe', () => {
  assert.equal(record({ ganadas: 3, perdidas: 1, empatadas: 0 }), '3-1');
  assert.equal(record({ ganadas: 3, perdidas: 1, empatadas: 1 }), '3-1-1');
});

test('tablaDePosiciones() no revienta con cero series', () => {
  assert.deepEqual(tablaDePosiciones([]), []);
});
