// Records what the CLI's telemetry prologue does, for tests/fixtures.rs:
// `setTelemetryProduct("cli")`, `maybeWarnCliTelemetry(getHarnesstapDir(), { argv })`
// and `trackCliStartup()`, as `runHarnesstapCli` (src/cli/runtime.ts) runs them.
// Run from the repository root: bun rust/telemetry-rs/tests/make-fixtures.ts
//
// The clock is pinned (setSystemTime), `randomUUID` returns a counter, stderr
// (console.error) and the capture transport are spied, and stdout's TTY flag
// is injected through `stdoutIsTTY`. Each scenario records the text printed,
// the requests sent and every file in the HarnessTap directory afterwards.
import { mock, setSystemTime, spyOn } from "bun:test";
import * as realCrypto from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let uuidCount = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
mock.module("node:crypto", () => ({ ...realCrypto, randomUUID: () => uuid(++uuidCount) }));

const telemetry = await import("../../../src/telemetry/index.ts");
const { getHarnesstapDir } = await import("../../../src/db/connection.ts");
const { PACKAGE_VERSION } = await import("../../../src/version.ts");

let seed = 0x7e1e;
function rand() {
  seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0;
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 0x297a2d39);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const maybe = <T>(p: number, xs: readonly T[]): T | undefined => (rand() < p ? pick(xs) : undefined);

const ENV_KEYS = [
  "HARNESSTAP_TELEMETRY",
  "HARNESSTAP_POSTHOG_PROJECT_API_KEY",
  "HARNESSTAP_POSTHOG_HOST",
  "HARNESSTAP_INSTALL_METHOD",
  "npm_execpath",
  "npm_command",
] as const;
const FLAGS = ["", " ", "0", "1", "true", " TRUE ", "False", "yes", "no", "on", "OFF", "maybe", "2", "\ttrue\n", "\ufeff1", "\u00851"];
const KEYS = ["", "  ", "phc_custom", " phc_padded ", "\u3000"];
const HOSTS = ["", " ", "http://localhost:8000", "http://localhost:8000///", " https://ph.example/ ", "https://ph.example/base/"];
const METHODS = ["", "brew", " NPM ", "Bun", "npx", "curl", "unknown", "UNKNOWN", "UN\u212ANOWN", "pip", "homebrew"];
const NPM_EXECPATHS = ["", "/usr/lib/node_modules/npm/bin/npm-cli.js", "/opt/homebrew/lib/node_modules/npm/bin/npx-cli.js", "/Users/x/.bun/bin/bun"];
const NPM_COMMANDS = ["", "exec", "run-script", "install"];
const EXEC_PATHS = ["/usr/local/bin/node", "/opt/homebrew/Cellar/node/22.1.0/bin/node", "/Users/x/.bun/bin/bun", "/usr/bin/NODE", "C:\\Program Files\\nodejs\\node.exe", "/usr/local/bin/ht", "/opt/ht/runtime"];
const SCRIPTS = [
  "/usr/local/lib/node_modules/harnesstap/dist/bin.js",
  "/opt/homebrew/Cellar/harnesstap/1.6.3/libexec/bin.js",
  "/Users/x/.npm/_npx/abc/node_modules/.bin/ht",
  "/Users/x/.bun/install/global/node_modules/harnesstap/dist/bin.js",
  "/Users/x/.harnesstap/bin/ht",
  "/home/x/HarnessTap/dist/bin.js",
  "/srv/app/main.js",
  "",
];
const REST = [
  [],
  ["list"],
  ["list", "--json"],
  ["status", "--format", "json"],
  ["status", "--format=json"],
  ["status", "--format", "yaml"],
  ["status", "--format"],
  ["--format", "json"],
  ["--json"],
  ["--JSON"],
  ["--json=true"],
  ["--", "--json"],
  ["plugin", "list", "--format", "--json"],
  ["--format", "JSON"],
  ["--format=json5"],
  ["-j"],
];

