import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import {
  addDependency,
  listDependencies,
} from "../../src/services/plugin-dependency.ts";

describe("agent constraint recovery routes", () => {
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

  async function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-recovery-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
    process.env.HOME = dir;
    const server = await startAgentServer({ port: 0 });
    servers.push(server);
    return { ...server, home: dir };
  }

  it("requires bearer auth", async () => {
    const server = await withServer();
    const response = await fetch(`${server.url}/v1/recovery/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        root: "my-setup",
        action: {
          id: "detach-dependency",
          label: "Detach design-doc",
          rootName: "my-setup",
          pluginName: "design-doc",
        },
      }),
    });
    expect(response.status).toBe(401);
  });

  it("runs detach-dependency and removes the dependency", async () => {
    const server = await withServer();
    const root = createPlugin({ name: "my-setup" });
    addDependency(root.id, "design-doc@anthropics", { versionConstraint: "*" });
    expect(listDependencies(root.id)).toHaveLength(1);

    const response = await fetch(`${server.url}/v1/recovery/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        root: "my-setup",
        action: {
          id: "detach-dependency",
          label: "Detach design-doc from my-setup",
          rootName: "my-setup",
          pluginName: "design-doc",
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(listDependencies(root.id)).toEqual([]);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
