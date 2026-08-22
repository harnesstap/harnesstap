import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "../../src/config/settings.js";
import {
  addMarketplace,
  listMarketplaces,
  normalizeMarketplaceUrl,
  removeMarketplace,
  updateMarketplace,
} from "../../src/services/marketplace-registry.js";

describe("normalizeMarketplaceUrl", () => {
  it("strips whitespace and trailing .git", () => {
    expect(normalizeMarketplaceUrl("  https://github.com/example/demo.git  ")).toBe(
      "https://github.com/example/demo",
    );
    expect(normalizeMarketplaceUrl("https://github.com/example/demo.GIT")).toBe(
      "https://github.com/example/demo",
    );
  });
});

describe("addMarketplace + listMarketplaces", () => {
  it("stores normalized URL without .git", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-marketplace-"));
    const result = addMarketplace(dir, {
      name: "demo",
      url: "  https://github.com/example/demo.git  ",
      platforms: ["claude-code"],
    });

    expect(result.status).toBe("added");
    expect(result.entry).toEqual({
      name: "demo",
      url: "https://github.com/example/demo",
      platforms: ["claude-code"],
    });
    expect(listMarketplaces(dir)).toEqual([result.entry]);
    expect(loadSettings(dir).plugins.marketplaces).toEqual([result.entry]);
  });
});

describe("addMarketplace idempotency", () => {
  it("returns already_configured for the same URL without duplicating", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-marketplace-"));
    const first = addMarketplace(dir, {
      name: "demo",
      url: "https://github.com/example/demo.git",
      platforms: ["claude-code"],
    });
    expect(first.status).toBe("added");

    const second = addMarketplace(dir, {
      name: "other-name",
      url: "https://github.com/example/demo",
      platforms: ["cursor"],
    });
    expect(second.status).toBe("already_configured");
    expect(second.entry).toEqual(first.entry);
    expect(listMarketplaces(dir)).toHaveLength(1);
    expect(listMarketplaces(dir)[0]).toEqual(first.entry);
  });
});

describe("addMarketplace name conflict", () => {
  it("throws when the same name points at a different URL", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-marketplace-"));
    addMarketplace(dir, {
      name: "demo",
      url: "https://github.com/example/demo.git",
      platforms: ["claude-code"],
    });

    expect(() =>
      addMarketplace(dir, {
        name: "demo",
        url: "https://github.com/example/other.git",
        platforms: ["claude-code"],
      }),
    ).toThrow(/name conflict/i);
    expect(listMarketplaces(dir)).toHaveLength(1);
  });
});

describe("removeMarketplace", () => {
  it("removes by name and persists an empty list", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-marketplace-"));
    addMarketplace(dir, {
      name: "demo",
      url: "https://github.com/example/demo.git",
      platforms: ["claude-code"],
    });

    const result = removeMarketplace(dir, "demo");
    expect(result.status).toBe("removed");
    expect(result.entry).toEqual({
      name: "demo",
      url: "https://github.com/example/demo",
      platforms: ["claude-code"],
    });
    expect(listMarketplaces(dir)).toEqual([]);
    expect(loadSettings(dir).plugins.marketplaces).toEqual([]);
  });
});

describe("updateMarketplace", () => {
  it("renames, changes url and platforms", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-marketplace-"));
    addMarketplace(dir, {
      name: "demo",
      url: "https://github.com/example/demo.git",
      platforms: ["claude-code"],
    });
    const result = updateMarketplace(dir, "demo", {
      name: "renamed",
      url: "https://github.com/example/other.git",
      platforms: ["cursor"],
    });
    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.entry).toEqual({
      name: "renamed",
      url: "https://github.com/example/other",
      platforms: ["cursor"],
    });
    expect(result.renamedFrom).toBe("demo");
    expect(result.urlChanged).toBe(true);
    expect(listMarketplaces(dir)).toEqual([result.entry]);
  });

  it("returns not_found for unknown name", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-marketplace-"));
    expect(updateMarketplace(dir, "missing", { name: "x" }).status).toBe("not_found");
  });

  it("throws on rename onto an existing name", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-marketplace-"));
    addMarketplace(dir, {
      name: "a",
      url: "https://github.com/example/a.git",
      platforms: ["claude-code"],
    });
    addMarketplace(dir, {
      name: "b",
      url: "https://github.com/example/b.git",
      platforms: ["claude-code"],
    });
    expect(() => updateMarketplace(dir, "a", { name: "b" })).toThrow(/name conflict/i);
  });

  it("throws when changing url onto an existing marketplace url", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-marketplace-"));
    addMarketplace(dir, {
      name: "a",
      url: "https://github.com/example/a.git",
      platforms: ["claude-code"],
    });
    addMarketplace(dir, {
      name: "b",
      url: "https://github.com/example/b.git",
      platforms: ["claude-code"],
    });
    expect(() =>
      updateMarketplace(dir, "a", { url: "https://github.com/example/b.git" }),
    ).toThrow(/url conflict/i);
  });
});
