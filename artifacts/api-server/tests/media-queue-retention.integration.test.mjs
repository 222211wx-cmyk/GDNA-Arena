import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import pg from "pg";

test("expired accepted sessions and their original outbox objects survive beyond 48 hours",
  {skip:!process.env.DATABASE_URL || process.env.NODE_ENV==="production"},async()=>{
    const client=new pg.Client({connectionString:process.env.DATABASE_URL});
    await client.connect();
    try{
      await client.query("BEGIN");
      // Temporary shadow tables only: production/application rows are untouched.
      await client.query(`
        CREATE TEMP TABLE r2_clip_uploads(id uuid,object_name text,multipart_upload_id text,state text,expires_at timestamptz) ON COMMIT DROP;
        CREATE TEMP TABLE clip_media_jobs(session_id uuid,state text) ON COMMIT DROP;
        CREATE TEMP TABLE clips(object_name text,upload_object_name text,thumbnail_object_name text,processing_output_object text) ON COMMIT DROP;
        CREATE TEMP TABLE citizen_profiles(avatar_url text,cover_url text) ON COMMIT DROP;
        CREATE TEMP TABLE clip_storage_cleanup(object_name text,clip_id integer,retry_at timestamptz,attempts integer) ON COMMIT DROP;
      `);
      for(const [i,state] of ["queued","processing","failed"].entries()){
        const id=`00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`;
        await client.query("INSERT INTO r2_clip_uploads VALUES($1,$2,'multipart','completing',NOW()-INTERVAL '3 days')",[id,`r2:original-${i}`]);
        await client.query("INSERT INTO clip_media_jobs VALUES($1,$2)",[id,state]);
        await client.query("INSERT INTO clip_storage_cleanup VALUES($1,0,NOW()-INTERVAL '1 day',0)",[`r2:original-${i}`]);
      }
      const source=await readFile(new URL("../src/jobs/clip-storage-cleanup.ts",import.meta.url),"utf8");
      const expiry=source.match(/`(SELECT id,object_name,multipart_upload_id FROM r2_clip_uploads[\s\S]*?ORDER BY expires_at LIMIT 1)`/)[1];
      assert.equal((await client.query(expiry)).rowCount,0);
      // Explicit job fence also protects against an accidentally regressed session state.
      await client.query("UPDATE r2_clip_uploads SET state='active'");
      assert.equal((await client.query(expiry)).rowCount,0);
      const claim=source.match(/`(\s*WITH candidate AS \([\s\S]*?RETURNING q.object_name, q.clip_id, q.attempts)`/)[1];
      assert.equal((await client.query(claim,[null])).rowCount,0,"durable cleanup cannot claim any retained job original");
      assert.equal((await client.query("SELECT * FROM clip_storage_cleanup")).rowCount,3);
    }finally{await client.query("ROLLBACK");await client.end();}
  });