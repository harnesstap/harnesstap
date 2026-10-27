// Renders the Homebrew formula (CLI) and cask (Desktop) for harnesstap/homebrew-tap.
//
// Usage:
//   bun scripts/homebrew-tap.ts --tag v1.2.3 --assets-json assets.json --out <tap checkout>
//
// `assets.json` is `gh release view <tag> --json assets`. The CLI tarball hash is computed
// from the npm registry tarball after checking it against the registry's sha512 integrity.
// Exits 0 without writing when the tap already carries the same or a newer version.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const NPM_PACKAGE = "harnesstap";
export const GITHUB_REPO = "harnesstap/harnesstap";
export const FORMULA_PATH = "Formula/harnesstap.rb";
export const CASK_TOKEN = "harnesstap-desktop";
export const CASK_PATH = `Casks/${CASK_TOKEN}.rb`;
/** Node line the formula runs on. A versioned LTS keg keeps the better-sqlite3 ABI stable. */
export const FORMULA_NODE = "node@24";

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export interface HomebrewRelease {
  version: string;
  cliUrl: string;
  cliSha256: string;
  dmgArmSha256: string;
  dmgIntelSha256: string;
}

export interface ReleaseAsset {
  name: string;
  digest?: string | null;
  url?: string;
}

export function parseReleaseTag(tag: string): string {
  const version = tag.trim().replace(/^v/, "");
  if (!VERSION_RE.test(version)) {
    throw new Error(`Homebrew tap: ${tag} is not a stable vX.Y.Z tag; prereleases are not published to the tap.`);
  }
  return version;
}

