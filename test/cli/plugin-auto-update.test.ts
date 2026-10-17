import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { loadUpdateSettings } from "../../src/config/settings.ts";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import {
  describeUpdateSettings,
  maybePromptKeepUpToDate,
  type KeepUpToDatePromptDeps,
} from "../../src/cli/handlers/plugin-auto-update.ts";
import { tryHandle } from "../../src/agent/parity-handlers/settings-updates.ts";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("cli-auto-update-");
});
afterEach(async () => {
  await ctx.cleanup();
});

function chooser(answers: string[]): KeepUpToDatePromptDeps["choose"] & { asked: string[] } {
  const asked: string[] = [];
  const fn = (async (input: { message: string }) => {
    asked.push(input.message);
    const next = answers.shift();
    if (next === "cancel") {
      const error = new Error("User force closed the prompt");
      error.name = "ExitPromptError";
      throw error;
    }
    return next;
  }) as KeepUpToDatePromptDeps["choose"] & { asked: string[] };
  fn.asked = asked;
  return fn;
}

describe("ht plugin auto-update", () => {
  it("prints the default and saves a change", async () => {
    const shown = await runCli(["plugin", "auto-update"]);
    expect(shown.stdout).toContain("Plugin updates: notify only, checked daily.");
    const saved = await runCli(["plugin", "auto-update", "--mode", "install", "--frequency", "weekly", "--format", "json"]);
    expect(JSON.parse(saved.stdout)).toEqual({ mode: "install", frequency: "weekly", prompted: true });
    expect(loadUpdateSettings(getHarnesstapDir()).mode).toBe("install");
  });

  it("rejects an unknown mode without saving", async () => {
    const result = await runCli(["plugin", "auto-update", "--mode", "always"]);
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("--mode must be off, notify or install");
    expect(loadUpdateSettings(getHarnesstapDir()).mode).toBe("notify");
  });

  it("describes install mode without promising a major", () => {
    expect(describeUpdateSettings({ mode: "install", frequency: "hourly", prompted: true })).toBe(
      "Plugin updates: install minor and patch versions in range automatically, never a major, checked hourly.",
    );
  });
});

describe("the one-time prompt after update --all", () => {
  const dir = () => getHarnesstapDir();

  it("never prompts when the run is not interactive", async () => {
    const choose = chooser(["install"]);
    expect(await maybePromptKeepUpToDate({ interactive: false, choose, harnesstapDir: dir() })).toBeNull();
    expect(choose.asked).toEqual([]);
    expect(loadUpdateSettings(dir()).prompted).toBe(false);
  });

  it("asks mode then frequency once, saves, and does not ask again", async () => {
    const choose = chooser(["install", "weekly"]);
    const saved = await maybePromptKeepUpToDate({ interactive: true, choose, harnesstapDir: dir() });
    expect(saved).toEqual({ mode: "install", frequency: "weekly", prompted: true });
    expect(choose.asked).toEqual(["Keep plugins up to date?", "How often should HarnessTap check?"]);
    const again = chooser(["off"]);
    expect(await maybePromptKeepUpToDate({ interactive: true, choose: again, harnesstapDir: dir() })).toBeNull();
    expect(again.asked).toEqual([]);
  });

  it("skips the frequency for Off", async () => {
    const off = chooser(["off"]);
    expect(await maybePromptKeepUpToDate({ interactive: true, choose: off, harnesstapDir: dir() })).toMatchObject({ mode: "off", prompted: true });
    expect(off.asked).toEqual(["Keep plugins up to date?"]);
  });

  it("keeps the defaults when the prompt is cancelled", async () => {
    const cancel = chooser(["cancel"]);
    expect(await maybePromptKeepUpToDate({ interactive: true, choose: cancel, harnesstapDir: dir() })).toEqual({
      mode: "notify",
      frequency: "daily",
      prompted: true,
    });
  });
});

describe("GET and PUT /v1/settings/updates", () => {
  const TOKEN = "t";
  async function call(method: string, body?: unknown, token: string | null = TOKEN) {
    const headers = new Headers();
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await tryHandle(
      new Request("http://127.0.0.1/v1/settings/updates", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      TOKEN,
      {},
    );
    if (!response) throw new Error("no route");
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  it("reads the defaults and saves a partial change", async () => {
    expect(await call("GET")).toEqual({ status: 200, json: { mode: "notify", frequency: "daily", prompted: false } });
    expect(await call("PUT", { mode: "install", prompted: true })).toEqual({
      status: 200,
      json: { mode: "install", frequency: "daily", prompted: true },
    });
    expect(loadUpdateSettings(getHarnesstapDir())).toEqual({ mode: "install", frequency: "daily", prompted: true });
  });

  it("rejects bad values and unknown keys, and requires the token", async () => {
    expect((await call("PUT", { mode: "always" })).status).toBe(400);
    expect((await call("PUT", { frequency: "monthly" })).json.message).toBe("frequency must be hourly, daily or weekly");
    expect((await call("PUT", { auto: true })).json.message).toBe("unknown key: auto");
    expect((await call("PUT", { prompted: "yes" })).status).toBe(400);
    expect((await call("GET", undefined, null)).status).toBe(401);
    expect(loadUpdateSettings(getHarnesstapDir()).mode).toBe("notify");
  });
});
