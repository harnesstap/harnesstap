import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import { listVisibleMarketplaces } from "../../src/services/host-marketplaces.ts";

function writeKnownMarketplaces(
  homeRoot: string,
  entries: Record<string, unknown>,
): void {
  const dir = join(homeRoot, ".claude", "plugins");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "known_marketplaces.json"),
    `${JSON.stringify(entries, null, 2)}\n`,
  );
}

function writeClaudeMarketplaceRoot(
  root: string,
  input: { name: string; repositoryUrl?: string; plugins: string[] },
): void {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify(
      {
        name: input.name,
        ...(input.repositoryUrl
          ? { repository: { type: "git", url: input.repositoryUrl } }
          : {}),
        plugins: input.plugins.map((name) => ({ name })),
      },
      null,
      2,
    )}\n`,
  );
}

describe("listVisibleMarketplaces", () => {
  it("includes Claude known_marketplaces github and directory entries", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-host-mkt-"));
    const harnesstapDir = join(home, ".harnesstap");
    mkdirSync(harnesstapDir, { recursive: true });
    const teadsRoot = join(home, "projects", "claude-plugins");
    const officialRoot = join(
      home,
      ".claude",
      "plugins",
      "marketplaces",
      "claude-plugins-official",
    );
    writeClaudeMarketplaceRoot(teadsRoot, {
      name: "teads-plugins",
      repositoryUrl: "https://github.com/outbrain/claude-plugins",
      plugins: ["design-doc"],
    });
    writeClaudeMarketplaceRoot(officialRoot, {
      name: "claude-plugins-official",
      plugins: ["context7"],
    });
    writeKnownMarketplaces(home, {
      "claude-plugins-official": {
        source: { source: "github", repo: "anthropics/claude-plugins-official" },
        installLocation: officialRoot,
      },
      "teads-plugins": {
        source: { source: "directory", path: teadsRoot },
        installLocation: teadsRoot,
      },
    });

    const listed = listVisibleMarketplaces(harnesstapDir, home);
    expect(listed.map((entry) => entry.name)).toEqual([
      "claude-plugins-official",
      "teads-plugins",
    ]);
    expect(listed.find((entry) => entry.name === "teads-plugins")).toMatchObject({
      url: "https://github.com/outbrain/claude-plugins",
      platforms: ["claude-code"],
      managed: false,
    });
    expect(
      listed.find((entry) => entry.name === "claude-plugins-official"),
    ).toMatchObject({
      url: "https://github.com/anthropics/claude-plugins-official",
      managed: false,
    });
  });

  it("keeps HarnessTap registry entries first and does not duplicate name or URL", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-host-mkt-"));
    const harnesstapDir = join(home, ".harnesstap");
    mkdirSync(harnesstapDir, { recursive: true });
    addMarketplace(harnesstapDir, {
      name: "teads-plugins",
      url: "https://github.com/outbrain/claude-plugins.git",
      platforms: ["claude-code"],
    });
    const teadsRoot = join(home, "projects", "claude-plugins");
    writeClaudeMarketplaceRoot(teadsRoot, {
      name: "teads-plugins",
      repositoryUrl: "https://github.com/outbrain/claude-plugins",
      plugins: ["design-doc"],
    });
    writeKnownMarketplaces(home, {
      "teads-plugins": {
        source: { source: "directory", path: teadsRoot },
        installLocation: teadsRoot,
      },
      extra: {
        source: { source: "github", repo: "acme/extra-plugins" },
        installLocation: join(home, "missing"),
      },
    });

    const listed = listVisibleMarketplaces(harnesstapDir, home);
    expect(listed.map((entry) => ({ name: entry.name, managed: entry.managed }))).toEqual([
      { name: "teads-plugins", managed: true },
      { name: "extra", managed: false },
    ]);
  });
});
