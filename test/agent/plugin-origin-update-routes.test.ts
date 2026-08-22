import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/plugin-origin-update.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";
import * as originUpdate from "../../src/services/plugin-origin-update.ts";
import { AUTHORED_CHECK_MESSAGE } from "../../src/services/plugin-origin-update.ts";
import type { TestContext } from "../helpers/db.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const TOKEN = "test-token";
const DEPS = { isAgentSwitchInProgress: () => false };

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("plugin-origin-update-routes-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function request(
  method: string,
  path: string,
  options?: { token?: string | null; body?: unknown },
): Request {
  const headers = new Headers();
  if (options?.token !== null) {
    headers.set("authorization", `Bearer ${options?.token ?? TOKEN}`);
  }
  if (options?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function handle(
  method: string,
  path: string,
  options?: { token?: string | null; body?: unknown },
): Promise<Response> {
  const response = await tryHandle(request(method, path, options), TOKEN, DEPS);
  if (!response) {
    throw new Error(`tryHandle returned null for ${method} ${path}`);
  }
  return response;
}

describe("GET /v1/plugins/check", () => {
  it("returns 401 without bearer", async () => {
    const response = await handle("GET", "/v1/plugins/check", { token: null });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns check rows", async () => {
    createPlugin({ name: "eng", version: "1.0.0" });

    const response = await handle("GET", "/v1/plugins/check?refresh=1&name=eng");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{
        name: string;
        status: string;
        message?: string;
        local_version: string;
      }>;
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      name: "eng",
      status: "unknown",
      local_version: "1.0.0",
      message: AUTHORED_CHECK_MESSAGE,
    });
  });

  it("returns null for unrelated paths", async () => {
    const result = await tryHandle(request("GET", "/v1/health"), TOKEN, DEPS);
    expect(result).toBeNull();
  });

  it("wraps check failures as a structured 500", async () => {
    const spy = spyOn(originUpdate, "checkPluginOrigins").mockRejectedValue(
      new Error("origin fetch exploded"),
    );
    try {
      const response = await handle("GET", "/v1/plugins/check");
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error).toBe("check_failed");
      expect(body.message).toBe("origin fetch exploded");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("POST /v1/plugins/update", () => {
  it("returns 401 without bearer", async () => {
    const response = await handle("POST", "/v1/plugins/update", {
      token: null,
      body: { name: "eng" },
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("updates a named plugin", async () => {
    createPlugin({ name: "eng", version: "1.0.0" });

    const response = await handle("POST", "/v1/plugins/update", {
      body: { name: "eng" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{ name: string; status: string; message?: string }>;
      summary: { updated: number; skipped: number; failed: number };
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      name: "eng",
      status: "skipped",
      message: AUTHORED_CHECK_MESSAGE,
    });
    expect(body.summary).toEqual({ updated: 0, skipped: 1, failed: 0 });
  });

  it("returns 400 when body has neither name nor all", async () => {
    const response = await handle("POST", "/v1/plugins/update", { body: {} });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("runs a batch when all is true", async () => {
    const eng = createPlugin({ name: "eng", version: "1.0.0", origin: "upstream" });
    const ops = createPlugin({ name: "ops", version: "2.0.0", origin: "upstream" });
    setPluginOrigin(eng.id, "upstream");
    setPluginOrigin(ops.id, "upstream");

    const response = await handle("POST", "/v1/plugins/update", {
      body: { all: true },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{ name: string; status: string }>;
      summary: { updated: number; skipped: number; failed: number };
    };
    expect(body.results.map((row) => row.name).sort()).toEqual(["eng", "ops"]);
    expect(body.results.every((row) => row.status === "skipped")).toBe(true);
    expect(body.summary).toEqual({ updated: 0, skipped: 2, failed: 0 });
  });
});
