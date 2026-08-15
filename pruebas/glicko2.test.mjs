import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  estadoInicial,
  probabilidadGanar,
  actualizar,
  actualizarContraVarios,
  aplicarPartida,
  estadoDeEquipo,
} from '../motor/glicko2.mjs';

// ---------------------------------------------------------------------------
// EL ANCLA: el ejemplo resuelto que publicó Glickman en "Example of the
// Glicko-2 system". Si esto pasa, la implementación es la del paper y no una
// aproximación parecida.
//
//   Jugador:  r=1500, RD=200, sigma=0.06, tau=0.5
//   Rivales:  (1400, RD 30)  -> gana   (s=1)
//             (1550, RD 100) -> pierde (s=0)
//             (1700, RD 300) -> pierde (s=0)
//   Resultado publicado: rating 1464.06, RD 151.52, sigma 0.05999
//
// SOBRE EL RATING: acá se comprueba contra 1464.06 con tolerancia de 0.02, y
// no con igualdad exacta a 2 decimales, por una razón concreta y no por
// aflojar la prueba. El paper redondea sus pasos intermedios a 4 decimales:
// publica mu' = -0.2069, y -0.2069 * 173.7178 + 1500 = 1464.06. Llevando la
// precisión completa, mu' = -0.206943..., que da 1464.0507. O sea que el
// 1464.06 impreso arrastra el redondeo del propio ejemplo. RD y volatilidad
// sí calzan exactos a la precisión publicada, que es la señal de que la
// implementación es la del paper.
// ---------------------------------------------------------------------------
test('reproduce el ejemplo resuelto de Glickman (ancla del paper)', () => {
  const jugador = { rating: 1500, rd: 200, vol: 0.06 };
  const nuevo = actualizarContraVarios(
    jugador,
    [
      { rival: { rating: 1400, rd: 30, vol: 0.06 }, puntaje: 1 },
      { rival: { rating: 1550, rd: 100, vol: 0.06 }, puntaje: 0 },
      { rival: { rating: 1700, rd: 300, vol: 0.06 }, puntaje: 0 },
    ],
    { tau: 0.5 },
  );

  assert.ok(
    Math.abs(nuevo.rating - 1464.06) < 0.02,
    `rating ${nuevo.rating} se aleja de 1464.06 más de lo que explica el redondeo del paper`,
  );
  assert.equal(nuevo.rd.toFixed(2), '151.52');
  assert.equal(nuevo.vol.toFixed(5), '0.06000');
});

// ---------------------------------------------------------------------------
// La propiedad por la que se trae Glicko-2: la incertidumbre jala la
// probabilidad hacia 0.5. Esto es lo que Elo no puede hacer.
// ---------------------------------------------------------------------------
test('con la MISMA diferencia de rating, más incertidumbre = más cerca de 0.5', () => {
  const favorito = { rating: 1800, rd: 50, vol: 0.06 };

  const rivalConocido = { rating: 1500, rd: 50, vol: 0.06 };
  const rivalNuevo = { rating: 1500, rd: 350, vol: 0.06 };

  const probContraConocido = probabilidadGanar(favorito, rivalConocido);
  const probContraNuevo = probabilidadGanar(favorito, rivalNuevo);

  assert.ok(
    probContraNuevo < probContraConocido,
    `contra un desconocido debería ser menos extrema: ${probContraNuevo} vs ${probContraConocido}`,
  );
  assert.ok(Math.abs(probContraNuevo - 0.5) < Math.abs(probContraConocido - 0.5));
});

// El caso Iron Wing de TI2026: 29 partidas contra 334. Elo le dio 12.3% al
// débil y ganó (Brier 1.5379, el peor de las 18 series).
test('el caso Iron Wing: poca experiencia no produce una probabilidad extrema', () => {
  const falcons = { rating: 1796, rd: 60, vol: 0.06 };
  const ironWingPocaInfo = { rating: 1575, rd: 300, vol: 0.06 };

  const prob = probabilidadGanar(falcons, ironWingPocaInfo);
  // Elo puro daba ~0.877 al favorito. Glicko-2, sabiendo que no conoce bien
  // al rival, tiene que ser notablemente menos confiado.
  assert.ok(prob < 0.83, `demasiado confiado para lo poco que se sabe del rival: ${prob}`);
  assert.ok(prob > 0.5, 'el favorito sigue siendo favorito');
});

