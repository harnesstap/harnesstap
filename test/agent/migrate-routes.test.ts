import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import {
  addResourceToLayer,
  createLayer,
} from "../../src/models/layer-model.ts";
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
    createLayer({ name: "migrate-layer" });

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

  it("POST /v1/migrate/export exports a layer bundle", async () => {
    const server = withServer();
    const layer = createLayer({ name: "export-layer" });
    const resource = createResource(
      makeResourceInput({ type: "skill", name: "helper" }),
    );
    addResourceToLayer(layer.id, resource.id);

    const outputPath = join(tempDirs.at(-1)!, "export-layer.harnesstap.toml");
    const response = await fetch(`${server.url}/v1/migrate/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "layer",
        path: outputPath,
        layer: "export-layer",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope).toBe("layer");
    expect(body.output).toBe(outputPath);
    expect(body.layers).toEqual(["export-layer"]);
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, "utf-8")).toContain("export-layer");
  });

  it("POST /v1/migrate/export exports workspace archive", async () => {
    const server = withServer();
    createLayer({ name: "workspace-layer" });

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
    expect(body.layer_count).toBeGreaterThanOrEqual(1);
    expect(existsSync(archivePath)).toBe(true);
  });

  it("POST /v1/migrate/export returns 400 for unknown layer", async () => {
    const server = withServer();
    const outputPath = join(tempDirs.at(-1)!, "missing.harnesstap.toml");

    const response = await fetch(`${server.url}/v1/migrate/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "layer",
        path: outputPath,
        layer: "does-not-exist",
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

    const outputPath = join(tempDirs.at(-1)!, "solo.harnesstap.toml");
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

  it("POST /v1/migrate/export exports an environment document", async () => {
    const server = withServer();
    const environment = createEnvironment({ name: "staging" });
    upsertEnvironmentEnvVar(environment.id, "API_KEY", "secret");

    const outputPath = join(tempDirs.at(-1)!, "staging.environment.toml");
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

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scope).toBe("environment");
    expect(body.output).toBe(outputPath);
    expect(body.environment).toBe("staging");
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, "utf-8")).toContain("staging");
  });

  it("POST /v1/migrate/import imports a layer bundle with detected scope", async () => {
    const exportDir = mkdtempSync(join(tmpdir(), "ht-agent-migrate-bundle-"));
    tempDirs.push(exportDir);
    const bundlePath = join(exportDir, "import-layer.harnesstap.toml");

    const exportServer = withServer();
    const layer = createLayer({ name: "import-layer" });
    const resource = createResource(
      makeResourceInput({ type: "skill", name: "imported-skill" }),
    );
    addResourceToLayer(layer.id, resource.id);

    const exportResponse = await fetch(`${exportServer.url}/v1/migrate/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${exportServer.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "layer",
        path: bundlePath,
        layer: "import-layer",
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
    expect(body.scope).toBe("layer");
    expect(body.layers).toEqual(["import-layer"]);
    expect(body.layer).toBe("import-layer");
  });

  it("POST /v1/migrate/import returns 400 for forced scope mismatch", async () => {
    const server = withServer();
    createLayer({ name: "mismatch-layer" });

    const bundlePath = join(tempDirs.at(-1)!, "mismatch-layer.harnesstap.toml");
    const exportResponse = await fetch(`${server.url}/v1/migrate/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "layer",
        path: bundlePath,
        layer: "mismatch-layer",
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
    expect(body.message).toMatch(/looks like layer data/i);
  });
});
