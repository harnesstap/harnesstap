import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI resource", () => {
  it("lists, shows, and deletes resources", async () => {
    const context = await createTestContext("cli-resource");

    try {
      await runCli(["init"]);

      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "shared-skill",
          description: "Shared helper",
          content: "# Shared",
        }),
      );

      const resourceList = await runCli(["resource", "list"]);
      const resourceShow = await runCli(["resource", "show", resource.id]);

      expect(resourceList.stdout).toContain("shared-skill");
      expect(resourceShow.stdout).toContain("RESOURCE");
      expect(resourceShow.stdout).toContain(resource.id);
      expect(resourceShow.stdout).toContain("CONTENT");
      expect(resourceShow.stdout).toContain("# Shared");

      const deleteResult = await runCli(["resource", "delete", resource.id]);
      expect(deleteResult.stdout).toContain("✓ Deleted");
      expect(deleteResult.stdout).toContain("skill");
      expect(deleteResult.stdout).toContain('"shared-skill"');
      expect(resourceModel.getResource(resource.id)).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("shows a resource by name", async () => {
    const context = await createTestContext("cli-resource-show-name");

    try {
      await runCli(["init"]);

      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "openapi-mcp-baseline",
          description: "OpenAPI MCP baseline",
          content: "# OpenAPI MCP Baseline",
        }),
      );

      const resourceShow = await runCli(["resource", "show", "openapi-mcp-baseline"]);

      expect(resourceShow.stdout).toContain("# OpenAPI MCP Baseline");
    } finally {
      await context.cleanup();
    }
  });

  it("resource list hides IDs by default and reveals them with --show-id", async () => {
    const context = await createTestContext("cli-resource-show-id-flag");

    try {
      await runCli(["init"]);

      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "openapi-mcp-baseline",
          description: "OpenAPI MCP baseline",
          content: "# OpenAPI MCP Baseline",
        }),
      );
      const shortId = `${resource.id.slice(0, 6)}…${resource.id.slice(-4)}`;

      const hidden = await runCli(["resource", "list"]);
      const shown = await runCli(["resource", "list", "--show-id"]);

      expect(hidden.stdout).not.toMatch(/\|\s+ID\s+\|/);
      expect(hidden.stdout).not.toContain(shortId);
      expect(shown.stdout).toMatch(/\|\s+ID\s+\|/);
      expect(shown.stdout).toContain(shortId);
    } finally {
      await context.cleanup();
    }
  });

  it("renders resource list as a shared table with updated timestamps", async () => {
    const context = await createTestContext("cli-resource-list-table");
    try {
      await runCli(["init"]);
      const result = await runCli(["resource", "list"]);
      expect(result.stdout).toContain("TYPE");
      expect(result.stdout).toContain("UPDATED");
    } finally {
      await context.cleanup();
    }
  });

  it("deletes a resource by name", async () => {
    const context = await createTestContext("cli-resource-delete-name");

    try {
      await runCli(["init"]);

      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "delete-me",
          description: "Delete me",
          content: "# Delete Me",
        }),
      );

      const deleteResult = await runCli(["resource", "delete", "delete-me"]);
      expect(deleteResult.stdout).toContain("✓ Deleted");
      expect(deleteResult.stdout).toContain("skill");
      expect(deleteResult.stdout).toContain('"delete-me"');

      expect(resourceModel.getResource(resource.id)).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("resource delete passes --search into the wizard filter", async () => {
    const context = await createTestContext("cli-resource-delete-search");

    try {
      await runCli(["init"]);

      const resourceModel = await import("../../src/models/resource.ts");
      const instruction = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "copilot-cli-instructions",
          content: "# Copilot",
        }),
      );
      resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "team",
          content: "# Team",
        }),
      );

      const deleteResult = await runCli(
        ["resource", "delete", "--search", "copilot"],
        {
          isTTY: true,
          promptResponses: [{ value: [instruction.id] }],
        },
      );

      expect(deleteResult.stdout).toContain('"copilot-cli-instructions"');
      expect(resourceModel.getResource(instruction.id)).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("resource delete prompts for searchable multi-select on TTY and deletes selected resources", async () => {
    const context = await createTestContext("cli-resource-delete-multi-select");

    try {
      await runCli(["init"]);

      const resourceModel = await import("../../src/models/resource.ts");
      const keep = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "keep-me",
          content: "# Keep",
        }),
      );
      const deleteA = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "delete-a",
          content: "# Delete A",
        }),
      );
      const deleteB = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "delete-b",
          content: "# Delete B",
        }),
      );

      const deleteResult = await runCli(["resource", "delete"], {
        isTTY: true,
        promptResponses: [{ value: [deleteA.id, deleteB.id] }],
      });

      expect(deleteResult.stdout).toContain('"delete-a"');
      expect(deleteResult.stdout).toContain('"delete-b"');
      expect(resourceModel.getResource(deleteA.id)).toBeUndefined();
      expect(resourceModel.getResource(deleteB.id)).toBeUndefined();
      expect(resourceModel.getResource(keep.id)?.name).toBe("keep-me");
    } finally {
      await context.cleanup();
    }
  });

  it("emits JSON for resource list and show", async () => {
    const context = await createTestContext("cli-resource-json");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "json-resource",
          description: "JSON resource",
          content: "# JSON Resource",
        }),
      );

      const list = await runCli(["resource", "list", "--format", "json"]);
      const show = await runCli(["resource", "show", resource.id, "--format", "json"]);

      expect(JSON.parse(list.stdout)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: resource.id,
            name: "json-resource",
            type: "skill",
          }),
        ]),
      );
      expect(JSON.parse(show.stdout)).toEqual(
        expect.objectContaining({
          id: resource.id,
          name: "json-resource",
          content: "# JSON Resource",
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("emits JSON ambiguity payloads for resource selectors", async () => {
    const context = await createTestContext("cli-resource-json-ambiguous");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "dup-name" }),
      );
      resourceModel.createResource(
        makeResourceInput({ type: "rule", name: "dup-name" }),
      );

      const result = await runCli(["resource", "show", "dup-name", "--format", "json"]);

      expect(JSON.parse(result.stdout)).toEqual(
        expect.objectContaining({
          error: "ambiguous_resource_name",
          input: "dup-name",
          matches: expect.arrayContaining([
            expect.objectContaining({ name: "dup-name" }),
          ]),
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("resource show prefers unnamespaced match for bare selector", async () => {
    const context = await createTestContext("cli-resource-prefer-unnamespaced");

    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");

      resourceModel.upsertResource(
        {
          type: "skill",
          name: "brainstorming",
          namespace: "cursor-team-kit",
          description: "",
          content: "# Namespaced",
          metadata: {},
          source: "test",
          origin_kind: "marketplace_link",
          origin_ref: "brainstorming@cursor-team-kit",
        },
        { policy: "overwrite" },
      );
      resourceModel.upsertResource(
        {
          type: "skill",
          name: "brainstorming",
          namespace: "",
          description: "",
          content: "# Default",
          metadata: {},
          source: "test",
          origin_kind: "manual",
          origin_ref: "",
        },
        { policy: "overwrite" },
      );

      const show = await runCli(["resource", "show", "brainstorming"]);
      expect(show.stdout).toContain("# Default");
    } finally {
      await context.cleanup();
    }
  });

  it("resource ambiguity table hides IDs by default and reveals them with --show-id", async () => {
    const context = await createTestContext("cli-resource-ambiguous-show-id");

    try {
      await runCli(["init"]);

      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "duplicate-name",
          description: "First duplicate",
          content: "# First",
        }),
      );
      resourceModel.createResource(
        makeResourceInput({
          type: "rule",
          name: "duplicate-name",
          description: "Second duplicate",
          content: "# Second",
        }),
      );

      const hidden = await runCli(["resource", "show", "duplicate-name"]);
      const shown = await runCli(["resource", "show", "duplicate-name", "--show-id"]);

      expect(hidden.stderr).toContain("Ambiguous resource selector: duplicate-name");
      expect(hidden.stdout).not.toContain("# First");
      expect(hidden.stdout).not.toContain("# Second");
      expect(hidden.stdout).toContain("TYPE");
      expect(hidden.stdout).toContain("NAME");
      expect(hidden.stdout).not.toMatch(/\|\s+ID\s+\|/);

      expect(shown.stderr).toContain("Ambiguous resource selector: duplicate-name");
      expect(shown.stdout).toMatch(/\|\s+ID\s+\|/);
    } finally {
      await context.cleanup();
    }
  });
});
