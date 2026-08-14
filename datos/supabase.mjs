// Cliente mínimo de PostgREST. Mismo proyecto de Supabase que Monitor
// LaLiga (reutilizado a propósito) -- tablas con prefijo dota_ para no
// chocar con las de fútbol.

function headers() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function baseUrl() {
  return process.env.SUPABASE_URL;
}

export async function seleccionar(tabla, query = '', { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${baseUrl()}/rest/v1/${tabla}${query}`, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase seleccionar(${tabla}) respondió ${res.status}: ${await res.text()}`);
  return res.json();
}

// PATCH: actualiza sólo las columnas que se pasan, en las filas que matchean
// la query. A diferencia de upsert, no necesita mandar la fila completa --
// importante para marcar "ya avisado" sin arriesgar sobreescribir la
// predicción guardada.
export async function parchear(tabla, query, cambios, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${baseUrl()}/rest/v1/${tabla}${query}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify(cambios),
  });
  if (!res.ok) throw new Error(`Supabase parchear(${tabla}) respondió ${res.status}: ${await res.text()}`);
  return true;
}

export async function upsert(tabla, filas, { onConflict, fetchImpl = fetch } = {}) {
  const url = new URL(`${baseUrl()}/rest/v1/${tabla}`);
  if (onConflict) url.searchParams.set('on_conflict', onConflict);

  const res = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: {
      ...headers(),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(filas),
  });
  if (!res.ok) throw new Error(`Supabase upsert(${tabla}) respondió ${res.status}: ${await res.text()}`);
  return res.json();
}
