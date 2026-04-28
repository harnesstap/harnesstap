import { describe, expect, it } from "vitest";
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
      expect(resourceShow.stdout).toContain("# Shared");

      await runCli(["resource", "delete", resource.id]);
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

      expect(resourceList.stdout).toContain(resource.id);
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

      await runCli(["resource", "delete", "delete-me"]);

      expect(resourceModel.getResource(resource.id)).toBeUndefined();
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

      expect(resourceShow.stderr).toContain("Ambiguous resource name: duplicate-name");
      expect(resourceShow.stdout).not.toContain("# First");
      expect(resourceShow.stdout).not.toContain("# Second");
    } finally {
      await context.cleanup();
    }
  });
});
