// Records the npm `semver` package (the app's copy) on generated versions and ranges.
// Run from the repository root: node rust/node-semver-rs/tests/make-fixtures.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const semver = require("../../../node_modules/semver");

let seed = 0x5eed;
const rnd = (n) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return ((seed >>> 8) % n);
};
const pick = (a) => a[rnd(a.length)];

const nums = ["0", "1", "2", "3", "10", "01", "00", "9007199254740991", "9007199254740992", "99999999999999999999", "999999999999999999999999", "123456789012345678901234567890"];
const num = () => (rnd(5) ? pick(["0", "1", "2", "3", "10"]) : pick(nums));
const pres = ["alpha", "beta", "1", "0", "01", "rc-1", "x", "99999999999999999999", "9007199254740991", "9007199254740990", "a1", "1a", "-", "--x", "", "beta.2", "alpha.beta", "BETA", "ü"];
const builds = ["build", "001", "sha.abc", "", "x-y"];
const spaces = [" ", "  ", "\t", "\n", "\u00a0", "\u2003", "\ufeff", "\u0085", "\u3000", ""];
const pfx = ["", "", "", "v", "=", "v=", "= ", " v", "V", "vv"];
const xs = ["x", "X", "*"];

const version = () => {
  let s = (rnd(3) ? "" : pick(pfx)) + num() + "." + num() + "." + num();
  const r = rnd(14);
  if (r < 2) s = num() + "." + num();
  if (r === 2) s = num();
  if (rnd(3) === 0) s += (rnd(6) === 0 ? "" : "-") + pick(pres) + (rnd(3) === 0 ? "." + pick(pres) : "");
  if (rnd(4) === 0) s += "+" + pick(builds) + (rnd(3) === 0 ? "." + pick(builds) : "");
  if (rnd(10) === 0) s = pick(spaces) + s + pick(spaces);
  if (rnd(80) === 0) s = s + "x".repeat(250);
  if (rnd(25) === 0) s = pick(["", "latest", "garbage", "1.2.3.4", "a878bcad3958", "1.0.0-", "1.0.0+", "1..2", "-1.0.0", "1.2.3 "]);
  return s;
};

const partial = () => {
  const parts = [rnd(5) === 0 ? pick(xs) : pick(nums.slice(0, 7))];
  if (rnd(3)) parts.push(rnd(4) === 0 ? pick(xs) : pick(nums.slice(0, 7)));
  if (rnd(3) && parts.length === 2) parts.push(rnd(4) === 0 ? pick(xs) : pick(nums.slice(0, 9)));
  let s = pick(pfx) + parts.join(".");
  if (parts.length === 3 && rnd(4) === 0) s += "-" + pick(pres);
  if (rnd(8) === 0) s += "+" + pick(builds);
  return s;
};

const ops = ["", "", "=", ">", ">=", "<", "<=", "~", "~>", "^", "~ ", "^ ", "> ", ">= ", "< ", "=  ", ">=\t", "!", "==", "~^"];
const comparator = () => {
  const r = rnd(12);
  if (r === 0) return partial() + " - " + partial();
  if (r === 1) return pick(["*", "", "x", "latest", ">=0.0.0", ">=0.0.0-0", ">= 0.0.0", "<0.0.0-0", "<0.0.0", "||", "* || 1.2.3", "a878bcad3958", ">*", "<x", "<=*", ">=x", "=*"]);
  return pick(ops) + partial();
};
const range = () => {
  let parts = [];
  const n = 1 + rnd(3);
  for (let i = 0; i < n; i++) parts.push(comparator());
  let s = parts.join(pick([" ", " ", "  ", "\t", "\u00a0"]));
  if (rnd(4) === 0) s += pick([" || ", "||", " ||", "|| "]) + range();
  if (rnd(10) === 0) s = pick(spaces) + s + pick(spaces);
  return s;
};

const OPTS = [undefined, { includePrerelease: true }, { loose: true }, { loose: true, includePrerelease: true }];
const optName = (o) => (o === undefined ? "strict" : (o.loose ? "loose" : "") + (o.includePrerelease ? "incpr" : ""));
const run = (f) => {
  try {
    const v = f();
    return { ok: v === undefined ? null : v };
  } catch (e) {
    return { err: `${e.name}: ${e.message}` };
  }
};
const sv = (v) => (v == null ? null : { version: v.version, raw: v.raw, prerelease: v.prerelease, build: v.build });

const cases = [];
const add = (fn, args, opts, f) => cases.push({ fn, args, opts: optName(opts), ...run(f) });

for (let i = 0; i < 1500; i++) {
  const v = version();
  const o = pick(OPTS);
  add("parse", [v], o, () => sv(semver.parse(v, o)));
  add("valid", [v], o, () => semver.valid(v, o));
  add("prerelease", [v], o, () => semver.prerelease(v, o));
  add("coerce", [v], o, () => sv(semver.coerce(v, o)));
  add("major", [v], o, () => semver.major(v, o));
}
const named = ["1.2.3", "1.2.3-alpha", "1.2.3-alpha.1", "1.2.3-0", "1.2.4", "2.0.0", "0.0.1", "0.1.0", "0.0.0", "0.0.0-0", "1.11.0", "1.2.3+b", "1.2.3-beta.01", "10.0.0", "3.0.0-rc.1"];
for (let i = 0; i < 1200; i++) {
  const a = rnd(3) ? pick(named) : version();
  const b = rnd(3) ? pick(named) : version();
  const o = pick(OPTS);
  for (const fn of ["compare", "rcompare", "compareBuild", "eq", "gt", "gte", "lt", "lte"]) {
    add(fn, [a, b], o, () => semver[fn](a, b, o));
  }
}
for (let i = 0; i < 3000; i++) {
  const r = range();
  const o = pick(OPTS);
  add("validRange", [r], o, () => semver.validRange(r, o));
  for (let k = 0; k < 3; k++) {
    const v = rnd(2) ? pick(named) : version();
    add("satisfies", [v, r], o, () => semver.satisfies(v, r, o));
  }
  if (i % 3 === 0) add("minVersion", [r], o, () => sv(semver.minVersion(r, o)));
  if (i % 3 === 1) {
    const vs = Array.from({ length: 1 + rnd(6) }, () => (rnd(2) ? pick(named) : version()));
    add("maxSatisfying", [vs, r], o, () => semver.maxSatisfying(vs, r, o));
  }
}
for (let i = 0; i < 300; i++) {
  // Sorting calls the comparator in V8's TimSort order, so which invalid version throws first is
  // V8's; the app sorts versions it has already validated, and so do these cases.
  const vs = Array.from({ length: 1 + rnd(7) }, () => (rnd(4) ? pick(named) : version()));
  const valid = vs.filter((v) => semver.valid(v) !== null);
  add("rsort", [valid], undefined, () => semver.rsort([...valid]));
  add("sortRcompare", [valid], undefined, () => [...valid].sort(semver.rcompare));
}
writeFileSync(new URL("./fixtures/semver.json", import.meta.url), JSON.stringify(cases));
console.log(cases.length);
