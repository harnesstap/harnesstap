// Records the apm services for tests/fixtures.rs.
// Run from the repository root: bun rust/apm-rs/tests/make-fixtures.ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as deps from "../../../src/services/apm-dependencies.ts";
import * as targets from "../../../src/services/apm-targets.ts";

let seed = 0xa9d1;
const rnd = (n: number) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
};
const pick = <T>(a: readonly T[]): T => a[rnd(a.length)]!;

const run = (f: () => unknown) => {
  try {
    const v = f();
    return { ok: v === undefined ? "$undefined" : v };
  } catch (e) {
    return { err: (e as Error).message };
  }
};

const pieces = [
  "", "./", "../", "~/", "/", ".\\", "..\\", "~\\", "https://", "http://", "file://", "git://", "git@",
  "ssh://git@", "git+https://", "github.com", "gitlab.example.com", "localhost", "org", "repo", "repo.git",
  "pkg", "@", "#", "#v1.2.0", "#main", ":", "/", "/", "\\", "sub", "catalog", "x@market", " ", ".git", "@1.0.0",
];
const depString = () => {
  let s = "";
  for (let i = 0, n = 1 + rnd(6); i < n; i++) s += pick(pieces);
  return s;
};
const fixedStrings = [
  "./skills/x", "../a/b/", "~/p", "/abs/p", ".\\win\\p", "..\\up", "~\\h", "https://github.com/o/r.git#v1",
  "git@github.com:o/r.git", "git+https://h.com/o/r.git#main", "ssh://git@h:22/o/r", "file:///tmp/r.git",
  "org/cat/slug", "org/cat/slug@1.2.0", "org/cat/slug#^1", "name@market", "a/b@x", "owner/repo",
  "owner/repo.git#v2", "gitlab.com/o/r", "gitlab.com/g/s/r#ref", "localhost/o/r", "plain", "plain#ref",
  "#x", "a#", "  spaced/repo  ", "a//b", "/", "", "@x", "a@", "x:y/z",
];
const values = () => pick<unknown>(["v", "", 1, null, true, ["a"], { k: 1 }, "1.2.0", "^2"]);
const objectEntry = () => {
  const o: Record<string, unknown> = {};
  const keys = ["git", "id", "path", "marketplace", "name", "version", "ref", "registry", "transport", "command", "args", "url", "env", "headers", "other"];
  for (let i = 0, n = rnd(5); i < n; i++) {
    const k = pick(keys);
    o[k] = rnd(2) ? depString() : values();
  }
  if (rnd(4) === 0) o.registry = pick([false, true, "", "io.x/y", null, 0]);
  if (rnd(4) === 0) o.transport = pick(["stdio", "http", "sse", "streamable-http", "ws", 1]);
  if (rnd(4) === 0) o.args = pick([[1, "a", null, true, [2, 3]], "x", []]);
  if (rnd(4) === 0) o.env = pick([{ B: 1, A: "x", "10": null, "2": [1] }, [], "x", null]);
  if (rnd(4) === 0) o.headers = { Authorization: "Bearer x" };
  return o;
};

const apm: unknown[] = [];
const mcp: unknown[] = [];
const entries: unknown[] = [...fixedStrings, null, 1, [], true];
for (let i = 0; i < 1500; i++) entries.push(rnd(2) ? depString() : objectEntry());
entries.push(
  { git: "https://h.com/o/r.git", ref: "v1", path: "skills/x" },
  { git: "git+ssh://git@h.com/o/r.git#pin" },
  { git: "o/r", id: "x" },
  { id: "org/cat/slug", version: "1.0.0" },
  { id: "owner/repo#main", version: "2" },
  { id: "name@market", version: "3" },
  { marketplace: "m", name: "n", version: "1" },
  { marketplace: "m", name: "n", version: "" },
  { path: "./local" },
  { name: "srv" },
  { name: "srv", registry: false, command: "npx", args: ["-y", 1] },
  { name: "srv", registry: "io.github/x", transport: "sse", url: "https://x" },
  { name: "" },
  {},
);
for (const e of entries) {
  const a = run(() => deps.parseApmDependencyEntry(e));
  apm.push({ entry: e === undefined ? "$undefined" : e, ...a, fs: "ok" in a ? deps.isFilesystemApmDependency(a.ok as never) : null });
  mcp.push({ entry: e, ...run(() => deps.parseMcpDependencyEntry(e)) });
}
const documents: unknown[] = [
  {}, { dependencies: null }, { dependencies: [] }, { dependencies: { apm: null } }, { dependencies: { apm: "x" } },
  { dependencies: { apm: ["a/b", "./c"], mcp: ["io/x"] }, devDependencies: { apm: ["d@m"], mcp: [{ name: "n" }] } },
  { dependencies: { mcp: 5 } }, { devDependencies: { apm: [1] } }, { dependencies: { apm: [] }, devDependencies: [] },
];
const collect = documents.map((d) => ({
  document: d,
  all: run(() => deps.collectApmAndDevDependencies(d as never)),
  runtime: run(() => deps.collectRuntimeApmDependencies(d as never)),
}));
writeFileSync(new URL("./fixtures/dependencies.json", import.meta.url), JSON.stringify({ apm, mcp, collect }));
console.log(apm.length, "entries,", collect.length, "documents");

