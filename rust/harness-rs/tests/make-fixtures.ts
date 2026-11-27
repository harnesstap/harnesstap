// Records the original's harness selection, platform detection and path-keyed project
// identity, as fixtures for tests/fixtures.rs.
// Run from the repository root: bun rust/harness-rs/tests/make-fixtures.ts
//
// Trees are built under a fixed folder; paths in results are written with that folder
// (and its real path, lowercased or not) as `$BASE`, ULIDs as `<id>` and times as `<ts>`.
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { closeDb } from "../../../src/db/connection.ts";
import { initializeSchema } from "../../../src/db/schema.ts";
import { getDb } from "../../../src/db/connection.ts";
import { getAllPlatforms } from "../../../src/platforms/registry.ts";
import { resolveHarnessSelection } from "../../../src/services/harness-config.ts";
import { parseHarnessList } from "../../../src/cli/handlers/parse-flags.ts";
import { detectPlatforms } from "../../../src/services/scanner.ts";
import {
  ensureProjectForRoot,
  findProjectForRoot,
  normalizeProjectPath,
  pathProjectId,
  resolveProjectIdentity,
} from "../../../src/services/project-identity.ts";

const BASE = "/tmp/ht-harness-fixture";
const here = dirname(new URL(import.meta.url).pathname);
type Entry = { path: string; kind: "dir" | "file" | "symlink"; target?: string };

rmSync(BASE, { recursive: true, force: true });
mkdirSync(BASE, { recursive: true });
const realBase = realpathSync(BASE);
function norm<T>(value: T): T {
  let text = JSON.stringify(value ?? null);
  for (const from of [realBase.toLowerCase(), realBase, BASE]) text = text.split(from).join("$BASE");
  text = text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<ts>").replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, "<id>");
  return JSON.parse(text);
}
function build(root: string, entries: Entry[]): void {
  mkdirSync(root, { recursive: true });
  for (const e of entries) {
    const full = join(root, e.path);
    mkdirSync(dirname(full), { recursive: true });
    if (e.kind === "dir") mkdirSync(full, { recursive: true });
    else if (e.kind === "file") writeFileSync(full, "x");
    else symlinkSync(e.target ?? "", full);
  }
}

// 1. resolveHarnessSelection, non-interactive, over every combination of the pools.
const selection: unknown[] = [];
const pools = {
  harnesses: [undefined, [], ["codex"], ["codex", "claude-code", "codex"], ["", "cursor"], ["nope"], ["nope", "x", "codex"], ["constructor"], ["Codex"]],
  main: [undefined, "", "cursor", "bad"],
  aliases: [undefined, [], ["codex", "cursor"], ["x"]],
  current: [undefined, [], ["warp", "warp"], ["gone"]],
  detected: [[], ["cursor"], ["cursor", "codex", "cursor"], ["", "q"]],
};
for (const harnesses of pools.harnesses)
  for (const main of pools.main)
    for (const aliases of pools.aliases)
      for (const current of pools.current)
        for (const detected of pools.detected) {
          const input = { harnesses, main, aliases, current, detected };
          try {
            const out = await resolveHarnessSelection({
              ...input,
              current: current ? { registered_harnesses: current } : undefined,
              nonInteractive: true,
            });
            selection.push({ input, ok: out.registered_harnesses });
          } catch (error) {
            selection.push({ input, error: (error as Error).message });
          }
        }

// 2. parseHarnessList
const lists = [null, "", ",", " a , b ,, c ", "a,b", "\u00a0x\u00a0", "\ufeffy,", "x\u2028", "日本語,é", "codex,claude-code,codex"].map(
  (value) => ({ value, out: parseHarnessList(value ?? undefined) ?? null }),
);

