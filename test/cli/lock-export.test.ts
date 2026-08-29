import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { writeLockfile, type Lockfile } from "../../src/services/lockfile.ts";
import { getHarnesstapDir } from "../../src/db/connection.ts";

const HASH = `sha256:${"c".repeat(64)}`;

function sampleLock(): Lockfile {
  return {
    root: "demo",
    resolved_at: "2024-06-01T00:00:00+00:00",
    resource_map_hash: HASH,
    plugins: [
      {
        name: "local-helper",
        version: "0.1.0",
        source: "local",
        integrity: HASH,
        depth: 1,
        path: ["demo", "local-helper"],
        content_hash: HASH,
      },
      {
        name: "git-utils",
        version: "1.2.0",
        source: "git",
        integrity: HASH,
        depth: 1,
        path: ["demo", "git-utils"],
        repo_url: "https://user:token@github.com/acme/git-utils?token=leak",
        resolved_commit: "def789ghi012",
        content_hash: HASH,
        declared_license: "MIT",
      },
    ],
  };
}

describe("ht lock export", () => {
  it("defaults to CycloneDX on stdout with no diagnostic logs", async () => {
    const context = await createTestContext("cli-lock-export-cdx");
    try {
      await runCli(["init"]);
      writeLockfile(context.projectDir, sampleLock());

      const result = await runCli([
        "lock",
        "export",
        "--timestamp",
        "2024-01-01T00:00:00+00:00",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const doc = JSON.parse(result.stdout) as {
        bomFormat: string;
        specVersion: string;
        components: Array<{ purl: string; licenses?: unknown }>;
      };
      expect(doc.bomFormat).toBe("CycloneDX");
      expect(doc.specVersion).toBe("1.5");
      expect(result.stdout).not.toMatch(/user:token|token=leak/);
      expect(doc.components.map((component) => component.purl)).toEqual([
        `pkg:generic/local-helper@${HASH}`,
        "pkg:github/acme/git-utils@def789ghi012",
      ]);
      expect(doc.components[1]?.licenses).toEqual([{ license: { id: "MIT" } }]);
    } finally {
      await context.cleanup();
    }
  });

  it("writes SPDX to a file and keeps stdout clean", async () => {
    const context = await createTestContext("cli-lock-export-spdx");
    try {
      await runCli(["init"]);
      writeLockfile(context.projectDir, sampleLock());
      const output = join(context.projectDir, "out", "sbom.spdx.json");

      const result = await runCli([
        "lock",
        "export",
        "--format",
        "spdx",
        "-o",
        output,
        "--timestamp",
        "2024-01-01T00:00:00+00:00",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout.trim()).toBe("");
      expect(existsSync(output)).toBe(true);
      const doc = JSON.parse(readFileSync(output, "utf8")) as {
        spdxVersion: string;
        packages: Array<{ licenseDeclared: string }>;
      };
      expect(doc.spdxVersion).toBe("SPDX-2.3");
      expect(doc.packages.map((pkg) => pkg.licenseDeclared)).toEqual([
        "NOASSERTION",
        "MIT",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("fails closed when the lockfile is missing", async () => {
    const context = await createTestContext("cli-lock-export-missing");
    try {
      await runCli(["init"]);
      const result = await runCli(["lock", "export"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/No lockfile found/);
      expect(result.stdout.trim()).toBe("");
    } finally {
      await context.cleanup();
    }
  });

  it("is deterministic for the same --timestamp", async () => {
    const context = await createTestContext("cli-lock-export-det");
    try {
      await runCli(["init"]);
      writeLockfile(context.projectDir, sampleLock());
      const first = await runCli([
        "lock",
        "export",
        "--timestamp",
        "2024-01-01T00:00:00+00:00",
      ]);
      const second = await runCli([
        "lock",
        "export",
        "--timestamp",
        "2024-01-01T00:00:00+00:00",
      ]);
      expect(first.stdout).toBe(second.stdout);
    } finally {
      await context.cleanup();
    }
  });

  it("reads a user-scope lock with --global when that file already exists", async () => {
    const context = await createTestContext("cli-lock-export-global");
    try {
      await runCli(["init"]);
      writeLockfile(getHarnesstapDir(), sampleLock());
      const result = await runCli([
        "lock",
        "export",
        "--global",
        "--timestamp",
        "2024-01-01T00:00:00+00:00",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("pkg:github/acme/git-utils");
    } finally {
      await context.cleanup();
    }
  });
});

describe("ht lock export help", () => {
  it("shows the lock group and export examples", async () => {
    const help = await runCli(["lock", "-h"]);
    expect(help.stdout).toContain("export");
    const exportHelp = await runCli(["lock", "export", "-h"]);
    expect(exportHelp.stdout).toContain("cyclonedx");
    expect(exportHelp.stdout).toContain("spdx");
  });
});
