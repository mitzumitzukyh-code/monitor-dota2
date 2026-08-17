// Aviso de fallos a Discord, a un canal aparte del de predicciones.
//
// POR QUÉ UN CANAL SEPARADO
// Los avisos de predicciones son para leer con calma; un fallo hay que verlo
// ya. Mezclados, el error se pierde entre veinte mensajes de partidas. Va a
// DISCORD_WEBHOOK_ERRORES; si ese secreto no está puesto cae al webhook
// normal, para que un fallo nunca quede sin avisar por falta de configuración.
//
// QUÉ LLEVA EL MENSAJE, Y POR QUÉ CADA COSA
//   qué falló     el paso concreto, no "el ciclo"
//   quién         quién disparó la corrida y de qué commit salió: si el fallo
//                 entró con un cambio, eso lo dice de una
//   cuándo        en hora de Venezuela, que es la que se lee
//   dónde mirar   enlace directo a la corrida
//
// Sin el "quién" y el "cuándo", un aviso de error obliga a abrir GitHub para
// entender lo mínimo. Con ellos, muchas veces se sabe la causa sin salir de
// Discord.

import { fileURLToPath } from 'node:url';
import { enviar } from './discord.mjs';
import { enVenezuela, hora12 } from './formato.mjs';

// Discord corta a 2.000. Un stack largo se recorta antes de armar el mensaje,
// no después: lo importante (qué, quién, dónde) va al final y no se puede
// perder por culpa de un stack de 80 líneas.
const MAX_DETALLE = 900;

export function mensajeError({
  paso = 'desconocido',
  detalle = '',
  actor = null,
  commit = null,
  mensajeCommit = null,
  repo = null,
  runId = null,
  runNumero = null,
  cuando = new Date(),
} = {}) {
  const { fecha, hora, valida } = enVenezuela(cuando.toISOString());
  const sello = valida ? `${fecha} · ${hora12(hora)}` : '—';

  const lineas = ['🔴 **Falló el ciclo**', ''];
  lineas.push(`**Qué:** \`${paso}\``);
  lineas.push(`**Cuándo:** ${sello} (hora de Venezuela)`);

  if (actor) lineas.push(`**Quién lo disparó:** ${actor}`);
  if (commit) {
    const corto = String(commit).slice(0, 7);
    // SÓLO la primera línea del mensaje de commit. En la práctica los mensajes
    // de este repo tienen 20-30 líneas de explicación, y meterlas enteras dejó
    // avisos ilegibles: el "qué falló" quedaba enterrado bajo el commit.
    // El título es lo que identifica el cambio; el cuerpo está en el enlace.
    const titulo = String(mensajeCommit ?? '').split('\n')[0].trim();
    const recortado = titulo.length > 72 ? titulo.slice(0, 72) + '…' : titulo;
    lineas.push(`**Commit:** ${recortado ? `\`${corto}\` — ${recortado}` : `\`${corto}\``}`);
  }

  if (detalle) {
    const recortado =
      detalle.length > MAX_DETALLE ? detalle.slice(0, MAX_DETALLE) + '\n… (recortado)' : detalle;
    lineas.push('');
    lineas.push('```');
    lineas.push(recortado);
    lineas.push('```');
  }

  if (repo && runId) {
    lineas.push('');
    lineas.push(`<https://github.com/${repo}/actions/runs/${runId}>${runNumero ? ` · corrida ${runNumero}` : ''}`);
  }

  return lineas.join('\n');
}

// Lee el contexto que GitHub Actions deja en el entorno. Fuera de Actions
// devuelve nulos, y el mensaje sale igual con lo que haya: un aviso de error
// incompleto sigue siendo mejor que ninguno.
export function contextoDeActions(env = process.env) {
  return {
    actor: env.GITHUB_ACTOR ?? null,
    commit: env.GITHUB_SHA ?? null,
    repo: env.GITHUB_REPOSITORY ?? null,
    runId: env.GITHUB_RUN_ID ?? null,
    runNumero: env.GITHUB_RUN_NUMBER ?? null,
  };
}

export async function avisarError(datos, { fetchImpl, webhook } = {}) {
  const destino = webhook ?? process.env.DISCORD_WEBHOOK_ERRORES ?? process.env.DISCORD_WEBHOOK;
  return enviar(mensajeError({ ...contextoDeActions(), ...datos }), { fetchImpl, webhook: destino });
}

const esEjecutadoDirectamente = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esEjecutadoDirectamente) {
  const r = await avisarError({
    paso: process.argv[2] ?? 'desconocido',
    detalle: process.argv[3] ?? '',
    mensajeCommit: process.env.MENSAJE_COMMIT ?? null,
  });
  console.log(r.enviado ? 'aviso de error enviado' : 'NO enviado — ' + r.razon);
}
