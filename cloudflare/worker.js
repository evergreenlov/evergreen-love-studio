/* Evergreen Love Studio: sincronización de plantillas entre aparatos (Cloudflare Worker + KV).
   Plan gratis de Cloudflare: alcanza de sobra. Guarda UN archivo JSON con tus plantillas.
   Variables que hay que crear en Cloudflare:
     - KV namespace enlazado con el nombre   PLANTILLAS
     - Secret                                 SYNC_TOKEN   (una clave larga; es tu "contraseña" de sincronización) */

const MAX_BYTES = 20 * 1024 * 1024;           // KV admite hasta 25 MB por valor
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// comparación que no se corta al primer error (evita adivinar la clave por tiempos)
function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '') return json({ ok: true, servicio: 'evergreen-sync' });
    if (url.pathname !== '/plantillas') return json({ error: 'no existe' }, 404);

    if (!env.SYNC_TOKEN || !env.PLANTILLAS) return json({ error: 'falta configurar SYNC_TOKEN o el KV PLANTILLAS en Cloudflare' }, 500);
    const auth = request.headers.get('Authorization') || '';
    if (!sameToken(auth, 'Bearer ' + env.SYNC_TOKEN)) return json({ error: 'clave incorrecta' }, 401);

    if (request.method === 'GET') {
      const v = await env.PLANTILLAS.get('plantillas');
      return new Response(v || JSON.stringify({ plantillas: [], borradas: {} }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: 'demasiado grande' }, 413);
      let data;
      try { data = JSON.parse(text); } catch (e) { return json({ error: 'JSON no válido' }, 400); }
      if (!data || !Array.isArray(data.plantillas)) return json({ error: 'formato no válido' }, 400);
      await env.PLANTILLAS.put('plantillas', JSON.stringify({ plantillas: data.plantillas, borradas: data.borradas && typeof data.borradas === 'object' ? data.borradas : {}, actualizado: new Date().toISOString() }));
      return json({ ok: true, plantillas: data.plantillas.length });
    }
    return json({ error: 'método no permitido' }, 405);
  },
};
