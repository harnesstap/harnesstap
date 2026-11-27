// Records apm-git-resolve.ts for tests/git_fixtures.rs.
// Run from the repository root with no GitHub credentials in reach:
//   env -i HOME=$(mktemp -d) PATH=/usr/bin:/bin ~/.bun/bin/bun rust/apm-rs/tests/make-git-fixtures.ts
import { setSystemTime, spyOn } from "bun:test";
import { writeFileSync } from "node:fs";
import * as creds from "../../../src/services/github-credentials.ts";
import * as git from "../../../src/services/apm-git-resolve.ts";

spyOn(creds, "resolveGithubAccessToken").mockReturnValue({ token: null, source: "none" } as never);
setSystemTime(new Date("2026-03-04T05:06:07.089Z"));

let seed = 0x91e7;
const rnd = (n: number) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
};
const pick = <T>(a: readonly T[]): T => a[rnd(a.length)]!;
const err = (e: unknown) => ({ name: (e as Error).name, message: (e as Error).message });

// Origins
const urlPieces = [
  "git@", "ssh://git@", "https://", "http://", "git+", "file://", "file:///", "git://", "", "GitHub.COM", "github.com",
  "gist.github.com", "h.example", ":443", ":22", ":80", ":9418", ":8080", ":", "/", "//", "o", "r", ".git", ".GIT", "/",
  " ", "\t", "\n", "[::1]", "user@", "%41", "é", "?q=1", "#frag", "\\", "..", "www.github.com", "foo:", "x.git/",
];
const fixedUrls = [
  "git@github.com:o/r.git", "git@GitHub.com:O/R.git/", "ssh://git@h.example:22/o/r.git", "ssh://git@H:2222/o/r",
  "https://github.com/o/r.git", "https://GITHUB.com:443/o/r/", "http://h:80/o/r.GIT", "git://h:9418/o/r",
  "file:///tmp/r.git", "file://host/tmp/r.git", "foo:bar", "git+https://h/o/r.git", "  https://h/o/r  ",
  "not a url", "https://[::1]:8443/o/r", "https://h:443:22/o", "git@h:", "git@:x", "ssh://git@/x", "https://h/a b",
  "https://h/o/r.git?x#y", "github.com:o/r", "user@github.com:o/r.git", "ssh://user@gist.github.com/abc",
  "https://user:pw@h/o/r", "git@h:o/r\nx", "https://h.example/%7Euser/r.git", "HTTPS://H/O", "https:///o/r",
];
const origins = [...fixedUrls];
for (let i = 0; i < 1500; i++) {
  let s = "";
  for (let j = 0, n = 1 + rnd(7); j < n; j++) s += pick(urlPieces);
  origins.push(s);
}
const urls = origins.map((origin) => ({
  origin,
  canonical: git.canonicalApmRepoUrl(origin),
  auth: [null, "", "tok"].map((t) => creds.githubHttpsRemoteForAuth(origin, t)),
}));

// Refs and paths
const refs = [
  "", " ", "main", "v1.2.3", "1.2.3", "^1.2.0", "~1", ">=1 <2", "1.x", "*", "1.2.3 - 2", "1 || 2", "latest",
  "0123456789abcdef0123456789ABCDEF01234567", "0123456789abcdef", "x", "feature/x", "=1.0.0", "v1.2", "1.2.3-beta.1",
  "^not", "1 ||2", " ^1 ", "v1.2.3\n",
];
const classify = [undefined, ...refs].map((r) => ({ ref: r ?? null, kind: git.classifyApmGitRef(r) }));
const paths = [
  "", ".", "./", "././", "./.", "/abs", "a/../b", "..", "a\\..\\b", "skills/x", "./skills", ".//x", "a//b", "a/./b",
  "C:\\x", "x.prompt.md", "X.Agent.MD", "dir\\a.instructions.md", "a.md", ".\\.", ".\\", "a/.", "./a/", "...",
];
const virtualPaths = paths.map((p) => {
  let safe: unknown = null;
  try { git.assertSafeApmVirtualPath(p); } catch (e) { safe = err(e); }
  return { path: p, safe, virtualFile: git.isApmVirtualFilePath(p) };
});

// Tag selection
const tagPool = [
  "v1.0.0", "1.0.0", "v1.2.0", "refs/tags/v1.2.0", "v1.2.0-rc.1", "v2.0.0", "2.0.0", "vv1.0.0", "v1", "release-1",
  "v1.10.0", "v1.9.9", "1.2.0+build", "v1.2.0+b", "V1.0.0", " v1.0.0", "v01.0.0", "0.0.1",
];
const ranges = ["^1.0.0", "~1.2", ">=1", "*", "1.x", "^2", "<1", "bogus", "", ">=1.2.0-rc.0", "1.2.0 - 2.0.0"];
const tagSelections = [];
for (let i = 0; i < 400; i++) {
  const range = pick(ranges);
  const tags = Array.from({ length: rnd(8) }, () => pick(tagPool));
  tagSelections.push({ range, tags, selected: git.selectSemverTag(range, tags) ?? null });
}

