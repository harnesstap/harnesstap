import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CARGO_PACKAGE_NAME = "harnesstap-desktop";
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)*$/;

export function normalizeReleaseVersion(raw: string): string {
  const version = raw.trim().replace(/^v/, "");
  if (!SEMVER.test(version)) {
    throw new Error(`Invalid release version: ${raw}`);
  }
  return version;
}

export function setJsonVersion(contents: string, version: string): string {
  const updated = contents.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
  if (updated === contents) {
    const parsed = JSON.parse(contents) as { version?: string };
    if (parsed.version === version) {
      return contents;
    }
    throw new Error("Could not update JSON version field");
  }
  return updated;
}

export function setCargoTomlPackageVersion(contents: string, version: string): string {
  const packageHeader = contents.indexOf("[package]");
  if (packageHeader < 0) {
    throw new Error("Cargo.toml is missing a [package] section");
  }
  const nextSection = contents.indexOf("\n[", packageHeader + 1);
  const end = nextSection === -1 ? contents.length : nextSection;
  const pkg = contents.slice(packageHeader, end);
  if (!/^version\s*=/m.test(pkg)) {
    throw new Error("Cargo.toml [package] is missing version");
  }
  const updatedPkg = pkg.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
  return contents.slice(0, packageHeader) + updatedPkg + contents.slice(end);
}

export function setCargoLockPackageVersion(
  contents: string,
  name: string,
  version: string,
): string {
  const needle = `[[package]]\nname = "${name}"\nversion = "`;
  const start = contents.indexOf(needle);
  if (start < 0) {
    throw new Error(`Cargo.lock is missing package ${name}`);
  }
  const versionStart = start + needle.length;
  const versionEnd = contents.indexOf('"', versionStart);
  if (versionEnd < 0) {
    throw new Error(`Cargo.lock package ${name} has a truncated version`);
  }
  return `${contents.slice(0, versionStart)}${version}${contents.slice(versionEnd)}`;
}

export function syncDesktopVersionFiles(root: string, version: string): void {
  const packageJson = join(root, "apps/desktop/package.json");
  const tauriConf = join(root, "apps/desktop/src-tauri/tauri.conf.json");
  const cargoToml = join(root, "apps/desktop/src-tauri/Cargo.toml");
  const cargoLock = join(root, "apps/desktop/src-tauri/Cargo.lock");
  writeFileSync(packageJson, setJsonVersion(readFileSync(packageJson, "utf8"), version));
  writeFileSync(tauriConf, setJsonVersion(readFileSync(tauriConf, "utf8"), version));
  writeFileSync(cargoToml, setCargoTomlPackageVersion(readFileSync(cargoToml, "utf8"), version));
  writeFileSync(
    cargoLock,
    setCargoLockPackageVersion(readFileSync(cargoLock, "utf8"), CARGO_PACKAGE_NAME, version),
  );
}

export function stampReleaseVersionFiles(root: string, raw: string): string {
  const version = normalizeReleaseVersion(raw);
  const packageJson = join(root, "package.json");
  writeFileSync(packageJson, setJsonVersion(readFileSync(packageJson, "utf8"), version));
  syncDesktopVersionFiles(root, version);
  return version;
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === entry) {
  const args = process.argv.slice(2);
  const releaseAll = args[0] === "--release";
  const raw = releaseAll ? args[1] : args[0];
  if (!raw) {
    console.error("Usage: bun scripts/sync-desktop-version.ts [--release] <version>");
    process.exit(1);
  }
  const root = process.env.STAMP_RELEASE_ROOT || ROOT;
  if (releaseAll) {
    const version = stampReleaseVersionFiles(root, raw);
    console.log(`Release version stamps set to ${version}`);
  } else {
    const version = normalizeReleaseVersion(raw);
    syncDesktopVersionFiles(root, version);
    console.log(`Desktop version stamps set to ${version}`);
  }
}