// apm-targets.ts
const targetTokens = [
  "copilot", "claude", "grok-build", "cursor", "opencode", "codex", "gemini", "antigravity", "windsurf", "kiro",
  "agent-skills", "all", "ALL", " All ", "vscode", "Agents", "VSCode", "claude-code", "github-copilot",
  "gemini-cli", "warp", "jules", "x-acme-tool", "x-acme", "x-a-b-c", "x-1-b", "unknown", "", " ", "Claude",
  "x-acme-", "cline", "roo", "goose",
];
const tokenList = () => Array.from({ length: rnd(5) }, () => pick(targetTokens));
const mappings = [];
for (let i = 0; i < 600; i++) {
  const tokens = tokenList();
  mappings.push({ tokens, ...run(() => targets.mapApmTargets(tokens)) });
}
const singles = targetTokens.map((t) => ({
  token: t,
  harness: targets.harnessSlugForApmTarget(t) ?? null,
  apm: targets.apmTargetForHarness(t),
  deployDir: targets.deployDirForApmTarget(t),
}));
const tokenDocs = [
  {}, { targets: "claude" }, { target: "cursor" }, { targets: null, target: "x" }, { targets: ["a", 1, null, [2, 3]] },
  { targets: 5, target: "y" }, { targets: { a: 1 } }, { target: ["codex"] }, { targets: true },
].map((d) => ({ document: d, tokens: targets.collectApmTargetTokens(d) }));

const signalFiles = [
  ".github/copilot-instructions.md", ".github/instructions/", ".github/agents/", ".github/prompts", ".github/hooks/",
  ".claude/", "CLAUDE.md", ".grok/", ".grok", ".cursor/", ".cursorrules", ".cursorrules/", ".opencode/",
  ".codex", ".codex/", ".gemini/", "GEMINI.md/", ".windsurf/", ".kiro/", "link:.kiro", "link:.claude",
];
const tmpRoot = mkdtempSync(join(tmpdir(), "apm-targets-"));
const resolutions = [];
const maybe = <T>(f: () => T) => (rnd(3) === 0 ? f() : undefined);
for (let i = 0; i < 400; i++) {
  const root = join(tmpRoot, `p${i}`);
  mkdirSync(root, { recursive: true });
  const tree = Array.from({ length: rnd(4) }, () => pick(signalFiles));
  for (const entry of tree) {
    if (entry.startsWith("link:")) {
      // A symlink to a directory: lstat says it is not one.
      mkdirSync(join(root, "real"), { recursive: true });
      try { symlinkSync(join(root, "real"), join(root, entry.slice(5))); } catch {}
      continue;
    }
    const path = join(root, entry);
    try {
      if (entry.endsWith("/")) mkdirSync(path, { recursive: true });
      else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "x");
      }
    } catch {}
  }
  const slugs = () => Array.from({ length: rnd(4) }, () => pick(["claude-code", "cursor", "codex", "warp", "nope", "", "cursor"]));
  const input: Record<string, unknown> = {
    projectRoot: root,
    cliTarget: maybe(() => pick(["claude", "all", "claude,cursor", " , ", "", "vscode, kiro", "nope", "x-a-b", "claude-code,all", "vscode,all", "agent-skills, all"])),
    cliAll: maybe(() => pick([true, false])),
    cliHarness: maybe(() => pick(["claude-code", "cursor, codex", "", "nope", " "])),
    manifestHarnessTargets: maybe(slugs),
    preferenceHarnesses: maybe(slugs),
    fallbackHarnesses: maybe(slugs),
  };
  for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k];
  const resolved = run(() => targets.resolveCompileTargets(input as never));
  const preview = "ok" in resolved
    ? [false, true].map((includeAgentSkills) => targets.previewApmTargets(resolved.ok as never, { includeAgentSkills }))
    : null;
  resolutions.push({ tree, input: { ...input, projectRoot: undefined }, detected: targets.detectApmTargetSignals(root), resolved, preview });
}
rmSync(tmpRoot, { recursive: true, force: true });
writeFileSync(
  new URL("./fixtures/targets.json", import.meta.url),
  JSON.stringify({ mappings, singles, tokenDocs, resolutions }),
);
console.log(mappings.length, "mappings,", resolutions.length, "resolutions");
