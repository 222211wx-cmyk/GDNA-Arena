import { spawn } from "node:child_process";

/** Decode one still-image frame before persistence; bounded pixels, runtime and input bytes.
 * Uses the same ffmpeg runtime already required by Clips, without changing Clips storage.
 */
export async function validateCitizenImage(bytes: Buffer): Promise<boolean> {
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) return false;
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-v", "error", "-threads", "1", "-max_pixels", "25000000",
      "-protocol_whitelist", "pipe", "-i", "pipe:0", "-frames:v", "1", "-f", "null", "-",
    ], { stdio: ["pipe", "ignore", "pipe"] });
    let failed = false;
    const timer = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, 5000);
    child.stderr.on("data", () => { failed = true; });
    child.stdin.on("error", () => { failed = true; });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve(code === 0 && !failed); });
    child.stdin.end(bytes);
  });
}