// PANDORA sync worker — story/save backup across devices (KV).
// Auth: the app sends a user-chosen passphrase in X-Sync-Token; data is
// namespaced under its hash, so only someone with the same passphrase can
// read/write those keys. Personal-scale security, no accounts needed.
//
// API:
//   GET  /sync?key=<name>   -> stored JSON (or 404)
//   PUT  /sync?key=<name>   body = JSON to store
//   GET  /sync/list         -> keys stored under this token
// Keys used by the app: "stories" (vn_local_stories), "save:<storyId>", "cfg"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Sync-Token',
};

async function tokenHash(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pandora:' + token));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    if (!url.pathname.startsWith('/sync')) {
      return new Response('pandora-sync ok', { headers: CORS });
    }

    const token = req.headers.get('X-Sync-Token') || '';
    if (token.length < 4) {
      return new Response(JSON.stringify({ error: 'sync token required (4+ chars)' }),
        { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const ns = await tokenHash(token);

    if (url.pathname === '/sync/list') {
      const list = await env.PANDORA_KV.list({ prefix: ns + ':' });
      const keys = list.keys.map(k => k.name.slice(ns.length + 1));
      return new Response(JSON.stringify({ keys }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const key = url.searchParams.get('key');
    if (!key || key.length > 128) {
      return new Response(JSON.stringify({ error: 'key required' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const kvKey = ns + ':' + key;

    if (req.method === 'GET') {
      const val = await env.PANDORA_KV.get(kvKey);
      if (val === null) {
        return new Response(JSON.stringify({ error: 'not found' }),
          { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      return new Response(val, { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (req.method === 'PUT') {
      const body = await req.text();
      if (body.length > 20_000_000) {
        return new Response(JSON.stringify({ error: 'too large' }),
          { status: 413, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      await env.PANDORA_KV.put(kvKey, body);
      return new Response(JSON.stringify({ ok: true, bytes: body.length }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'method' }),
      { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};
