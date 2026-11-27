// Records services/self-update.ts (the CLI update notice) for tests/fixtures.rs:
// maybeNotifyCliUpdate and resolvePublishedRelease with a scripted fetchFn, a
// pinned `now`, generated env/argv and pre-existing update-check.json files,
// plus the pure helpers they reach. Run from the repo root under Node (the
// CLI's runtime), in UTC:
//   TZ=UTC HT_RELEASE=1 node --experimental-transform-types --import ./rust/apm-rs/tests/ts-resolve.mjs rust/self-update-rs/tests/make-fixtures.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as su from "../../../src/services/self-update.ts";
import { PACKAGE_VERSION } from "../../../src/version.ts";

let seed = 0x5e1f0;
function rand() {
  seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0;
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 0x297a2d39);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const chance = (p) => rand() < p;

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.parse("2026-11-27T10:00:00.000Z");

const VERSIONS = ["1.6.3", "1.6.4", "v1.7.0", "1.7.0-beta.1", "2.0.0", "1.6.2", "V1.10.0", " 1.6.4 ", "1.6", "latest", "1.6.4+build.5", "v2", "\u00a01.8.0\t", "1.6.3-rc.1", "0.0.1", "10.0.0", "1.06.4", ""];
const CURRENT = ["1.6.3", "v1.6.3", "1.6.3-dev+abc1234", "1.6.3-dev", "1.7.0", "0.9.0", " 1.6.3 ", "garbage", "", "2.0.0-rc.1", "1.6", "V1.6.3"];
const SCRIPTS = [
  "/usr/local/lib/node_modules/harnesstap/dist/bin.js",
  "C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\harnesstap\\dist\\bin.js",
  "/opt/homebrew/Cellar/harnesstap/1.6.3/libexec/lib/node_modules/harnesstap/dist/bin.js",
  "/opt/homebrew/Cellar/harnesstap/1.6.3/libexec/bin/ht",
  "/usr/local/CELLAR/HarnessTap/1.6.3/bin/ht",
  "C:\\homebrew\\Cellar\\harnesstap\\x\\ht.js",
  "/Users/a/.bun/install/global/node_modules/harnesstap/dist/bin.js",
  "/Users/a/.bun/bin/ht",
  "/Users/a/Library/pnpm/global/5/node_modules/harnesstap/dist/bin.js",
  "/Users/a/Library/pnpm/global/5/.pnpm/harnesstap@1.6.3/node_modules/harnesstap/dist/bin.js",
  "/repo/node_modules/.bin/ht",
  "/Users/a/.npm/_npx/abc123/node_modules/harnesstap/dist/bin.js",
  "/tmp/_npx/x/bin.js",
  "/repo/dist/bin.js",
  "/repo/src/bin.ts",
  "/usr/local/lib/node_modules/harnesstap-fork/dist/bin.js",
  "",
  "ht",
];
const ARGS = [[], ["plugin", "list"], ["apply"], ["--json"], ["list", "--json"], ["__complete", "apply"], ["completion", "zsh"], ["x", "completion"], ["list", "--format", "json"], ["list", "--format=json"], ["list", "--format", "yaml"], ["list", "--format"], ["--format", "JSON"], ["--json=false"], ["status"]];
const ENV_VALUES = {
  HARNESSTAP_UPDATE_CHANNEL: ["npm", "github", "NPM", "x", ""],
  npm_package_name: ["harnesstap", "other", ""],
  HARNESSTAP_INSTALL_METHOD: ["brew", " BREW ", "Brew\n", "npm", "", "brewery"],
  HARNESSTAP_SKIP_UPDATE_CHECK: ["1", "true", "0", "yes", "TRUE"],
  HARNESSTAP_UPDATE_CHECK: ["1", "0", "true"],
  BUN_TEST: ["1", "", "0"],
  NODE_ENV: ["test", "production", ""],
};
const ENV_ODDS = { HARNESSTAP_UPDATE_CHANNEL: 0.25, npm_package_name: 0.15, HARNESSTAP_INSTALL_METHOD: 0.25, HARNESSTAP_SKIP_UPDATE_CHECK: 0.06, HARNESSTAP_UPDATE_CHECK: 0.1, BUN_TEST: 0.06, NODE_ENV: 0.1 };
function env() {
  const e = {};
  for (const [k, p] of Object.entries(ENV_ODDS)) if (chance(p)) e[k] = pick(ENV_VALUES[k]);
  return e;
}

