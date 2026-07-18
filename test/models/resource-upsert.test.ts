import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("upsertResource", () => {
  it("creates new resource with hash and blob", async () => {
    const context = await createInitializedTestContext("resource-upsert-create");

    try {
      const { upsertResource } = await import("../../src/models/resource.ts");
      const result = upsertResource(
        {
          ...makeResourceInput({ type: "skill", name: "demo", content: "x" }),
          origin_kind: "manual",
        },
        { policy: "skip", harnesstapDir: context.homeDir },
      );

      expect(result.action).toBe("created");
      if (result.action === "created") {
        expect(result.resource.content_hash).toMatch(/^sha256:/);
        expect(result.resource.content_blob_ref).toContain("blobs/sha256/");
      }
    } finally {
      await context.cleanup();
    }
  });

  it("returns unchanged when hash matches", async () => {
    const context = await createInitializedTestContext("resource-upsert-unchanged");

    try {
      const { upsertResource } = await import("../../src/models/resource.ts");
      const input = {
        ...makeResourceInput({ type: "skill", name: "demo", content: "same" }),
        origin_kind: "manual" as const,
      };

      upsertResource(input, { policy: "skip", harnesstapDir: context.homeDir });
      const again = upsertResource(input, { policy: "skip", harnesstapDir: context.homeDir });

      expect(again.action).toBe("unchanged");
    } finally {
      await context.cleanup();
    }
  });

  it("overwrite updates content when hash differs", async () => {
    const context = await createInitializedTestContext("resource-upsert-overwrite");

    try {
      const { upsertResource } = await import("../../src/models/resource.ts");
      const base = {
        type: "skill" as const,
        name: "demo",
        namespace: "",
        description: "",
        metadata: {},
        source: "test",
        origin_kind: "manual" as const,
        origin_ref: "",
      };

      upsertResource(
        { ...base, content: "v1" },
        { policy: "overwrite", harnesstapDir: context.homeDir },
      );
      const updated = upsertResource(
        { ...base, content: "v2" },
        { policy: "overwrite", harnesstapDir: context.homeDir },
      );

      expect(updated.action).toBe("updated");
      if (updated.action === "updated") {
        expect(updated.resource.content).toBe("v2");
      }
    } finally {
      await context.cleanup();
    }
  });

  it("fail policy throws on hash conflict", async () => {
    const context = await createInitializedTestContext("resource-upsert-fail");

    try {
      const { upsertResource } = await import("../../src/models/resource.ts");
      const base = {
        type: "skill" as const,
        name: "demo",
        namespace: "",
        description: "",
        metadata: {},
        source: "test",
        origin_kind: "manual" as const,
        origin_ref: "",
      };

      upsertResource(
        { ...base, content: "v1" },
        { policy: "overwrite", harnesstapDir: context.homeDir },
      );

      expect(() =>
        upsertResource({ ...base, content: "v2" }, { policy: "fail" }),
      ).toThrow(/conflict/i);
    } finally {
      await context.cleanup();
    }
  });
});

describe("resolveResource", () => {
  it("prefers unnamespaced resource in display mode", async () => {
    const context = await createInitializedTestContext("resource-resolve-display");

    try {
      const { upsertResource, resolveResource } = await import("../../src/models/resource.ts");
      const base = {
        type: "skill" as const,
        description: "",
        metadata: {},
        source: "test",
        origin_kind: "manual" as const,
        origin_ref: "",
      };

      upsertResource(
        { ...base, name: "brainstorming", namespace: "team-kit", content: "namespaced" },
        { harnesstapDir: context.homeDir },
      );
      upsertResource(
        { ...base, name: "brainstorming", namespace: "", content: "default" },
        { harnesstapDir: context.homeDir },
      );

      const result = resolveResource("brainstorming", { mode: "display" });
      expect(result.status).toBe("found");
      if (result.status === "found") {
        expect(result.resource.namespace).toBe("");
        expect(result.resource.content).toBe("default");
      }
    } finally {
      await context.cleanup();
    }
  });

  it("requires namespace in compose mode when ambiguous", async () => {
    const context = await createInitializedTestContext("resource-resolve-compose");

    try {
      const { upsertResource, resolveResource } = await import("../../src/models/resource.ts");
      const base = {
        type: "skill" as const,
        name: "brainstorming",
        description: "",
        metadata: {},
        source: "test",
        origin_kind: "manual" as const,
        origin_ref: "",
      };

      upsertResource(
        { ...base, namespace: "team-a", content: "a" },
        { harnesstapDir: context.homeDir },
      );
      upsertResource(
        { ...base, namespace: "team-b", content: "b" },
        { harnesstapDir: context.homeDir },
      );

      const result = resolveResource("skill:brainstorming", { mode: "compose" });
      expect(result.status).toBe("ambiguous");
    } finally {
      await context.cleanup();
    }
  });
});
