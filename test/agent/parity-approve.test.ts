import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/approve.ts";
import { setAgentApplyInProgressForTests, resetAgentApplyInProgressForTests } from "../../src/agent/parity-handlers/apply.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";

const TOKEN = "test-token";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("parity-approve-");
  resetAgentApplyInProgressForTests();
  writeFileSync(
    join(ctx.projectDir, "apm.yml"),
    `name: demo
version: "1.0.0"
executables: {}
`,
    "utf-8",
  );
});

afterEach(async () => {
  resetAgentApplyInProgressForTests();
  await ctx.cleanup();
});

function grantRequest(
  path: "/v1/approve" | "/v1/deny",
  body: unknown,
  headers: Record<string, string> = {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
  },
): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function handle(
  request: Request,
  deps: { isAgentSwitchInProgress: () => boolean } = {
    isAgentSwitchInProgress: () => false,
  },
): Promise<Response | null> {
  return tryHandle(request, TOKEN, deps);
}

describe("POST /v1/approve and /v1/deny", () => {
  it("returns null for other paths", async () => {
    expect(await handle(new Request("http://127.0.0.1/v1/health"))).toBeNull();
  });

  it("writes project allow grants", async () => {
    const response = await handle(
      grantRequest("/v1/approve", {
        projectPath: ctx.projectDir,
        refs: ["acme/hooks"],
      }),
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as { side: string; refs: string[] };
    expect(body.side).toBe("allow");
    expect(body.refs).toEqual(["acme/hooks"]);
    const manifest = readFileSync(join(ctx.projectDir, "apm.yml"), "utf-8");
    expect(manifest).toContain("acme/hooks");
    expect(manifest).toContain("allow");
  });

  it("writes project deny grants", async () => {
    const response = await handle(
      grantRequest("/v1/deny", {
        projectPath: ctx.projectDir,
        refs: ["acme/hooks"],
      }),
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ side: "deny", refs: ["acme/hooks"] });
    expect(readFileSync(join(ctx.projectDir, "apm.yml"), "utf-8")).toContain("deny");
  });

  it("rejects empty refs", async () => {
    const response = await handle(
      grantRequest("/v1/approve", { projectPath: ctx.projectDir, refs: [] }),
    );
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: "invalid_refs" });
  });

  it("returns 409 apply_in_progress when apply is running", async () => {
    setAgentApplyInProgressForTests(true);
    const response = await handle(
      grantRequest("/v1/approve", {
        projectPath: ctx.projectDir,
        refs: ["acme/hooks"],
      }),
    );
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({ error: "apply_in_progress" });
  });
});
