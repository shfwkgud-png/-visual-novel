'use strict';
// Run with node --test tests-notifications-client.js. Every transport is a local fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
function productionFunction(name) {
  const match = new RegExp('\\n(?:async )?function ' + name + '\\(').exec(source);
  assert.ok(match, 'Missing production function ' + name);
  return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}
const helpers = ['fetchNim', 'resetTurnAsyncWork', 'llmRequestCurrent', 'isFreeApiMode', 'isFreeOpenRouterModel',
  'providerRequestError', 'safeProviderErrorText', 'providerErrorDetails', 'permanentProviderError', 'llmRequestProfile',
  'providerDeadline', 'readProviderStream', 'createSseParser', 'providerText'].map(productionFunction).join('\n');
const start = source.indexOf('\nfunction pushSubB64('), end = source.indexOf('\nfunction saveSettings()', start);
assert.ok(start >= 0 && end > start);
const notificationCode = source.slice(start, end); // Includes the actual visibility, pagehide and pageshow listeners.
const base = 'https://relay.invalid', prompt = 'private fixture scene', subscription = '{"endpoint":"https://push.invalid/fixture"}';
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key) };
}
function answer(text = '{"narration":"fixture"}', reason = 'stop') {
  return events([{choices:[{delta:{content:text}, finish_reason:reason}]}]);
}
function events(rows) {
  return new Response(rows.map(row => 'data: ' + JSON.stringify(row) + '\n\n').join('') + 'data: [DONE]\n\n');
}
function fixture({hidden = false, optedIn = true, beacon = 'accept', session = storage(), respond = () => answer()} = {}) {
  const model = [], updates = [], handlers = new Map(), startup = [];
  let serial = 0;
  const listener = (type, fn) => handlers.set(type, fn);
  const id = () => '00000000-0000-4000-8000-' + String(++serial).padStart(12, '0');
  const sb = {document:{hidden, addEventListener:listener}, addEventListener:listener, navigator:{},
    sessionStorage:session, localStorage:storage({vn_push_sub:subscription, vn_notif_done:optedIn ? '1' : '0'}),
    crypto:{randomUUID:id}, sendBtn:{disabled:false}, btoa, TextDecoder, AbortController,
    queueMicrotask:fn=>startup.push(fn), setTimeout:()=>1, clearTimeout(){}, recTokens(){}, showStatToast(){},
    PROVIDER:'openrouter', FREE_TEST_MODE:false, SYNC_URL:base, OPENROUTER_URL:'https://openrouter.invalid',
    NIM_URL:'https://nim.invalid', OPENROUTER_KEY:'fixture-key', NIM_MODEL:'fixture-model',
    curORModel:()=>'google/gemini-3.8-flash',
    fetch:async (url, options) => {
      if (url.startsWith(base + '/gen/visibility?')) {
        updates.push({via:'fetch',url,body:JSON.parse(options.body),options});
        return new Response(null,{status:204});
      }
      model.push({url,options});
      return await respond(model.length);
    },
  };
  if (beacon !== 'absent') sb.navigator.sendBeacon = (url, body) => {
    if (beacon === 'throw') throw new Error('fixture unavailable');
    if (beacon === 'decline') return false;
    updates.push({via:'beacon',url,body:JSON.parse(body)}); return true;
  };
  sb.window = sb;
  vm.runInNewContext(helpers + '\n' + notificationCode, sb);
  for (const callback of startup) callback();
  const generate = () => sb.fetchNim(prompt,[{role:'user',content:prompt}],0.7,4000,()=>{},sb.NIM_MODEL,null,0,{task:'main'});
  return {sb,model,updates,session,generate,visibility(hide) {
    sb.document.hidden=hide; handlers.get('visibilitychange')();
  }, dispatch(type){ handlers.get(type)(); }};
}
const bodies = h => h.updates.map(event => event.body);
const state = (seq,hidden,disabled=false) => ({seq,hidden,disabled});

test('initial visible relay uses the original POST; ordered visibility changes never start another generation', async () => {
  let release;
  const h=fixture({respond:()=>new Promise(resolve=>{release=resolve;})}), work=h.generate();
  assert.equal(h.model.length,1); assert.equal(h.updates.length,0);
  const {headers}=h.model[0].options;
  assert.equal(headers['X-Push-Mode'],'visibility-v1'); assert.equal(headers['X-Push-Hidden'],'0');
  assert.equal(atob(headers['X-Push-Sub']),subscription);
  h.visibility(true); h.visibility(false); h.dispatch('pagehide'); h.dispatch('pageshow');
  assert.deepEqual(bodies(h),[state(1,true),state(2,false),state(3,true),state(4,false)]);
  release(answer());
  assert.equal((await work).finishReason,'stop');
  assert.deepEqual(h.updates.at(-1).body,state(5,false,true));
  h.visibility(true); assert.equal(h.updates.length,5); assert.equal(h.model.length,1);
});

