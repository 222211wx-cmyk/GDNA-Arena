// Connector: Railway. Redeploys one service after an upload. Runs ONLY when "railway" is listed explicitly as a target.
const URL_ = () => process.env.RAILWAY_API_URL || "https://backboard.railway.com/graphql/v2";
export default {
  name: "railway",
  envVars: ["RAILWAY_API_TOKEN", "RAILWAY_SERVICE_ID", "RAILWAY_ENVIRONMENT_ID"],
  configured: () => Boolean(process.env.RAILWAY_API_TOKEN && process.env.RAILWAY_SERVICE_ID && process.env.RAILWAY_ENVIRONMENT_ID),
  async send() {
    const r = await fetch(URL_(), { method: "POST", headers: { Authorization: `Bearer ${process.env.RAILWAY_API_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({
      query: "mutation($s:String!,$e:String!){serviceInstanceRedeploy(serviceId:$s,environmentId:$e)}", variables: { s: process.env.RAILWAY_SERVICE_ID, e: process.env.RAILWAY_ENVIRONMENT_ID } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.errors) throw new Error(`Railway ${r.status}: ${j.errors?.[0]?.message ?? "redeploy failed"}`);
    return { ok: true, redeployed: true };
  },
};
