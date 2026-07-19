import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSettings } from "../../src/config/settings.js";

describe("loadSettings", () => {
  it("defaults refreshMaxAgeHours to 24 when config missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-config-"));
    const settings = loadSettings(dir);
    expect(settings.plugins.refreshMaxAgeHours).toBe(24);
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
});
