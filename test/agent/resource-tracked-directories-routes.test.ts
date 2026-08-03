import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";

describe("agent resource tracked directory routes", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.stop();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) {
      delete process.env.HARNESSTAP_HOME;
    } else {
      process.env.HARNESSTAP_HOME = previousHome;
    }
  });

  function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-tracked-dirs-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    mkdirSync(dir, { recursive: true });
    const server = startAgentServer({ port: 0 });
    servers.push(server);
    return server;
  }

  it("lists, adds, and removes tracked directories", async () => {
    const server = withServer();
    const scanDir = mkdtempSync(join(tmpdir(), "ht-tracked-scan-"));
    tempDirs.push(scanDir);
    mkdirSync(join(scanDir, ".cursor", "rules"), { recursive: true });
    writeFileSync(
      join(scanDir, ".cursor", "rules", "guide.mdc"),
      "---\ndescription: Guide\n---\n# Guide",
    );

    const denied = await fetch(`${server.url}/v1/library/resource-directories`);
    expect(denied.status).toBe(401);

    const list = await fetch(`${server.url}/v1/library/resource-directories`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      directories: Array<{ kind: string }>;
    };
    expect(listBody.directories.some((entry) => entry.kind === "home_default")).toBe(
      true,
    );

    const added = await fetch(`${server.url}/v1/library/resource-directories`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: scanDir }),
    });
    expect(added.status).toBe(200);
    const addedBody = (await added.json()) as { imported_count: number };
    expect(addedBody.imported_count).toBeGreaterThan(0);

    const removed = await fetch(`${server.url}/v1/library/resource-directories`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${server.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: scanDir }),
    });
    expect(removed.status).toBe(200);
  });

  it("rescans tracked directories", async () => {
    const previousOsHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const server = withServer();
    const workspace = process.env.HARNESSTAP_HOME;
    expect(workspace).toBeTruthy();
    if (!workspace) {
      return;
    }

    const fakeHome = join(workspace, "user-home");
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    mkdirSync(join(fakeHome, ".cursor", "rules"), { recursive: true });
    writeFileSync(
      join(fakeHome, ".cursor", "rules", "home.mdc"),
      "---\ndescription: Home\nalwaysApply: true\n---\n# Home",
    );

    try {
      const denied = await fetch(
        `${server.url}/v1/library/resource-directories/rescan`,
        { method: "POST" },
      );
      expect(denied.status).toBe(401);

      const rescanned = await fetch(
        `${server.url}/v1/library/resource-directories/rescan`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${server.token}` },
        },
      );
      expect(rescanned.status).toBe(200);
      const body = (await rescanned.json()) as {
        imported_count: number;
        rescanned: Array<{ kind: string }>;
        directories: Array<{ kind: string }>;
      };
      expect(body.imported_count).toBeGreaterThan(0);
      expect(body.rescanned.some((entry) => entry.kind === "home_default")).toBe(
        true,
      );
      expect(
        body.directories.some((entry) => entry.kind === "home_default"),
      ).toBe(true);
    } finally {
      if (previousOsHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousOsHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
    }
  });
});
