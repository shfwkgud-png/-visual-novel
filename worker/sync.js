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
  'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Sync-Token',
};

// ===== ACCOUNTS (username/password → HMAC session token) =====
const te = new TextEncoder();

async function pbkdf2Hash(pw, salt) {
  const key = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(salt), iterations: 100000 }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(msg, secret) {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function makeToken(user, env) {
  const exp = Date.now() + 90 * 24 * 3600 * 1000;   // 90 days
  const sig = await hmacHex(user + '|' + exp, env.AUTH_SECRET || 'dev');
  return btoa(unescape(encodeURIComponent(user))) + '.' + exp + '.' + sig;
}

async function verifyToken(token, env) {
  try {
    const [u64, exp, sig] = token.split('.');
    const user = decodeURIComponent(escape(atob(u64)));
    if (Date.now() > Number(exp)) return null;
    const want = await hmacHex(user + '|' + exp, env.AUTH_SECRET || 'dev');
    return sig === want ? user : null;
  } catch { return null; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Resolve the caller's storage namespace: account token first, legacy passphrase second.
async function resolveNs(req, env) {
  const auth = req.headers.get('X-Auth') || '';
  if (auth) {
    const user = await verifyToken(auth, env);
    if (user) {
      const admin = (await env.PANDORA_KV.get('sys:admin')) === user;
      return { ns: 'u_' + user, user, admin };
    }
  }
  const token = req.headers.get('X-Sync-Token') || '';
  if (token.length >= 4) return { ns: await tokenHash(token), user: null, admin: false };
  return null;
}

async function tokenHash(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pandora:' + token));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(req.url);

    // ---- AUTH ----
    if (url.pathname === '/auth/register' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const u = String(b.u || '').trim().toLowerCase();
      const p = String(b.p || '');
      if (!/^[a-z0-9_-]{3,20}$/.test(u)) return json({ error: '아이디는 영문 소문자/숫자 3~20자' }, 400);
      if (p.length < 6) return json({ error: '비밀번호는 6자 이상' }, 400);
      if (await env.PANDORA_KV.get('user:' + u)) return json({ error: '이미 존재하는 아이디' }, 409);
      const salt = crypto.randomUUID();
      const hash = await pbkdf2Hash(p, salt);
      await env.PANDORA_KV.put('user:' + u, JSON.stringify({ salt, hash, created: Date.now() }));
      // first registered account becomes the admin
      if (!(await env.PANDORA_KV.get('sys:admin'))) await env.PANDORA_KV.put('sys:admin', u);
      const admin = (await env.PANDORA_KV.get('sys:admin')) === u;
      return json({ ok: true, token: await makeToken(u, env), user: u, admin });
    }
    if (url.pathname === '/auth/login' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const u = String(b.u || '').trim().toLowerCase();
      const rec = JSON.parse((await env.PANDORA_KV.get('user:' + u)) || 'null');
      if (!rec) return json({ error: '아이디 또는 비밀번호가 틀립니다' }, 401);
      const hash = await pbkdf2Hash(String(b.p || ''), rec.salt);
      if (hash !== rec.hash) return json({ error: '아이디 또는 비밀번호가 틀립니다' }, 401);
      const admin = (await env.PANDORA_KV.get('sys:admin')) === u;
      return json({ ok: true, token: await makeToken(u, env), user: u, admin });
    }
    // Google Sign-In: verify the GIS ID token server-side, map to an account
    if (url.pathname === '/auth/google' && req.method === 'POST') {
      if (!env.GOOGLE_CLIENT_ID) return json({ error: '구글 로그인이 아직 설정되지 않았습니다' }, 501);
      let b; try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const cred = String(b.credential || '');
      if (!cred) return json({ error: 'credential required' }, 400);
      const vr = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred));
      if (!vr.ok) return json({ error: '구글 토큰 검증 실패' }, 401);
      const info = await vr.json();
      if (info.aud !== env.GOOGLE_CLIENT_ID) return json({ error: 'aud mismatch' }, 401);
      if (Number(info.exp) * 1000 < Date.now()) return json({ error: 'expired' }, 401);
      // stable account id from the Google subject
      const u = 'g' + info.sub;
      if (!(await env.PANDORA_KV.get('user:' + u))) {
        await env.PANDORA_KV.put('user:' + u, JSON.stringify({
          provider: 'google',
          email: info.email || '',
          name: info.name || (info.email || '').split('@')[0],
          created: Date.now()
        }));
        if (!(await env.PANDORA_KV.get('sys:admin'))) await env.PANDORA_KV.put('sys:admin', u);
      }
      const admin = (await env.PANDORA_KV.get('sys:admin')) === u;
      const rec = JSON.parse((await env.PANDORA_KV.get('user:' + u)) || '{}');
      return json({ ok: true, token: await makeToken(u, env), user: u, display: rec.name || rec.email || u, admin });
    }
    if (url.pathname === '/auth/me') {
      const who = await resolveNs(req, env);
      if (!who || !who.user) return json({ error: 'no auth' }, 401);
      return json({ user: who.user, admin: who.admin });
    }
    // admin: user list
    if (url.pathname === '/admin/users') {
      const who = await resolveNs(req, env);
      if (!who || !who.admin) return json({ error: 'admin only' }, 403);
      const list = await env.PANDORA_KV.list({ prefix: 'user:', limit: 1000 });
      const users = [];
      for (const k of list.keys) {
        const u = k.name.slice(5);
        const rec = JSON.parse((await env.PANDORA_KV.get(k.name)) || '{}');
        const dataKeys = await env.PANDORA_KV.list({ prefix: 'u_' + u + ':', limit: 1000 });
        const imgKeys = await env.PANDORA_KV.list({ prefix: 'img:u_' + u + ':', limit: 1000 });
        users.push({ user: u, created: rec.created || 0, keys: dataKeys.keys.length, imgs: imgKeys.keys.length });
      }
      return json({ users, admin: await env.PANDORA_KV.get('sys:admin') });
    }

    // ---- IMAGE STORE (KV-backed, free tier) ----
    // GET /img/<ns>/<id>  — public (possessing the URL grants access; ns is a
    //                       token hash, unguessable). Served with long cache.
    // PUT /img?name=<id>  — token required; body = raw image bytes (≤ 8MB).
    if (url.pathname.startsWith('/img/')) {
      const parts = url.pathname.split('/');       // ['', 'img', ns, id]
      if (parts.length >= 4) {
        const { value, metadata } = await env.PANDORA_KV.getWithMetadata(
          'img:' + parts[2] + ':' + parts.slice(3).join('/'), 'arrayBuffer');
        if (value === null) return new Response('not found', { status: 404, headers: CORS });
        return new Response(value, {
          headers: {
            ...CORS,
            'Content-Type': (metadata && metadata.ct) || 'image/png',
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        });
      }
      return new Response('bad path', { status: 400, headers: CORS });
    }
    // list this token's images (admin)
    if (url.pathname === '/img-list') {
      const who = await resolveNs(req, env);
      if (!who) return json({ error: 'auth' }, 401);
      const ns = who.ns;
      const list = await env.PANDORA_KV.list({ prefix: 'img:' + ns + ':', limit: 1000 });
      const items = list.keys.map(k => ({
        name: k.name.slice(('img:' + ns + ':').length),
        url: url.origin + '/img/' + ns + '/' + k.name.slice(('img:' + ns + ':').length)
      }));
      return new Response(JSON.stringify({ items }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/img' && req.method === 'DELETE') {
      const who = await resolveNs(req, env);
      if (!who) return json({ error: 'auth' }, 401);
      const ns = who.ns;
      const name = (url.searchParams.get('name') || '').replace(/[^a-zA-Z0-9_.-]/g, '');
      await env.PANDORA_KV.delete('img:' + ns + ':' + name);
      return new Response(JSON.stringify({ ok: true }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/img' && req.method === 'PUT') {
      const who = await resolveNs(req, env);
      if (!who) return json({ error: 'auth' }, 401);
      const ns = who.ns;
      const name = (url.searchParams.get('name') || '').replace(/[^a-zA-Z0-9_.-]/g, '');
      if (!name) return new Response(JSON.stringify({ error: 'name' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 8_000_000) return new Response(JSON.stringify({ error: 'too large' }),
        { status: 413, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const ct = req.headers.get('Content-Type') || 'image/png';
      await env.PANDORA_KV.put('img:' + ns + ':' + name, buf, { metadata: { ct } });
      return new Response(JSON.stringify({ ok: true, url: url.origin + '/img/' + ns + '/' + name }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (!url.pathname.startsWith('/sync')) {
      return new Response('pandora-sync ok', { headers: CORS });
    }

    const who = await resolveNs(req, env);
    if (!who) {
      return new Response(JSON.stringify({ error: 'login or sync token required' }),
        { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const ns = who.ns;

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

    if (req.method === 'DELETE') {
      await env.PANDORA_KV.delete(kvKey);
      return new Response(JSON.stringify({ ok: true }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } });
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
