import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importMigrationState } from "../../src/services/migrate.ts";

describe("migrate archive containment", () => {
  it("refuses an archive containing a path traversal", () => {
    // Host tar (bsdtar) refuses to create/extract `../` members, so build a
    // symlink escape instead — listContainedFiles still rejects it with the
    // same PathEscapeError surface.
    const parent = mkdtempSync(join(tmpdir(), "evil-parent-"));
    const staging = join(parent, "pkg");
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "s");
    writeFileSync(join(staging, "manifest.json"), "{}");
    mkdirSync(join(staging, "nested"), { recursive: true });
    writeFileSync(join(staging, "nested", "ok.txt"), "ok");
    symlinkSync(outside, join(staging, "leak"));
    const archive = join(parent, "evil.tar.gz");
    execSync(`tar -czf ${archive} -C ${staging} .`);

    expect(() => importMigrationState({ archivePath: archive })).toThrow(
      /escapes the package root/,
    );
    rmSync(parent, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});
