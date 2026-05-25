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

  it("lists the full resource ID", async () => {
    const context = await createTestContext("cli-resource-list-full-id");

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

      const resourceList = await runCli(["resource", "list"]);

      // IDs are shortened in human-mode table output (first 6 chars always visible)
      expect(resourceList.stdout).toContain(resource.id.slice(0, 6));
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

  it("reports an ambiguous resource name", async () => {
    const context = await createTestContext("cli-resource-ambiguous-name");

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

      const resourceShow = await runCli(["resource", "show", "duplicate-name"]);

      expect(resourceShow.stderr).toContain("Ambiguous resource selector: duplicate-name");
      expect(resourceShow.stdout).not.toContain("# First");
      expect(resourceShow.stdout).not.toContain("# Second");
      // match table headers must appear in stdout
      expect(resourceShow.stdout).toContain("TYPE");
      expect(resourceShow.stdout).toContain("NAME");
      expect(resourceShow.stdout).toContain("ID");
    } finally {
      await context.cleanup();
    }
  });
});
