import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";
const require=createRequire(import.meta.url);
const root=new URL("../",import.meta.url).pathname;

test("only direct-upload metadata routes parse 2048 ETags within bounded 256 KiB budget",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"clip-json-"));
  let server;
  try{
    const entry=path.join(directory,"entry.mjs"),output=path.join(directory,"entry.cjs");
    await writeFile(entry,`
      import express from "express";
      import {clipAwareJsonBody} from ${JSON.stringify(path.join(root,"src/lib/clip-metadata-json.ts"))};
      export const app=express();
      app.use(clipAwareJsonBody());
      app.use((req,res)=>res.json({parts:req.body?.parts?.length ?? 0}));
      app.use((err,req,res,next)=>res.status(err.status || 500).json({error:err.type}));
    `);
    await build({entryPoints:[entry],outfile:output,bundle:true,platform:"node",format:"cjs",logLevel:"silent",
      nodePaths:[path.join(root,"node_modules")]});
    server=require(output).app.listen(0,"127.0.0.1");
    await new Promise(resolve=>server.once("listening",resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const manifest=JSON.stringify({sessionId:"00000000-0000-4000-8000-000000000001",expectedOwnerId:7,
      parts:Array.from({length:2048},(_,i)=>({partNumber:i+1,etag:`"${"a".repeat(32)}"`}))});
    assert.ok(Buffer.byteLength(manifest)>100*1024);
    assert.ok(Buffer.byteLength(manifest)<256*1024);
    const post=(url,body)=>fetch(base+url,{method:"POST",headers:{"content-type":"application/json"},body});
    for(const endpoint of ["/api/upload/complete","/api/upload/presign","/api/clips/create","/api/r2/presign"]){
      for(const suffix of ["","/"]){
        const response=await post(endpoint+suffix,manifest);
        assert.equal(response.status,200,endpoint+suffix);
        assert.equal((await response.json()).parts,2048);
        const oversized=await post(endpoint+suffix,JSON.stringify({padding:"x".repeat(256*1024)}));
        assert.equal(oversized.status,413,endpoint+suffix+" preserves upper bound");
      }
    }
    for(const endpoint of ["/api/messages","/api/upload/complete/extra","/api/r2/presign-other"]){
      assert.equal((await post(endpoint,manifest)).status,413,endpoint+" retains default 100KiB");
      assert.equal((await post(endpoint,JSON.stringify({padding:"x".repeat(99*1024)}))).status,200);
    }
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
});