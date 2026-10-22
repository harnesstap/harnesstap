/**
 * Test preload: run every test file against a throwaway HOME and temp dir,
 * fail the run if anything touches the real user's HarnessTap data directory,
 * and report HarnessTap temp dirs a run leaves in the real temp dir.
 *
 * Bun keeps `os.homedir()` from process start, so code that needs the home
 * directory must read `process.env.HOME` (see `src/utils/home-root.ts`).
 */
import { plugin } from "bun";
import { afterAll, afterEach } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, resolve, sep } from "node:path";
import { restoreEnv, snapshotEnv } from "./isolated-env.ts";

type Snapshot = Map<string, string>;

function realHomeCandidates(): string[] {
  const homes = new Set<string>();
  const add = (value: string | undefined) => {
    if (value && value.trim() !== "") homes.add(resolve(value));
  };
  add(process.env.HOME);
  add(process.env.USERPROFILE);
  add(homedir());
  try {
    add(userInfo().homedir);
  } catch {
    // No passwd entry (some containers); the env candidates still apply.
  }
  return [...homes];
}

function guardedDirs(testRoot: string): string[] {
  const dirs = new Set<string>();
  for (const home of realHomeCandidates()) {
    dirs.add(join(home, ".harnesstap"));
  }
  const configured = process.env.HARNESSTAP_HOME;
  if (configured && configured.trim() !== "") {
    dirs.add(resolve(configured));
  }
  return [...dirs].filter(
    (dir) => dir !== testRoot && !dir.startsWith(testRoot + sep),
  );
}

