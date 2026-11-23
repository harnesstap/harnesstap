// Records the writing half of apm-manifest.ts (serializeEnvironmentBlock,
// apmDocumentFromProjectConfig through formatApmManifest) for tests/manifest_write_fixtures.rs.
// The configs are the manifests in fixtures/project-config.json that parse, read with
// parseProjectConfigContents, some with their name or version dropped. Run from the repo root
// under Node (the CLI's runtime):
//   TZ=UTC node --experimental-transform-types --import ./rust/apm-rs/tests/ts-resolve.mjs rust/apm-rs/tests/make-manifest-write-fixtures.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { formatApmManifest, serializeEnvironmentBlock } from "../../../src/services/apm-manifest.ts";
import { parseProjectConfigContents } from "../../../src/services/project-config.ts";

if (process.env.TZ !== "UTC") throw new Error("run with TZ=UTC");

let seed = 0x77a1e;
function rand() {
  seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0;
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 0x297a2d39);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

const sources = JSON.parse(readFileSync(new URL("./fixtures/project-config.json", import.meta.url), "utf8")).contents.filter((c) => c.config).map((c) => c.raw);
const extra = [
  "name: demo\nversion: 1.0.0\nx-harnesstap: {a: 1}\nenvironment: e\ndefault_environment: d\nz: 1\n2: two\nname2: x\n",
  "name: demo\nversion: 1.0.0\nenvironments:\n  default: dev\n",
  "name: demo\nversion: 1.0.0\nenvironments:\n  dev: {}\n  \"3\": {values: {b: 1, a: 2}}\n",
  "name: demo\nversion: 1.0.0\ndescription: d\nprofiles:\n  - {name: a, source: local}\n  - {name: b, source: catalog, selector: s, environment: e}\n  - {name: c, source: inline, plugin: p}\nplugins:\n  - {name: p, z: 1, \"1\": one}\n",
];
const cases = [];
for (const raw of [...extra, ...sources]) {
  const drop = pick(["none", "none", "name", "version", "both"]);
  const projectPath = pick(["/x/my-proj", "/x/proj/", "/", " ", "/x/ spaced ", "rel/dir", ""]);
  const config = parseProjectConfigContents(raw, "apm.yml");
  if (drop === "name" || drop === "both") delete config.apm_name;
  if (drop === "version" || drop === "both") delete config.apm_version;
  const block = serializeEnvironmentBlock(config);
  cases.push({ raw, drop, projectPath, block: block === undefined ? null : JSON.stringify(block), yaml: formatApmManifest(config, projectPath) });
}
writeFileSync(new URL("./fixtures/manifest-write.json", import.meta.url), JSON.stringify({ generator: "make-manifest-write-fixtures.mjs", cases }) + "\n");
console.log(cases.length);
