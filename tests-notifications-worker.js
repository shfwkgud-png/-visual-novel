'use strict';
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
let worker, PandoraSyncStore, successfulScene, fixtureKey;
const gid = 'aad952b6-4624-4f53-be3a-c64558b0b828';
const endpoint = 'https://web.push.apple.com/Qfixture';
const savedFetch = global.fetch, realNow = Date.now;
const sse = items => items.map(item => 'data: ' + JSON.stringify(item) + '\r\n\r\n').join('') + 'data: [DONE]\r\n\r\n';
const event = (content, finish_reason) => ({choices:[{delta:{content},finish_reason}]});
const scene = JSON.stringify({narration:'연회장 문이 열린다.',dialogue:[]});
const complete = sse([event(scene,'stop')]);
before(async () => {
  ({ default:worker, PandoraSyncStore } = await import('./worker/sync.js'));
  ({ successfulScene } = await import('./worker/gen-notify.js'));
  const key = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  fixtureKey = JSON.stringify(await crypto.subtle.exportKey('jwk',key.privateKey));
});
after(() => { global.fetch=savedFetch; Date.now=realNow; });

function harness(transcript=complete) {
  const map = new Map(), pushes=[], parked=[], names=[], waits=[];
  let chain=Promise.resolve(), alarm, failStore=false, endStream;
  const ctx = {
    blockConcurrencyWhile(fn) { const next=chain.then(fn); chain=next.catch(()=>{}); return next; },
    storage:{
      get:async k=>structuredClone(map.get(k)),
      put:async (k,v)=>{ if (failStore) throw Error('fixture storage offline'); map.set(k,structuredClone(v)); },
      delete:async k=>map.delete(k), setAlarm:async t=>{alarm=t;},
      sql:{exec(){throw Error('notification touched save tables');}}
    }
  };
  const env={
    PANDORA_KV:{put:async(k,v)=>parked.push({k,v})}, VAPID_PRIVATE_JWK:fixtureKey, VAPID_PUBLIC:'fixture-public'
  };
  const obj = new PandoraSyncStore(ctx,env);
  env.PANDORA_SYNC_STORE={idFromName:n=>{names.push(n);return n;},get:()=>obj};
  global.fetch=async (url,init)=>{
    if (String(url)==='https://openrouter.ai/api/v1/chat/completions') {
      return new Response(new ReadableStream({start(c){endStream=()=>{c.enqueue(new TextEncoder().encode(transcript));c.close();};}}));
    }
    assert.equal(String(url),endpoint); pushes.push(init); return new Response(null,{status:201});
  };
  const call=(path,init)=>worker.fetch(new Request('https://fixture.invalid'+path,init),env,{waitUntil:p=>waits.push(p)});
  return {
    pushes, parked, names, map, obj, env, alarm:()=>alarm, offline:()=>{failStore=true;},
    async start(extra={}, dest=endpoint) {
      const response=await call('/gen?id='+gid,{method:'POST',headers:{'X-OR-Key':'fixture',
        'X-Push-Mode':'visibility-v1','X-Push-Hidden':'0','X-Push-Sub':btoa(JSON.stringify({endpoint:dest})),...extra},body:'{}'});
      assert.equal(response.status,200); return response;
    },
    async finish() { endStream(); await Promise.all(waits); },
    visible:(v,id=gid)=>call('/gen/visibility?id='+id,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:typeof v==='string'?v:JSON.stringify(v)}),
    call,
  };
}

