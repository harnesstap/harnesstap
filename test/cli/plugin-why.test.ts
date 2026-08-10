import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { addResourceToPlugin, createPlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addPluginAttachment } from "../../src/services/plugin-composition.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("why-");
});

afterEach(async () => {
  await ctx.cleanup();
});

async function seedAndApply(): Promise<void> {
  const base = createPlugin({ name: "base", version: "2.1.0" });
  const resource = createResource({
    type: "skill",
    name: "alpha",
    description: "",
    content: "A",
    metadata: {},
    source: "test",
  });
  addResourceToPlugin(base.id, resource.id);
  createPlugin({ name: "root", version: "1.0.0" });
  const root = getPluginByName("root");
  if (!root) throw new Error("missing root");
  await addPluginAttachment({ plugin: root, selector: "plugin:base", version: "^2.0.0" });
  await runCli([
    "apply",
    "root",
    "--project",
    ctx.projectDir,
    "--harness",
    "claude-code",
  ]);
}

describe("plugin why", () => {
  it("explains why a version was selected", async () => {
    await seedAndApply();
    const result = await runCli(["plugin", "why", "base", "--project", ctx.projectDir]);
    expect(result.stdout).toContain("base@2.1.0");
    expect(result.stdout).toContain("root@1.0.0");
    expect(result.stdout).toContain("^2.0.0");
  });

  it("explains which plugin won a resource", async () => {
    await seedAndApply();
    const result = await runCli([
      "plugin",
      "why",
      "skill:alpha",
      "--project",
      ctx.projectDir,
    ]);
    expect(result.stdout).toContain("skill:alpha");
    expect(result.stdout).toContain("base@2.1.0");
  });

  it("treats lockfile root as locked", async () => {
    await seedAndApply();
    const result = await runCli([
      "plugin",
      "why",
      "root",
      "--project",
      ctx.projectDir,
      "--format",
      "json",
    ]);
    const payload = JSON.parse(result.stdout) as {
      name: string;
      depth: number;
      locked: boolean;
    };
    expect(payload).toMatchObject({
      name: "root",
      depth: 0,
      locked: true,
    });
  });

  it("emits JSON and agrees with the lockfile", async () => {
    await seedAndApply();
    const result = await runCli([
      "plugin",
      "why",
      "base",
      "--project",
      ctx.projectDir,
      "--format",
      "json",
    ]);
    const payload = JSON.parse(result.stdout) as {
      kind: string;
      name: string;
      version: string;
      locked: boolean;
    };
    expect(payload).toMatchObject({
      kind: "plugin",
      name: "base",
      version: "2.1.0",
      locked: true,
    });
  });

  it("reports an unknown target", async () => {
    await seedAndApply();
    const result = await runCli(["plugin", "why", "nope", "--project", ctx.projectDir]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("nope");
  });
});
