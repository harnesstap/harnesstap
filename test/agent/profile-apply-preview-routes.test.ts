import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";

describe("agent profile apply-preview routes", () => {
  const previousHarnessTapHome = process.env.HARNESSTAP_HOME;
  const previousHome = process.env.HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.stop();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    restoreEnv("HARNESSTAP_HOME", previousHarnessTapHome);
    restoreEnv("HOME", previousHome);
  });

  function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-apply-preview-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
    process.env.HOME = dir;
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return { ...server, home: dir };
  }

  it("requires bearer auth", async () => {
    const server = withServer();
    const response = await fetch(`${server.url}/v1/profiles/apply-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: "work", scope: "home" }),
    });
    expect(response.status).toBe(401);
  });

  it("returns home apply preview for a selected profile", async () => {
    const server = withServer();
    const layer = createLayer({ name: "work" });
    setLayerTags(layer.id, ["profile"]);
    const resource = createResource({
      type: "instruction",
      name: "guide",
      description: "",
      content: "# guide",
      metadata: {},
      source: "manual",
    });
    addResourceToLayer(layer.id, resource.id);
    setActiveProfileName("work");

    const response = await fetch(`${server.url}/v1/profiles/apply-preview`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({ profile: "work", scope: "home", harness: "claude-code" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      profile: string;
      scope: string;
      relative_to_active: boolean;
      contents: { stack_resource_count: number } | null;
      files: { expected_count: number; changes: unknown[] };
      harnesses?: Record<string, unknown>;
    };
    expect(body.profile).toBe("work");
    expect(body.scope).toBe("home");
    expect(body.relative_to_active).toBe(true);
    expect(body.contents?.stack_resource_count).toBe(1);
    expect(body.files.expected_count).toBeGreaterThan(0);
    expect(body.harnesses).toBeDefined();
  });

  it("rejects project scope without projectPath", async () => {
    const server = withServer();
    const response = await fetch(`${server.url}/v1/profiles/apply-preview`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({ profile: "work", scope: "project" }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "project_path_required",
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
