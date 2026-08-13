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
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Sync-Token,X-Auth,X-OR-Key,X-Push-Sub,Range',
  'Access-Control-Expose-Headers': 'Content-Range,Accept-Ranges,Content-Length',
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

// ===== WEB PUSH (응답 완료 알림, 2026-08-14) =====
// payload 없는 푸시라 암호화 불필요 — VAPID JWT(ES256)만 서명해 푸시 서비스에 POST.
// SW 쪽 push 핸들러가 일반 문구 알림을 띄운다(앱이 보이면 침묵).
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sendPush(subJson, env) {
  try {
    const sub = JSON.parse(subJson);
    const ep = new URL(sub.endpoint);
    const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const now = Math.floor(Date.now() / 1000);
    const h = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const c = b64u(te.encode(JSON.stringify({ aud: ep.origin, exp: now + 43200, sub: 'mailto:shfwkgud@gmail.com' })));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(h + '.' + c));
    const jwt = h + '.' + c + '.' + b64u(sig);
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { 'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, 'TTL': '120', 'Content-Length': '0' },
    });
    return r.status;   // 201=수락
  } catch (e) { return 'err:' + String(e).slice(0, 80); }
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
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(req.url);

    // ---- GENERATION RELAY (2026-08-13, 유저 "백그라운드 두고 나가면 생성 에러") ----
    // iOS는 앱 이탈 시 탭을 얼려 브라우저→OpenRouter 직행 스트림이 끊긴다. 워커가 중계하면서
    // 업스트림을 tee — 한쪽은 클라이언트로 그대로 흘리고, 한쪽은 waitUntil로 클라이언트가 죽어도
    // 끝까지 읽어 KV에 보관(15분). 복귀한 클라이언트가 GET으로 보관본을 주워 재생성 없이 이어간다.
    //   POST /gen?id=<uuid>  body=OpenRouter 요청 그대로, X-OR-Key=사용자 키 → SSE 중계
    //   GET  /gen?id=<uuid>  → 보관된 SSE 전문(완주 시) / 404(아직·없음)
    if (url.pathname === '/gen') {
      const gid = (url.searchParams.get('id') || '');
      if (!/^[a-zA-Z0-9-]{8,64}$/.test(gid)) return new Response('bad id', { status: 400, headers: CORS });
      if (req.method === 'POST') {
        const orKey = req.headers.get('X-OR-Key') || '';
        if (!orKey) return new Response('key required', { status: 400, headers: CORS });
        const body = await req.text();
        if (body.length > 2000000) return new Response('too large', { status: 413, headers: CORS });
        const up = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + orKey,
                     'HTTP-Referer': 'https://shfwkgud-png.github.io', 'X-Title': 'PANDORA' },
          body,
        });
        if (!up.ok || !up.body) {
          const t = await up.text();
          return new Response(t, { status: up.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        const [toClient, toPark] = up.body.tee();
        // ★푸시 구독(선택): 클라이언트가 X-Push-Sub(b64 JSON)를 실어 보내면 완주 시점에 알림 발송
        //   (유저 "답변 완성되면 진동 정도는 줘야" — 2026-08-14). 무상태: 구독을 저장하지 않는다.
        let pushSub = null;
        try { const ps = req.headers.get('X-Push-Sub'); if (ps) pushSub = decodeURIComponent(escape(atob(ps))); } catch {}
        ctx.waitUntil((async () => {
          try {
            const txt = await new Response(toPark).text();   // 클라이언트가 끊겨도 여긴 완주된다
            await env.PANDORA_KV.put('gen:' + gid, txt, { expirationTtl: 900 });
            if (pushSub) await sendPush(pushSub, env);       // 완주 알림(SW가 가시성 보고 침묵/배너 결정)
          } catch {}
        })());
        return new Response(toClient, { status: 200, headers: { ...CORS, 'Content-Type': 'text/event-stream' } });
      }
      if (req.method === 'GET') {
        const v = await env.PANDORA_KV.get('gen:' + gid);
        if (v === null) return new Response('not ready', { status: 404, headers: CORS });
        return new Response(v, { status: 200, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      return new Response('bad method', { status: 405, headers: CORS });
    }

    // ---- AUTH ----
    if (url.pathname === '/auth/register' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const u = String(b.u || '').trim().toLowerCase();
      const p = String(b.p || '');
      if (!/^[a-z0-9_-]{3,20}$/.test(u)) return json({ error: '아이디는 영문 소문자/숫자 3~20자' }, 400);
      if (p.length < 6) return json({ error: '비밀번호는 6자 이상' }, 400);
      if (await env.PANDORA_KV.get('user:' + u)) return json({ error: '이미 존재하는 아이디' }, 409);
      // id/pw signup is invite-only (Google signup needs no invite — Google
      // already verified the email). Admin issues codes in the admin console.
      const invite = String(b.invite || '').trim().toUpperCase();
      if (!invite) return json({ error: '초대코드가 필요합니다' }, 403);
      if (!(await env.PANDORA_KV.get('invite:' + invite))) return json({ error: '유효하지 않은 초대코드' }, 403);
      await env.PANDORA_KV.delete('invite:' + invite);   // single-use
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
    // admin: invite codes
    if (url.pathname === '/admin/invites') {
      const who = await resolveNs(req, env);
      if (!who || !who.admin) return json({ error: 'admin only' }, 403);
      if (req.method === 'POST') {
        const code = [...crypto.getRandomValues(new Uint8Array(4))]
          .map(b2 => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b2 % 32]).join('') +
          [...crypto.getRandomValues(new Uint8Array(4))]
          .map(b2 => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b2 % 32]).join('');
        await env.PANDORA_KV.put('invite:' + code, JSON.stringify({ created: Date.now(), by: who.user }));
        return json({ ok: true, code });
      }
      if (req.method === 'DELETE') {
        const code = String(url.searchParams.get('code') || '').toUpperCase();
        await env.PANDORA_KV.delete('invite:' + code);
        return json({ ok: true });
      }
      const list = await env.PANDORA_KV.list({ prefix: 'invite:', limit: 200 });
      const invites = [];
      for (const k of list.keys) {
        const rec = JSON.parse((await env.PANDORA_KV.get(k.name)) || '{}');
        invites.push({ code: k.name.slice(7), created: rec.created || 0 });
      }
      return json({ invites });
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

    // ---- IMAGE STORE (R2-backed) ----
    // GET /img?name=<id> — serve from R2 (URL 소지 = 접근. novel.html cgUrlFor가 쓰는 경로)
    if (url.pathname === '/img' && req.method === 'GET') {
      const name = (url.searchParams.get('name') || '').replace(/[^a-zA-Z0-9_.-]/g, '');
      if (!name) return new Response('name required', { status: 400, headers: CORS });
      // NSFW는 로그인 토큰 필수 (?t= — <img>는 헤더를 못 보내므로 쿼리로)
      if (name.startsWith('nsfw_')) {
        const user = await verifyToken(url.searchParams.get('t') || '', env);
        if (!user) return new Response('login required', { status: 401, headers: CORS });
      }
      // ★iOS Safari 미디어(오디오/비디오) 재생 필수: Range 요청 → 206 Partial Content.
      //   200 전체응답이면 iOS <audio> 재생이 불안정(무음·루프 실패). 2026-07-21.
      const hasRange = req.headers.has('Range');
      const obj = await env.R2_IMG.get(name, hasRange ? { range: req.headers } : undefined);
      if (!obj) return new Response('not found', { status: 404, headers: CORS });
      const h = {
        ...CORS,
        'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Accept-Ranges': 'bytes',
        'ETag': obj.httpEtag,
      };
      let status = 200;
      if (hasRange && obj.range) {
        const off = obj.range.offset ?? 0;
        const len = obj.range.length ?? (obj.size - off);
        h['Content-Range'] = `bytes ${off}-${off + len - 1}/${obj.size}`;
        h['Content-Length'] = String(len);
        status = 206;
      } else {
        h['Content-Length'] = String(obj.size);
      }
      return new Response(obj.body, { status, headers: h });
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
      // R2 direct upload (local gen pipeline; X-Upload-Key = wrangler secret UPLOAD_KEY)
      const upKey = req.headers.get('X-Upload-Key') || '';
      if (upKey && env.UPLOAD_KEY && upKey === env.UPLOAD_KEY) {
        const rname = (url.searchParams.get('name') || '').replace(/[^a-zA-Z0-9_.-]/g, '');
        if (!rname) return json({ error: 'name' }, 400);
        const rbuf = await req.arrayBuffer();
        if (rbuf.byteLength > 8_000_000) return json({ error: 'too large' }, 413);
        await env.R2_IMG.put(rname, rbuf, {
          httpMetadata: { contentType: req.headers.get('Content-Type') || 'image/webp' }
        });
        return json({ ok: true, r2: true, name: rname });
      }
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
