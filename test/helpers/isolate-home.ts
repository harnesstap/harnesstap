/**
 * Test preload: run every test file against a throwaway HOME, and fail the run
 * if anything touches the real user's HarnessTap data directory.
 *
 * Bun keeps `os.homedir()` from process start, so code that needs the home
 * directory must read `process.env.HOME` (see `src/utils/home-root.ts`).
 */
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

const testRoot = resolve(mkdtempSync(join(tmpdir(), "ht-test-home-")));
const guarded = guardedDirs(testRoot);
const shallowBefore = new Map(guarded.map((dir) => [dir, snapshot(dir, false)]));
const deepBefore = new Map(guarded.map((dir) => [dir, snapshot(dir, true)]));

process.env.HOME = testRoot;
process.env.USERPROFILE = testRoot;
// Follow HOME (tests that point HOME elsewhere expect the data dir to move too).
delete process.env.HARNESSTAP_HOME;
process.env.HARNESSTAP_TEST_HOME_ROOT = testRoot;

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
  if (reported) return;
  for (const dir of guarded) {
    const changes = diff(deepBefore.get(dir) ?? new Map(), snapshot(dir, true));
    if (changes.length > 0) {
      reported = true;
      throw failure(changes, "detected at the end of the run");
    }
  }
  rmSync(testRoot, { recursive: true, force: true });
});

export const isolatedTestHome = testRoot;
export const guardedHarnesstapDirs = guarded;
export const realHarnesstapExists = guarded.some((dir) => existsSync(dir));
