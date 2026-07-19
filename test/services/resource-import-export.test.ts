import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatResourceExportToml,
  parseResourceExportToml,
} from "../../src/services/transport/resource.ts";
import {
  exportResourceToFile,
  importResourceFromFile,
} from "../../src/services/resource-import-export.ts";
import type { ResourceExport } from "../../src/types.ts";
import { createTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("resource transport TOML", () => {
  it("round-trips a skill resource", () => {
    const doc: ResourceExport = {
      $schema: "urn:harnesstap:resource:v1",
      version: 1,
      type: "skill",
      name: "oncall",
      namespace: "",
      description: "On-call skill",
      content: "# On-call\n",
      metadata: { mode: "agent-requested" },
      origin_kind: "manual",
      origin_ref: "",
      content_hash: "",
      content_blob_ref: "",
    };

    const parsed = parseResourceExportToml(formatResourceExportToml(doc));
    expect(parsed.type).toBe("skill");
    expect(parsed.name).toBe("oncall");
    expect(parsed.content).toBe("# On-call\n");
    expect(parsed.metadata).toEqual({ mode: "agent-requested" });
  });
});

describe("resource import/export service", () => {
  it("exports and imports a resource into the library", async () => {
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
      const outPath = join(dir, "shared-skill.harnesstap.toml");
      exportResourceToFile(`skill:${created.name}`, outPath);

      const raw = readFileSync(outPath, "utf-8");
      expect(raw).toContain("urn:harnesstap:resource:v1");

      resourceModel.deleteResource(created.id);
      rmSync(dir, { recursive: true, force: true });
    } finally {
      await ctx.cleanup();
    }

    const importContext = await createTestContext("resource-io-import");
    try {
      const { initializeSchema } = await import("../../src/db/schema.ts");
      const { getDb } = await import("../../src/db/connection.ts");
      initializeSchema(getDb());

      const dir = mkdtempSync(join(tmpdir(), "ht-resource-import-"));
      const outPath = join(dir, "shared-skill.harnesstap.toml");
      writeFileSync(
        outPath,
        formatResourceExportToml({
          $schema: "urn:harnesstap:resource:v1",
          version: 1,
          type: "skill",
          name: "shared-skill",
          namespace: "",
          description: "",
          content: "# Skill body",
          metadata: {},
          origin_kind: "manual",
          origin_ref: "",
          content_hash: "",
          content_blob_ref: "",
        }),
      );

      const resourceModel = await import("../../src/models/resource.ts");
      const result = importResourceFromFile(outPath);
      expect(result.resource.name).toBe("shared-skill");
      expect(result.action).toBe("created");
      expect(
        resourceModel.resolveResource("skill:shared-skill").status,
      ).toBe("found");

      rmSync(dir, { recursive: true, force: true });
    } finally {
      await importContext.cleanup();
    }
  });

  it("rejects composition resource types", () => {
    expect(() => exportResourceToFile("plugin_pin:foo@bar", "/tmp/x.toml")).toThrow(
      /composition/i,
    );
  });
});
