import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  createPlugin,
  getPluginById,
  stampPluginOrigin,
} from "../../src/models/plugin-model.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";
import * as originUpdate from "../../src/services/plugin-origin-update.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("cli-origin-update-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function seedUpstream(name = "demo", version = "1.0.0") {
  const plugin = createPlugin({ name, version, origin: "upstream" });
  setPluginOrigin(plugin.id, "upstream");
  stampPluginOrigin(plugin.id, {
    locator: `${name}@mkt`,
    fingerprint: "old",
    fingerprintKind: "git_sha",
  });
  const stamped = getPluginById(plugin.id);
  if (!stamped) {
    throw new Error(`Plugin not found after stamp: ${plugin.id}`);
  }
  return stamped;
}

describe("plugin check and update CLI", () => {
  it("lists --refresh on plugin check --help", async () => {
    const result = await runCli(["plugin", "check", "--help"]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toContain("--refresh");
  });

  it("prints JSON check rows with status", async () => {
    seedUpstream();
    const spy = spyOn(originUpdate, "checkPluginOrigins").mockResolvedValue({
      results: [
        {
          plugin_id: "p1",
          name: "demo",
          origin_locator: "demo@mkt",
          status: "current",
          local_version: "1.0.0",
          origin_fingerprint: "old",
        },
      ],
    });
    try {
      const result = await runCli(["plugin", "check", "--format", "json"]);
      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        results: Array<{ status: string }>;
      };
      expect(payload.results[0]?.status).toBe("current");
    } finally {
      spy.mockRestore();
    }
  });

  it("exits 0 when check finds only outdated rows", async () => {
    seedUpstream();
    const spy = spyOn(originUpdate, "checkPluginOrigins").mockResolvedValue({
      results: [
        {
          plugin_id: "p1",
          name: "demo",
          origin_locator: "demo@mkt",
          status: "outdated",
          local_version: "1.0.0",
          origin_fingerprint: "new",
        },
      ],
    });
    try {
      const result = await runCli(["plugin", "check", "--format", "json"]);
      expect(result.exitCode ?? 0).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("exits 1 when any check row is error", async () => {
    seedUpstream();
    const spy = spyOn(originUpdate, "checkPluginOrigins").mockResolvedValue({
      results: [
        {
          plugin_id: "p1",
          name: "demo",
          origin_locator: "demo@mkt",
          status: "error",
          local_version: "1.0.0",
          message: "fetch failed",
        },
      ],
    });
    try {
      const result = await runCli(["plugin", "check", "--format", "json"]);
      expect(result.exitCode).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("requires a name or --all for plugin update", async () => {
    const result = await runCli(["plugin", "update"]);
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/pass a name or --all/i);
  });

  it("refuses --all off-TTY without --yes and does not bump version", async () => {
    const plugin = seedUpstream();
    const result = await runCli(["plugin", "update", "--all"], { isTTY: false });
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "Pass --yes to update without a prompt.",
    );
    expect(getPluginById(plugin.id)?.version).toBe("1.0.0");
    expect(getPluginById(plugin.id)?.origin_fingerprint).toBe("old");
  });

  it("prompts on TTY --all even when CI is set", async () => {
    const plugin = seedUpstream();
    const updateSpy = spyOn(originUpdate, "updatePluginOrigins");
    try {
      const result = await runCli(["plugin", "update", "--all"], {
        isTTY: true,
        env: { CI: "true" },
        promptResponses: [{ value: false }],
      });
      expect(result.exitCode ?? 0).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("Operation cancelled.");
      expect(updateSpy).not.toHaveBeenCalled();
      expect(getPluginById(plugin.id)?.version).toBe("1.0.0");
    } finally {
      updateSpy.mockRestore();
    }
  });

  it("rejects a name together with --all before confirmation or mutation", async () => {
    const plugin = seedUpstream();
    const updateSpy = spyOn(originUpdate, "updatePluginOrigins");
    try {
      const result = await runCli(["plugin", "update", "demo", "--all", "--yes"], {
        isTTY: false,
      });
      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/pass a name or --all, not both/i);
      expect(updateSpy).not.toHaveBeenCalled();
      expect(getPluginById(plugin.id)?.version).toBe("1.0.0");
    } finally {
      updateSpy.mockRestore();
    }
  });

  it("exits 1 when any update row is failed", async () => {
    seedUpstream();
    const spy = spyOn(originUpdate, "updatePluginOrigins").mockResolvedValue({
      results: [
        {
          plugin_id: "p1",
          name: "demo",
          status: "failed",
          message: "collision",
        },
      ],
      summary: { updated: 0, skipped: 0, failed: 1 },
    });
    try {
      const result = await runCli([
        "plugin",
        "update",
        "demo",
        "--format",
        "json",
      ]);
      expect(result.exitCode).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
