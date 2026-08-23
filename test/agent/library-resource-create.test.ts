import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createAgentFetchHandler } from "../../src/agent/routes.ts";
import {
  createInitializedTestContext,
  type TestContext,
} from "../helpers/db.ts";

const TOKEN = "test-token";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("library-resource-create-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function handle(body: unknown, token: string | null = TOKEN): Promise<Response> {
  const request = new Request("http://127.0.0.1/v1/library/resources", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return Promise.resolve(createAgentFetchHandler(TOKEN, 7474)(request)).then(
    (response) => response,
  );
}

describe("POST /v1/library/resources", () => {
  it("requires bearer auth", async () => {
    const response = await handle({ type: "skill", name: "ship" }, null);
    expect(response.status).toBe(401);
  });

  it("creates a skill resource", async () => {
    const response = await handle({
      type: "skill",
      name: "ship",
      description: "Ship it",
      content: "# Ship\nDo the thing.",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      resource: { id: string; type: string; name: string; source: string; origin_kind: string };
    };
    expect(body.resource.type).toBe("skill");
    expect(body.resource.name).toBe("ship");
    expect(body.resource.source).toBe("manual");
    expect(body.resource.origin_kind).toBe("manual");
    expect(body.resource.id).toBeTruthy();
  });

  it("trims the name", async () => {
    const response = await handle({ type: "instruction", name: "  tidy  ", content: "Be tidy" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { resource: { name: string } };
    expect(body.resource.name).toBe("tidy");
  });

  it("returns 409 resource_conflict on duplicate type+name", async () => {
    await handle({ type: "command", name: "dupe", content: "one" });
    const response = await handle({ type: "command", name: "dupe", content: "two" });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("resource_conflict");
  });

  it("allows same name across different types", async () => {
    await handle({ type: "command", name: "shared", content: "cmd" });
    const response = await handle({ type: "skill", name: "shared", content: "skill body" });
    expect(response.status).toBe(200);
  });

  it("returns 400 when type is unknown", async () => {
    const response = await handle({ type: "widget", name: "x" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_type");
  });

  it("rejects composition types", async () => {
    const response = await handle({ type: "plugin", name: "nope" });
    expect(response.status).toBe(400);
  });

  it("returns 400 when name is missing", async () => {
    const response = await handle({ type: "skill", content: "body" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("returns 400 when content is required but missing", async () => {
    for (const type of ["instruction", "skill", "rule", "agent", "command"]) {
      const response = await handle({ type, name: `n-${type}` });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("content is required");
    }
  });

  it("validates permission action and pattern", async () => {
    const badAction = await handle({
      type: "permission", name: "p1", metadata: { action: "maybe", pattern: "Bash(*)" },
    });
    expect(badAction.status).toBe(400);

    const missingPattern = await handle({
      type: "permission", name: "p2", metadata: { action: "allow" },
    });
    expect(missingPattern.status).toBe(400);

    const ok = await handle({
      type: "permission", name: "p3", metadata: { action: "deny", pattern: "Bash(rm *)" },
    });
    expect(ok.status).toBe(200);
  });

  it("validates env_var key/value", async () => {
    const missingValue = await handle({
      type: "env_var", name: "e1", metadata: { key: "FOO" },
    });
    expect(missingValue.status).toBe(400);

    const ok = await handle({
      type: "env_var", name: "e2", metadata: { key: "FOO", value: "bar" },
    });
    expect(ok.status).toBe(200);
  });

  it("validates hook event/script", async () => {
    const missingScript = await handle({
      type: "hook", name: "h1", metadata: { event: "post_tool_use" },
    });
    expect(missingScript.status).toBe(400);

    const ok = await handle({
      type: "hook", name: "h2", metadata: { event: "post_tool_use", script: "./check.sh" },
    });
    expect(ok.status).toBe(200);
  });

  it("validates mcp_server transport-dependent fields", async () => {
    const badTransport = await handle({
      type: "mcp_server", name: "m0", metadata: { transport: "carrier-pigeon" },
    });
    expect(badTransport.status).toBe(400);

    const stdioMissingCommand = await handle({
      type: "mcp_server", name: "m1", metadata: { transport: "stdio" },
    });
    expect(stdioMissingCommand.status).toBe(400);

    const httpMissingUrl = await handle({
      type: "mcp_server", name: "m2", metadata: { transport: "http" },
    });
    expect(httpMissingUrl.status).toBe(400);

    const stdioOk = await handle({
      type: "mcp_server", name: "m3",
      metadata: { transport: "stdio", command: "npx", args: ["-y", "server"] },
    });
    expect(stdioOk.status).toBe(200);

    const httpOk = await handle({
      type: "mcp_server", name: "m4", metadata: { transport: "http", url: "https://example.com/mcp" },
    });
    expect(httpOk.status).toBe(200);
  });

  it("validates model_config model", async () => {
    const missing = await handle({ type: "model_config", name: "mc1" });
    expect(missing.status).toBe(400);

    const ok = await handle({
      type: "model_config", name: "mc2", metadata: { model: "gpt-5", provider: "openai" },
    });
    expect(ok.status).toBe(200);
  });

  it("stores rule metadata", async () => {
    const response = await handle({
      type: "rule", name: "r1", content: "Use bun",
      metadata: { globs: ["src/**/*.ts"], always_apply: false },
    });
    expect(response.status).toBe(200);
  });

  it("rejects unknown metadata fields", async () => {
    const response = await handle({
      type: "rule", name: "r-bogus", content: "Use bun",
      metadata: { bogus: true },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_body");
    expect(body.message).toContain("unknown metadata field");
  });

  it("allows known optional metadata extras", async () => {
    const response = await handle({
      type: "skill", name: "s-extras", content: "# Skill",
      metadata: { scripts: [] },
    });
    expect(response.status).toBe(200);
  });
});
