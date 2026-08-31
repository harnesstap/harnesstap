import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeReleaseVersion,
  setCargoLockPackageVersion,
  setCargoTomlPackageVersion,
  setJsonVersion,
} from "../../scripts/sync-desktop-version.ts";

const root = join(import.meta.dir, "../..");

function cliVersion(): string {
  return (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string })
    .version;
}

describe("desktop release version stamps", () => {
  it("keeps Desktop artifact versions aligned with the CLI package", () => {
    const version = cliVersion();
    const desktopPkg = JSON.parse(
      readFileSync(join(root, "apps/desktop/package.json"), "utf8"),
    ) as { version: string };
    const tauri = JSON.parse(
      readFileSync(join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
    ) as { version: string };
    const cargoToml = readFileSync(join(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8");
    const cargoLock = readFileSync(join(root, "apps/desktop/src-tauri/Cargo.lock"), "utf8");
    const packageSection = cargoToml.slice(
      cargoToml.indexOf("[package]"),
      cargoToml.indexOf("\n[", cargoToml.indexOf("[package]") + 1),
    );
    const workflow = readFileSync(join(root, ".github/workflows/changie-release-pr.yml"), "utf8");
    const release = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");

    expect(desktopPkg.version).toBe(version);
    expect(tauri.version).toBe(version);
    expect(packageSection).toContain(`version = "${version}"`);
    expect(cargoLock).toContain(`name = "harnesstap-desktop"\nversion = "${version}"`);
    expect(workflow).toContain("scripts/sync-desktop-version.ts");
    expect(release).toContain("apps/desktop/scripts/reseal-macos-app.sh");
    expect(release).toContain("startsWith(matrix.name, 'macos-')");
  });

  it("rewrites JSON, Cargo.toml, and Cargo.lock package versions", () => {
    expect(normalizeReleaseVersion("v1.0.1")).toBe("1.0.1");
    expect(setJsonVersion('{\n  "version": "0.1.0",\n  "targets": ["dmg"]\n}\n', "1.0.1")).toBe(
      '{\n  "version": "1.0.1",\n  "targets": ["dmg"]\n}\n',
    );
    expect(setCargoTomlPackageVersion('[package]\nname = "x"\nversion = "0.1.0"\n', "1.0.1")).toBe(
      '[package]\nname = "x"\nversion = "1.0.1"\n',
    );
    expect(
      setCargoLockPackageVersion(
        '[[package]]\nname = "harnesstap-desktop"\nversion = "0.1.0"\n',
        "harnesstap-desktop",
        "1.0.1",
      ),
    ).toBe('[[package]]\nname = "harnesstap-desktop"\nversion = "1.0.1"\n');
  });
});
