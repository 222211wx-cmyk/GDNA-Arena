import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { createHash } from "node:crypto";

// PORT only needed for dev server — build doesn't use it
const port = Number(process.env.PORT || 3000);

// BASE_PATH: "/" in production (served at root), "/gdna-arena" fallback for local dev
const basePath = process.env.BASE_PATH || "/";

function pwaServiceWorker() {
  return {
    name: "gdna-safe-pwa-service-worker",
    apply: "build" as const,
    generateBundle(_: unknown, bundle: Record<string, { fileName: string; type: string }>) {
      const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
      const precache = Object.values(bundle)
        .filter(asset => asset.type === "chunk" || /\.(?:css|js|svg|png|jpe?g|webp|woff2?)$/i.test(asset.fileName))
        .map(asset => `${normalizedBase}${asset.fileName}`);
      precache.push(`${normalizedBase}index.html`);
      const version = createHash("sha256").update(precache.join("|")).digest("hex").slice(0, 12);
      const source = `/* Generated at build time. Private API, AMIS, and key material are never cached. */
const VERSION = ${JSON.stringify(version)};
const SHELL_CACHE = "gdna-arena-shell-" + VERSION;
const PUBLIC_CACHE = "gdna-arena-public-" + VERSION;
const PRECACHE = ${JSON.stringify(precache)};
const BASE = ${JSON.stringify(normalizedBase)};
const PUBLIC_API_PATHS = new Set([
  BASE + "api/legends",
  BASE + "api/pulse/events",
  BASE + "api/pulse/stats"
]);
const OFFLINE_CLIENTS = new Set();
const isSameOrigin = url => url.origin === self.location.origin;
const isStaticAsset = request => request.destination === "style" || request.destination === "script" ||
  request.destination === "image" || request.destination === "font" || new URL(request.url).pathname.startsWith(BASE + "assets/");
self.addEventListener("install", event => event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys
      .filter(key => (key.startsWith("gdna-arena-shell-") || key.startsWith("gdna-arena-public-")) &&
        key !== SHELL_CACHE && key !== PUBLIC_CACHE)
      .map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener("message", event => {
  if (event.data?.type !== "GDNA_CONNECTIVITY" || !event.source?.id) return;
  if (event.data.online === false) OFFLINE_CLIENTS.add(event.source.id);
  else OFFLINE_CLIENTS.delete(event.source.id);
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (!isSameOrigin(new URL(request.url))) return;
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (OFFLINE_CLIENTS.has(event.clientId)) {
      event.respondWith(Promise.resolve(new Response(
        JSON.stringify({ error: "This action needs an internet connection." }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      )));
    }
    return;
  }
  const url = new URL(request.url);
  // Only three explicitly public, non-personalized endpoints may be cached.
  // Auth/session/private API responses, AMIS data, and key material are excluded.
  if (url.pathname === BASE + "api" || url.pathname.startsWith(BASE + "api/")) {
    if (!PUBLIC_API_PATHS.has(url.pathname)) return;
    event.respondWith(fetch(request).then(response => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        void caches.open(PUBLIC_CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(async () => (await caches.match(request)) || Response.error()));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => response).catch(async () =>
      (await caches.match(BASE + "index.html")) || Response.error()));
    return;
  }
  if (!isStaticAsset(request)) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      void caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  })));
});`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    pwaServiceWorker(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({ root: path.resolve(import.meta.dirname, "..") }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  define: {
    "process.env.DATABASE_URL": '""',
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: { strict: true },
    proxy: {
      "/api/ws": {
        target: "ws://localhost:8080",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
