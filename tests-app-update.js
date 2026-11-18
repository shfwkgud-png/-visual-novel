'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const buildId=require('./scripts/app-build.js');
const source=fs.readFileSync(path.join(__dirname,'novel.html'),'utf8').replace(/\r\n/g,'\n');
const build=JSON.parse(fs.readFileSync(path.join(__dirname,'app-build.json'),'utf8')).build;
assert.equal(buildId(__dirname),build,'Run node scripts/app-build.js after changing app sources');
assert(source.includes('<meta name="pandora-build" content="'+build+'">'));
for(const match of source.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi))
  if(!/^(?:https?:)?\/\//.test(match[1]))assert.equal(new URL(match[1],'https://app.invalid/').searchParams.get('build'),build);

const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'pandora-build-test-'));
try{
  fs.mkdirSync(path.join(scratch,'storypacks','demo'),{recursive:true});
  const html='<meta name="pandora-build" content="'+'0'.repeat(64)+'"><style>body{color:red}</style><script src="client.js?v=1"></script>';
  for(const [file,text] of Object.entries({'novel.html':html,'client.js':'const app=1;\n','sw.js':'// notification only\n','manifest.webmanifest':'{}\n','storypacks/demo/data.json':'{"event":"hello"}\n'}))
    fs.writeFileSync(path.join(scratch,file),text);
  const before=buildId(scratch);
  fs.utimesSync(path.join(scratch,'novel.html'),new Date(0),new Date(0));
  assert.equal(buildId(scratch),before,'redeployment timestamps are not an app change');
  fs.writeFileSync(path.join(scratch,'client.js'),'const app=1;\r\n');
  assert.equal(buildId(scratch),before,'Windows checkout line endings are not an app change');
  fs.writeFileSync(path.join(scratch,'novel.html'),html.replace('0'.repeat(64),before).replace('?v=1','?v=1&build='+before));
  assert.equal(buildId(scratch),before,'the embedded build and script cache key do not hash themselves');
  fs.writeFileSync(path.join(scratch,'storypacks/demo/data.json'),'{"event":"changed"}\n');
  assert.notEqual(buildId(scratch),before,'local story data changes the release identity');
  fs.writeFileSync(path.join(scratch,'storypacks/demo/data.json'),'{"event":"hello"}\n');
  fs.writeFileSync(path.join(scratch,'novel.html'),html.replace('color:red','color:blue'));
  assert.notEqual(buildId(scratch),before,'CSS and markup changes are app changes');
  fs.writeFileSync(path.join(scratch,'novel.html'),html);
  fs.writeFileSync(path.join(scratch,'storypacks/demo/ignored.test.js'),'// tests only');
  assert.equal(buildId(scratch),before,'test-only changes do not notify players');
}finally{
  assert.equal(path.dirname(path.resolve(scratch)),path.resolve(os.tmpdir()));
  assert(path.basename(scratch).startsWith('pandora-build-test-'));
  fs.rmSync(scratch,{recursive:true});
}

const refresh=source.slice(source.indexOf('function refreshApp()'),source.indexOf('// ===== PROVIDER TOGGLE ====='));
const start=source.indexOf('// The meta identifies the loaded code;');
const update=source.slice(start,source.indexOf('// Background pickup owns',start));
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
function page(loaded=A){
  const nodes=new Map(),timers=[],navigations=[],calls=[],events={};
  const context={URL,AbortController,sendBtn:{disabled:false},window:{addEventListener:(name,fn)=>events[name]=fn},
    location:{protocol:'https:',href:'https://app.invalid/game/novel.html?story=hogwarts#scene',replace:url=>navigations.push(url)},
    setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>t.cleared=true,
    document:{hidden:false,querySelector:()=>({content:loaded}),getElementById:id=>nodes.get(id),
      addEventListener:(name,fn)=>events[name]=fn,
      createElement:()=>({style:{},dataset:{},remove(){nodes.delete(this.id);}}),
      body:{appendChild:node=>nodes.set(node.id,node)}}};
  context.reply=async()=>({ok:true,json:async()=>({build:A})});
  context.fetch=(url,options)=>{calls.push({url,options});return context.reply(url,options);};
  vm.createContext(context);vm.runInContext(refresh+'\n'+update,context);
  return {context,nodes,timers,navigations,calls,events};
}
(async()=>{
  const p=page();
  for(const etag of ['"release"','W/"release"','"new-deploy-same-content"']){
    p.context.reply=async()=>({ok:true,headers:{get:()=>etag},json:async()=>({build:A})});
    assert.equal(await p.context.checkAppUpdate(),false);
    assert.equal(p.nodes.size,0,'transfer ETags never produce a false update');
  }
  p.context.reply=async()=>({ok:true,json:async()=>({build:B})});
  assert.equal(await p.context.checkAppUpdate(),true,'a cached document detects new code on its first check');
  assert.equal(p.nodes.get('appUpdateBanner').dataset.build,B);
  await p.context.checkAppUpdate();assert.equal(p.nodes.size,1);
  p.context.window._dismissedAppBuild=B;p.nodes.get('appUpdateBanner').remove();
  await p.context.checkAppUpdate();assert.equal(p.nodes.size,0,'dismissal applies to that version');
  p.context.reply=async()=>({ok:true,json:async()=>({build:C})});
  await p.context.checkAppUpdate();assert.equal(p.nodes.size,1,'a genuinely later version can notify again');
  const current=page(B);current.context.reply=async()=>({ok:true,json:async()=>({build:B})});
  await current.context.checkAppUpdate(true);assert.equal(current.nodes.size,0);assert.equal(current.navigations.length,0);
  const history=page();history.context.reply=async()=>({ok:true,json:async()=>({build:B})});
  history.context.sendBtn.disabled=true;await history.context.checkAppUpdate(true);
  assert.equal(history.navigations.length,0,'history restore cannot interrupt generation');
  history.context.sendBtn.disabled=false;await history.context.checkAppUpdate(true);
  assert.equal(history.navigations.length,1);
  const destination=new URL(history.navigations[0]);
  assert.equal(destination.searchParams.get('story'),'hogwarts');assert.equal(destination.hash,'#scene');
  assert(destination.searchParams.get('v'),'refresh must bypass the document cache, not add a fragment');
  const parallel=page();await Promise.all([parallel.context.checkAppUpdate(),parallel.context.checkAppUpdate()]);
  assert.equal(parallel.calls.length,1,'foreground/history checks share one in-flight request');
  for(const payload of [null,{},[],{build:[A]},{build:{}},{build:'not-a-version'}]){
    const invalid=page();invalid.context.reply=async()=>({ok:true,json:async()=>payload});
    assert.equal(await invalid.context.checkAppUpdate(),false);assert.equal(invalid.nodes.size,0);
  }
  const offline=page();offline.context.reply=async()=>({ok:false,json:async()=>({build:B})});
  assert.equal(await offline.context.checkAppUpdate(),false);assert.equal(offline.navigations.length,0);
  const timeout=page();timeout.context.reply=(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('offline'))));
  const pending=timeout.context.checkAppUpdate();timeout.timers.find(t=>t.ms===8000).fn();
  assert.equal(await pending,false);
  timeout.context.reply=async()=>({ok:true,json:async()=>({build:B})});
  assert.equal(await timeout.context.checkAppUpdate(),true,'a timed-out check does not block future checks');
  console.log('PASS app updates: content identity, cached first load, ETag variants, same-version refresh, history, concurrency, invalid/offline and timeout recovery');
})().catch(error=>{console.error(error);process.exitCode=1;});
