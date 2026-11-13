import { Router, type IRouter } from "express";
export function retiredClipUploadsRouter(): IRouter {
  const router = Router();
  const gone = (_req: unknown,res: import("express").Response) => {
    res.status(410).json({error:"Legacy upload endpoint; use the server-managed resumable upload",
      presignEndpoint:"/api/upload/presign",completeEndpoint:"/api/upload/complete"});
  };
  router.use(["/clips/uploads","/clip/upload","/clip/upload-simple","/clip/upload-final"],gone);
  router.post("/clips",gone);
  return router;
}