const LOOKUP_AT = [
  (now) => new Date(now - 60_000).toISOString(),
  (now) => new Date(now - DAY).toISOString(),
  (now) => new Date(now - DAY - 1).toISOString(),
  (now) => new Date(now - 3 * DAY).toISOString(),
  (now) => new Date(now + 3_600_000).toISOString(),
  (now) => new Date(now - 3_600_000).toISOString().replace(".000Z", "Z"),
  (now) => new Date(now - 3_600_000).toISOString().replace("Z", "+02:00"),
  (now) => new Date(now - 3_600_000).toISOString().replace("Z", "-05:30"),
  (now) => new Date(now - 3_600_000).toISOString().slice(0, 16) + "Z",
  (now) => new Date(now - 3_600_000).toISOString().slice(0, 10),
  (now) => new Date(now - 3_600_000).toISOString().slice(0, 7),
  (now) => new Date(now - 3_600_000).toISOString().slice(0, 4),
  (now) => new Date(now - 3_600_000).toISOString().slice(0, 19),
  (now) => new Date(now - 3_600_000).toISOString().replace(/\.\d+Z/, ".5Z"),
  (now) => "+" + new Date(now - 3_600_000).toISOString().replace(/^/, "00"),
  () => "2026-11-27T24:00:00.000Z",
  () => "2026-11-27T24:00:01.000Z",
  () => "2026-02-30T00:00:00.000Z",
  () => "2026-13-01T00:00:00.000Z",
  () => "2026-11-27T10:60:00Z",
  () => "not a date",
  () => "",
  () => "2026-11-27T10:00:00.123456789Z",
  () => "2026-11-27T10Z",
  () => "2026-11-27T10:00:00+02",
  () => "2026-11-27T10:00:00.Z",
  () => "+275760-09-13T00:00:00.000Z",
  () => "+275760-09-13T00:00:00.001Z",
  () => "-000000-01-01T00:00:00Z",
  () => null,
  () => 5,
];

function cacheObject(now) {
  const c = {};
  if (chance(0.9)) c.lastLookupAt = pick(LOOKUP_AT)(now);
  if (chance(0.9)) c.latestVersion = chance(0.9) ? pick(VERSIONS) : pick([null, 1, ""]);
  if (chance(0.7)) c.latestNotes = pick(["", "Notes\n- fix", null, 3, "é \u2028 \"q\""]);
  if (chance(0.7)) c.latestHtmlUrl = pick(["https://github.com/harnesstap/harnesstap/releases/tag/v9", "", null, false]);
  if (chance(0.7)) c.assets = chance(0.8) ? Array.from({ length: Math.floor(rand() * 4) }, () => pick([
    { name: "ht_1.7.0_aarch64.dmg", browser_download_url: "https://x/a.dmg" },
    { browser_download_url: "https://x/b", name: "b.deb", size: 1.5, "1": "first", extra: { a: [1, "2"] } },
    { name: 1, browser_download_url: "u" },
    { name: "n" },
    null,
    "asset",
    ["n", "u"],
  ])) : pick([{}, "x", null]);
  if (chance(0.5)) c.notifiedVersion = pick([...VERSIONS, null, 7]);
  if (chance(0.1)) c.other = { kept: false };
  return c;
}

// Accepted only by V8's legacy (non-ISO) date fallback; the port treats them
// as invalid. Recorded on their own, as known differences.
const LEGACY_DATES = ["2026-11-27T10:00:00.000+0200", "2026-11-27 10:00:00Z", "2026-11-27t10:00:00z", "2026-1-2", "+2026-11-27", "Fri Nov 27 2026"];

const CORRUPT = ["{", "null", "[]", "\"x\"", "42", "{\"lastLookupAt\": 5}", "", "\ufeff{}", "{\"a\":1,}", " {\"latestVersion\":\"9.9.9\",\"latestVersion\":\"1.6.4\",\"lastLookupAt\":\"2026-11-27T09:00:00.000Z\"} \n"];
function cacheSetup(now) {
  const k = rand();
  if (k < 0.2) return { kind: "none" };
  if (k < 0.23) return { kind: "dir" };
  if (k < 0.25) return { kind: "home-is-file" };
  if (k < 0.28) return { kind: "missing-home" };
  if (k < 0.36) return { kind: "file", text: pick(CORRUPT) };
  const c = cacheObject(now);
  return { kind: "file", text: JSON.stringify(c, null, pick([0, 2, 2, "\t"])) + (chance(0.8) ? "\n" : "") };
}