test('las probabilidades de los dos lados suman 1', () => {
  const a = { rating: 1700, rd: 80, vol: 0.06 };
  const b = { rating: 1450, rd: 200, vol: 0.06 };
  assert.equal((probabilidadGanar(a, b) + probabilidadGanar(b, a)).toFixed(10), '1.0000000000');
});

test('dos equipos idénticos dan exactamente 50%', () => {
  const e = { rating: 1600, rd: 120, vol: 0.06 };
  assert.equal(probabilidadGanar(e, { ...e }), 0.5);
});

// ---------------------------------------------------------------------------
// Comportamiento del RD
// ---------------------------------------------------------------------------
test('el RD baja al jugar: cada partida da información', () => {
  const antes = estadoInicial();
  const despues = actualizar(antes, estadoInicial(), 1);
  assert.ok(despues.rd < antes.rd, `${despues.rd} debería ser menor que ${antes.rd}`);
});

test('sin partidas el rating no se mueve pero el RD crece', () => {
  const antes = { rating: 1600, rd: 100, vol: 0.06 };
  const despues = actualizarContraVarios(antes, []);
  assert.equal(despues.rating, 1600);
  assert.ok(despues.rd > antes.rd, 'la confianza se pierde con la inactividad');
});

test('ganar sube el rating y perder lo baja', () => {
  const base = estadoInicial();
  assert.ok(actualizar(base, estadoInicial(), 1).rating > base.rating);
  assert.ok(actualizar(base, estadoInicial(), 0).rating < base.rating);
});

test('ganarle a un fuerte sube más que ganarle a un débil', () => {
  const yo = { rating: 1500, rd: 100, vol: 0.06 };
  const subeVsFuerte = actualizar(yo, { rating: 1900, rd: 100, vol: 0.06 }, 1).rating - yo.rating;
  const subeVsDebil = actualizar(yo, { rating: 1100, rd: 100, vol: 0.06 }, 1).rating - yo.rating;
  assert.ok(subeVsFuerte > subeVsDebil, `${subeVsFuerte} debería superar a ${subeVsDebil}`);
});

// ---------------------------------------------------------------------------
// aplicarPartida: la forma normalizada de datos/juegos/bo3.mjs
// ---------------------------------------------------------------------------
test('aplicarPartida() mueve a los dos equipos en direcciones opuestas', () => {
  const porEquipo = new Map();
  const jugadas = new Map();
  aplicarPartida(porEquipo, jugadas, { equipoA: 10, equipoB: 20, ganador: 10 });

  assert.ok(estadoDeEquipo(porEquipo, 10).rating > 1500);
  assert.ok(estadoDeEquipo(porEquipo, 20).rating < 1500);
  assert.equal(jugadas.get(10), 1);
  assert.equal(jugadas.get(20), 1);
});

test('aplicarPartida() actualiza a los dos contra el estado PREVIO del rival', () => {
  // Si el segundo equipo se actualizara contra el estado ya modificado del
  // primero, estaría reaccionando a información que aún no existía.
  const porEquipo = new Map();
  aplicarPartida(porEquipo, new Map(), { equipoA: 1, equipoB: 2, ganador: 1 });
  const [a, b] = [porEquipo.get(1), porEquipo.get(2)];
  // Partiendo de estados idénticos, el movimiento tiene que ser simétrico.
  assert.equal((a.rating - 1500).toFixed(6), (1500 - b.rating).toFixed(6));
  assert.equal(a.rd.toFixed(6), b.rd.toFixed(6));
});

test('aplicarPartida() ignora una partida sin ganador válido', () => {
  const porEquipo = new Map();
  aplicarPartida(porEquipo, new Map(), { equipoA: 1, equipoB: 2, ganador: 99 });
  assert.equal(porEquipo.size, 0);
});

test('estadoDeEquipo() devuelve el inicial para un equipo que nunca jugó', () => {
  assert.deepEqual(estadoDeEquipo(new Map(), 777), estadoInicial());
});