test('success while hidden leaves the relay armed until the user returns to the page', async () => {
  const h=fixture({hidden:true});
  assert.equal((await h.generate()).finishReason,'stop');
  assert.equal(h.model[0].options.headers['X-Push-Hidden'],'1');
  assert.equal(h.updates.length,0);
  h.visibility(false); h.visibility(true);
  assert.deepEqual(bodies(h),[state(1,false,true)]);
});

test('HTTP, provider-stream, truncation, content filtering and terminal empty results retire a hidden relay', async () => {
  for (const make of [()=>new Response('{"error":{"message":"fixture rejection"}}',{status:401}),
    ()=>events([{error:{code:503,message:'fixture stream error'}}]),
    ()=>answer('partial','length'),()=>answer('','content_filter'),()=>answer('','stop')]) {
    const h=fixture({hidden:true,respond:make});
    await h.generate();
    h.visibility(false);
    assert.deepEqual(bodies(h),[state(1,true,true)]); assert.equal(h.model.length,1);
  }
});

test('network loss, timeout and EOF before a terminal event retain visibility updates without another model call', async () => {
  for (const make of [()=>{throw Error('connection lost');},
    ()=>{throw Object.assign(new Error('timeout'),{name:'AbortError'});},()=>new Response('')]) {
    const h=fixture({respond:make}), result=await h.generate();
    assert.ok(result.error);
    assert.deepEqual(bodies(h),[]);
    h.visibility(true); h.visibility(false);
    assert.deepEqual(bodies(h),[state(1,true),state(2,false)]);
    assert.equal(h.model.length,1);
  }
});

test('resetting a session or opting out disables the active request even if its hidden stream later succeeds', async () => {
  for (const action of ['reset','opt out']) {
    let release;
    const h=fixture({hidden:true,respond:()=>new Promise(resolve=>{release=resolve;})}), work=h.generate();
    if (action==='reset') h.sb.resetTurnAsyncWork(); else await h.sb.toggleDoneNotif(false);
    assert.deepEqual(bodies(h),[state(1,true,true)]);
    release(answer()); await work; h.visibility(false);
    assert.equal(h.updates.length,1);
    if (action==='opt out') {
      const next=h.generate(); release(answer()); await next;
      const headers=h.model[1].options.headers;
      for (const key of ['X-Push-Sub','X-Push-Mode','X-Push-Hidden']) assert.equal(headers[key],undefined);
      h.visibility(true); assert.equal(h.updates.length,1);
    }
  }
});

test('a fresh generation retires only the interrupted id, including a direct replacement', async () => {
  for (const direct of [false,true]) {
    const h=fixture({respond:index=>{ if (index===1) throw Error('lost'); return answer(); }});
    await h.generate(); h.visibility(true);
    const prior=h.model[0].url.split('id=')[1];
    if (direct) h.sb.PROVIDER='nim';
    await h.generate();
    const priorUpdates=h.updates.filter(event=>new URL(event.url).searchParams.get('id')===prior);
    assert.deepEqual(priorUpdates.map(event=>event.body),[state(1,true),state(2,true,true)]);
    h.visibility(false);
    assert.equal(h.updates.length,direct ? 2 : 3);
    assert.equal(h.model.length,2);
  }
});

test('a failed beacon falls back to a CORS-simple keepalive POST containing only status', async () => {
  for (const beacon of ['absent','decline','throw']) {
    const h=fixture({beacon,respond:()=>{throw Error('lost');}});
    await h.generate(); h.visibility(true);
    const [update]=h.updates;
    assert.equal(update.via,'fetch'); assert.equal(update.options.method,'POST'); assert.equal(update.options.keepalive,true);
    const request=new Request(update.url,update.options);
    assert.match(request.headers.get('content-type'),/^text\/plain\b/i);
    assert.deepEqual([...request.headers.keys()],['content-type']);
    assert.deepEqual(JSON.parse(await request.text()),state(1,true));
    const expected=new URL(h.model[0].url); expected.pathname='/gen/visibility';
    assert.equal(update.url,expected.href); assert.equal(h.model.length,1);
  }
});

test('visible reload cancels the last hidden sequence once without saving prompts, credentials or subscription', async () => {
  const h=fixture({respond:()=>{throw Error('lost');}});
  await h.generate(); h.visibility(true);
  const [job]=JSON.parse(h.session.getItem('vn_pending_push'));
  assert.deepEqual(Object.keys(job).sort(),['finished','id','seq','started']);
  const restored=fixture({session:h.session});
  assert.equal(restored.updates[0].url,h.updates[0].url);
  assert.deepEqual(bodies(restored),[state(2,false,true)]);
  restored.visibility(true);
  assert.equal(restored.updates.length,1); assert.equal(restored.model.length,0);
  assert.equal(h.session.getItem('vn_pending_push'),null);
});
