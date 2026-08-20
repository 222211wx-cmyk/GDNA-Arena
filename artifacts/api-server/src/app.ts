import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Behind the Replit router/proxy — needed for correct client IPs (rate
// limiting) and secure cookies in production.
app.set("trust proxy", 1);

// ── Security headers ─────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // API only — the frontend is served separately
    crossOriginResourcePolicy: { policy: "cross-origin" }, // allow media/images to the app
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── CORS ─────────────────────────────────────────────────────────────────────
// Only the app's own origins may make credentialed cross-origin requests.
// Reflecting arbitrary origins with credentials would let any website drive a
// logged-in citizen's browser against these APIs (CSRF-style abuse, OpenAI
// cost drain on public AI endpoints).
const allowedOrigins = new Set<string>();
if (process.env.REPLIT_DEV_DOMAIN) {
  allowedOrigins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
}
for (const domain of (process.env.REPLIT_DOMAINS ?? "").split(",")) {
  const d = domain.trim();
  if (d) allowedOrigins.add(`https://${d}`);
}
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.add("http://localhost:80");
  allowedOrigins.add("http://localhost");
}

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin and non-browser requests carry no Origin header — allow
      // them (they are not subject to CORS anyway).
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(null, false); // no CORS headers → browser blocks the response
      }
    },
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Exported so the WebSocket signaling server can authenticate upgrades
// against the same session store.
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  logger.error("SESSION_SECRET is not set in production — sessions are using an insecure fallback secret!");
}
// Persistent session store (PostgreSQL) — sessions survive server restarts
// and republishes, so citizens stay logged in instead of being kicked out.
const PgStore = connectPgSimple(session);
// Create the table ourselves — the store's createTableIfMissing reads a .sql
// file from disk, which breaks in the bundled production build.
if (pool) {
  pool.query(`
    CREATE TABLE IF NOT EXISTS "user_sessions" (
      "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire" ON "user_sessions" ("expire");
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uniq ON users (LOWER(email));
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uniq ON users (LOWER(username));
    -- Citizen accounts use username + password only. Remove obsolete mail
    -- verification state and code tables permanently.
    ALTER TABLE users DROP COLUMN IF EXISTS email_verified;
    DROP TABLE IF EXISTS email_verification_codes;
    DROP TABLE IF EXISTS password_reset_codes;
    -- AMIS unified messenger: per-conversation mute + per-user messenger settings
    ALTER TABLE dm_room_members ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS dm_user_settings (
      user_id integer PRIMARY KEY,
      notifications boolean NOT NULL DEFAULT true,
      read_receipts boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `).then(() => {
    // Legacy admin bootstrap remains independent from citizen authentication.
    // It sends no mail and does not make email part of register/login.
    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    if (adminEmails.length && pool) {
      return pool.query(
        `UPDATE users SET is_admin = true WHERE LOWER(email) = ANY($1) AND is_admin = false`,
        [adminEmails]
      ).then(r => { if (r.rowCount) logger.info(`Granted admin to ${r.rowCount} account(s)`); });
    }
    return undefined;
  }).catch((err) => logger.error(err, "Failed to create session table / auth indexes"));
}
// Never run production with a forgeable fallback secret — refuse to start.
const sessionSecret = process.env.SESSION_SECRET
  ?? (process.env.NODE_ENV === "production"
    ? (() => { logger.error("SESSION_SECRET is required in production"); process.exit(1); })()
    : "gdna-arena-dev-secret");
export const sessionMiddleware = session({
  store: pool
    ? new PgStore({ pool, tableName: "user_sessions", createTableIfMissing: false })
    : undefined,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  // Netflix-style: every visit slides the expiry window forward, so active
  // citizens are never asked to log in again.
  rolling: true,
  cookie: {
    // "auto" + trust proxy: secure cookies on HTTPS (production), plain in dev
    secure: process.env.NODE_ENV === "production" ? "auto" : false,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
  },
});

app.use(sessionMiddleware);

// ── Rate limiting (brute-force & abuse shields) ──────────────────────────────
// Strict shield on credential endpoints: 10 attempts / 15 min per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true, // only FAILED attempts count — legit citizens never locked
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "محاولات كثيرة — انتظر 15 دقيقة ثم أعد المحاولة" },
});
app.use(["/api/auth/login", "/api/auth/register", "/api/auth/change-password"], authLimiter);

// AI-powered endpoints are expensive — 30 requests / 5 min per IP.
const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "طلبات كثيرة على النظام الذكي — انتظر قليلاً" },
});
app.use(["/api/smart", "/api/archon", "/api/chat", "/api/neural", "/api/ameeq", "/api/stars"], aiLimiter);

// General safety net for the whole API: 600 requests / 5 min per IP.
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "الكثير من الطلبات — تمهّل قليلاً" },
});
app.use("/api", globalLimiter);

// Update last_seen_at for authenticated users on every request
app.use("/api", (req, _res, next) => {
  const userId = (req.session as any)?.userId;
  if (userId) {
    // fire-and-forget — don't await so it never slows down requests
    import("@workspace/db").then(({ pool }) => {
      pool?.query(`UPDATE "users" SET "last_seen_at" = NOW() WHERE id = $1`, [userId]).catch(() => {});
    }).catch(() => {});
  }
  next();
});
app.use("/api", router);

export default app;
