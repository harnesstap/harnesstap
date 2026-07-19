import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectImportScopeFromFile,
  resolveExportScope,
  resolveImportScope,
} from "../../src/services/migrate-scope.ts";
import { formatResourceExportToml } from "../../src/services/transport/resource.ts";
import {
  makeSingleLayerExport,
  writeLayerExportToml,
} from "../helpers/transport-fixtures.ts";

describe("migrate-scope", () => {
  it("resolves layer export scope from --layer flag", () => {
    expect(
      resolveExportScope({
        layer: "my-layer",
        file: "./out.harnesstap.toml",
      }).scope,
    ).toBe("layer");
  });

  it("resolves workspace export scope from archive extension", () => {
    expect(
      resolveExportScope({ file: "./backup.tar.gz" }).scope,
    ).toBe("workspace");
  });

  it("detects layer import from TOML schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-scope-"));
    const path = join(dir, "layer.harnesstap.toml");
    writeLayerExportToml(path, makeSingleLayerExport({ name: "x" }));
    expect(detectImportScopeFromFile(path)).toBe("layer");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects resource import from TOML schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-scope-r-"));
    const path = join(dir, "skill.harnesstap.toml");
    writeFileSync(
      path,
      formatResourceExportToml({
        $schema: "urn:harnesstap:resource:v1",
        version: 1,
        type: "skill",
        name: "x",
        namespace: "",
        description: "",
        content: "#",
        metadata: {},
        origin_kind: "manual",
        origin_ref: "",
        content_hash: "",
        content_blob_ref: "",
      }),
    );
    expect(detectImportScopeFromFile(path)).toBe("resource");
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects forced import scope that mismatches file format", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-scope-mismatch-"));
    const path = join(dir, "layer.harnesstap.toml");
    writeLayerExportToml(path, makeSingleLayerExport({ name: "x" }));
    expect(() =>
      resolveImportScope({ file: path, workspace: true }),
    ).toThrow(/looks like layer data but --workspace/);
    rmSync(dir, { recursive: true, force: true });
  });
});
