import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-recovery-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("apply constraint recovery", () => {
  it("surfaces missing-inventory hints without scaffolding on non-TTY apply", async () => {
    const root = createPlugin({ name: "my-setup" });
    addDependency(root.id, "design-doc@anthropics", { versionConstraint: "*" });

    const result = await runCli([
      "apply",
      "my-setup",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
      "--no-interactive",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("No local version of");
    expect(result.stderr).toContain("--sync-plugins");
  });
});
