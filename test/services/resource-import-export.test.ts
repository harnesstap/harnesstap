import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exportResourceToFile,
  importResourceFromFile,
} from "../../src/services/resource-import-export.ts";
import { createTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("resource import/export service", () => {
  it("exports a resource as an Agent Plugins package directory", async () => {
    const ctx = await createTestContext("resource-io");
    try {
      const { initializeSchema } = await import("../../src/db/schema.ts");
      const { getDb } = await import("../../src/db/connection.ts");
      initializeSchema(getDb());

      const resourceModel = await import("../../src/models/resource.ts");
      const created = resourceModel.createResource(
        makeResourceInput({ name: "shared-skill", content: "# Skill body" }),
      );

      const dir = mkdtempSync(join(tmpdir(), "ht-resource-export-"));
      const outPath = join(dir, "shared-skill");
      const exported = exportResourceToFile(`skill:${created.name}`, outPath);

      expect(exported.name).toBe("shared-skill");
      expect(existsSync(join(outPath, "plugin.json"))).toBe(true);
      expect(existsSync(join(outPath, "skills", "shared-skill", "SKILL.md"))).toBe(true);
      const manifest = JSON.parse(readFileSync(join(outPath, "plugin.json"), "utf-8")) as {
        name: string;
        version: string;
      };
      expect(manifest.name).toBe("shared-skill");
      expect(manifest.version).toBe("0.0.0");
      expect(exported.files).toContain("plugin.json");

      rmSync(dir, { recursive: true, force: true });
    } finally {
      await ctx.cleanup();
    }
  });

  it("imports a resource package into the library", async () => {
    const exportContext = await createTestContext("resource-io-export");
    let packageDir = "";
    try {
      const { initializeSchema } = await import("../../src/db/schema.ts");
      const { getDb } = await import("../../src/db/connection.ts");
      initializeSchema(getDb());

      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource(
        makeResourceInput({ name: "shared-skill", content: "# Skill body" }),
      );

      const dir = mkdtempSync(join(tmpdir(), "ht-resource-export-2-"));
      packageDir = join(dir, "shared-skill");
      exportResourceToFile("skill:shared-skill", packageDir);
    } finally {
      await exportContext.cleanup();
    }

    const importContext = await createTestContext("resource-io-import");
    try {
      const { initializeSchema } = await import("../../src/db/schema.ts");
      const { getDb } = await import("../../src/db/connection.ts");
      initializeSchema(getDb());

      const resourceModel = await import("../../src/models/resource.ts");
      const result = importResourceFromFile(packageDir);
      expect(result.resource.name).toBe("shared-skill");
      expect(result.action).toBe("created");
      expect(
        resourceModel.resolveResource("skill:shared-skill").status,
      ).toBe("found");

      rmSync(packageDir, { recursive: true, force: true });
      rmSync(join(packageDir, ".."), { recursive: true, force: true });
    } finally {
      await importContext.cleanup();
    }
  });

  it("rejects composition resource types", () => {
    expect(() => exportResourceToFile("plugin_pin:foo@bar", "/tmp/x-pkg")).toThrow(
      /composition/i,
    );
  });
});
