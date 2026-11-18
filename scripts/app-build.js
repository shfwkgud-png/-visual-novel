'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const marker=/(<meta name="pandora-build" content=")[a-f0-9]{64}(">)/;
const scriptTag=/(<script\b[^>]*\bsrc=["'])([^"']+)(["'])/gi;
const read=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
function versionScripts(html,build){
  return html.replace(scriptTag,(tag,before,src,after)=>{
    if(/^(?:https?:)?\/\//.test(src))return tag;
    const [file,query]=src.split('?'),params=new URLSearchParams(query);
    params.delete('build');
    if(build)params.set('build',build);
    return before+file+(params.size?'?'+params:'')+after;
  });
}

function buildId(root){
  const html=read(path.join(root,'novel.html'));
  if(!marker.test(html))throw new Error('novel.html is missing its pandora-build meta');
  const files=new Set(['novel.html','sw.js','manifest.webmanifest']);
  for(const match of html.matchAll(scriptTag)){
    const file=match[2].split(/[?#]/)[0];
    if(!/^(?:https?:)?\/\//.test(file))files.add(file);
  }
  function collect(dir){
    for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
      const file=dir+'/'+entry.name;
      if(entry.isDirectory())collect(file);
      else if(/\.(?:js|json)$/.test(file)&&!file.endsWith('.test.js'))files.add(file);
    }
  }
  collect('storypacks');
  const hash=crypto.createHash('sha256');
  for(const file of [...files].sort()){
    const absolute=path.resolve(root,file);
    if(!absolute.startsWith(path.resolve(root)+path.sep))throw new Error('Build input escapes repository: '+file);
    let source=read(absolute);
    if(file==='novel.html')source=versionScripts(source.replace(marker,'$1__BUILD__$2'),null);
    hash.update(file+'\0'+source+'\0');
  }
  return hash.digest('hex');
}

if(require.main===module){
  const root=path.resolve(__dirname,'..'),build=buildId(root);
  const file=path.join(root,'novel.html'),html=read(file);
  const next=versionScripts(html.replace(marker,(_,before,after)=>before+build+after),build);
  const manifest=JSON.stringify({build})+'\n';
  if(process.argv.includes('--check')){
    if(html!==next||read(path.join(root,'app-build.json'))!==manifest)
      throw new Error('App build is stale. Run: node scripts/app-build.js');
  }else{
    fs.writeFileSync(file,next);
    fs.writeFileSync(path.join(root,'app-build.json'),manifest);
  }
  console.log('App build '+build.slice(0,12)+' verified');
}
module.exports=buildId;