// resolveApmGitDependency against a fake git
const sha = () => Array.from({ length: 40 }, () => "0123456789abcdef"[rnd(16)]).join("");
const remoteNames = [
  "HEAD", "refs/heads/main", "refs/heads/dev", "refs/tags/v1.0.0", "refs/tags/v1.2.0", "refs/tags/v1.2.0^{}",
  "refs/tags/1.3.0", "refs/tags/v2.0.0", "refs/tags/v2.0.0^{}", "refs/tags/main", "refs/heads/feature/x",
  "refs/tags/release", "refs/remotes/origin/main", "refs/tags/v1.2.0-rc.1",
];
const junkLines = ["", "garbage", "\tHEAD", "abc\trefs/heads/x", "  \n", "0123\tHEAD"];
const remoteTable = () => {
  const lines: string[] = [];
  for (let i = 0, n = rnd(11); i < n; i++) {
    const s = rnd(6) === 0 ? sha().toUpperCase() : sha();
    lines.push(rnd(8) === 0 ? pick(junkLines) : `${rnd(5) === 0 ? " " : ""}${s}\t${pick(remoteNames)}${rnd(6) === 0 ? "\r" : ""}`);
  }
  return lines;
};
const matchesPattern = (line: string, pattern: string) => {
  const name = line.split("\t")[1]?.trim().replace(/\^\{\}$/, "") ?? "";
  return name === pattern || name.endsWith(`/${pattern}`);
};
const origins2 = ["https://h.example/o/r.git", "git@github.com:o/r.git", "git+https://h.example/o/r", "file:///tmp/r.git"];
const deps2 = [];
const resolutions = [];
for (let i = 0; i < 1500; i++) {
  const originRef = pick(origins2);
  const refChoice = rnd(4);
  const dependency: Record<string, unknown> = {
    raw: "x",
    sourceKind: rnd(15) === 0 ? pick(["catalog", "local", "marketplace"]) : "git",
    name: pick(["r", "other"]),
    originRef,
    applySelector: "x",
  };
  const refValue = () => pick([...refs.slice(0, 13), "release", "dev", "0123456789abcdef0123456789abcdef01234567"]);
  if (refChoice === 1 || refChoice === 3) dependency.ref = refValue();
  if (refChoice === 2 || refChoice === 3) dependency.versionConstraint = refValue();
  if (rnd(5) === 0) dependency.path = pick(["skills/x", "skills/x", "", "../x", "./.", "a.prompt.md"]);
  const lock = rnd(4) === 0 ? undefined : Array.from({ length: 1 + rnd(3) }, () => {
    const entry: Record<string, unknown> = { name: pick(["r", "other"]) };
    if (rnd(3)) entry.repo_url = pick([git.canonicalApmRepoUrl(originRef), git.canonicalApmRepoUrl(originRef), "", "other/x"]);
    if (rnd(4)) entry.resolved_commit = pick([sha(), sha(), sha().toUpperCase(), "", "abc"]);
    if (rnd(2)) entry.resolved_ref = pick(["", refValue()]);
    if (rnd(2)) entry.constraint = pick(["", refValue(), (dependency.ref ?? dependency.versionConstraint ?? "") as string]);
    if (rnd(3) === 0) entry.resolved_tag = pick(["", "v1.2.0"]);
    if (rnd(4) === 0) entry.virtual_path = pick(["skills/x", ""]);
    return entry;
  });
  const update = rnd(5) === 0;
  const table = remoteTable();
  const failAt = rnd(5) === 0 ? rnd(3) : -1;
  const calls: Array<{ args: string[]; stdout: string; stderr: string; exitCode: number }> = [];
  const runCommand = (command: string, args: string[]) => {
    if (command !== "git") throw new Error(`unexpected ${command}`);
    const rest = [...args];
    while (rest[0] === "-c") {
      if (rest[1] !== "protocol.file.allow=always") throw new Error(`credential leak? ${rest[1]}`);
      rest.splice(0, 2);
    }
    let result;
    if (calls.length === failAt) {
      result = { stdout: "", stderr: pick(["", "  fatal: nope \n"]), exitCode: 128 };
    } else if (rest[1] === "--tags") {
      result = { stdout: table.filter((l) => l.includes("refs/tags/") || rnd(4) === 0).join("\n"), stderr: "", exitCode: 0 };
    } else {
      const patterns = rest.slice(2);
      result = { stdout: table.filter((l) => patterns.some((p) => matchesPattern(l, p)) || rnd(5) === 0).join("\n"), stderr: "", exitCode: 0 };
    }
    calls.push({ args: rest, ...result });
    return result;
  };
  let outcome;
  try {
    outcome = { ok: await git.resolveApmGitDependency(dependency as never, { update, lock: lock ? { plugins: lock } as never : undefined, runCommand }) };
  } catch (e) {
    outcome = { err: err(e) };
  }
  resolutions.push({ dependency, lock: lock ?? null, update, calls, ...outcome });
}
void deps2;

writeFileSync(
  new URL("./fixtures/git.json", import.meta.url),
  JSON.stringify({ urls, classify, virtualPaths, tagSelections, resolutions }),
);
const kinds: Record<string, number> = {};
for (const r of resolutions) {
  const k = "ok" in r ? (r.ok.replayed ? "replayed" : "resolved") : r.err.message.split(" ").slice(0, 3).join(" ");
  kinds[k] = (kinds[k] ?? 0) + 1;
}
console.log(urls.length, "urls,", resolutions.length, "resolutions", kinds);
