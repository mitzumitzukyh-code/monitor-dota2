// Reintentos con espera progresiva para las peticiones a fuentes externas.
//
// POR QUÉ EXISTE
// El 2026-08-15 OpenDota devolvió 521 (Cloudflare: servidor caído) y el ciclo
// entero se cayó con él. Sin reintentos, cualquier hipo de un tercero —un 502
// de dos segundos, un 429 por ráfaga— cuesta una corrida completa, y con TI
// en curso una corrida perdida puede ser una predicción que ya no se puede
// hacer (regla 6: no se predice hacia atrás).
//
// QUÉ SE REINTENTA Y QUÉ NO
// Se reintenta lo que puede arreglarse solo: fallos de red, 5xx y 429. NO se
// reintenta un 4xx (400, 401, 404): esos significan que la petición está mal
// hecha, y repetirla igual solo gasta presupuesto y tiempo (regla 5).
//
// Esto NO salva una caída larga. Si la fuente está abajo diez minutos, el
// ciclo falla igual — pero falla después de haber intentado, no al primer
// tropiezo.

// 429 = demasiadas peticiones. 5xx = problema del servidor.
function valeLaPenaReintentar(status) {
  return status === 429 || (status >= 500 && status < 600);
}

// Si el servidor dice cuánto esperar, se le hace caso: sabe mejor que
// nosotros. Puede venir en segundos o como fecha HTTP.
function esperaPedidaPorElServidor(cabeceras) {
  const valor = cabeceras?.get?.('retry-after');
  if (!valor) return null;

  const segundos = Number(valor);
  if (Number.isFinite(segundos) && segundos >= 0) return segundos * 1000;

  const fecha = Date.parse(valor);
  if (Number.isFinite(fecha)) {
    const ms = fecha - Date.now();
    return ms > 0 ? ms : 0;
  }
  return null;
}

const dormirDeVerdad = (ms) => new Promise((r) => setTimeout(r, ms));

// Envuelve fetch. Misma firma, así que se puede pasar donde se espera un
// fetchImpl y nadie más se entera.
//
// `dormir` es inyectable para que las pruebas no esperen de verdad.
export function conReintentos(
  fetchBase = fetch,
  { intentos = 3, esperaBase = 500, esperaMaxima = 8000, dormir = dormirDeVerdad, alReintentar = null } = {},
) {
  return async function fetchReintentando(url, opciones) {
    let ultimoError = null;

    for (let intento = 1; intento <= intentos; intento++) {
      let respuesta = null;
      let fallo = null;

      try {
        respuesta = await fetchBase(url, opciones);
      } catch (e) {
        fallo = e; // se cayó la red, ni siquiera hubo respuesta
      }

      if (respuesta && !valeLaPenaReintentar(respuesta.status)) return respuesta;
      if (respuesta) ultimoError = `HTTP ${respuesta.status}`;
      if (fallo) ultimoError = fallo.message;

      // Se agotaron los intentos: devolver la respuesta (aunque sea 5xx) para
      // que quien llama produzca su propio mensaje de error con contexto, o
      // relanzar el fallo de red si nunca hubo respuesta.
      if (intento === intentos) {
        if (respuesta) return respuesta;
        throw fallo;
      }

      // Espera exponencial: 500ms, 1s, 2s... con un tope. El tope existe
      // para que un ciclo que corre cada 10 minutos no se quede esperando
      // más de lo que dura su propia ventana.
      const exponencial = Math.min(esperaBase * 2 ** (intento - 1), esperaMaxima);
      const pedida = respuesta ? esperaPedidaPorElServidor(respuesta.headers) : null;
      const espera = pedida ?? exponencial;

      if (alReintentar) alReintentar({ intento, de: intentos, espera, razon: ultimoError, url });
      await dormir(espera);
    }

    throw new Error(`sin reintentos disponibles: ${ultimoError}`);
  };
}

// El que se usa por defecto en producción: avisa por consola cada reintento,
// para que quede en el log de GitHub Actions y se pueda ver que la fuente
// estuvo inestable aunque la corrida haya terminado bien.
export const fetchConReintentos = conReintentos(fetch, {
  alReintentar: ({ intento, de, espera, razon }) =>
    console.warn(`  reintento ${intento}/${de} en ${espera}ms — ${razon}`),
});
