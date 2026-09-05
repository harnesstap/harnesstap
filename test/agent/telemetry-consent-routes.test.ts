import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { startAgentServer } from "../../src/agent/serve.ts";
import {
  TELEMETRY_CONSENT_TITLE,
  TELEMETRY_CLI_DISABLE_INSTRUCTIONS,
} from "../../src/telemetry/copy.ts";

describe("agent telemetry consent routes", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const previousTelemetry = process.env.HARNESSTAP_TELEMETRY;
  const previousKey = process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY;
  const tempDirs: string[] = [];
  const servers: Array<{ stop: () => void; url: string; token: string }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) delete process.env.HARNESSTAP_HOME;
    else process.env.HARNESSTAP_HOME = previousHome;
    if (previousTelemetry === undefined) delete process.env.HARNESSTAP_TELEMETRY;
    else process.env.HARNESSTAP_TELEMETRY = previousTelemetry;
    if (previousKey === undefined) delete process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY;
    else process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY = previousKey;
  });

  async function withServer() {
    const dir = mkdtempSync(join(tmpdir(), "ht-agent-tel-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    process.env.HARNESSTAP_TELEMETRY = "";
    process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY = "phc_test";
    const server = await startAgentServer({ port: 0 });
    servers.push(server);
    return { server, dir };
  }

  it("GET /v1/telemetry requires auth and reports unsettled consent", async () => {
    const { server } = await withServer();
    const unauth = await fetch(`${server.url}/v1/telemetry`);
    expect(unauth.status).toBe(401);

    const response = await fetch(`${server.url}/v1/telemetry`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.needs_consent).toBe(true);
    expect(body.enabled).toBe(false);
    expect(body.copy.title).toBe(TELEMETRY_CONSENT_TITLE);
    expect(body.copy.not_tracked.join(" ")).toContain("No personal data");
  });

  it("PUT /v1/telemetry persists the choice so the modal is not needed again", async () => {
    const { server, dir } = await withServer();
    const put = await fetch(`${server.url}/v1/telemetry`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: false }),
    });
    expect(put.status).toBe(200);
    const saved = await put.json();
    expect(saved.needs_consent).toBe(false);
    expect(saved.preference).toBe(false);
    expect(saved.enabled).toBe(false);

    const get = await fetch(`${server.url}/v1/telemetry`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    const loaded = await get.json();
    expect(loaded.needs_consent).toBe(false);
    expect(loaded.preference).toBe(false);

    const raw = JSON.parse(readFileSync(join(dir, "config.jsonc"), "utf-8")) as {
      telemetry: { enabled: boolean };
    };
    expect(raw.telemetry.enabled).toBe(false);
  });

  it("PUT enable then disable toggles the Preferences value", async () => {
    const { server } = await withServer();
    const enable = await fetch(`${server.url}/v1/telemetry`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    });
    expect((await enable.json()).preference).toBe(true);

    const disable = await fetch(`${server.url}/v1/telemetry`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: false }),
    });
    expect((await disable.json()).preference).toBe(false);
    expect(TELEMETRY_CLI_DISABLE_INSTRUCTIONS).toContain("HARNESSTAP_TELEMETRY=0");
  });
});
