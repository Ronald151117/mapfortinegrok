#!/usr/bin/env node
// Bundles src/embed/mapa-sv.ts into dist-embed/mapa-sv.js: the flat El Salvador map for other apps
// (Visual GPS copies it to src/vendor/). No dependencies: the caller passes its own maplibregl.
import { build } from "vite";

await build({
  configFile: false,
  logLevel: "warn",
  resolve: { tsconfigPaths: true },
  build: {
    lib: { entry: "src/embed/mapa-sv.ts", formats: ["es"], fileName: () => "mapa-sv.js" },
    outDir: "dist-embed",
    emptyOutDir: true,
    target: "es2020",
    minify: false,
  },
});
console.log("dist-embed/mapa-sv.js");
