import { defineConfig } from "tsup";
import { resolveBuildVersion } from "./src/version.ts";

const define = {
  __HT_VERSION__: JSON.stringify(resolveBuildVersion()),
};

const shared = {
  format: ["esm"] as const,
  outDir: "dist",
  clean: false,
  splitting: true,
  sourcemap: true,
  define,
};

export default defineConfig([
  {
    ...shared,
    entry: { index: "src/index.ts" },
    target: "node22",
    dts: true,
  },
  {
    ...shared,
    // The status refresh worker is loaded by file URL next to the bundle, so
    // it needs its own entry in dist/.
    entry: {
      bin: "src/bin.ts",
      "status-refresh-worker": "src/services/status-refresh-worker.ts",
    },
    target: "es2020",
    dts: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
