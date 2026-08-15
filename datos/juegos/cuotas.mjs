// Captura de cuotas de casa de apuestas, desde bo3.gg.
//
// POR QUÉ ESTO EXISTE Y POR QUÉ CORRE SEGUIDO
//
// bo3.gg solo expone la cuota mientras la partida está en ventana viva (hoy y
// mañana). Verificado con llamadas reales (2026-08-15): las partidas de 2022
// a 2025 vienen con 0% de cuota, las de hoy con ~66%. En cuanto la partida
// pasa, la cuota se borra y NO se puede recuperar después a ningún precio.
//
// Para qué sirve: es la única vara honesta para saber si el modelo vale algo
// comercialmente. Ganarle a "tirar una moneda" no significa nada si la casa
// de apuestas predice mejor -- ahí la información no vale, porque el que la
// compraría puede leer la cuota gratis. Sin esta captura, esa comparación no
// se puede hacer nunca.
//
// Esto NO apuesta ni recomienda apostar. Solo guarda el número para poder
// medirse contra él.

import { DISCIPLINAS } from './bo3.mjs';
import { fetchConReintentos } from '../reintentar.mjs';

const BASE = 'https://api.bo3.gg/api/v1';
const MS_ENTRE_PETICIONES = 400;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Una cuota decimal de 1.10 significa "pagan 1.10 por cada 1 apostado", o sea
// una probabilidad implícita de 1/1.10 = 90.9%. Las dos implícitas de una
// partida suman MÁS de 100%: ese exceso es el margen de la casa (el "vig").
// Hay que quitarlo o la comparación contra el modelo está sesgada -- el
// Brier de una distribución que suma 1.07 no es comparable con uno que suma 1.
export function probabilidadesImplicitas(coeffA, coeffB) {
  const a = Number(coeffA);
  const b = Number(coeffB);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 1 || b <= 1) return null;

  const crudaA = 1 / a;
  const crudaB = 1 / b;
  const suma = crudaA + crudaB;
  if (suma <= 0) return null;

  return {
    probA: crudaA / suma,
    probB: crudaB / suma,
    margen: suma - 1, // cuánto se queda la casa
  };
}

// Saca la cuota de una partida cruda de bo3.gg. Devuelve null si no la trae:
// ~1 de cada 3 partidas en ventana viva no tiene cuota, y eso es normal.
export function extraerCuota(m) {
  const bu = m.bet_updates;
  if (!bu?.team_1?.coeff || !bu?.team_2?.coeff) return null;

  // El orden de bet_updates NO se asume igual al de team1/team2: se cruza por
  // team_id. Si no cuadra, se descarta -- una cuota asignada al equipo
  // equivocado es peor que no tener cuota.
  const idUno = bu.team_1.team_id;
  const idDos = bu.team_2.team_id;
  if (idUno == null || idDos == null) return null;

  let coeffA, coeffB;
  if (idUno === m.team1_id && idDos === m.team2_id) {
    coeffA = bu.team_1.coeff;
    coeffB = bu.team_2.coeff;
  } else if (idUno === m.team2_id && idDos === m.team1_id) {
    coeffA = bu.team_2.coeff;
    coeffB = bu.team_1.coeff;
  } else {
    return null;
  }

  const probs = probabilidadesImplicitas(coeffA, coeffB);
  if (!probs) return null;

  return {
    matchId: m.id,
    disciplinaId: m.discipline_id,
    equipoA: m.team1_id,
    equipoB: m.team2_id,
    coeffA: Number(coeffA),
    coeffB: Number(coeffB),
    probA: probs.probA,
    probB: probs.probB,
    margen: probs.margen,
    inicioProgramado: m.start_date ? new Date(m.start_date).toISOString() : null,
    proveedorId: bu.bet_provider_id ?? null,
  };
}

async function pedir(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'monitor-esports/0.1 (proyecto personal)' },
  });
  if (!res.ok) throw new Error(`bo3.gg respondió ${res.status}`);
  return res.json();
}

// Captura las cuotas de lo que viene. Se corre seguido (cada 15-30 min) para
// tener también el MOVIMIENTO de la cuota, no solo un valor suelto: cómo se
// mueve antes del saque es información por sí sola.
export async function capturarCuotas(juegos = ['cs2'], { fetchImpl = fetchConReintentos, limite = 100 } = {}) {
  const capturadoEn = new Date().toISOString();
  const filas = [];

  for (const juego of juegos) {
    const disciplinaId = DISCIPLINAS[juego];
    if (!disciplinaId) throw new Error(`juego desconocido: ${juego}`);

    const url =
      `${BASE}/matches?page[limit]=${Math.min(limite, 100)}&page[offset]=0&sort=start_date` +
      `&filter[matches.discipline_id][eq]=${disciplinaId}&filter[matches.status][eq]=upcoming`;

    const datos = await pedir(url, fetchImpl);
    for (const m of datos.results ?? []) {
      const cuota = extraerCuota(m);
      if (!cuota) continue;

      // Regla 6: solo sirve la cuota tomada ANTES de que arranque. Si la
      // partida ya empezó, la cuota ya vio parte del resultado.
      if (cuota.inicioProgramado && new Date(cuota.inicioProgramado) <= new Date(capturadoEn)) continue;

      filas.push({ ...cuota, juego, capturadoEn });
    }
    await espera(MS_ENTRE_PETICIONES);
  }

  return filas;
}
