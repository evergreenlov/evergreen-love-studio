/* Evergreen Love Studio: copia local para usarlo sin internet.
   Con internet siempre se pide la versión nueva; sin internet se usa la última copia guardada. */
const CACHE = 'evergreen-studio-v1';
const FILES = [
 "./",
 "index.html",
 "estilos.css",
 "app.js",
 "version.txt",
 "manifest.webmanifest",
 "icon-192.png",
 "icon-512.png",
 "apple-touch-icon.png",
 "lib/clipper.js",
 "lib/three.min.js",
 "lib/OrbitControls.js",
 "lib/opentype.min.js",
 "lib/fonts/Allura.ttf",
 "lib/fonts/AmaticSC.ttf",
 "lib/fonts/BebasNeue.ttf",
 "lib/fonts/Cinzel.ttf",
 "lib/fonts/DancingScript.ttf",
 "lib/fonts/GreatVibes.ttf",
 "lib/fonts/KaushanScript.ttf",
 "lib/fonts/LICENCIAS.txt",
 "lib/fonts/Lobster.ttf",
 "lib/fonts/Montserrat.ttf",
 "lib/fonts/OFL.txt",
 "lib/fonts/Pacifico.ttf",
 "lib/fonts/PlayfairDisplay.ttf",
 "lib/fonts/Sacramento.ttf"
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // addAll falla entero si falta un archivo: se guardan de uno en uno y se cuentan
    let ok = 0;
    await Promise.all(FILES.map(async f => { try { const r = await fetch(f, { cache: 'reload' }); if (r.ok) { await c.put(f, r); ok++; } } catch (err) { /* sin conexión */ } }));
    self.__guardados = ok;
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
    const all = await self.clients.matchAll({ includeUncontrolled: true });
    all.forEach(c => c.postMessage({ type: 'offline-listo', archivos: FILES.length }));
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    // Los archivos se guardan sin el ?v= para que sirvan con cualquier versión de la dirección
    const key = new Request(url.origin + url.pathname);
    try {
      const r = await fetch(req, { cache: 'no-cache' });
      if (r && r.ok) c.put(key, r.clone());
      return r;
    } catch (err) {
      const hit = await c.match(key) || await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const idx = await c.match('index.html') || await c.match('./'); if (idx) return idx; }
      return new Response('Sin conexión y este archivo todavía no está guardado.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
