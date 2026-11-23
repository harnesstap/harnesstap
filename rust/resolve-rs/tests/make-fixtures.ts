// Records plugin-constraints.ts and version-mediation.ts, as fixtures for tests/fixtures.rs.
// Run from the repository root: bun rust/resolve-rs/tests/make-fixtures.ts
import { writeFileSync } from "node:fs";
import {
  parseVersionConstraint,
  satisfiesConstraint,
} from "../../../src/services/plugin-constraints.ts";
import {
  intersectConstraints,
  normalizeConstraint,
  selectVersion,
} from "../../../src/services/resolve/version-mediation.ts";
import { UnsatisfiableConstraintError } from "../../../src/services/resolve/types.ts";

let seed = 0xc0ffee;
const rnd = (n: number) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
};
const pick = <T>(a: readonly T[]): T => a[rnd(a.length)]!;

const versions = [
  "1.0.0", "1.2.3", "1.2.4", "1.11.0", "2.0.0", "2.1.0", "3.0.0-beta.1", "3.0.0", "0.1.0", "0.0.1",
  "1.2.3-alpha", "1.2.3-0", "v1.2.3", " 1.2.3 ", "1.2.3+build", "10.0.0",
  "unknown", "a878bcad3958", "main", "", "latest", "1.2", "abc1234",
];
const constraints = [
  "", "*", "latest", " latest ", "1.2.3", "=1.2.3", "v1.2.3", "^1.0.0", "~1.2.0", ">=1.0.0 <2.0.0",
  "1.x", "2", ">2.0.0", "<=1.2.3", "^3.0.0-beta.0", "1.0.0 - 2.0.0", "^1 || ^2", ">=3", "0.x",
  "a878bcad3958", "A878BCAD", "abc1234", "abc12", "main", "not a range", "1.2.3.4", "^0.1.0",
  " ^1.2.0 ", "\u00a0~2.0", "x", "1.2.3-alpha", "=v2.0.0",
];
const names = ["dep", "team-standards", "lint"];

const run = (f: () => unknown) => {
  try {
    return { ok: f() ?? null };
  } catch (e) {
    if (e instanceof UnsatisfiableConstraintError) {
      return {
        err: {
          name: e.name,
          message: e.message,
          pluginName: e.pluginName,
          requirers: e.requirers,
          available: e.available,
          reason: e.reason,
          actions: e.actions,
          hints: e.hints,
        },
      };
    }
    return { err: { name: (e as Error).name, message: (e as Error).message } };
  }
};

const cases: unknown[] = [];
const add = (fn: string, args: unknown[], f: () => unknown) => cases.push({ fn, args, ...run(f) });

for (const c of constraints) {
  add("parseVersionConstraint", [c], () => parseVersionConstraint(c));
  add("normalizeConstraint", [c], () => normalizeConstraint(c));
  for (const v of versions) add("satisfiesConstraint", [c, v], () => satisfiesConstraint(c, v));
}
for (let i = 0; i < 300; i++) {
  const list = Array.from({ length: rnd(4) }, () => pick(constraints));
  add("intersectConstraints", [list], () => intersectConstraints(list));
}
const sourceKinds = [undefined, undefined, "local", "marketplace", "git", "catalog"] as const;
const refs = [undefined, undefined, "", "  ", "dep@market", "plugin:dep@market", " https://github.com/a/dep "];
for (let i = 0; i < 1500; i++) {
  const name = pick(names);
  const rootName = pick(["root", "my-profile"]);
  const available = Array.from({ length: rnd(5) }, () => pick(versions));
  const constraintList = Array.from({ length: rnd(4) }, () => {
    const depth = 1 + rnd(3);
    const path = [rootName, ...Array.from({ length: depth - 1 }, (_, k) => `p${k}@1.0.0`)];
    const record: Record<string, unknown> = {
      constraint: rnd(3) ? pick(constraints.slice(0, 19)) : pick(constraints),
      path,
      requirer: path[path.length - 1],
    };
    if (rnd(6) === 0) record.declared = pick(["main", "v1.2.3", ""]);
    return record;
  });
  const input: Record<string, unknown> = { name, available, constraints: constraintList, rootName };
  if (rnd(6) === 0) input.rootOverride = rnd(2) ? pick(available.length ? available : versions) : pick(versions);
  const sk = pick(sourceKinds);
  if (sk) input.sourceKind = sk;
  const ref = pick(refs);
  if (ref !== undefined) input.pluginRef = ref;
  add("selectVersion", [input], () => selectVersion(input as Parameters<typeof selectVersion>[0]));
}
writeFileSync(new URL("./fixtures/resolve.json", import.meta.url), JSON.stringify(cases));
console.log(cases.length);
