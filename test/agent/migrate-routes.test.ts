import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import {
  addResourceToPlugin,
  createPlugin,
} from "../../src/models/plugin-model.ts";
import {
  createEnvironment,
  upsertEnvironmentEnvVar,
} from "../../src/models/environment.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  exportScopedMigration,
  resolveExportScope,
} from "../../src/services/migrate-scope.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("agent migrate routes", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) delete process.env.HARNESSTAP_HOME;
    else process.env.HARNESSTAP_HOME = previousHome;
  });

  function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-migrate-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  it("POST /v1/migrate/detect-import-scope requires auth and detects workspace archive", async () => {
    const server = withServer();
    createPlugin({ name: "migrate-plugin" });

    const archivePath = join(tempDirs.at(-1)!, "workspace.tar.gz");
    const resolved = resolveExportScope({ workspace: true, file: archivePath });
    exportScopedMigration(resolved, { workspace: true, file: archivePath });

    const unauth = await fetch(`${server.url}/v1/migrate/detect-import-scope`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: archivePath }),
    });
    expect(unauth.status).toBe(401);

    const response = await fetch(`${server.url}/v1/migrate/detect-import-scope`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: archivePath }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope).toBe("workspace");
  });

  it("POST /v1/migrate/detect-import-scope returns 400 for missing path", async () => {
    const server = withServer();

    const response = await fetch(`${server.url}/v1/migrate/detect-import-scope`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("path_required");
  });

  it("POST /v1/migrate/export exports a plugin bundle", async () => {
    const server = withServer();
    const plugin = createPlugin({ name: "export-plugin" });
    const resource = createResource(
      makeResourceInput({ type: "skill", name: "helper" }),
    );
    addResourceToPlugin(plugin.id, resource.id);

    const outputPath = join(tempDirs.at(-1)!, "export-plugin.ap.json");
    const response = await fetch(`${server.url}/v1/migrate/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "plugin",
        path: outputPath,
        plugin: "export-plugin",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope).toBe("plugin");
    expect(body.output).toBe(outputPath);
    expect(body.plugins).toEqual(["export-plugin"]);
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, "utf-8")).toContain("export-plugin");
  });

  it("POST /v1/migrate/export exports workspace archive", async () => {
    const server = withServer();
    createPlugin({ name: "workspace-plugin" });

    const archivePath = join(tempDirs.at(-1)!, "workspace.tar.gz");
    const response = await fetch(`${server.url}/v1/migrate/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "workspace",
        path: archivePath,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope).toBe("workspace");
    expect(body.output).toBe(archivePath);
    expect(body.plugin_count).toBeGreaterThanOrEqual(1);
    expect(existsSync(archivePath)).toBe(true);
  });

  it("POST /v1/migrate/export returns 400 for unknown plugin", async () => {
    const server = withServer();
    const outputPath = join(tempDirs.at(-1)!, "missing.ap.json");

    const response = await fetch(`${server.url}/v1/migrate/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "plugin",
        path: outputPath,
        plugin: "does-not-exist",
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("export_failed");
    expect(body.message).toMatch(/not found/i);
  });

  it("POST /v1/migrate/export exports a resource document", async () => {
    const server = withServer();
    createResource(
      makeResourceInput({
        type: "instruction",
        name: "solo",
        content: "# Solo instruction\n",
      }),
    );

    const outputPath = join(tempDirs.at(-1)!, "solo.ap.json");
    const response = await fetch(`${server.url}/v1/migrate/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "resource",
        path: outputPath,
        resource: "instruction:solo",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope).toBe("resource");
    expect(body.output).toBe(outputPath);
    expect(body.resource).toBe("instruction:solo");
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, "utf-8")).toContain("solo");
  });

  it("POST /v1/migrate/export rejects standalone environment export", async () => {
    const server = withServer();
    const environment = createEnvironment({ name: "staging" });
    upsertEnvironmentEnvVar(environment.id, "API_KEY", "secret");

    const outputPath = join(tempDirs.at(-1)!, "staging.ap.json");
    const response = await fetch(`${server.url}/v1/migrate/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "environment",
        path: outputPath,
        environment: "staging",
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string; message?: string };
    expect(body.message ?? body.error ?? "").toMatch(/workspace/i);
  });

  it("POST /v1/migrate/import imports a plugin bundle with detected scope", async () => {
    const exportDir = mkdtempSync(join(tmpdir(), "ht-agent-migrate-bundle-"));
    tempDirs.push(exportDir);
    const bundlePath = join(exportDir, "import-plugin.ap.json");

    const exportServer = withServer();
    const plugin = createPlugin({ name: "import-plugin" });
    const resource = createResource(
      makeResourceInput({ type: "skill", name: "imported-skill" }),
    );
    addResourceToPlugin(plugin.id, resource.id);

    const exportResponse = await fetch(`${exportServer.url}/v1/migrate/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${exportServer.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "plugin",
        path: bundlePath,
        plugin: "import-plugin",
      }),
    });
    expect(exportResponse.status).toBe(200);

    const importServer = withServer();
    const response = await fetch(`${importServer.url}/v1/migrate/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${importServer.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: bundlePath }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope).toBe("plugin");
    expect(body.plugins).toEqual(["import-plugin"]);
    expect(body.plugin).toBe("import-plugin");
  });

  it("POST /v1/migrate/import returns 400 for forced scope mismatch", async () => {
    const server = withServer();
    createPlugin({ name: "mismatch-plugin" });

    const bundlePath = join(tempDirs.at(-1)!, "mismatch-plugin.ap.json");
    const exportResponse = await fetch(`${server.url}/v1/migrate/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "plugin",
        path: bundlePath,
        plugin: "mismatch-plugin",
      }),
    });
    expect(exportResponse.status).toBe(200);

    const response = await fetch(`${server.url}/v1/migrate/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: bundlePath, scope: "workspace" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("import_failed");
    expect(body.message).toMatch(/looks like plugin data/i);
  });
});