// 3. detectPlatforms over generated trees
const configured = new Set<string>();
for (const p of getAllPlatforms()) {
  for (const [key, value] of Object.entries(p.projectPaths)) {
    if (key !== "pathAlternates" && typeof value === "string" && value) configured.add(value);
  }
  for (const alts of Object.values(p.projectPaths.pathAlternates ?? {})) for (const a of alts ?? []) configured.add(a);
  for (const d of p.detectionPaths?.project ?? []) configured.add(d.replace(/^~\//, ""));
}
const entryFor = (path: string): Entry => ({ path: path.replace(/\/+$/, ""), kind: path.endsWith("/") ? "dir" : "file" });
const trees: Entry[][] = [[]];
const paths = [...configured].sort();
for (const path of paths) {
  trees.push([entryFor(path)]);
  // the wrong kind: a file where a folder is configured, or the reverse
  trees.push([{ path: path.replace(/\/+$/, ""), kind: path.endsWith("/") ? "file" : "dir" }]);
  // another case, which macOS still finds
  const upper = path.replace(/[a-z]/, (c) => c.toUpperCase());
  if (upper !== path) trees.push([entryFor(upper)]);
}
trees.push([{ path: "AGENTS.md", kind: "symlink", target: "CLAUDE.md" }, { path: "CLAUDE.md", kind: "file" }]);
trees.push([{ path: "AGENTS.md", kind: "symlink", target: "missing.md" }]);
trees.push([{ path: "agents.md", kind: "file" }]);
let seed = 7;
const rand = (n: number) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};
for (let i = 0; i < 120; i++) {
  const picked = new Map<string, Entry>();
  for (let k = 0; k < 2 + rand(4); k++) {
    const e = entryFor(paths[rand(paths.length)] as string);
    if (![...picked.keys()].some((p) => p.startsWith(`${e.path}/`) || e.path.startsWith(`${p}/`))) picked.set(e.path, e);
  }
  trees.push([...picked.values()]);
}
const detect = trees.map((entries, i) => {
  const root = join(BASE, "detect", String(i));
  build(root, entries);
  return { entries, detected: detectPlatforms(root) };
});

// 4. Project identity: paths relative to $BASE/id, which is the working folder.
const idRoot = join(BASE, "id");
build(idRoot, [
  { path: "proj", kind: "dir" },
  { path: "Mixed Case/inner", kind: "dir" },
  { path: "file.txt", kind: "file" },
  { path: "link", kind: "symlink", target: "proj" },
  { path: "dangling", kind: "symlink", target: "nowhere" },
  { path: "repo-origin", kind: "dir" },
  { path: "repo-none", kind: "dir" },
  { path: "repo-blank", kind: "dir" },
]);
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd: join(idRoot, cwd), stdio: "ignore" });
git("repo-origin", "init", "-q");
git("repo-origin", "remote", "add", "origin", "https://github.com/org/repo.git");
git("repo-none", "init", "-q");
git("repo-blank", "init", "-q");
git("repo-blank", "config", "remote.origin.url", " ");
process.chdir(idRoot);
const idPaths = [".", "", "proj", "proj/", "./proj//", "Mixed Case", "Mixed Case/inner/..", "file.txt", "link", "dangling", "missing/sub", "..", "/", "repo-origin", "repo-none", "repo-blank", "repo-origin/sub"];
const identity = idPaths.map((path) => {
  const id = resolveProjectIdentity(path);
  return norm({
    path,
    normalized: normalizeProjectPath(path),
    pathId: pathProjectId(path),
    identity: id.kind === "path" ? { kind: "path", root: id.root, localId: id.localId, name: id.name } : { kind: "origin" },
  });
});

// 5. find and ensure on a fresh database
process.env.HARNESSTAP_HOME = join(BASE, "db");
initializeSchema(getDb());
const projects: unknown[] = [];
for (const [op, path] of [
  ["find", "proj"], ["ensure", "proj"], ["find", "proj/"], ["ensure", "link"], ["ensure", "missing/sub"],
  ["find", "missing/sub"], ["ensure", "/"], ["find", "repo-none"], ["ensure", "repo-none"], ["find", "repo-none"],
] as const) {
  const id = resolveProjectIdentity(path);
  const out = op === "find" ? findProjectForRoot(path, id) : ensureProjectForRoot(path, id);
  projects.push(norm({ op, path, out: out ?? null }));
}
closeDb();

const platform = process.platform;
writeFileSync(
  join(here, "fixtures", "harness.json"),
  `${JSON.stringify({ platform, selection, lists, detect, identity, projects }, null, 1)}\n`,
);
rmSync(BASE, { recursive: true, force: true });
console.log(`${selection.length} selections, ${lists.length} lists, ${detect.length} trees, ${identity.length} identities, ${projects.length} project calls`);