const NPM_URL = su.NPM_LATEST_API;
const GH_URL = su.GITHUB_LATEST_RELEASE_API;
function okBody(text, status = 200) {
  return { status, body: text };
}
function npmOutcome() {
  const k = rand();
  if (k < 0.55) return okBody(JSON.stringify({ name: "harnesstap", version: pick(VERSIONS) }), pick([200, 200, 203, 299]));
  if (k < 0.6) return okBody(JSON.stringify(pick([{}, { version: 1 }, { version: "  " }, null, [], "1.7.0"])));
  if (k < 0.7) return okBody("{\"error\":\"Not found\"}", pick([404, 500, 429, 301, 199 + 101]));
  if (k < 0.76) return okBody(pick(["{", "<html>", "", "\ufeff{\"version\":\"1.7.0\"}", "{\"version\":\"1.7.0\"} x"]));
  if (k < 0.85) return { error: "network" };
  if (k < 0.9) return { error: "timeout" };
  return null;
}
function githubOutcome(npmVersion) {
  const k = rand();
  if (k < 0.6) {
    const tag = chance(0.5) && typeof npmVersion === "string" ? pick([npmVersion, `v${npmVersion}`, ` v${npmVersion} `]) : pick(VERSIONS);
    const body = { tag_name: tag };
    if (chance(0.7)) body.body = pick(["## Changes\n- a", "", 5, null, "line \u2028 \"x\" é"]);
    if (chance(0.7)) body.html_url = pick(["https://github.com/harnesstap/harnesstap/releases/tag/v1.7.0", "", 1]);
    if (chance(0.7)) body.assets = chance(0.85) ? Array.from({ length: Math.floor(rand() * 4) }, () => pick([
      { name: "ht_1.7.0_aarch64.dmg", browser_download_url: "https://x/a.dmg", size: 10 },
      { browser_download_url: "https://x/b", name: "b.deb" },
      { name: 1, browser_download_url: "u" },
      null,
      "x",
      [1],
    ])) : pick([{}, "x", null]);
    if (chance(0.2)) body.draft = false;
    return okBody(JSON.stringify(body, null, pick([0, 2])), pick([200, 200, 201]));
  }
  if (k < 0.65) return okBody(JSON.stringify(pick([{}, { tag_name: 1 }, { tag_name: " " }, null, ["v1"]])));
  if (k < 0.75) return okBody("{\"message\":\"Not Found\"}", pick([404, 403, 500]));
  if (k < 0.8) return okBody(pick(["{", "", "nope"]));
  if (k < 0.9) return { error: "network" };
  if (k < 0.95) return { error: "timeout" };
  return null;
}
function responses() {
  const npm = npmOutcome();
  let npmVersion;
  try { npmVersion = npm && npm.status < 300 ? JSON.parse(npm.body).version : undefined; } catch { /* not JSON */ }
  const gh = githubOutcome(typeof npmVersion === "string" ? npmVersion.trim() : undefined);
  const r = {};
  if (npm) r[NPM_URL] = npm;
  if (gh) r[GH_URL] = gh;
  return r;
}

function fakeFetch(script, calls) {
  return async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: init?.headers ?? null, timeoutMs: init?.timeoutMs ?? null, retries: init?.retries ?? null });
    const out = script[url];
    if (!out) throw new Error(`Connection refused (1 attempts): ${url}`);
    if (out.error === "timeout") throw new Error(`Request timed out after ${init?.timeoutMs}ms (1 attempts): ${url}`);
    if (out.error) throw new TypeError("fetch failed");
    return new Response(out.body, { status: out.status });
  };
}

function prepare(setup) {
  const root = mkdtempSync(join(tmpdir(), "ht-self-update-"));
  const dir = join(root, "home");
  switch (setup.kind) {
    case "none": mkdirSync(dir); break;
    case "missing-home": break;
    case "home-is-file": writeFileSync(dir, "x"); break;
    case "dir": mkdirSync(join(dir, "update-check.json"), { recursive: true }); break;
    case "file": mkdirSync(dir); writeFileSync(join(dir, "update-check.json"), setup.text); break;
    default: throw new Error(setup.kind);
  }
  return { root, dir };
}
function cacheAfter(dir) {
  const path = join(dir, "update-check.json");
  if (!existsSync(path)) return null;
  if (statSync(path).isDirectory()) return { dir: true };
  return { text: readFileSync(path, "utf8") };
}

