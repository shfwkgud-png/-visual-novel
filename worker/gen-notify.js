// Per-generation lifecycle. No prompts, API keys, player accounts or save data.
const KEY = 'generation-notification';
const TTL = 15 * 60 * 1000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

function trustedEndpoint(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096) return null;
    const u = new URL(value), host = u.hostname;
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash || u.pathname === '/') return null;
    if (host === 'fcm.googleapis.com' || host === 'web.push.apple.com' || host.endsWith('.web.push.apple.com')
        || host === 'push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com')
        || host.endsWith('.notify.windows.com')) return u.href;
  } catch {}
  return null;
}

export function notificationStart(req, id) {
  if (!UUID.test(id) || req.headers.get('X-Push-Mode') !== 'visibility-v1') return null;
  const hidden = req.headers.get('X-Push-Hidden'), sub = req.headers.get('X-Push-Sub');
  if (!['0','1'].includes(hidden) || !sub || sub.length > 8192) return null;
  try {
    const endpoint = trustedEndpoint(JSON.parse(atob(sub)).endpoint);
    return endpoint ? { type:'start', endpoint, hidden:hidden === '1' } : null;
  } catch { return null; }
}

export async function generationSignal(env, id, signal) {
  try {
    const ns = env.PANDORA_SYNC_STORE;
    const response = await ns.get(ns.idFromName('gen-notify:' + id)).fetch(new Request('https://internal/generation-notification', {
      method:'POST', body:JSON.stringify(signal)
    }));
    return response.ok;
  } catch { return false; }
}

export async function updateGenerationVisibility(req, env, id, cors) {
  const reply = status => new Response(null, {status, headers:cors});
  if (req.method !== 'POST') return reply(405);
  if (!UUID.test(id) || !req.body) return reply(400);
  if (req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'text/plain') return reply(415);
  const reader=req.body.getReader(), decoder=new TextDecoder();
  let text='', size=0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>256) { reader.cancel().catch(()=>{}); return reply(413); }
      text+=decoder.decode(value,{stream:true});
    }
    const v=JSON.parse(text+decoder.decode());
    if (!v || !Number.isSafeInteger(v.seq) || v.seq<1 || typeof v.hidden!=='boolean'
        || ('disabled' in v && typeof v.disabled!=='boolean')
        || Object.keys(v).some(k=>!['seq','hidden','disabled'].includes(k))) return reply(400);
    return reply(await generationSignal(env,id,{...v,type:'visibility'}) ? 204 : 503);
  } catch { return reply(400); }
}

export function successfulScene(sse) {
  let text='', finish=null;
  try {
    for (const event of sse.split(/\r?\n\r?\n/)) {
      const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if (!data || data.trim()==='[DONE]') continue;
      const item=JSON.parse(data), c=item.choices?.[0];
      if (item.error || c?.error || c?.delta?.refusal || c?.message?.refusal) return false;
      if (c?.finish_reason) {
        if (c.finish_reason !== 'stop') return false;
        finish=c.finish_reason;
      }
      const content=c?.delta?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type==='refusal') return false;
          if (part?.type==='text' && typeof part.text==='string') text+=part.text;
        }
      } else if (typeof content==='string') text+=content;
    }
    if (finish!=='stop') return false;
    const scene=JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gi,''));
    const lines=Array.isArray(scene?.dialogue) ? scene.dialogue.map(d=>d?.text) : [];
    const prose=[scene?.narration,...lines].filter(s=>typeof s==='string').join(' ').trim();
    if (!prose || scene.refusal) return false;
    // Match short model refusal language also rejected by the scene UI.
    return prose.length>=200 || !/죄송|생성할 수 없|생성하지|제공할 수 없|도와드릴 수 없|도울 수 없|진행할 수 없|부적절한|정책|가이드라인|AI로서|다른 방향으로|윤리적|허용되지 않|I cannot|I can't|I am unable|as an AI|inappropriate|guidelines|I apologize/i.test(prose);
  } catch { return false; }
}

async function sendPush(endpoint, env) {
  const te = new TextEncoder(), ep = new URL(endpoint);
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), {name:'ECDSA',namedCurve:'P-256'}, false, ['sign']);
  const header = b64u(te.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const claims = b64u(te.encode(JSON.stringify({aud:ep.origin,exp:Math.floor(Date.now()/1000)+43200,sub:'mailto:shfwkgud@gmail.com'})));
  const signature = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,te.encode(header+'.'+claims));
  await fetch(endpoint,{method:'POST', redirect:'error', signal:AbortSignal.timeout(5000), headers:{
    Authorization:'vapid t='+header+'.'+claims+'.'+b64u(signature)+', k='+env.VAPID_PUBLIC, TTL:'0', 'Content-Length':'0'
  }});
}

export async function notifyGeneration(ctx, env, signal) {
  const endpoint = await ctx.blockConcurrencyWhile(async()=>{
    const storage=ctx.storage, now=Date.now();
    let s=await storage.get(KEY);
    if (s && (now>=s.expires || s.disabled || s.sent)) return;
    if (!s) {
      if (signal.type==='complete') return;
      s={seq:0,hidden:false,expires:now+TTL};
      await storage.setAlarm(s.expires);
    }
    if (signal.type==='start') {
      if (s.endpoint || !trustedEndpoint(signal.endpoint)) return;
      s.endpoint=signal.endpoint;
      if (!s.seq) s.hidden=signal.hidden;
    } else if (signal.type==='visibility') {
      if (signal.seq<=s.seq) return;
      s.seq=signal.seq; s.hidden=signal.hidden;
      if (signal.disabled) { s.disabled=true; delete s.endpoint; }
    } else if (signal.type==='complete') {
      if (!s.endpoint) return;
      s.complete=true;
    } else return;
    const target=s.endpoint && s.complete && s.hidden && !s.disabled ? s.endpoint : null;
    if (target) { s.sent=true; delete s.endpoint; }
    await storage.put(KEY,s);
    return target;
  });
  if (endpoint) await sendPush(endpoint,env);
}

export async function expireGeneration(ctx) {
  await ctx.blockConcurrencyWhile(async()=>{
    const s=await ctx.storage.get(KEY);
    if (!s) return;
    if (Date.now()>=s.expires) await ctx.storage.delete(KEY);
    else await ctx.storage.setAlarm(s.expires);
  });
}
