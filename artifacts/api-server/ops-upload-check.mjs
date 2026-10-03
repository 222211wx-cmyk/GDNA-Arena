import { r2Client,r2Config } from "./src/lib/r2-storage.ts";
import { ListObjectsV2Command,ListMultipartUploadsCommand,HeadObjectCommand,DeleteObjectCommand,AbortMultipartUploadCommand,ListPartsCommand } from "@aws-sdk/client-s3";
import { readFile,writeFile,open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
const client=r2Client(), Bucket=r2Config().bucket;
const root="../../reports/";
async function inventory(){
  let token; const objects=[];
  do { const page=await client.send(new ListObjectsV2Command({Bucket,Prefix:"clips/",ContinuationToken:token}));objects.push(...page.Contents??[]);token=page.NextContinuationToken; }while(token);
  const multipart=await client.send(new ListMultipartUploadsCommand({Bucket,Prefix:"clips/"}));
  return {count:objects.length,bytes:objects.reduce((n,o)=>n+o.Size,0),objects:objects.map(o=>({key:o.Key,size:o.Size,etag:o.ETag})),multipart:multipart.Uploads??[],truncated:multipart.IsTruncated??false};
}
if(process.argv[2]==="inspect"){
 const data=await inventory();await writeFile(root+"storage-before-safe-cleanup.json",JSON.stringify(data,null,2));
 console.log(JSON.stringify(data,null,2));
} else if(process.argv[2]==="test"){
 const result={size:150_000_000,parts:0};let cookie="",session;
 const api=async(path,body,method="POST")=>{
  const res=await fetch("http://localhost:8080/api"+path,{method,headers:{"Content-Type":"application/json",Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
  if(res.headers.getSetCookie().length)cookie=res.headers.getSetCookie().map(s=>s.split(";")[0]).join("; ");
  const data=await res.json().catch(()=>null);if(!res.ok)throw new Error(`${path}: ${res.status} ${JSON.stringify(data)}`);return data;
 };
 try{
  const user=await api("/auth/register",{username:"qa"+randomUUID().replaceAll("-","").slice(0,12),password:randomUUID(),birthDate:"2000-01-01"});
  result.userId=user.id??user.user?.id;
  const path="/tmp/server-upload-150mb.wav",file=await open(path,"w");
  const header=Buffer.alloc(44);header.write("RIFF");header.writeUInt32LE(result.size-8,4);header.write("WAVEfmt ",8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(48000,24);header.writeUInt32LE(96000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write("data",36);header.writeUInt32LE(result.size-44,40);
  await file.write(header);await file.truncate(result.size);await file.close();
  session=await api("/upload/presign",{action:"initiate",requestId:randomUUID(),filename:"server-upload-150mb.wav",title:"Authorized upload diagnostic",size:result.size,contentType:"audio/wav",durationSec:null});
  result.sessionId=session.sessionId;
  for(let n=1;n<=session.partCount;n++){
   const start=(n-1)*session.partSize,end=Math.min(result.size,start+session.partSize)-1;
   const res=await fetch(`http://localhost:8080/api/upload/chunk/${session.sessionId}/${n}`,{method:"PUT",duplex:"half",headers:{Cookie:cookie,"Content-Type":"application/octet-stream","Content-Length":String(end-start+1)},body:createReadStream(path,{start,end})});
   if(!res.ok)throw new Error(`chunk ${n}: ${res.status} ${await res.text()}`);
   await res.json();result.parts++;
   if(n===2){const inspected=await api("/upload/presign",{action:"inspect",sessionId:session.sessionId});result.resumeConfirmed=inspected.parts.length===2;}
  }
  result.receipt=await api("/upload/presign",{action:"complete",sessionId:session.sessionId});
  result.success=true;
 }catch(e){result.error=e.message;}
 await writeFile(root+"server-chunk-150mb-result.json",JSON.stringify(result,null,2));console.log(result);
} else if(process.argv[2]==="cleanup"){
 const before=JSON.parse(await readFile(root+"storage-before-safe-cleanup.json","utf8"));
 const refs=await readFile(root+"production-clips-before-cleanup.csv","utf8");
 const candidates=(await readFile(root+"clips-unreferenced-over-24h.csv","utf8")).trim().split("\n").slice(1).map(line=>{const [key,size,date]=line.trim().split(",");return{key,size:Number(size),date};});
 if(candidates.length!==6||candidates.reduce((n,o)=>n+o.size,0)!==224546721)throw new Error("Candidate manifest changed");
 const deleted=[];
 for(const o of candidates){
  if(refs.includes(o.key))throw new Error("Published reference found");
  const head=await client.send(new HeadObjectCommand({Bucket,Key:o.key}));
  const pinned=before.objects.find(x=>x.key===o.key);
  if(head.ContentLength!==o.size||head.ETag!==pinned?.etag||Math.floor(head.LastModified.getTime()/1000)!==Math.floor(Date.parse(o.date)/1000)||Date.now()-head.LastModified.getTime()<86400000)throw new Error("Object identity/age changed");
  await client.send(new DeleteObjectCommand({Bucket,Key:o.key,IfMatch:head.ETag}));
  deleted.push(o);
 }
 const after=await inventory();
 const report={deleted,freedBytes:before.bytes-after.bytes,beforeBytes:before.bytes,afterBytes:after.bytes,beforeCount:before.count,afterCount:after.count};
 await writeFile(root+"safe-cleanup-result.json",JSON.stringify(report,null,2));console.log(report);
} else if(process.argv[2]==="abort"){
 const state=await inventory();
 const target=state.multipart.find(x=>x.Key==="clips/original/1/8035e00d-7b46-4a17-902f-c8d66bbfd214.mp4"&&new Date(x.Initiated).toISOString()==="2026-10-03T00:19:42.584Z");
 if(target){
  await client.send(new AbortMultipartUploadCommand({Bucket,Key:target.Key,UploadId:target.UploadId}));
 }
 const after=await inventory();
 const report={aborted:!!target,remainingMultipart:after.multipart.length,bytes:after.bytes,count:after.count};
 await writeFile(root+"multipart-abort-result.json",JSON.stringify(report,null,2));console.log(report);
} else if(process.argv[2]==="finish-test"){
 const test=JSON.parse(await readFile(root+"server-chunk-150mb-result.json","utf8"));
 if(!test.success||test.userId!==7189||test.sessionId!=="f4e5e2ee-a5a8-4a19-95d6-28eb73042d67")throw new Error("Diagnostic identity differs");
 const Key=`clips/original/${test.userId}/${test.sessionId}.wav`;
 const head=await client.send(new HeadObjectCommand({Bucket,Key}));
 if(head.ContentLength!==150_000_000||head.Metadata?.session!==test.sessionId||head.Metadata?.owner!==String(test.userId))throw new Error("Diagnostic object differs");
 await client.send(new DeleteObjectCommand({Bucket,Key,IfMatch:head.ETag}));
 const before=JSON.parse(await readFile(root+"storage-before-safe-cleanup.json","utf8"));
 const cleanup=JSON.parse(await readFile(root+"safe-cleanup-result.json","utf8"));
 const after=await inventory();
 const kept=before.objects.filter(o=>!cleanup.deleted.some(d=>d.key===o.key));
 const unchanged=kept.every(o=>after.objects.some(a=>a.key===o.key&&a.size===o.size&&a.etag===o.etag));
 const result={testObjectVerifiedBytes:head.ContentLength,testObjectRemoved:true,nonTargetObjectsUnchanged:unchanged,count:after.count,bytes:after.bytes,freedBytes:before.bytes-after.bytes,pendingMultipart:after.multipart.length};
 await writeFile(root+"storage-after-safe-cleanup.json",JSON.stringify(result,null,2));console.log(result);
}