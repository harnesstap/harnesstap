import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";
import {
  formatDevBuildVersion,
  isReleaseBuild,
  readGitSha,
} from "./src/version.ts";

const packageVersion = (
  JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
    version: string;
  }
).version;

const cliVersion = formatDevBuildVersion(packageVersion, {
  isRelease: isReleaseBuild(),
  gitSha: readGitSha(),
});

const define = {
  __HT_VERSION__: JSON.stringify(cliVersion),
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
