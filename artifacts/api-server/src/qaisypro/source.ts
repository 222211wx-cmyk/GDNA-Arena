// Builds the connector input (ctx) for an object that already lives in R2. R2 stays the source of truth.
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import path from "node:path";
import { r2Client, r2Config } from "../lib/r2-storage.js";

export async function r2Source(key: string, fileName?: string) {
  const Bucket = r2Config()!.bucket;
  const head = await r2Client().send(new HeadObjectCommand({ Bucket, Key: key }));
  const get = async (range?: string) => (await r2Client().send(new GetObjectCommand({ Bucket, Key: key, Range: range }))).Body as Readable;
  return {
    key, size: head.ContentLength ?? 0, fileName: fileName || path.posix.basename(key), contentType: head.ContentType,
    stream: () => get(),
    read: async (start?: number, end?: number) => {
      const chunks: Buffer[] = []; for await (const c of await get(start === undefined ? undefined : `bytes=${start}-${end}`)) chunks.push(c as Buffer);
      return Buffer.concat(chunks);
    },
  };
}
