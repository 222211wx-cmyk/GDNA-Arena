import test from "node:test";
import assert from "node:assert/strict";
import {readFile,mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";
const require=createRequire(import.meta.url);
const root=new URL("../",import.meta.url).pathname;
test("legacy binary and Tus routes return explicit 410 without consuming clip bytes",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"media-retired-"));
  let server;
  try{
    const entry=path.join(dir,"entry.mjs"),out=path.join(dir,"retired.cjs");
    await writeFile(entry,`import express from "express"; import {retiredClipUploadsRouter} from ${JSON.stringify(path.join(root,"src/routes/clip-upload-retired.ts"))};
      export const app=express();app.use(retiredClipUploadsRouter());`);
    await build({entryPoints:[entry],outfile:out,bundle:true,platform:"node",format:"cjs",logLevel:"silent",nodePaths:[path.join(root,"node_modules")]});
    server=require(out).app.listen(0,"127.0.0.1");
    await new Promise(resolve=>server.once("listening",resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    for(const [method,url] of [["POST","/clips"],["POST","/clip/upload"],["POST","/clip/upload-simple"],["POST","/clip/upload-final"],["POST","/clips/uploads"],["PATCH","/clips/uploads/session"]]){
      const response=await fetch(base+url,{method,body:"not-media",headers:{"content-type":"application/offset+octet-stream"}});
      assert.equal(response.status,410);
      assert.equal((await response.json()).presignEndpoint,"/api/upload/presign");
    }
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test("new clip contract uses safe 64-bit 10 GiB arithmetic without allocating media",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"media-cap-"));
  try {
    const out=path.join(dir,"protocol.cjs");
    await build({entryPoints:[path.join(root,"src/lib/clip-upload-protocol.ts")],outfile:out,bundle:true,platform:"node",format:"cjs",logLevel:"silent"});
    const {MAX_NEW_CLIP_BYTES}=require(out);
    assert.equal(MAX_NEW_CLIP_BYTES,10737418240);
    assert.equal(Math.ceil(MAX_NEW_CLIP_BYTES/(5*1024*1024)),2048);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("HTTP bundle has no probe or encoder and API startup has no media jobs",async()=>{
  const source=await readFile(path.join(root,"src/routes/r2.ts"),"utf8");
  assert.doesNotMatch(source,/import.*clip-publish|import.*clip-duration|import.*clip-server-compression/);
  const startup=await readFile(path.join(root,"src/index.ts"),"utf8");
  assert.doesNotMatch(startup,/startClip(?:Compression|Thumbnail|Storage|Temp)/);
  const legacy=await readFile(path.join(root,"src/routes/clips.ts"),"utf8");
  assert.match(legacy,/retiredClipUploadsRouter/);
  assert.doesNotMatch(legacy,/import.*clip-publish|createClipsUploadsRouter|createSimpleClipUploadRouter/);
});

for (const scenario of ["short","interrupted","ready","paused","stale","exhausted"]) test(`worker durable ${scenario} behavior`,async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"media-worker-test-"));
  const key=`worker_${scenario}`;
  const writes=[];
  let published=0;
  let attempts=scenario==="exhausted"?9:1;
  const controller=new AbortController();
  const client={
    on(){},off(){},release(){},
    async query(sql,params=[]){
      writes.push({sql,params});
      if(sql.includes("WITH next")) return {rows:scenario==="paused"?[]:[{session_id:"session",attempts,output_object:null}]};
      if(sql.includes("SELECT * FROM r2"))return {rows:[{object_name:"r2:original",size_bytes:"100",user_id:7,content_type:"video/mp4",original_name:"video.mp4"}]};
      if(sql.includes("RETURNING session_id"))return {rows:[{}],rowCount:scenario==="stale"?0:1};
      return {rows:[],rowCount:1};
    }
  };
  globalThis[key]={pool:{connect:async()=>client},probe:async()=>scenario==="short"?59:60,
    compress:async input=>{
      assert.match(input.outputFilename,/^r2:clip_[a-f0-9]{32}_720p\.mp4$/,"reserved output follows compressor's strict hexadecimal identity contract");
      if(scenario==="interrupted"){controller.abort();throw Error("worker terminated");}
      return {filename:input.outputFilename,contentType:"video/mp4",size:50};
    },
    publish:async(input,c,commit)=>{published++;await commit(c,{id:9});}
  };
  try {
    const boundary=path.join(dir,"boundary.mjs");
    await writeFile(boundary,`
      const h=globalThis[${JSON.stringify(key)}];
      export const pool=h.pool;
      export const verifiedDuration=h.probe;
      export const compressStoredClip=h.compress;
      export const publishClip=h.publish;
      export const clipFile=()=>({getMetadata:async()=>[{size:100}]});
      export const providerSibling=(_n,name)=>"r2:"+name;
      export const logger={warn(){}};
    `);
    const out=path.join(dir,"worker.cjs");
    await build({entryPoints:[path.join(root,"src/jobs/clip-media.ts")],outfile:out,bundle:true,platform:"node",format:"cjs",logLevel:"silent",
      plugins:[{name:"worker-boundaries",setup(p){
        p.onResolve({filter:/^@workspace\/db$|\/(?:clip-publish|clip-duration|clip-storage|clip-server-compression|logger)\.js$/},()=>({path:boundary}));
      }}]});
    await require(out).runClipMediaBatch(controller.signal);
    assert.match(writes[0].sql,/FOR UPDATE SKIP LOCKED/);
    if(scenario==="short" || scenario==="exhausted"){
      assert.equal(published,0);
      assert.ok(writes.some(w=>w.params[2]==="failed"));
    }else if(scenario==="stale"){
      assert.equal(published,0,"stale lease cannot publish");
    }else if(scenario==="interrupted"){
      assert.equal(published,0);
      assert.ok(writes.some(w=>w.params[2]==="queued"&&w.params[4]===0));
    }else if(scenario==="paused"){
      assert.equal(published,0);
      assert.equal(writes.length,1);
    }else{
      assert.equal(published,1);
      assert.ok(writes.some(w=>w.sql.includes("SET state='ready'")&&w.sql.includes("token=$2")));
      assert.ok(writes.some(w=>w.sql.includes("upload_object_name=$2")&&w.params[1]==="r2:original"));
    }
  }finally{delete globalThis[key];await rm(dir,{recursive:true,force:true});}
});