const notify = [];
for (let i = 0; i < 700; i += 1) {
  const now = BASE + Math.floor(rand() * 400) * 3_600_000 - 200 * 3_600_000 + Math.floor(rand() * 1000);
  const c = {
    argv: ["/usr/local/bin/node", pick(SCRIPTS), ...pick(ARGS)],
    env: env(),
    exitCode: chance(0.85) ? null : pick([0, 1, 2]),
    currentVersion: pick(CURRENT),
    now,
    setup: cacheSetup(now),
    responses: responses(),
  };
  const { root, dir } = prepare(c.setup);
  const calls = [];
  const notices = [];
  process.exitCode = c.exitCode ?? undefined;
  const result = await su.maybeNotifyCliUpdate({
    argv: c.argv,
    env: c.env,
    harnesstapDir: dir,
    currentVersion: c.currentVersion,
    now: new Date(now),
    fetchFn: fakeFetch(c.responses, calls),
    writeNotice: (m) => notices.push(m),
  });
  process.exitCode = undefined;
  notify.push({ ...c, result, notices, calls, after: cacheAfter(dir) });
  rmSync(root, { recursive: true, force: true });
}

const resolve = [];
for (let i = 0; i < 300; i += 1) {
  const now = BASE + Math.floor(rand() * 100) * 3_600_000 - 50 * 3_600_000;
  const c = { channel: pick(["npm", "github"]), now, setup: cacheSetup(now), responses: responses() };
  const { root, dir } = prepare(c.setup);
  const calls = [];
  const result = await su.resolvePublishedRelease({ channel: c.channel, harnesstapDir: dir, now: new Date(now), fetchFn: fakeFetch(c.responses, calls) });
  resolve.push({ ...c, result, calls, after: cacheAfter(dir) });
  rmSync(root, { recursive: true, force: true });
}

const pure = {
  normalize: VERSIONS.concat(CURRENT, ["v", "vv1", "\ufeffv1.0.0", " V 1"]).map((v) => [v, su.normalizePublishedVersion(v)]),
  newer: [],
  channel: [],
  homebrew: [],
  hint: [],
  skip: [],
  fresh: [],
  legacyFresh: LEGACY_DATES.map((at) => [at, BASE, su.isUpdateLookupFresh({ lastLookupAt: at }, new Date(BASE))]),
};
for (const a of VERSIONS.concat(CURRENT)) for (const b of CURRENT) pure.newer.push([a, b, su.isNewerPublishedVersion(a, b)]);
for (let i = 0; i < 300; i += 1) {
  const script = pick(SCRIPTS);
  const e = env();
  pure.channel.push([script, e, su.detectCliInstallChannel(script, e)]);
  pure.homebrew.push([script, e, su.isHomebrewCliInstall(script, e)]);
  const argv = ["node", script, ...pick(ARGS)];
  pure.skip.push([argv, e, su.shouldSkipCliUpdateNotice(argv, e)]);
}
for (const ch of ["npm", "github"]) for (const v of VERSIONS) for (const hb of [false, true]) pure.hint.push([ch, v, hb, su.cliInstallHint(ch, v, hb)]);
for (const f of LOOKUP_AT) {
  for (const delta of [0, DAY, -DAY, 10 * DAY]) {
    const now = BASE + delta;
    const at = f(BASE);
    pure.fresh.push([at, now, su.isUpdateLookupFresh({ lastLookupAt: typeof at === "string" ? at : null }, new Date(now))]);
  }
}

// Fractions at the max-age boundary: ".5" is 500 ms, ".12" is 120 ms.
for (const [at, now] of [["2026-11-26T10:00:00.5Z", BASE + 400], ["2026-11-26T10:00:00.5Z", BASE + 600], ["2026-11-26T10:00:00.12Z", BASE + 100], ["2026-11-26T10:00:00.12Z", BASE + 130], ["2026-11-26T10:00:00.1239Z", BASE + 123], ["2026-11-26T10:00:00.1239Z", BASE + 124]]) {
  pure.fresh.push([at, now, su.isUpdateLookupFresh({ lastLookupAt: at }, new Date(now))]);
}

mkdirSync("rust/self-update-rs/tests/fixtures", { recursive: true });
writeFileSync("rust/self-update-rs/tests/fixtures/self-update.json", JSON.stringify({ packageVersion: PACKAGE_VERSION, notify, resolve, pure }) + "\n");
const shown = notify.filter((c) => c.notices.length).length;
console.log(`${notify.length} notify scenarios (${shown} with a notice, ${notify.filter((c) => c.calls.length).length} with fetches), ${resolve.length} resolve scenarios, ${Object.values(pure).reduce((n, l) => n + l.length, 0)} pure calls; PACKAGE_VERSION=${PACKAGE_VERSION}`);
