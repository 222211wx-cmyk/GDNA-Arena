import express, { type RequestHandler } from "express";

// 2048 ordered multipart ETags need ~135 KiB. Encrypted messages add one
// wrapped key per active device; their 512 KiB envelope needs JSON overhead.
// Other routes retain Express's 100 KiB limit.
export function clipAwareJsonBody(): RequestHandler {
  const ordinary = express.json();
  const multipartMetadata = express.json({ limit: "256kb" });
  const encryptedDelivery = express.json({ limit: "768kb" });
  const metadataPath = /^\/api\/(?:upload\/(?:complete|presign)|clips\/create|r2\/presign)\/?$/i;
  const encryptedPath = /^\/api\/(?:messages\/rooms\/\d+\/send|communication\/groups)\/?$/i;
  return (req,res,next) => (encryptedPath.test(req.path) ? encryptedDelivery : metadataPath.test(req.path) ? multipartMetadata : ordinary)(req,res,next);
}