function entryKey(path: string): string | undefined {
  try {
    const stat = lstatSync(path);
    return `${stat.isDirectory() ? "d" : "f"}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return undefined;
  }
}

function snapshot(dir: string, deep: boolean): Snapshot {
  const out: Snapshot = new Map();
  const rootKey = entryKey(dir);
  if (rootKey === undefined) return out;
  out.set(dir, rootKey);
  const walk = (current: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(current, name);
      const key = entryKey(full);
      if (key === undefined) continue;
      out.set(full, key);
      if (deep && key.startsWith("d:") && depth < 8) walk(full, depth + 1);
    }
  };
  walk(dir, 0);
  return out;
}

function diff(before: Snapshot, after: Snapshot): string[] {
  const changed: string[] = [];
  for (const [path, key] of after) {
    const old = before.get(path);
    if (old === undefined) changed.push(`created ${path}`);
    else if (old !== key && !key.startsWith("d:")) changed.push(`modified ${path}`);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changed.push(`removed ${path}`);
  }
  return changed;
}

function failure(changes: string[], where: string): Error {
  const shown = changes.slice(0, 20).join("\n  ");
  return new Error(
    `A test touched the real HarnessTap home (${where}):\n  ${shown}\n` +
      "Tests run with a temporary HOME from test/helpers/isolate-home.ts. " +
      "Pass HOME/HARNESSTAP_HOME from the test environment (process.env) " +
      "instead of os.homedir() or a hard-coded path.",
  );
}

/** Temp dir names HarnessTap code and tests create. */
const TEMP_PREFIX = /^(ht-|harnesstap-)/;

function listTempEntries(dir: string): Set<string> {
  try {
    return new Set(readdirSync(dir).filter((name) => TEMP_PREFIX.test(name)));
  } catch {
    return new Set();
  }
}

/**
 * HarnessTap temp entries that appeared in `dir` during this run. Entries that
 * existed before the run, or that are older than it (another process), are
 * never reported and never touched.
 */
export function leakedTempEntries(
  dir: string,
  before: Set<string>,
  startedAtMs: number,
): string[] {
  const leaked: string[] = [];
  for (const name of listTempEntries(dir)) {
    if (before.has(name)) continue;
    try {
      if (lstatSync(join(dir, name)).mtimeMs + 1000 < startedAtMs) continue;
    } catch {
      continue;
    }
    leaked.push(join(dir, name));
  }
  return leaked.sort();
}

// Every temp dir a test (or a CLI subprocess it spawns) creates through
// os.tmpdir() lands under one per-run root, removed when the run ends, so
// individual tests do not each need a teardown for their mkdtemp dirs.
const realTmp = tmpdir();
const runStartedAtMs = Date.now();
const realTmpBefore = listTempEntries(realTmp);
const tmpRoot = resolve(mkdtempSync(join(realTmp, "ht-test-run-")));
realTmpBefore.add(tmpRoot.slice(tmpRoot.lastIndexOf(sep) + 1));
process.env.TMPDIR = tmpRoot;
process.env.TMP = tmpRoot;
process.env.TEMP = tmpRoot;

const testRoot = resolve(mkdtempSync(join(tmpdir(), "ht-test-home-")));
const guarded = guardedDirs(testRoot);
const shallowBefore = new Map(guarded.map((dir) => [dir, snapshot(dir, false)]));
const deepBefore = new Map(guarded.map((dir) => [dir, snapshot(dir, true)]));

process.env.HOME = testRoot;
process.env.USERPROFILE = testRoot;
// Follow HOME (tests that point HOME elsewhere expect the data dir to move too).
delete process.env.HARNESSTAP_HOME;
process.env.HARNESSTAP_TEST_HOME_ROOT = testRoot;

const envBaseline = snapshotEnv();
const envLeaks: string[] = [];
let currentTestFile: string | undefined;

function checkEnvAfterFile(): void {
  const drift = restoreEnv(envBaseline);
  if (drift.length > 0) {
    envLeaks.push(`${currentTestFile ?? "<unknown file>"}: ${drift.join(", ")}`);
  }
}

// All test files share one process, so a file that changes HOME (or the other
// isolated variables) without restoring it would leak into every later file.
// A test file's module loads after the previous file's afterAll hooks, so this
// is the point to put the baseline back and remember who leaked.
plugin({
  name: "harnesstap-test-env-guard",
  setup(build) {
    build.onLoad({ filter: /\.test\.[cm]?[jt]sx?$/ }, async (args) => {
      if (currentTestFile !== undefined) checkEnvAfterFile();
      currentTestFile = args.path;
      const ext = args.path.slice(args.path.lastIndexOf(".") + 1);
      const loader = ext.endsWith("tsx")
        ? "tsx"
        : ext.endsWith("ts")
          ? "ts"
          : ext.endsWith("jsx")
            ? "jsx"
            : "js";
      return { contents: await Bun.file(args.path).text(), loader };
    });
  },
});

let reported = false;

afterEach(() => {
  if (reported) return;
  for (const dir of guarded) {
    const changes = diff(shallowBefore.get(dir) ?? new Map(), snapshot(dir, false));
    if (changes.length > 0) {
      reported = true;
      throw failure(changes, "detected after this test");
    }
  }
});

afterAll(() => {
  checkEnvAfterFile();
  const envError =
    envLeaks.length > 0
      ? new Error(
          `Test files changed the isolated environment without restoring it:\n  ${envLeaks.join("\n  ")}\n` +
            "The preload restored it before the next file. Save and restore these " +
            "variables in the file's afterEach/afterAll.",
        )
      : undefined;
  if (reported) {
    if (envError) throw envError;
    return;
  }
  for (const dir of guarded) {
    const changes = diff(deepBefore.get(dir) ?? new Map(), snapshot(dir, true));
    if (changes.length > 0) {
      reported = true;
      throw envError ?? failure(changes, "detected at the end of the run");
    }
  }
  rmSync(testRoot, { recursive: true, force: true });
  rmSync(tmpRoot, { recursive: true, force: true });
  const leaked = leakedTempEntries(realTmp, realTmpBefore, runStartedAtMs);
  if (leaked.length > 0) {
    const message =
      `This test run left ${leaked.length} HarnessTap temp dir(s) in ${realTmp}:\n  ` +
      leaked.slice(0, 20).join("\n  ") +
      "\nCreate temp dirs with os.tmpdir() (redirected per run by " +
      "test/helpers/isolate-home.ts), not a hard-coded temp path.";
    // Locally another process may be creating ht-* dirs at the same time, so
    // only CI (one run per machine) treats a leak as a failure.
    if (process.env.CI && !envError) throw new Error(message);
    console.warn(`warning: ${message}`);
  }
  if (envError) throw envError;
});

export const isolatedTestHome = testRoot;
export const isolatedTempRoot = tmpRoot;
export const realTempDir = realTmp;
export const guardedHarnesstapDirs = guarded;
export const realHarnesstapExists = guarded.some((dir) => existsSync(dir));
