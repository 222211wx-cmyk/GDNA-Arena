import {
  DeleteObjectCommand,
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  UploadPartCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PassThrough, Readable, Writable } from "node:stream";

export const R2_PREFIX = "r2:";

export interface ClipStorageFile {
  getMetadata(): Promise<[{ size: number; contentType?: string }]>;
  createReadStream(range?: { start?: number; end?: number }): Readable;
  createWriteStream(options?: {
    metadata?: { contentType?: string; cacheControl?: string };
    preconditionOpts?: { ifGenerationMatch?: number };
  }): Writable;
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>;
}

type R2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

// All environment reads and bucket precedence are defined here.
function r2Settings() {
  const endpoint = process.env.R2_ENDPOINT?.trim() || "";
  const primaryBucket = process.env.R2_BUCKET_NAME?.trim() || "";
  const fallbackBucket = process.env.R2_BUCKET?.trim() || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() || "";
  const bucket = primaryBucket || fallbackBucket;
  const bucketSource = primaryBucket
    ? "R2_BUCKET_NAME"
    : fallbackBucket
      ? "R2_BUCKET"
      : null;
  const missing: string[] = [];
  if (!endpoint) missing.push("R2_ENDPOINT");
  // Neither alias is individually mandatory; at least one must be non-blank.
  if (!bucket)
    missing.push("R2_BUCKET_NAME or R2_BUCKET (at least one required)");
  if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  return {
    endpoint,
    bucket,
    bucketSource,
    accessKeyId,
    secretAccessKey,
    missing,
  };
}