export function compareVersions(a: string, b: string): number {
  const pa = VERSION_RE.exec(a);
  const pb = VERSION_RE.exec(b);
  if (!pa || !pb) {
    throw new Error(`Homebrew tap: cannot compare ${a} and ${b}.`);
  }
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function npmTarballUrl(version: string): string {
  return `https://registry.npmjs.org/${NPM_PACKAGE}/-/${NPM_PACKAGE}-${version}.tgz`;
}

export function dmgAssetName(version: string, arch: "aarch64" | "x64"): string {
  return `HarnessTap_${version}_${arch}.dmg`;
}

function assertSha256(label: string, value: string): string {
  if (!SHA256_RE.test(value)) {
    throw new Error(`Homebrew tap: ${label} is not a sha256 hex digest: ${value}`);
  }
  return value;
}

/** Reads the sha256 GitHub records for each macOS DMG of the release. */
export function dmgDigests(assets: ReleaseAsset[], version: string): { arm: string; intel: string } {
  const pick = (arch: "aarch64" | "x64"): string => {
    const name = dmgAssetName(version, arch);
    const asset = assets.find((entry) => entry.name === name);
    if (!asset) {
      throw new Error(`Homebrew tap: release has no ${name} asset.`);
    }
    const digest = asset.digest ?? "";
    if (!digest.startsWith("sha256:")) {
      throw new Error(`Homebrew tap: ${name} has no sha256 digest (got "${digest}").`);
    }
    return assertSha256(name, digest.slice("sha256:".length));
  };
  return { arm: pick("aarch64"), intel: pick("x64") };
}

/** Returns the version in a rendered formula, or null when the file has none. */
export function readFormulaVersion(formula: string): string | null {
  const match = /\/harnesstap-(\d+\.\d+\.\d+)\.tgz"/.exec(formula);
  return match ? match[1] : null;
}

export function renderFormula(release: HomebrewRelease): string {
  assertSha256("CLI tarball", release.cliSha256);
  return `class Harnesstap < Formula
  desc "Agent harness configuration toolkit for Claude Code, Codex, Cursor and more"
  homepage "https://harnesstap.com"
  url "${release.cliUrl}"
  sha256 "${release.cliSha256}"
  license "Apache-2.0"

  livecheck do
    url :stable
  end

  depends_on "${FORMULA_NODE}"

  def install
    node = formula_opt_bin("${FORMULA_NODE}")
    ENV.prepend_path "PATH", node
    system node/"npm", "install", *std_npm_args(ignore_scripts: false)
    env = { PATH: "#{node}:$PATH", HARNESSTAP_INSTALL_METHOD: "brew" }
    %w[harnesstap ht].each do |cmd|
      (bin/cmd).write_env_script libexec/"bin"/cmd, env
    end
  end

  test do
    ENV["HARNESSTAP_TELEMETRY"] = "0"
    ENV["HARNESSTAP_SKIP_UPDATE_CHECK"] = "1"
    assert_match version.to_s, shell_output("#{bin}/harnesstap --version")
    # \`status\` opens the SQLite library, so this proves better-sqlite3 built for this Node.
    assert_match "PROJECT", shell_output("#{bin}/ht status")
    assert_path_exists testpath/".harnesstap/harnesstap.db"
  end
end
`;
}

export function renderCask(release: HomebrewRelease): string {
  assertSha256("Apple Silicon DMG", release.dmgArmSha256);
  assertSha256("Intel DMG", release.dmgIntelSha256);
  return `cask "${CASK_TOKEN}" do
  arch arm: "aarch64", intel: "x64"

  version "${release.version}"
  sha256 arm:   "${release.dmgArmSha256}",
         intel: "${release.dmgIntelSha256}"

  url "https://github.com/${GITHUB_REPO}/releases/download/v#{version}/HarnessTap_#{version}_#{arch}.dmg"
  name "HarnessTap"
  desc "Desktop app for the HarnessTap agent harness configuration toolkit"
  homepage "https://harnesstap.com/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on :macos

  app "HarnessTap.app"

  zap trash: [
    "~/Library/Application Support/dev.harnesstap.desktop",
    "~/Library/Caches/dev.harnesstap.desktop",
    "~/Library/Preferences/dev.harnesstap.desktop.plist",
    "~/Library/Saved Application State/dev.harnesstap.desktop.savedState",
    "~/Library/WebKit/dev.harnesstap.desktop",
  ]

  caveats <<~EOS
    HarnessTap Desktop is not notarized by Apple yet. The first launch is blocked by
    Gatekeeper: open System Settings > Privacy & Security and click "Open Anyway".

    Your library in ~/.harnesstap is shared with the CLI and is kept by "brew uninstall --zap".
  EOS
end
`;
}

export function writeTap(dir: string, release: HomebrewRelease): string[] {
  const files: Array<[string, string]> = [
    [FORMULA_PATH, renderFormula(release)],
    [CASK_PATH, renderCask(release)],
  ];
  for (const [path, content] of files) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return files.map(([path]) => path);
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Downloads the npm tarball, checks it against the registry sha512 integrity, returns its sha256. */
export async function npmTarballSha256(version: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const metaRes = await fetchFn(`https://registry.npmjs.org/${NPM_PACKAGE}/${version}`);
  if (!metaRes.ok) {
    throw new Error(`Homebrew tap: npm has no ${NPM_PACKAGE}@${version} (HTTP ${metaRes.status}).`);
  }
  const meta = (await metaRes.json()) as { dist?: { tarball?: string; integrity?: string } };
  const tarball = meta.dist?.tarball;
  const integrity = meta.dist?.integrity ?? "";
  if (tarball !== npmTarballUrl(version)) {
    throw new Error(`Homebrew tap: unexpected npm tarball URL ${tarball}.`);
  }
  const res = await fetchFn(tarball);
  if (!res.ok) {
    throw new Error(`Homebrew tap: download of ${tarball} failed (HTTP ${res.status}).`);
  }
  const data = new Uint8Array(await res.arrayBuffer());
  const sha512 = `sha512-${createHash("sha512").update(data).digest("base64")}`;
  if (integrity !== sha512) {
    throw new Error(`Homebrew tap: ${tarball} does not match npm integrity ${integrity}.`);
  }
  return sha256Hex(data);
}

function argValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) {
    throw new Error(`Homebrew tap: missing ${name} <value>.`);
  }
  return value;
}

async function main(args: string[]): Promise<void> {
  const version = parseReleaseTag(argValue(args, "--tag"));
  const out = argValue(args, "--out");
  const assetsJson = JSON.parse(readFileSync(argValue(args, "--assets-json"), "utf-8")) as {
    assets?: ReleaseAsset[];
  };

  const formulaFile = join(out, FORMULA_PATH);
  const current = existsSync(formulaFile) ? readFormulaVersion(readFileSync(formulaFile, "utf-8")) : null;
  if (current && compareVersions(current, version) >= 0) {
    console.log(`Homebrew tap already at ${current}; not rendering ${version}.`);
    return;
  }

  const dmg = dmgDigests(assetsJson.assets ?? [], version);
  const release: HomebrewRelease = {
    version,
    cliUrl: npmTarballUrl(version),
    cliSha256: await npmTarballSha256(version),
    dmgArmSha256: dmg.arm,
    dmgIntelSha256: dmg.intel,
  };
  for (const path of writeTap(out, release)) {
    console.log(`wrote ${path} for ${version}`);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
