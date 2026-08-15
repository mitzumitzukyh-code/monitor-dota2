// Captura las cuotas de lo que viene y las guarda. Se corre seguido desde el
// ciclo de GitHub Actions.
//
//   node --env-file=.env datos/juegos/guardar-cuotas.mjs
//   node --env-file=.env datos/juegos/guardar-cuotas.mjs cs2 lol
//
// Idempotente: la clave primaria es (match_id, capturado_en), así que correr
// dos veces seguidas no pisa nada -- agrega una captura más, que es
// justamente lo que se quiere para ver el movimiento de la cuota.

import { fileURLToPath } from 'node:url';
import { upsert } from '../supabase.mjs';
import { capturarCuotas } from './cuotas.mjs';
import { DISCIPLINAS } from './bo3.mjs';

export async function guardarCuotas(juegos, { fetchImpl, fetchImplSupabase } = {}) {
  const filas = await capturarCuotas(juegos, { fetchImpl });
  if (filas.length === 0) return { capturadas: 0, guardadas: 0 };

  const paraBase = filas.map((c) => ({
    match_id: c.matchId,
    capturado_en: c.capturadoEn,
    juego: c.juego,
    disciplina_id: c.disciplinaId,
    equipo_a: c.equipoA,
    equipo_b: c.equipoB,
    coeff_a: c.coeffA,
    coeff_b: c.coeffB,
    prob_a: c.probA,
    prob_b: c.probB,
    margen: c.margen,
    inicio_programado: c.inicioProgramado,
    proveedor_id: c.proveedorId,
  }));

  await upsert('eslo_cuotas', paraBase, { fetchImpl: fetchImplSupabase });
  return { capturadas: filas.length, guardadas: paraBase.length };
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  const pedidos = process.argv.slice(2);
  const juegos = pedidos.length ? pedidos : ['cs2', 'lol', 'dota2'];

  const desconocidos = juegos.filter((j) => !DISCIPLINAS[j]);
  if (desconocidos.length) {
    console.error(`juego desconocido: ${desconocidos.join(', ')}`);
    console.error(`juegos: ${Object.keys(DISCIPLINAS).join(', ')}`);
    process.exit(1);
  }

  guardarCuotas(juegos)
    .then((r) => console.log(`cuotas capturadas: ${r.capturadas} · guardadas: ${r.guardadas}`))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}
