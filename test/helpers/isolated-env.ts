/**
 * Environment variables the test preload (test/helpers/isolate-home.ts) owns.
 * A test file that changes one must put it back before the file ends.
 */
export const ISOLATED_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HARNESSTAP_HOME",
  "HARNESSTAP_TEST_HOME_ROOT",
  "TMPDIR",
  "TMP",
  "TEMP",
] as const;

export type EnvSnapshot = Record<string, string | undefined>;

export function snapshotEnv(keys: readonly string[] = ISOLATED_ENV_KEYS): EnvSnapshot {
  const out: EnvSnapshot = {};
  for (const key of keys) out[key] = process.env[key];
  return out;
}

/** Puts `baseline` back and returns a description of each key that had drifted. */
export function restoreEnv(baseline: EnvSnapshot): string[] {
  const drift: string[] = [];
  for (const key of Object.keys(baseline)) {
    const want = baseline[key];
    const have = process.env[key];
    if (have === want) continue;
    drift.push(`${key}=${have ?? "<unset>"} (expected ${want ?? "<unset>"})`);
    if (want === undefined) delete process.env[key];
    else process.env[key] = want;
  }
  return drift;
}

/**
 * Saves the isolated variables now; call `restore()` in afterEach/afterAll.
 * Use it in any test that points HOME or HARNESSTAP_HOME at its own dir.
 */
export function saveIsolatedEnv(): { restore: () => void } {
  const saved = snapshotEnv();
  return { restore: () => void restoreEnv(saved) };
}