const CONFIGS = [
  '{"telemetry":{"enabled":true}}',
  '{"telemetry":{"enabled":false}}',
  "{}",
  '{"telemetry":{}}',
  '{"telemetry":{"enabled":"true"}}',
  '{"telemetry":{"enabled":1}}',
  '{"telemetry":{"enabled":null}}',
  '{"telemetry":null}',
  '{"telemetry":"x"}',
  '{"telemetry":[true]}',
  "null",
  "1",
  '"s"',
  "[]",
  "{",
  "",
  '// prefs\n{\n  "telemetry": { "enabled": false, }, // off\n}\n',
  '/* x */ {"telemetry": {"enabled": true /* on */},}',
  '{"telemetry":{"enabled":true},"telemetry":{"enabled":false}}',
  '\ufeff{"telemetry":{"enabled":true}}',
  "{'telemetry': {'enabled': true}}",
  '{"other": 1, "telemetry": {"enabled": true, "extra": "keep"}}',
];
const NOW = Date.parse("2026-11-27T08:15:30.123Z");
const STATES = [
  "{}",
  '{"distinct_id":"abc"}',
  '{"distinct_id":"  padded id  ","cli_notice_shown_at":"  "}',
  '{"distinct_id":"abc","cli_notice_shown_at":"2026-01-01T00:00:00.000Z"}',
  '{"distinct_id":"abc","cli_installed_at":"2026-01-01T00:00:00.000Z"}',
  '{"distinct_id":"abc","cli_first_run_at":"2026-01-01T00:00:00.000Z"}',
  '{"distinct_id":"abc","cli_installed_at":"2026-01-01T00:00:00.000Z","cli_first_run_at":"2026-01-02T00:00:00.000Z","cli_notice_shown_at":"2026-01-01T00:00:00.000Z"}',
  '{"cli_notice_shown_at":"x","cli_first_run_at":"y","distinct_id":"z","identified_distinct_id":"user-1","desktop_first_open_at":"d1","desktop_installed_at":"d0","cli_installed_at":"w"}',
  '{"distinct_id":"abc","identified_distinct_id":"user-1"}',
  '{"distinct_id":"abc","identified_distinct_id":"   "}',
  '{"distinct_id":5,"cli_installed_at":true,"cli_first_run_at":null,"cli_notice_shown_at":["x"]}',
  '{"distinct_id":"abc","foo":1,"bar":{"x":[1,2]}}',
  '{"distinct_id":"\\u00e9\\t\\u0001\\"q\\"/ \\u2028"}',
  '{"distinct_id":"\u00a0nbsp\ufeff","cli_notice_shown_at":"\u0085"}',
  '{"distinct_id":"a","distinct_id":"b"}',
  "{",
  "[]",
  "null",
  '"x"',
  "",
  "\ufeff{}",
  '  {"distinct_id": "spaced"}  \n',
];

type Scenario = {
  name: string;
  env: Record<string, string>;
  home: "dir" | "missing" | "file";
  config?: { file: "config.jsonc" | "config.json" | "both" | "dir"; text: string };
  state?: { text?: string; hex?: string; dir?: true };
  execPath: string;
  argv: string[];
  tty: boolean;
  runs: number;
  now: string;
};

const scenarios: Scenario[] = [];
function add(s: Omit<Scenario, "now" | "name"> & { name?: string }) {
  const i = scenarios.length;
  scenarios.push({ name: s.name ?? `random-${i}`, ...s, now: new Date(NOW + i * 7_777_777 + (i % 1000)).toISOString() });
}
const node = "/usr/local/bin/node";
const bin = SCRIPTS[0]!;

// Hand-picked: each rule on its own, from a clean directory.
for (const flag of [undefined, "0", "1"]) {
  for (const config of [undefined, CONFIGS[0], CONFIGS[1], CONFIGS[2]]) {
    for (const tty of [true, false]) {
      add({
        name: `basic-${flag ?? "unset"}-${config ?? "none"}-${tty ? "tty" : "pipe"}`,
        env: flag === undefined ? {} : { HARNESSTAP_TELEMETRY: flag },
        home: "dir",
        config: config === undefined ? undefined : { file: "config.jsonc", text: config },
        execPath: node,
        argv: [node, bin, "list"],
        tty,
        runs: 2,
      });
    }
  }
}
for (const config of CONFIGS) {
  for (const file of ["config.jsonc", "config.json", "both"] as const) {
    add({ name: `config-${file}`, env: {}, home: "dir", config: { file, text: config }, execPath: node, argv: [node, bin], tty: true, runs: 1 });
  }
}
add({ name: "config-dir", env: {}, home: "dir", config: { file: "dir", text: "" }, execPath: node, argv: [node, bin], tty: true, runs: 1 });
for (const text of STATES) {
  for (const flag of ["1", undefined]) {
    add({ name: "state", env: flag ? { HARNESSTAP_TELEMETRY: flag } : {}, home: "dir", state: { text }, execPath: node, argv: [node, bin], tty: true, runs: 1 });
  }
}
for (const flag of ["1", undefined]) {
  add({ name: "state-invalid-utf8", env: flag ? { HARNESSTAP_TELEMETRY: flag } : {}, home: "dir", state: { hex: Buffer.from('{"distinct_id":"a\xff\xfeb","cli_notice_shown_at":"\xc3"}', "latin1").toString("hex") }, execPath: node, argv: [node, bin], tty: true, runs: 1 });
  add({ name: "state-dir", env: flag ? { HARNESSTAP_TELEMETRY: flag } : {}, home: "dir", state: { dir: true }, execPath: node, argv: [node, bin], tty: true, runs: 2 });
  for (const home of ["missing", "file"] as const) {
    add({ name: `home-${home}`, env: flag ? { HARNESSTAP_TELEMETRY: flag } : {}, home, execPath: node, argv: [node, bin], tty: true, runs: 2 });
  }
}
for (const rest of REST) {
  for (const tty of [true, false]) {
    add({ name: "argv", env: {}, home: "dir", execPath: node, argv: [node, bin, ...rest], tty, runs: 1 });
  }
}
add({ name: "argv-json-first", env: {}, home: "dir", execPath: node, argv: ["--json"], tty: true, runs: 1 });
add({ name: "argv-empty", env: {}, home: "dir", execPath: node, argv: [], tty: true, runs: 1 });
for (const execPath of EXEC_PATHS) {
  for (const script of SCRIPTS) {
    add({ name: "install-method", env: { HARNESSTAP_TELEMETRY: "1" }, home: "dir", execPath, argv: script ? [execPath, script] : [execPath], tty: false, runs: 1 });
  }
}

