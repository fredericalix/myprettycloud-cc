// Static server for the Astro-built marketing/docs site (dist/).
// Stripped-down sibling of frontend/server.mjs — no proxy, pure static.

import compression from "compression";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 8080;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");

const app = express();

// Gzip — but never on already-compressed payloads or Range requests:
// gzipped binaries mangle 206 responses behind the CC HTTP/2 edge.
app.use(
  compression({
    filter: (req, res) => {
      if (req.headers.range) return false;
      if (/\.(png|webp|avif|jpe?g|gif|ico|mp4|webm|woff2?)$/i.test(req.path)) return false;
      return compression.filter(req, res);
    },
  }),
);

// Astro's content-hashed output under /_astro/ is immutable; HTML revalidates.
// Directory pages (dist/docs/workflows/index.html) rely on the trailing-slash
// redirect, so keep express.static's default redirect behaviour.
app.use(
  express.static(DIST, {
    extensions: ["html"],
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      } else if (filePath.includes(`${path.sep}_astro${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
      }
    },
  }),
);

// Honest 404s — no SPA fallback on a content site.
app.use((_req, res) => {
  res.status(404);
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.sendFile(path.join(DIST, "404.html"));
});

app.listen(PORT, () => {
  console.log(`website on :${PORT}, serving ${DIST}`);
});
