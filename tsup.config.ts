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
    entry: { bin: "src/bin.ts" },
    target: "es2020",
    dts: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
