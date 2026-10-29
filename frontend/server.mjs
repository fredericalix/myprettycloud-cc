// Same-origin reverse proxy + static server for the exported Next app.
//
// One public origin (https://myprettycloud-frontend.cleverapps.io):
//   /api /auth /ws /webhooks /mcp /.well-known → forwarded to the Rust backend
//   everything else                            → served from ./out (next export)
//
// Single origin avoids the cross-site cookie problem (cleverapps.io subdomains
// are separate sites on the Public Suffix List). Adapted from the mycctown
// proxy, which is proven against the Clever Cloud HTTP/2 edge.

import compression from "compression";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 8080;
const BACKEND = process.env.BACKEND_INTERNAL_URL || process.env.BACKEND_URL;

if (!BACKEND) {
  console.error("BACKEND_INTERNAL_URL is required (e.g. https://<your-backend>.cleverapps.io)");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "out");

// Keep the original URL intact (Express's app.use('/api', …) would strip the
// prefix, which the backend doesn't expect). ws:true tunnels the WebSocket.
const proxy = createProxyMiddleware({
  target: BACKEND,
  changeOrigin: true,
  xfwd: true,
  ws: true,
  pathFilter: (p) =>
    p.startsWith("/api") ||
    p.startsWith("/auth") ||
    p.startsWith("/ws") ||
    p.startsWith("/webhooks") ||
    p.startsWith("/mcp") ||
    p.startsWith("/.well-known"),
});

const app = express();
app.use(proxy);

// Gzip — but never on already-compressed payloads (.bin/.png/media) or on
// Range requests: gzipping binaries wastes CPU and, worse, mangles 206
// responses behind the CC HTTP/2 edge → ERR_HTTP2_PROTOCOL_ERROR on the GLTF
// .bin/.png the city streams.
app.use(
  compression({
    filter: (req, res) => {
      if (req.headers.range) return false;
      if (/\.(bin|png|webp|jpe?g|gif|mp3|wav|ogg|m4a|mp4|webm|glb|gltf)$/i.test(req.path)) return false;
      return compression.filter(req, res);
    },
  }),
);

// The in-app docs page was removed — documentation lives on the website now.
// Keep old bookmarks working with a redirect.
app.get(["/docs", "/docs/"], (_req, res) => {
  res.redirect(302, "https://myprettycloud-website.cleverapps.io/docs/");
});

// Same collision: Next 16 emits an out/login/ directory of RSC .txt payloads
// (no index.html) that shadows login.html, so express.static skips it and the
// SPA fallback would serve the city. Serve the real page explicitly.
app.get(["/login", "/login/"], (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.sendFile(path.join(OUT_DIR, "login.html"));
});

// Static assets. Next-hashed bundles under /_next/ are immutable (1y).
// /assets/** (GLTF/bin/png) are NOT path-hashed — cache 1h with revalidation
// so a content change after a deploy is picked up (the ?v=N query also busts).
app.use(
  express.static(OUT_DIR, {
    extensions: ["html"],
    redirect: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      } else if (filePath.includes(`${path.sep}_next${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
      }
    },
  }),
);

// SPA fallback to the city shell for any unmatched route.
app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.sendFile(path.join(OUT_DIR, "index.html"));
});

const server = app.listen(PORT, () => {
  console.log(`frontend on :${PORT}, proxying /api /auth /ws /webhooks /mcp → ${BACKEND}`);
});

// http-proxy-middleware needs explicit upgrade handling for WebSockets.
server.on("upgrade", (req, socket, head) => {
  proxy.upgrade(req, socket, head);
});
