import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
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

app.use(
  cors({
    origin: true,
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
export const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET ?? "gdna-arena-secret-fallback",
  resave: false,
  saveUninitialized: false,
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
app.use(["/api/auth/login", "/api/auth/register"], authLimiter);

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