export function r2Config(): R2Config | null {
  const { endpoint, bucket, accessKeyId, secretAccessKey, missing } =
    r2Settings();
  if (missing.length) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

function r2ConfigurationError(): Error {
  const { missing } = r2Settings();
  return new Error(
    `R2 storage is not configured; missing: ${missing.join(", ")}`,
  );
}

// Call once from the API startup entry point, before accepting requests.
// Never log the configuration object, endpoint, access key, or secret key.
export function logR2Startup(): void {
  const cfg = r2Config();
  const { endpoint, bucketSource, missing } = r2Settings();
  console.log(`[R2] R2 configured: ${cfg ? "YES" : "NO"}`);
  console.log(`[R2] Bucket resolved from: ${bucketSource ?? "NONE"}`);
  console.log(`[R2] Endpoint present: ${endpoint ? "YES" : "NO"}`);
  // The bucket name is not needed in the logs; only its source is reported.
  if (missing.length) console.error(`[R2] Missing: ${missing.join(", ")}`);
}

let cachedClient: { signature: string; client: S3Client } | undefined;
export function r2Client(): S3Client {
  const config = r2Config();
  if (!config) throw r2ConfigurationError();
  const signature = `${config.endpoint}\n${config.bucket}\n${config.accessKeyId}`;
  if (cachedClient?.signature !== signature) {
    cachedClient?.client.destroy();
    cachedClient = {
      signature,
      client: new S3Client({
        region: "auto",
        endpoint: config.endpoint,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      }),
    };
  }
  return cachedClient.client;
}

export function r2Reference(key: string): string {
  if (
    !/^clips\/(?:original|derived)\/[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(key) ||
    key.includes("..") ||
    key.includes("\\")
  ) {
    throw new Error("Invalid R2 object key");
  }
  return `${R2_PREFIX}${key}`;
}
export function isR2Reference(reference: string): boolean {
  return reference.startsWith(R2_PREFIX);
}
export function providerSibling(reference: string, filename: string): string {
  return isR2Reference(reference)
    ? r2Reference(`clips/derived/${filename}`)
    : filename;
}
export function r2Key(reference: string): string {
  if (!isR2Reference(reference)) throw new Error("Not an R2 object reference");
  const key = reference.slice(R2_PREFIX.length);
  r2Reference(key);
  return key;
}
function nodeBody(body: unknown): Readable {
  if (body instanceof Readable) return body;
  throw new Error("R2 returned an unsupported response stream");
}
class R2Writable extends Writable {
  private pending = Buffer.alloc(0);
  private uploadId?: string;
  private partNumber = 1;
  private readonly parts: { PartNumber: number; ETag: string }[] = [];
  private readonly partBytes = 5 * 1024 * 1024;
  constructor(
    private readonly key: string,
    private readonly contentType?: string,
    private readonly cacheControl?: string,
    private readonly createOnly = false,
  ) {
    super();
  }
  override _construct(callback: (error?: Error | null) => void) {
    const config = r2Config();
    if (!config) {
      callback(r2ConfigurationError());
      return;
    }
    const prepare = async () => {
      if (this.createOnly) {
        try {
          await r2Client().send(
            new HeadObjectCommand({ Bucket: config.bucket, Key: this.key }),
          );
          throw Object.assign(new Error("R2 object already exists"), {
            code: 412,
          });
        } catch (error) {
          if (
            Number(
              (error as { $metadata?: { httpStatusCode?: number } }).$metadata
                ?.httpStatusCode,
            ) !== 404
          )
            throw error;
        }
      }
      const result = await r2Client().send(
        new CreateMultipartUploadCommand({
          Bucket: config.bucket,
          Key: this.key,
          ContentType: this.contentType,
          CacheControl: this.cacheControl,
        }),
      );
      if (!result.UploadId)
        throw new Error("R2 did not create multipart upload");
      this.uploadId = result.UploadId;
    };
    prepare().then(
      () => callback(),
      (error) => callback(error as Error),
    );
  }
  private async uploadPart(bytes: Buffer) {
    const config = r2Config();
    if (!config || !this.uploadId)
      throw new Error("R2 multipart upload is not initialized");
    const number = this.partNumber++;
    const result = await r2Client().send(
      new UploadPartCommand({
        Bucket: config.bucket,
        Key: this.key,
        UploadId: this.uploadId,
        PartNumber: number,
        Body: bytes,
      }),
    );
    if (!result.ETag) throw new Error("R2 did not return multipart ETag");
    this.parts.push({ PartNumber: number, ETag: result.ETag });
  }
  override _write(
    chunk: Buffer | Uint8Array,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.pending = Buffer.concat([this.pending, Buffer.from(chunk)]);
    const flush = async () => {
      while (this.pending.length >= this.partBytes) {
        const part = this.pending.subarray(0, this.partBytes);
        this.pending = this.pending.subarray(this.partBytes);
        await this.uploadPart(part);
      }
    };
    flush().then(
      () => callback(),
      (error) => callback(error as Error),
    );
  }
  override _final(callback: (error?: Error | null) => void) {
    const config = r2Config();
    const finish = async () => {
      if (!config || !this.uploadId)
        throw new Error("R2 multipart upload is not initialized");
      if (this.pending.length || !this.parts.length)
        await this.uploadPart(this.pending);
      this.pending = Buffer.alloc(0);
      await r2Client().send(
        new CompleteMultipartUploadCommand({
          Bucket: config.bucket,
          Key: this.key,
          UploadId: this.uploadId,
          MultipartUpload: { Parts: this.parts },
        }),
      );
    };
    finish().then(
      () => callback(),
      async (error) => {
        if (config && this.uploadId) {
          await r2Client()
            .send(
              new AbortMultipartUploadCommand({
                Bucket: config.bucket,
                Key: this.key,
                UploadId: this.uploadId,
              }),
            )
            .catch(() => {});
        }
        callback(error as Error);
      },
    );
  }
  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ) {
    const config = r2Config();
    if (!config || !this.uploadId || this.writableFinished) {
      callback(error);
      return;
    }
    r2Client()
      .send(
        new AbortMultipartUploadCommand({
          Bucket: config.bucket,
          Key: this.key,
          UploadId: this.uploadId,
        }),
      )
      .catch(() => {})
      .finally(() => callback(error));
  }
}
export function r2File(reference: string): ClipStorageFile {
  const key = r2Key(reference);
  return {
    async getMetadata() {
      const config = r2Config();
      if (!config) throw r2ConfigurationError();
      const result = await r2Client().send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      return [
        { size: Number(result.ContentLength), contentType: result.ContentType },
      ];
    },
    createReadStream(range = {}) {
      const stream = new PassThrough();
      const controller = new AbortController();
      let source: Readable | undefined;
      stream.once("close", () => {
        controller.abort();
        if (source && !source.destroyed) source.destroy();
      });
      const config = r2Config();
      if (!config) {
        queueMicrotask(() => stream.destroy(r2ConfigurationError()));
        return stream;
      }
      const Range =
        range.start !== undefined
          ? `bytes=${range.start}-${range.end ?? ""}`
          : undefined;
      void r2Client()
        .send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key, Range }),
          { abortSignal: controller.signal },
        )
        .then((result) => {
          source = nodeBody(result.Body);
          if (stream.destroyed) {
            source.destroy();
            return;
          }
          source.on("error", (error) => stream.destroy(error));
          source.pipe(stream);
        })
        .catch((error) => stream.destroy(error as Error));
      return stream;
    },
    createWriteStream(options = {}) {
      return new R2Writable(
        key,
        options.metadata?.contentType,
        options.metadata?.cacheControl,
        options.preconditionOpts?.ifGenerationMatch === 0,
      );
    },
    async delete(options = {}) {
      const config = r2Config();
      if (!config) throw r2ConfigurationError();
      try {
        return await r2Client().send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
        );
      } catch (error) {
        if (
          options.ignoreNotFound &&
          Number(
            (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode,
          ) === 404
        ) {
          return undefined;
        }
        throw error;
      }
    },
  };
}
export async function signR2Get(
  reference: string,
  expiresInSeconds: number,
  options: { contentDisposition?: string; contentType?: string } = {},
): Promise<string> {
  const config = r2Config();
  if (!config) throw r2ConfigurationError();
  return getSignedUrl(
    r2Client(),
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: r2Key(reference),
      ResponseContentDisposition: options.contentDisposition,
      ResponseContentType: options.contentType,
    }),
    { expiresIn: expiresInSeconds },
  );
}
let statusCache:
  | { expires: number; connected: boolean; error?: string }
  | undefined;
export async function r2ConnectionStatus(): Promise<{
  provider: "r2";
  configured: boolean;
  connected: boolean;
  bucket: string | null;
  error?: string;
}> {
  const config = r2Config();
  if (!config)
    return {
      provider: "r2",
      configured: false,
      connected: false,
      bucket: null,
      error: r2ConfigurationError().message,
    };
  if (!statusCache || statusCache.expires <= Date.now()) {
    try {
      await r2Client().send(new HeadBucketCommand({ Bucket: config.bucket }), {
        abortSignal: AbortSignal.timeout(5_000),
      });
      statusCache = { expires: Date.now() + 60_000, connected: true };
    } catch (error) {
      const status =
        Number(
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode,
        ) || 0;
      statusCache = {
        expires: Date.now() + 15_000,
        connected: false,
        error: status
          ? `R2 bucket check failed (${status})`
          : "R2 bucket check failed",
      };
    }
  }
  return {
    provider: "r2",
    configured: true,
    connected: statusCache.connected,
    bucket: config.bucket,
    ...(statusCache.error ? { error: statusCache.error } : {}),
  };
}
