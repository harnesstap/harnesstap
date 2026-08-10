import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("origin-ui-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("origin display", () => {
  it("shows an ORIGIN column in plugin list", async () => {
    createPlugin({ name: "mine" });
    const upstream = createPlugin({ name: "web-search" });
    setPluginOrigin(upstream.id, "upstream");

    const result = await runCli(["plugin", "list"]);
    expect(result.stdout).toContain("ORIGIN");
    expect(result.stdout).toContain("authored");
    expect(result.stdout).toContain("upstream");
  });

  it("includes origin in JSON output", async () => {
    const upstream = createPlugin({ name: "web-search" });
    setPluginOrigin(upstream.id, "upstream");
    // Existing list JSON is a bare array for --local-only (not `{ plugins: [...] }`).
    const result = await runCli(["plugin", "list", "--local-only", "--format", "json"]);
    const payload = JSON.parse(result.stdout) as Array<{ name: string; origin: string }>;
    expect(payload.find((l) => l.name === "web-search")?.origin).toBe(
      "upstream",
    );
  });

  it("labels dependency sources in plugin show", async () => {
    createPlugin({ name: "base" });
    const root = createPlugin({ name: "root" });
    addDependency(root.id, "web-search@anthropics", { versionConstraint: "^1.0.0" });
    addDependency(root.id, "base");

    const result = await runCli(["plugin", "show", "root"]);
    expect(result.stdout).toContain("web-search");
    expect(result.stdout).toContain("marketplace");
    expect(result.stdout).toContain("^1.0.0");
    expect(result.stdout).toContain("local");
  });
});
