import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectImportScopeFromFile,
  rejectEnvironmentScope,
  resolveExportScope,
  resolveImportScope,
} from "../../src/services/migrate-scope.ts";

describe("migrate-scope", () => {
  it("resolves plugin export scope from --plugin flag", () => {
    expect(
      resolveExportScope({
        plugin: "my-plugin",
        file: "./out-pkg",
      }).scope,
    ).toBe("plugin");
  });

  it("defaults plugin export to a directory, or .ap.json with --single-file", () => {
    const dir = resolveExportScope({ plugin: "My Plugin" });
    expect(dir.outputPath.endsWith("my-plugin")).toBe(true);
    expect(dir.singleFile).toBe(false);

    const file = resolveExportScope({ plugin: "My Plugin", singleFile: true });
    expect(file.outputPath.endsWith("my-plugin.ap.json")).toBe(true);
    expect(file.singleFile).toBe(true);
  });

  it("resolves workspace export scope from archive extension", () => {
    expect(
      resolveExportScope({ file: "./backup.tar.gz" }).scope,
    ).toBe("workspace");
  });

  it("detects plugin import from a package directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-scope-"));
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
    expect(detectImportScopeFromFile(dir)).toBe("plugin");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects plugin import from an .ap.json envelope", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-scope-ap-"));
    const path = join(dir, "pkg.ap.json");
    writeFileSync(
      path,
      JSON.stringify({ schema: "urn:harnesstap:ap-package:v1", files: {} }),
    );
    expect(detectImportScopeFromFile(path)).toBe("plugin");
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects legacy .harnesstap.toml transport files", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-scope-toml-"));
    const path = join(dir, "plugin.harnesstap.toml");
    writeFileSync(path, 'schema = "urn:harnesstap:layer:v1"\nversion = 1\n');
    expect(() => detectImportScopeFromFile(path)).toThrow(/Agent Plugins package/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects forced import scope that mismatches file format", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-scope-mismatch-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
    expect(() =>
      resolveImportScope({ file: dir, workspace: true }),
    ).toThrow(/looks like plugin data but --workspace/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects --environment via rejectEnvironmentScope", () => {
    expect(() => rejectEnvironmentScope({ environment: "work" })).toThrow(/--workspace/);
    expect(() =>
      resolveExportScope({ environment: "work", file: "./x" }),
    ).toThrow(/--workspace/);
  });
});
