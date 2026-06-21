import { describe, expect, it } from "bun:test";
import type { Resource } from "../../src/types.js";
import {
  substituteEnvironmentVars,
  substituteResourceMetadata,
  substituteResourcesForApply,
} from "../../src/services/environment-var-substitution.ts";

function makeMcpResource(
  metadata: Record<string, unknown>,
  name = "posthog",
): Resource {
  return {
    id: "01TEST",
    type: "mcp_server",
    name,
    description: "",
    content: "",
    metadata,
    source: "manual",
    namespace: "",
    origin_kind: "manual",
    origin_ref: "",
    content_hash: "",
    content_blob_ref: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("environment var substitution", () => {
  it("substitutes known placeholders in strings", () => {
    const result = substituteEnvironmentVars("prefix-${API_KEY}-suffix", {
      API_KEY: "secret",
    });

    expect(result).toEqual({
      value: "prefix-secret-suffix",
      missing: [],
    });
  });

  it("leaves unresolved placeholders and collects missing keys", () => {
    const result = substituteEnvironmentVars("${KNOWN} and ${MISSING}", {
      KNOWN: "ok",
    });

    expect(result).toEqual({
      value: "ok and ${MISSING}",
      missing: ["MISSING"],
    });
  });

  it("deduplicates missing keys across repeated placeholders", () => {
    const result = substituteEnvironmentVars("${MISSING}-${MISSING}", {});

    expect(result).toEqual({
      value: "${MISSING}-${MISSING}",
      missing: ["MISSING"],
    });
  });

  it("substitutes mcp_server metadata env, command, and args", () => {
    const resource = makeMcpResource({
      transport: "stdio",
      command: "${MCP_BIN}",
      args: ["--token", "${MCP_TOKEN}"],
      env: {
        MCP_KEY: "${MCP_KEY}",
        STATIC: "plain",
      },
    });

    const result = substituteResourceMetadata(resource, {
      MCP_BIN: "/usr/bin/mcp",
      MCP_TOKEN: "token-value",
      MCP_KEY: "key-value",
    });

    expect(result.missing).toEqual([]);
    expect(result.resource.metadata).toEqual({
      transport: "stdio",
      command: "/usr/bin/mcp",
      args: ["--token", "token-value"],
      env: {
        MCP_KEY: "key-value",
        STATIC: "plain",
      },
    });
  });

  it("substitutes mcp_server metadata url, headers, and auth", () => {
    const resource = makeMcpResource({
      transport: "http",
      url: "https://mcp.example.com/${TENANT}",
      headers: {
        Authorization: "Bearer ${API_TOKEN}",
      },
      auth: {
        CLIENT_ID: "${CLIENT_ID}",
        CLIENT_SECRET: "${CLIENT_SECRET}",
        scopes: ["read"],
      },
    });

    const result = substituteResourceMetadata(resource, {
      TENANT: "acme",
      API_TOKEN: "token-value",
      CLIENT_ID: "client-id",
      CLIENT_SECRET: "client-secret",
    });

    expect(result.missing).toEqual([]);
    expect(result.resource.metadata).toEqual({
      transport: "http",
      url: "https://mcp.example.com/acme",
      headers: {
        Authorization: "Bearer token-value",
      },
      auth: {
        CLIENT_ID: "client-id",
        CLIENT_SECRET: "client-secret",
        scopes: ["read"],
      },
    });
  });

  it("returns other resource types unchanged", () => {
    const resource = {
      type: "rule" as const,
      metadata: { action: "allow" as const, pattern: "${SHOULD_NOT_CHANGE}" },
    };

    const result = substituteResourceMetadata(resource, { SHOULD_NOT_CHANGE: "nope" });

    expect(result).toEqual({
      resource,
      missing: [],
    });
  });

  it("aggregates missing keys across resources in substituteResourcesForApply", () => {
    const resources = [
      makeMcpResource(
        {
          transport: "stdio",
          env: { ONE: "${ONE}" },
        },
        "first",
      ),
      makeMcpResource(
        {
          transport: "stdio",
          command: "${TWO}",
        },
        "second",
      ),
      makeMcpResource(
        {
          transport: "stdio",
          args: ["${ONE}"],
        },
        "third",
      ),
    ];

    const result = substituteResourcesForApply(resources, {});

    expect(result.missing).toEqual(["ONE", "TWO"]);
    expect(result.resources[0]?.metadata).toEqual({
      transport: "stdio",
      env: { ONE: "${ONE}" },
    });
    expect(result.resources[1]?.metadata).toEqual({
      transport: "stdio",
      command: "${TWO}",
    });
    expect(result.resources[2]?.metadata).toEqual({
      transport: "stdio",
      args: ["${ONE}"],
    });
  });

  it("does not mutate the original resources", () => {
    const resource = makeMcpResource({
      transport: "stdio",
      env: { MCP_KEY: "${MCP_KEY}" },
    });
    const originalMetadata = resource.metadata;

    substituteResourcesForApply([resource], { MCP_KEY: "resolved" });

    expect(resource.metadata).toBe(originalMetadata);
    expect((resource.metadata as { env?: Record<string, string> }).env).toEqual({
      MCP_KEY: "${MCP_KEY}",
    });
  });
});
