import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CASK_PATH,
  FORMULA_PATH,
  type HomebrewRelease,
  compareVersions,
  dmgDigests,
  npmTarballSha256,
  npmTarballUrl,
  parseReleaseTag,
  readFormulaVersion,
  renderCask,
  renderFormula,
  sha256Hex,
  writeTap,
} from "../../scripts/homebrew-tap.ts";

const ARM = "a".repeat(64);
const INTEL = "b".repeat(64);
const CLI = "c".repeat(64);

const RELEASE: HomebrewRelease = {
  version: "1.6.1",
  cliUrl: npmTarballUrl("1.6.1"),
  cliSha256: CLI,
  dmgArmSha256: ARM,
  dmgIntelSha256: INTEL,
};

describe("homebrew tap render", () => {
  it("accepts only stable vX.Y.Z tags", () => {
    expect(parseReleaseTag("v1.6.1")).toBe("1.6.1");
    expect(parseReleaseTag("1.6.1")).toBe("1.6.1");
    expect(() => parseReleaseTag("v1.7.0-beta.1")).toThrow("not a stable");
  });

  it("compares versions numerically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.6.1", "1.6.1")).toBe(0);
    expect(compareVersions("1.6.0", "1.6.1")).toBeLessThan(0);
  });

  it("reads the DMG digests GitHub records for the release", () => {
    const assets = [
      { name: "HarnessTap_1.6.1_aarch64.dmg", digest: `sha256:${ARM}` },
      { name: "HarnessTap_1.6.1_x64.dmg", digest: `sha256:${INTEL}` },
      { name: "HarnessTap_1.6.1_x64-setup.exe", digest: `sha256:${CLI}` },
    ];
    expect(dmgDigests(assets, "1.6.1")).toEqual({ arm: ARM, intel: INTEL });
    expect(() => dmgDigests(assets.slice(1), "1.6.1")).toThrow("no HarnessTap_1.6.1_aarch64.dmg");
    expect(() => dmgDigests([{ ...assets[0], digest: null }, assets[1]], "1.6.1")).toThrow("no sha256 digest");
  });

  it("renders a formula that installs the npm tarball on a pinned Node and runs SQLite in its test", () => {
    const formula = renderFormula(RELEASE);
    expect(formula).toContain('url "https://registry.npmjs.org/harnesstap/-/harnesstap-1.6.1.tgz"');
    expect(formula).toContain(`sha256 "${CLI}"`);
    expect(formula).toContain('depends_on "node@24"');
    expect(formula).toContain("std_npm_args(ignore_scripts: false)");
    expect(formula).toContain('HARNESSTAP_INSTALL_METHOD: "brew"');
    expect(formula).toContain('shell_output("#{bin}/ht status")');
    expect(readFormulaVersion(formula)).toBe("1.6.1");
  });

  it("renders a cask with per-arch DMG hashes and no quarantine bypass", () => {
    const cask = renderCask(RELEASE);
    expect(cask).toContain('cask "harnesstap-desktop" do');
    expect(cask).toContain('version "1.6.1"');
    expect(cask).toContain(`sha256 arm:   "${ARM}",\n         intel: "${INTEL}"`);
    expect(cask).toContain("/releases/download/v#{version}/HarnessTap_#{version}_#{arch}.dmg");
    expect(cask).toContain('app "HarnessTap.app"');
    expect(cask).toContain("depends_on macos: :big_sur");
    expect(cask).not.toContain("xattr");
    expect(cask).not.toContain("quarantine");
  });

  it("rejects hashes that are not sha256 hex", () => {
    expect(() => renderCask({ ...RELEASE, dmgArmSha256: "nope" })).toThrow("not a sha256");
    expect(() => renderFormula({ ...RELEASE, cliSha256: "A".repeat(64) })).toThrow("not a sha256");
  });

  it("writes Formula and Casks files into a tap checkout", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-tap-"));
    expect(writeTap(dir, RELEASE)).toEqual([FORMULA_PATH, CASK_PATH]);
    expect(readFileSync(join(dir, FORMULA_PATH), "utf-8")).toBe(renderFormula(RELEASE));
    expect(readFileSync(join(dir, CASK_PATH), "utf-8")).toBe(renderCask(RELEASE));
  });

  it("hashes the npm tarball only after it matches the registry integrity", async () => {
    const tarball = new TextEncoder().encode("tarball bytes");
    const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    const serve = (dist: { tarball: string; integrity: string }): typeof fetch =>
      (async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "https://registry.npmjs.org/harnesstap/1.6.1") {
          return Response.json({ dist });
        }
        if (url === npmTarballUrl("1.6.1")) {
          return new Response(tarball);
        }
        return new Response("missing", { status: 404 });
      }) as typeof fetch;

    const good = serve({ tarball: npmTarballUrl("1.6.1"), integrity });
    expect(await npmTarballSha256("1.6.1", good)).toBe(sha256Hex(tarball));

    const tampered = serve({ tarball: npmTarballUrl("1.6.1"), integrity: "sha512-AAAA" });
    await expect(npmTarballSha256("1.6.1", tampered)).rejects.toThrow("does not match npm integrity");
    await expect(npmTarballSha256("9.9.9", good)).rejects.toThrow("npm has no harnesstap@9.9.9");
  });
});
