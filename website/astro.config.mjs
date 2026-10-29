import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://myprettycloud-website.cleverapps.io",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
});
