import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSettings } from "../../src/config/settings.js";

describe("loadSettings", () => {
  it("defaults refreshMaxAgeHours to 24 when config missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "hd-config-"));
    const settings = loadSettings(dir);
    expect(settings.plugins.refreshMaxAgeHours).toBe(24);
  });

  it("reads refreshMaxAgeHours from config.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "hd-config-"));
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ plugins: { refreshMaxAgeHours: 48 } }),
    );
    expect(loadSettings(dir).plugins.refreshMaxAgeHours).toBe(48);
  });

  it("falls back to default for invalid refreshMaxAgeHours", () => {
    const dir = mkdtempSync(join(tmpdir(), "hd-config-"));
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ plugins: { refreshMaxAgeHours: -1 } }),
    );
    expect(loadSettings(dir).plugins.refreshMaxAgeHours).toBe(24);
  });
});
