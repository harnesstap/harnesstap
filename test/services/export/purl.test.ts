import { describe, expect, it } from "bun:test";
import { buildPurl, scrubUrl } from "../../../src/services/export/purl.ts";
import type { LockEntry } from "../../../src/services/lockfile.ts";

function entry(partial: Partial<LockEntry> & Pick<LockEntry, "name" | "source">): LockEntry {
  return {
    version: "1.0.0",
    integrity: "",
    depth: 1,
    path: [],
    ...partial,
  };
}

describe("SBOM purl + URL scrub", () => {
  it("builds github purls from recorded git identity", () => {
    expect(
      buildPurl(entry({
        name: "git-utils",
        source: "git",
        repo_url: "github.com/acme/git-utils",
        resolved_commit: "def789",
      })),
    ).toBe("pkg:github/acme/git-utils@def789");
  });

  it("treats host-less git owner/repo as github", () => {
    expect(
      buildPurl(entry({
        name: "ship",
        source: "git",
        repo_url: "acme/ship",
        resolved_commit: "abc123",
      })),
    ).toBe("pkg:github/acme/ship@abc123");
  });

  it("uses generic purl for unknown git hosts", () => {
    expect(
      buildPurl(entry({
        name: "mirror",
        source: "git",
        repo_url: "git.internal.example/team/mirror",
        resolved_commit: "fff000",
      })),
    ).toBe("pkg:generic/mirror@fff000");
  });

  it("uses generic content-hash identity for local primitives", () => {
    expect(
      buildPurl(entry({
        name: "local-helper",
        source: "local",
        content_hash: "sha256:aaa111",
      })),
    ).toBe("pkg:generic/local-helper@sha256:aaa111");
  });

  it("uses a stable HT catalog purl instead of fake OCI", () => {
    expect(
      buildPurl(entry({
        name: "foundation",
        source: "catalog",
        version: "2.0.0",
        integrity: "sha256:bbbb",
      })),
    ).toBe("pkg:generic/harnesstap/foundation@sha256:bbbb");
  });

  it("scrubs userinfo and query tokens from recorded URLs", () => {
    expect(scrubUrl("https://user:token@github.com/acme/secret?token=abc&sig=1")).toBe(
      "https://github.com/acme/secret",
    );
    expect(
      buildPurl(entry({
        name: "secret",
        source: "git",
        repo_url: "https://user:token@github.com/acme/secret?token=abc",
        resolved_commit: "c0ffee",
      })),
    ).toBe("pkg:github/acme/secret@c0ffee");
  });
});
