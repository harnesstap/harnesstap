import { describe, it, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSettings, saveSettings } from "../../src/config/settings.js";

describe("loadSettings", () => {
  it("defaults refreshMaxAgeHours to 24 when config missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    const settings = loadSettings(dir);
    expect(settings.plugins.refreshMaxAgeHours).toBe(24);
  });

  it("defaults pluginVersionHistoryLimit to 10 when config missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    const settings = loadSettings(dir);
    expect(settings.pluginVersionHistoryLimit).toBe(10);
  });

  it("reads refreshMaxAgeHours from config.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ plugins: { refreshMaxAgeHours: 48 } }),
    );
    expect(loadSettings(dir).plugins.refreshMaxAgeHours).toBe(48);
  });

  it("prefers config.jsonc over config.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ plugins: { refreshMaxAgeHours: 48 } }),
    );
    writeFileSync(
      join(dir, "config.jsonc"),
      JSON.stringify({ plugins: { refreshMaxAgeHours: 72 } }),
    );

    expect(loadSettings(dir).plugins.refreshMaxAgeHours).toBe(72);
  });

  it("reads JSONC comments and trailing commas", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.jsonc"),
      `{
  // keep plugin metadata fresh
  "plugins": {
    "refreshMaxAgeHours": 36,
  },
}`,
    );

    expect(loadSettings(dir).plugins.refreshMaxAgeHours).toBe(36);
  });

  it("falls back to defaults for malformed config content", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.jsonc"),
      `{
  "plugins": {
    "refreshMaxAgeHours": 36,
  // missing closing braces on purpose
`,
    );

    expect(loadSettings(dir).plugins.refreshMaxAgeHours).toBe(24);
  });

  it("parses quoted // content without treating it as a comment", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.jsonc"),
      `{
  "note": "keep https://example.com/docs // literal text",
  "plugins": {
    "refreshMaxAgeHours": 12,
  },
}`,
    );

    expect(loadSettings(dir).plugins.refreshMaxAgeHours).toBe(12);
  });

  it("falls back to default for invalid refreshMaxAgeHours", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ plugins: { refreshMaxAgeHours: -1 } }),
    );
    expect(loadSettings(dir).plugins.refreshMaxAgeHours).toBe(24);
  });

  it("reads pluginVersionHistoryLimit from config.jsonc", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.jsonc"),
      JSON.stringify({ pluginVersionHistoryLimit: 25 }),
    );
    expect(loadSettings(dir).pluginVersionHistoryLimit).toBe(25);
  });

  it("defaults pluginVersionHistoryLimit to 10 when key missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.jsonc"),
      JSON.stringify({ plugins: { refreshMaxAgeHours: 48 } }),
    );
    expect(loadSettings(dir).pluginVersionHistoryLimit).toBe(10);
  });

  it.each([0, -1, 1.5, "5", null, {}])(
    "falls back to default for invalid pluginVersionHistoryLimit (%p)",
    (invalidValue) => {
      const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
      writeFileSync(
        join(dir, "config.jsonc"),
        JSON.stringify({ pluginVersionHistoryLimit: invalidValue }),
      );
      expect(loadSettings(dir).pluginVersionHistoryLimit).toBe(10);
    },
  );
});

describe("plugins.marketplaces", () => {
  it("defaults marketplaces to [] when missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    expect(loadSettings(dir).plugins.marketplaces).toEqual([]);
  });

  it("reads marketplaces from config.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        plugins: {
          refreshMaxAgeHours: 24,
          marketplaces: [
            {
              name: "demo",
              url: "https://github.com/example/demo.git",
              platforms: ["claude-code"],
            },
          ],
        },
      }),
    );
    expect(loadSettings(dir).plugins.marketplaces).toEqual([
      {
        name: "demo",
        url: "https://github.com/example/demo.git",
        platforms: ["claude-code"],
      },
    ]);
  });

  it("saveSettings writes marketplaces to config.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    saveSettings(dir, {
      plugins: {
        refreshMaxAgeHours: 24,
        marketplaces: [
          {
            name: "demo",
            url: "https://github.com/example/demo.git",
            platforms: ["claude-code"],
          },
        ],
      },
      pluginVersionHistoryLimit: 10,
    });
    const raw = JSON.parse(readFileSync(join(dir, "config.json"), "utf-8"));
    expect(raw.plugins.marketplaces).toEqual([
      {
        name: "demo",
        url: "https://github.com/example/demo.git",
        platforms: ["claude-code"],
      },
    ]);
    expect(loadSettings(dir).plugins.marketplaces[0]?.name).toBe("demo");
  });

  it("saveSettings writes to existing config.jsonc", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.jsonc"),
      JSON.stringify({ plugins: { refreshMaxAgeHours: 48 } }),
    );
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ plugins: { refreshMaxAgeHours: 99 } }),
    );
    saveSettings(dir, {
      plugins: {
        refreshMaxAgeHours: 24,
        marketplaces: [
          {
            name: "demo",
            url: "https://github.com/example/demo.git",
            platforms: ["cursor"],
          },
        ],
      },
      pluginVersionHistoryLimit: 10,
    });
    const jsonc = JSON.parse(readFileSync(join(dir, "config.jsonc"), "utf-8"));
    expect(jsonc.plugins.marketplaces).toEqual([
      {
        name: "demo",
        url: "https://github.com/example/demo.git",
        platforms: ["cursor"],
      },
    ]);
    const json = JSON.parse(readFileSync(join(dir, "config.json"), "utf-8"));
    expect(json.plugins.refreshMaxAgeHours).toBe(99);
  });

  it("saveSettings preserves telemetry preference", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.jsonc"),
      JSON.stringify({ telemetry: { enabled: false }, plugins: { refreshMaxAgeHours: 24 } }),
    );
    saveSettings(dir, {
      plugins: {
        refreshMaxAgeHours: 12,
        marketplaces: [],
      },
      pluginVersionHistoryLimit: 10,
    });
    const jsonc = JSON.parse(readFileSync(join(dir, "config.jsonc"), "utf-8"));
    expect(jsonc.telemetry).toEqual({ enabled: false });
    expect(jsonc.plugins.refreshMaxAgeHours).toBe(12);
  });

  it("trims marketplace name and url", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        plugins: {
          marketplaces: [
            {
              name: "  demo  ",
              url: "  https://github.com/example/demo.git  ",
              platforms: ["claude-code"],
            },
          ],
        },
      }),
    );
    expect(loadSettings(dir).plugins.marketplaces).toEqual([
      {
        name: "demo",
        url: "https://github.com/example/demo.git",
        platforms: ["claude-code"],
      },
    ]);
  });

  it("skips marketplace rows with whitespace-only name", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        plugins: {
          marketplaces: [
            {
              name: "   ",
              url: "https://github.com/example/demo.git",
              platforms: ["claude-code"],
            },
          ],
        },
      }),
    );
    expect(loadSettings(dir).plugins.marketplaces).toEqual([]);
  });
});
