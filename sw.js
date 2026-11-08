/* Makes your gateway reachable with a real fetch() at ./v1/... while the app tab is open. The model itself runs in that tab. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || !/\/v1\/[a-z/]+$/.test(url.pathname)) return;
  e.respondWith(handle(e));
});
async function handle(e) {
  const url = new URL(e.request.url);
  const list = await self.clients.matchAll({ type: 'window' });
  const tab = list.find((c) => /app\.html/.test(c.url));
  const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  if (!tab) return json(503, { error: { message: 'Open app.html in this browser: your model runs in that tab.', type: 'server_error', code: 503 } });
  let body = null;
  if (e.request.method === 'POST') { try { body = await e.request.clone().json(); } catch (err) { return json(400, { error: { message: 'Body is not valid JSON.', type: 'invalid_request_error', code: 400 } }); } }
  const headers = {};
  e.request.headers.forEach((v, k) => (headers[k] = v));
  const reply = await new Promise((res) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (m) => res(m.data);
    tab.postMessage({ type: 'api-request', method: e.request.method, path: url.pathname, headers, body }, [ch.port2]);
    setTimeout(() => res({ status: 504, json: { error: { message: 'The model tab did not answer.', type: 'server_error', code: 504 } } }), 20000);
  });
  return json(reply.status, reply.json || {});
}
