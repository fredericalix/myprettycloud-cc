import type { NextConfig } from "next";

// Static export: the app is a client SPA (the city is client-only, no SSR / no
// API routes — those are proxied by server.mjs). Exporting to `out/` lets us
// serve it like a static site with explicit cache + compression rules, which
// avoids the HTTP/2 framing errors Next's dynamic static handler hits on large
// GLTF .bin/.png assets behind the Clever Cloud edge. server.mjs reverse-proxies
// /api /auth /ws /webhooks /mcp to the backend (incl. the WebSocket upgrade).
const nextConfig: NextConfig = {
  output: "export",
  // three.js ships untranspiled ESM that Next's compiler must process.
  transpilePackages: ["three"],
  images: { unoptimized: true },
};

export default nextConfig;