test('visible throughout, or foreground return before completion, produces no push',async()=>{
  for (const transitions of [[],[{seq:2,hidden:false},{seq:1,hidden:true}]]) {
    const h=harness(); await h.start();
    for (const v of transitions) assert.equal((await h.visible(v)).status,204);
    await h.finish(); assert.equal(h.pushes.length,0); assert.equal(h.parked.length,1);
  }
});
test('visibility arriving before start overrides initial state and repeated events send once',async()=>{
  const h=harness(); await h.visible({seq:1,hidden:true}); await h.start(); await h.finish();
  await Promise.all([h.visible({seq:2,hidden:true}),h.visible({seq:3,hidden:true})]);
  assert.equal(h.pushes.length,1); assert.equal(h.pushes[0].redirect,'error');
  assert.ok(h.names.every(n=>n==='gen-notify:'+gid));
});
test('late hidden can claim completed response, but disabled is terminal',async()=>{
  for (const disabled of [true,false]) {
    const h=harness(); await h.start(); await h.finish();
    if(disabled)await h.visible({seq:3,hidden:false,disabled:true});
    await Promise.all([h.visible({seq:1,hidden:true}),h.visible({seq:2,hidden:true})]);
    assert.equal(h.pushes.length,disabled?0:1);
  }
});
test('a hidden start can notify, legacy clients and unsupported push targets never can',async()=>{
  for (const [headers,dest,count] of [
    [{'X-Push-Hidden':'1'},endpoint,1],
    [{'X-Push-Hidden':'1','X-Push-Mode':'legacy'},endpoint,0],
    [{'X-Push-Hidden':'1'},'https://example.invalid/not-push',0]
  ]) {
    const h=harness(); await h.start(headers,dest); await h.finish();
    assert.equal(h.pushes.length,count); assert.equal(h.names.length,count?2:0);
  }
});
test('only a completed scene can send, including escaped and chunked dialogue',async()=>{
  const failures=[sse([event('', 'stop')]),sse([event(scene,'length')]),sse([event(scene,'content_filter')]),
    sse([event(scene,null)]),sse([event(scene,'stop'),{error:{code:503}}]),sse([event('{"narration":"unfinished"','stop')]),
    sse([event('Sorry, I cannot help.', 'stop')]),sse([event(JSON.stringify({narration:'죄송하지만 생성할 수 없습니다.'}),'stop')]),
    sse([{choices:[{delta:{content:scene,refusal:'declined'},finish_reason:'stop'}]}])];
  for(const body of failures) {
    const h=harness(body); await h.start({'X-Push-Hidden':'1'}); await h.finish(); assert.equal(h.pushes.length,0);
  }
  const lines=JSON.stringify({dialogue:[{text:'어디로 가?'}]});
  assert.equal(successfulScene(sse([event(lines.slice(0,7),null),event([{type:'text',text:lines.slice(7)}],'stop')])),true);
});
test('expiry prevents late sends and alarm removes only notification state',async()=>{
  const h=harness(); let now=realNow(); Date.now=()=>now;
  try {
    h.map.set('other','keep'); await h.start(); await h.finish();
    assert.equal(h.alarm(),now+900_000);
    now+=900_001; await h.visible({seq:1,hidden:true}); assert.equal(h.pushes.length,0);
    await h.obj.alarm(); assert.deepEqual([...h.map],[['other','keep']]);
    await h.visible({seq:2,hidden:true}); assert.equal(h.pushes.length,0);
  } finally { Date.now=realNow; }
});
test('lifecycle rejects invalid capabilities, untrusted input and excessive bodies without opening storage',async()=>{
  const h=harness();
  assert.equal((await h.visible({seq:1,hidden:true},'short-id')).status,400);
  for(const body of ['bad',{seq:0,hidden:true},{seq:1,hidden:'true'},{seq:1,hidden:true,endpoint}])
    assert.equal((await h.visible(body)).status,400);
  assert.equal((await h.visible('a'.repeat(300))).status,413);
  assert.equal((await h.call('/gen/visibility?id='+gid,{method:'GET'})).status,405);
  assert.equal(h.names.length,0);
  const cors=await h.call('/gen?id='+gid,{method:'OPTIONS'});
  assert.match(cors.headers.get('Access-Control-Allow-Headers'),/X-Push-Mode,X-Push-Hidden/);
});
test('storage failures cannot turn a successful generation into a foreground notification',async()=>{
  const h=harness(); h.offline(); await h.start({'X-Push-Hidden':'1'}); await h.finish();
  assert.equal(h.pushes.length,0); assert.equal(h.parked.length,1); assert.equal((await h.visible({seq:1,hidden:true})).status,503);
});
