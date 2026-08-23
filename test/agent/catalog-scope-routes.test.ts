import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";

describe("agent catalog scope routes", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.HARNESSTAP_HOME;
    else process.env.HARNESSTAP_HOME = previousHome;
  });

  async function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-catalog-scope-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    const server = await startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  function authHeaders(token: string): HeadersInit {
    return { Authorization: `Bearer ${token}` };
  }

  it("returns empty catalog scope with bearer auth", async () => {
    const server = await withServer();

    const ok = await fetch(`${server.url}/v1/catalogs/scope`, {
      headers: authHeaders(server.token),
    });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({
      defaultOrg: "harnesstap-cloud",
      publicCatalog: true,
      connectedOrgs: [],
      registered: [],
    });
  });

  it("connects an org then includes it in catalog scope", async () => {
    const server = await withServer();

    const connected = await fetch(`${server.url}/v1/catalogs/connected-orgs/acme`, {
      method: "POST",
      headers: authHeaders(server.token),
    });
    expect(connected.status).toBe(200);
    await expect(connected.json()).resolves.toEqual({ connectedOrgs: ["acme"] });

    const scope = await fetch(`${server.url}/v1/catalogs/scope`, {
      headers: authHeaders(server.token),
    });
    expect(scope.status).toBe(200);
    const body = (await scope.json()) as {
      connectedOrgs: string[];
      defaultOrg: string;
    };
    expect(body.defaultOrg).toBe("harnesstap-cloud");
    expect(body.connectedOrgs).toEqual(["acme"]);
  });

  it("disconnects a connected org", async () => {
    const server = await withServer();

    const connected = await fetch(`${server.url}/v1/catalogs/connected-orgs/acme`, {
      method: "POST",
      headers: authHeaders(server.token),
    });
    expect(connected.status).toBe(200);

    const disconnected = await fetch(`${server.url}/v1/catalogs/connected-orgs/acme`, {
      method: "DELETE",
      headers: authHeaders(server.token),
    });
    expect(disconnected.status).toBe(200);
    await expect(disconnected.json()).resolves.toEqual({ connectedOrgs: [] });

    const scope = await fetch(`${server.url}/v1/catalogs/scope`, {
      headers: authHeaders(server.token),
    });
    const body = (await scope.json()) as { connectedOrgs: string[] };
    expect(body.connectedOrgs).toEqual([]);
  });

  it("rejects connecting or disconnecting the default org and aliases", async () => {
    const server = await withServer();

    for (const org of ["harnesstap-cloud", "harnessdeck-cloud"]) {
      const connect = await fetch(`${server.url}/v1/catalogs/connected-orgs/${org}`, {
        method: "POST",
        headers: authHeaders(server.token),
      });
      expect(connect.status).toBe(400);
      const connectBody = (await connect.json()) as { error: string };
      expect(connectBody.error).toBe("default_org");

      const disconnect = await fetch(`${server.url}/v1/catalogs/connected-orgs/${org}`, {
        method: "DELETE",
        headers: authHeaders(server.token),
      });
      expect(disconnect.status).toBe(400);
      const disconnectBody = (await disconnect.json()) as { error: string };
      expect(disconnectBody.error).toBe("default_org");
    }
  });

  it("rejects unauthenticated GET, POST, and DELETE", async () => {
    const server = await withServer();

    const getDenied = await fetch(`${server.url}/v1/catalogs/scope`);
    expect(getDenied.status).toBe(401);

    const postDenied = await fetch(`${server.url}/v1/catalogs/connected-orgs/acme`, {
      method: "POST",
    });
    expect(postDenied.status).toBe(401);

    const deleteDenied = await fetch(`${server.url}/v1/catalogs/connected-orgs/acme`, {
      method: "DELETE",
    });
    expect(deleteDenied.status).toBe(401);
  });

  it("includes registered catalogs in GET scope", async () => {
    const server = await withServer();

    const connected = await fetch(`${server.url}/v1/catalogs/connected-orgs/acme`, {
      method: "POST",
      headers: authHeaders(server.token),
    });
    expect(connected.status).toBe(200);

    const registered = await fetch(`${server.url}/v1/catalogs/registered`, {
      method: "POST",
      headers: {
        ...authHeaders(server.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ selector: "acme/internal" }),
    });
    expect(registered.status).toBe(200);

    const scope = await fetch(`${server.url}/v1/catalogs/scope`, {
      headers: authHeaders(server.token),
    });
    expect(scope.status).toBe(200);
    const body = (await scope.json()) as {
      connectedOrgs: string[];
      registered: Array<{ org: string; catalog: string }>;
    };
    expect(body.connectedOrgs).toEqual(["acme"]);
    expect(body.registered).toEqual([{ org: "acme", catalog: "internal" }]);
  });
});
