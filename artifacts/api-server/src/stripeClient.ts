import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

async function getStripeCredentials(): Promise<{ secretKey: string; webhookSecret?: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const token = process.env.REPL_IDENTITY ? `repl ${process.env.REPL_IDENTITY}` : process.env.WEB_REPL_RENEWAL ? `depl ${process.env.WEB_REPL_RENEWAL}` : null;
  if (!hostname || !token) throw new Error("Stripe integration is not available in this runtime");
  const response = await fetch(`https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`, { headers: { Accept: "application/json", X_REPLIT_TOKEN: token }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Stripe credential request failed: ${response.status}`);
  const settings = ((await response.json()) as { items?: Array<{ settings?: { secret_key?: string; webhook_secret?: string } }> }).items?.[0]?.settings;
  if (!settings?.secret_key) throw new Error("Stripe integration has no secret key");
  return { secretKey: settings.secret_key, webhookSecret: settings.webhook_secret };
}
export async function getUncachableStripeClient(): Promise<Stripe> { return new Stripe((await getStripeCredentials()).secretKey); }
export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const credentials = await getStripeCredentials();
  return new StripeSync({ poolConfig: { connectionString: databaseUrl }, stripeSecretKey: credentials.secretKey, stripeWebhookSecret: credentials.webhookSecret ?? "" });
}