// Connector: GitHub. <=25 MB -> repo file (Contents API). Larger -> Release asset (streamed from R2, GitHub caps assets at 2 GiB).
import { Readable } from "node:stream";
const API = () => process.env.GITHUB_API_URL || "https://api.github.com";
const UPLOADS = () => process.env.GITHUB_UPLOADS_URL || "https://uploads.github.com";
const hdr = () => ({ Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "qaisypro" });
const FILE_LIMIT = 25 * 1024 * 1024;

async function gh(method, url, body) {
  const r = await fetch(url, { method, headers: { ...hdr(), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

export default {
  name: "github",
  envVars: ["GITHUB_TOKEN", "GITHUB_REPO"],
  configured: () => Boolean(process.env.GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPO || "")),
  async send(ctx, opts = {}) {
    const repo = process.env.GITHUB_REPO;
    const name = ctx.fileName.replace(/[^\w.\-]+/g, "_");
    if (ctx.size <= FILE_LIMIT) {
      const dir = (process.env.GITHUB_PATH_PREFIX ?? "qaisypro").replace(/^\/+|\/+$/g, "");
      const filePath = [dir, opts.path ?? name].filter(Boolean).join("/");
      const branch = process.env.GITHUB_BRANCH;
      const q = branch ? `?ref=${encodeURIComponent(branch)}` : "";
      const existing = await gh("GET", `${API()}/repos/${repo}/contents/${filePath}${q}`);
      const content = (await ctx.read()).toString("base64");
      const put = await gh("PUT", `${API()}/repos/${repo}/contents/${filePath}`, {
        message: `QAISYPRO: add ${name}`, content, ...(branch ? { branch } : {}), ...(existing.status === 200 ? { sha: existing.json.sha } : {}),
      });
      if (put.status !== 200 && put.status !== 201) throw new Error(`GitHub ${put.status}: ${put.json?.message ?? put.text.slice(0, 120)}`);
      return { ok: true, mode: "file", path: filePath, url: put.json?.content?.html_url };
    }
    if (ctx.size > 2 * 1024 ** 3) throw new Error("GitHub release assets are limited to 2 GiB (GitHub limit)");
    const tag = opts.tag ?? `qaisypro-${new Date().toISOString().slice(0, 10)}`;
    let rel = await gh("GET", `${API()}/repos/${repo}/releases/tags/${tag}`);
    if (rel.status === 404) rel = await gh("POST", `${API()}/repos/${repo}/releases`, { tag_name: tag, name: tag, body: "Uploaded by QAISYPRO", draft: false });
    if (!rel.json?.id) throw new Error(`GitHub release failed (${rel.status}): ${rel.json?.message ?? ""}`);
    const up = await fetch(`${UPLOADS()}/repos/${repo}/releases/${rel.json.id}/assets?name=${encodeURIComponent(name)}`, {
      method: "POST", headers: { ...hdr(), "content-type": ctx.contentType || "application/octet-stream", "content-length": String(ctx.size) },
      body: Readable.toWeb(await ctx.stream()), duplex: "half",
    });
    const j = await up.json().catch(() => ({}));
    if (up.status !== 201) throw new Error(`GitHub asset upload ${up.status}: ${j.message ?? ""}`);
    return { ok: true, mode: "release-asset", tag, url: j.browser_download_url };
  },
};
