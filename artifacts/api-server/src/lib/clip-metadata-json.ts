import express, { type RequestHandler } from "express";

// 2048 ordered multipart ETags need ~135 KiB. Only these metadata endpoints
// receive the larger budget; every other JSON route keeps Express's 100 KiB.
export function clipAwareJsonBody(): RequestHandler {
  const ordinary = express.json();
  const multipartMetadata = express.json({ limit: "256kb" });
  const metadataPath = /^\/api\/(?:upload\/(?:complete|presign)|clips\/create|r2\/presign)\/?$/i;
  return (req,res,next) => (metadataPath.test(req.path) ? multipartMetadata : ordinary)(req,res,next);
}