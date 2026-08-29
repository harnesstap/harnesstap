import { describe, expect, it } from "bun:test";
import { exportSbom } from "../../../src/services/export/sbom.ts";
import { resolveExportTimestamp } from "../../../src/services/export/timestamp.ts";
import type { LockEntry, Lockfile } from "../../../src/services/lockfile.ts";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function plugin(partial: Partial<LockEntry> & Pick<LockEntry, "name" | "source">): LockEntry {
  return {
    version: "1.0.0",
    integrity: HASH_A,
    depth: 1,
    path: ["root", partial.name],
    content_hash: HASH_A,
    ...partial,
  };
}

function lock(plugins: LockEntry[]): Lockfile {
  return {
    root: "demo",
    resolved_at: "2024-06-01T00:00:00+00:00",
    resource_map_hash: HASH_B,
    plugins,
  };
}

describe("SBOM export", () => {
  const sample = lock([
    plugin({
      name: "zeta",
      source: "local",
      content_hash: HASH_B,
      integrity: HASH_B,
    }),
    plugin({
      name: "git-utils",
      source: "git",
      repo_url: "github.com/acme/git-utils",
      resolved_commit: "def789ghi012",
      declared_license: "MIT",
    }),
    plugin({
      name: "dual",
      source: "git",
      repo_url: "github.com/acme/dual",
      resolved_commit: "c0ffee00",
      declared_license: "(MIT OR Apache-2.0)",
    }),
    plugin({
      name: "undeclared",
      source: "git",
      repo_url: "github.com/acme/undeclared",
      resolved_commit: "abc123",
    }),
  ]);

  it("emits CycloneDX 1.5 with licenses omitted when undeclared", () => {
    const raw = exportSbom(sample, "cyclonedx", "2024-01-01T00:00:00+00:00");
    const doc = JSON.parse(raw) as {
      bomFormat: string;
      specVersion: string;
      components: Array<{
        purl: string;
        licenses?: unknown;
        hashes?: Array<{ alg: string }>;
      }>;
    };
    expect(raw.endsWith("\n")).toBe(true);
    expect(doc.bomFormat).toBe("CycloneDX");
    expect(doc.specVersion).toBe("1.5");
    expect(doc.components.map((component) => component.purl)).toEqual([
      "pkg:generic/zeta@sha256:" + "b".repeat(64),
      "pkg:github/acme/dual@c0ffee00",
      "pkg:github/acme/git-utils@def789ghi012",
      "pkg:github/acme/undeclared@abc123",
    ]);
    const undeclared = doc.components.find((component) => component.purl.includes("undeclared"));
    expect(undeclared?.licenses).toBeUndefined();
    const mit = doc.components.find((component) => component.purl.includes("git-utils"));
    expect(mit?.licenses).toEqual([{ license: { id: "MIT" } }]);
    expect(mit?.hashes?.[0]?.alg).toBe("SHA-256");
  });

  it("emits SPDX 2.3 with NOASSERTION when undeclared", () => {
    const raw = exportSbom(sample, "spdx", "2024-01-01T00:00:00+00:00");
    const doc = JSON.parse(raw) as {
      spdxVersion: string;
      packages: Array<{ licenseDeclared: string; licenseConcluded: string }>;
    };
    expect(doc.spdxVersion).toBe("SPDX-2.3");
    expect(doc.packages.map((pkg) => pkg.licenseDeclared)).toEqual([
      "NOASSERTION",
      "(MIT OR Apache-2.0)",
      "MIT",
      "NOASSERTION",
    ]);
    expect(doc.packages.every((pkg) => pkg.licenseConcluded === "NOASSERTION")).toBe(true);
  });

  it("is byte-identical across runs with a pinned timestamp", () => {
    const first = exportSbom(sample, "cyclonedx", "2024-01-01T00:00:00+00:00");
    const second = exportSbom(sample, "cyclonedx", "2024-01-01T00:00:00+00:00");
    expect(first).toBe(second);
    expect(exportSbom(sample, "spdx", "2024-01-01T00:00:00+00:00")).toBe(
      exportSbom(sample, "spdx", "2024-01-01T00:00:00+00:00"),
    );
  });

  it("resolves timestamp from --timestamp then SOURCE_DATE_EPOCH then lockfile", () => {
    expect(resolveExportTimestamp("2024-06-01T00:00:00+00:00", "ignored")).toBe(
      "2024-06-01T00:00:00+00:00",
    );
    expect(resolveExportTimestamp(undefined, "2024-02-02T00:00:00+00:00", "0")).toBe(
      "1970-01-01T00:00:00+00:00",
    );
    expect(resolveExportTimestamp(undefined, "2024-02-02T00:00:00+00:00")).toBe(
      "2024-02-02T00:00:00+00:00",
    );
  });
});