// Random mixes of everything.
while (scenarios.length < 900) {
  const env: Record<string, string> = {};
  const values: Record<(typeof ENV_KEYS)[number], string | undefined> = {
    HARNESSTAP_TELEMETRY: maybe(0.7, FLAGS),
    HARNESSTAP_POSTHOG_PROJECT_API_KEY: maybe(0.25, KEYS),
    HARNESSTAP_POSTHOG_HOST: maybe(0.3, HOSTS),
    HARNESSTAP_INSTALL_METHOD: maybe(0.3, METHODS),
    npm_execpath: maybe(0.3, NPM_EXECPATHS),
    npm_command: maybe(0.3, NPM_COMMANDS),
  };
  for (const [k, v] of Object.entries(values)) if (v !== undefined) env[k] = v;
  const execPath = pick(EXEC_PATHS);
  const script = pick(SCRIPTS);
  const home = rand() < 0.9 ? "dir" : pick(["missing", "file"] as const);
  add({
    env,
    home,
    config: home === "dir" && rand() < 0.7 ? { file: pick(["config.jsonc", "config.jsonc", "config.json", "both"] as const), text: pick(CONFIGS) } : undefined,
    state: home === "dir" && rand() < 0.6 ? { text: pick(STATES) } : undefined,
    execPath,
    argv: [execPath, ...(script ? [script] : []), ...pick(REST)],
    tty: rand() < 0.6,
    runs: rand() < 0.3 ? 2 : 1,
  });
}

// --- Run ---
const stderr: string[] = [];
spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  stderr.push(`${args.map(String).join(" ")}\n`);
});
const sends: { url: string; body: string }[] = [];
telemetry.setTelemetryTransportForTests({ send: (url, body) => void sends.push({ url, body }) });

const realExecPath = process.execPath;
const realArgv = process.argv;
for (const k of ENV_KEYS) delete process.env[k];
delete process.env.HARNESSTAP_PRODUCT;

function listFiles(home: string): Record<string, string | null> {
  if (!existsSync(home) || !statSync(home).isDirectory()) return {};
  const out: Record<string, string | null> = {};
  for (const name of readdirSync(home).sort()) {
    const p = join(home, name);
    out[name] = statSync(p).isDirectory() ? null : readFileSync(p, "utf8");
  }
  return out;
}

const recorded = [];
for (const s of scenarios) {
  const root = mkdtempSync(join(tmpdir(), "ht-telemetry-"));
  const home = join(root, "home", ".harnesstap");
  if (s.home === "dir") mkdirSync(home, { recursive: true });
  if (s.home === "file") {
    mkdirSync(join(root, "home"));
    writeFileSync(home, "not a directory");
  }
  if (s.config) {
    if (s.config.file === "dir") mkdirSync(join(home, "config.jsonc"));
    else if (s.config.file === "both") {
      writeFileSync(join(home, "config.jsonc"), s.config.text);
      writeFileSync(join(home, "config.json"), '{"telemetry":{"enabled":false}}');
    } else writeFileSync(join(home, s.config.file), s.config.text);
  }
  if (s.state?.dir) mkdirSync(join(home, "telemetry-state.json"));
  else if (s.state?.hex !== undefined) writeFileSync(join(home, "telemetry-state.json"), Buffer.from(s.state.hex, "hex"));
  else if (s.state?.text !== undefined) writeFileSync(join(home, "telemetry-state.json"), s.state.text);

  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, s.env);
  process.env.HARNESSTAP_HOME = home;
  process.execPath = s.execPath;
  process.argv = s.argv;
  uuidCount = 0;
  setSystemTime(new Date(s.now));
  const runs = [];
  for (let r = 0; r < s.runs; r++) {
    stderr.length = 0;
    sends.length = 0;
    telemetry.setTelemetryProduct("cli");
    telemetry.maybeWarnCliTelemetry(getHarnesstapDir(), { argv: s.argv, stdoutIsTTY: s.tty });
    telemetry.trackCliStartup();
    runs.push({ stderr: stderr.join(""), sends: [...sends], files: listFiles(home) });
  }
  recorded.push({ ...s, runs });
  rmSync(root, { recursive: true, force: true });
}
process.execPath = realExecPath;
process.argv = realArgv;
for (const k of ENV_KEYS) delete process.env[k];
delete process.env.HARNESSTAP_HOME;

writeFileSync(
  "rust/telemetry-rs/tests/fixtures/scenarios.json",
  `${JSON.stringify({ version: PACKAGE_VERSION, platform: process.platform, scenarios: recorded })}\n`,
);
const flat = recorded.flatMap((s) => s.runs);
console.log(
  `${recorded.length} scenarios, ${flat.length} runs: ${flat.filter((r) => r.stderr).length} notices, ${flat.reduce((n, r) => n + r.sends.length, 0)} events`,
);
