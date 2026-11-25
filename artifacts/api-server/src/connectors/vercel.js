// Connector: Vercel. Triggers a Deploy Hook (create one in Vercel project settings). Runs only when listed as a target.
export default {
  name: "vercel",
  envVars: ["VERCEL_DEPLOY_HOOK_URL"],
  configured: () => Boolean(process.env.VERCEL_DEPLOY_HOOK_URL),
  async send() {
    const u = new URL(process.env.VERCEL_DEPLOY_HOOK_URL);
    if (u.protocol !== "https:" || !(u.hostname === "api.vercel.com" || process.env.VERCEL_HOOK_ALLOW_ANY === "1")) throw new Error("VERCEL_DEPLOY_HOOK_URL must be https://api.vercel.com/...");
    const r = await fetch(u, { method: "POST" });
    if (!r.ok) throw new Error(`Vercel ${r.status}`);
    return { ok: true, triggered: true };
  },
};
