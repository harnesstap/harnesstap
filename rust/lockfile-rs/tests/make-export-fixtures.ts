// Records src/services/export/ (sbom.ts, purl.ts, license.ts, timestamp.ts) as fixtures for
// tests/export.rs: lockfiles read with readLockfile, exported in both formats with
// timestamps resolved from --timestamp, SOURCE_DATE_EPOCH and generated_at, plus
// classifyDeclaredLicense and parseSbomFormat on their own.
// Run from the repository root: bun rust/lockfile-rs/tests/make-export-fixtures.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import "../../../src/models/plugin-model.ts";
import { readLockfile } from "../../../src/services/lockfile.ts";
import { exportSbom, parseSbomFormat } from "../../../src/services/export/sbom.ts";
import { classifyDeclaredLicense } from "../../../src/services/export/license.ts";
import { resolveExportTimestamp } from "../../../src/services/export/timestamp.ts";

let seed = 0x5b0;
const rnd = (n: number) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
};
const pick = <T>(a: readonly T[]): T => a[rnd(a.length)]!;
const maybe = <T>(a: readonly T[]): T | undefined => (rnd(3) === 0 ? undefined : pick(a));

const run = (f: () => unknown) => {
  try {
    return { ok: f() };
  } catch (e) {
    return { err: { name: (e as Error).name, message: (e as Error).message } };
  }
};

const hex = "0123456789abcdefABCDEF0123456789abcdef0123456789abcdef0123456789";
const names = ["", "pkg", "a b", "ünï", "x/y", "@scope/name", "Tool~1", "100%"];
const versions = ["", "1.0.0", "v2", "1.0.0+build", "ß"];
const sources = ["local", "git", "catalog", "marketplace", "registry", "other"];
const urls = [
  "", "https://github.com/Acme/Repo.git", "https://user:tok@github.com/a/b?x=1#frag",
  "https://github.com/a/b?", "https://:pw@gitlab.com/g/s/p.GIT/", "git@github.com:Acme/Repo.git",
  "git@GitLab.com:a/b.git?x=1", "ssh://git@bitbucket.org/a/b", "ssh://git@host:22/a/b?q",
  "file:///tmp/repo", "file:///", "acme/repo", "repo", "https://example.com/a/b/c/",
  "http://localhost:8080/x/y.git", "foo://Host/x/Y", "https://[::1]/a/b", "github.com/a/b",
  "https://github.com/a%20b/c d", "user@host.com?q=1", "not a url", "https://github.com",
  "c:/a/b", "https://GitHub.com:443/Owner/Repo#", "git+https://github.com/o/r.git", "mailto:x@y",
];
const commits = ["", "abc123", "0123456789abcdef0123456789abcdef01234567"];
const hashes = ["", `sha256:${hex}`, hex.toLowerCase(), `SHA256:${hex}`, "sha256:short", "md5:x", `sha256:${hex}0`];
const licenses = [
  "", "MIT", " mit ", "Apache-2.0 OR MIT", "(MIT AND BSD-3-Clause)", "GPL-2.0+ WITH Classpath-exception-2.0",
  "GPL-2.0 with Foo", "MIT and", "UNLICENSED", "unlicensed", "SEE LICENSE IN LICENSE.md", "LicenseRef-Custom",
  "DocumentRef-x:LicenseRef-y", "Proprietary", "MIT OR (Apache-2.0", "+", "MIT\u00a0OR\u00a0ISC", "and MIT",
  "(MIT)", "()", "MIT or ISC", "MIT OR ISC OR", "( MIT ) WITH LLVM-exception", "Apache-2.0 WITH",
  "MIT WITH LLVM-exception", "Zlib AND (ZPL-2.1 OR MPL-2.0+)", "mit OR isc", "GPL-3.0-or-later+",
  "WITH", "AND", ")", "MIT)", "LicenseRef-", "ß", "MIT\tOR\nISC",
];

function entry(): Record<string, unknown> {
  const e: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    if (v !== undefined) e[k] = v;
  };
  set("name", maybe(names));
  set("version", maybe(versions));
  set("source", maybe(sources));
  set("repo_url", maybe(urls));
  set("resolved_commit", maybe(commits));
  set("content_hash", maybe(hashes));
  set("integrity", maybe(hashes));
  set("declared_license", maybe(licenses));
  return e;
}

const timestamps = [
  undefined, "2024-06-01T00:00:00+00:00", "2024-06-01T00:00:00Z", " 2024-06-01T05:30:00+05:30 ",
  "2024-06-01", "2024-06-01T00:00", "garbage", "", "2024-02-29T23:59:59.999-00:30",
  "1999-12-31T23:59:59-12:00", "0000-01-01T00:00:00+00:00", "9999-12-31T23:59:59-23:59",
  "2024-06-01T00:00+01:00", "2023-02-29T00:00:00Z", "2024-13-01T00:00:00Z",
];
const epochs = [undefined, "", "0", "1700000000", "1.5", "-1", "abc", " 42 ", "0x10", "1e3", "9e15", "8640000000000", "253402300800"];
const generated = [undefined, "", "  2024-01-01T00:00:00Z  ", "yesterday"];

const dir = mkdtempSync(join(tmpdir(), "lock-export-"));
const exports = [];
for (let i = 0; i < 600; i++) {
  const doc: Record<string, unknown> = { lockfile_version: pick(["1", "1", "1", "2", "9"]) };
  const g = pick(generated);
  if (g !== undefined) doc.generated_at = g;
  const plugins = Array.from({ length: rnd(5) }, entry);
  doc[rnd(6) === 0 ? "dependencies" : "plugins"] = plugins;
  const yaml = rnd(40) === 0 ? "- not a mapping\n" : stringify(doc);
  const timestamp = pick(timestamps);
  const epoch = pick(epochs);
  const format = pick(["cyclonedx", "spdx", "SPDX", "CycloneDX"]);
  writeFileSync(join(dir, "apm.lock.yaml"), yaml);
  const result = run(() => {
    const lock = readLockfile(dir)!;
    const ts = resolveExportTimestamp(timestamp, lock.resolved_at, epoch);
    return exportSbom(lock, parseSbomFormat(format), ts);
  });
  exports.push({ yaml, timestamp, epoch, format, ...result });
}
rmSync(dir, { recursive: true, force: true });

const classify = licenses.map((value) => ({ value, ...run(() => classifyDeclaredLicense(value)) }));
const formats = ["cyclonedx", "spdx", "SPDX", "", "xml", "Spdx ", undefined].map((value) => ({
  value,
  ...run(() => parseSbomFormat(value)),
}));

await Bun.write(
  join(import.meta.dir, "fixtures", "export.json"),
  `${JSON.stringify({ exports, classify, formats }, null, 1)}\n`,
);
console.log(`${exports.length} exports, ${classify.length} licenses, ${formats.length} formats`);
