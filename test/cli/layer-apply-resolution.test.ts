import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { addResourceToLayer, createLayer, getLayerByName } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addLayerAttachment } from "../../src/services/layer-composition.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-resolve-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function attachInstruction(layerId: string, content: string, ns: string): void {
  const resource = createResource({
    type: "instruction",
    name: "context",
    description: "",
    content,
    metadata: {},
    source: "test",
    namespace: ns,
  });
  addResourceToLayer(layerId, resource.id);
}

describe("layer apply resolution", () => {
  it("gives the root's own resource precedence over its dependency", async () => {
    const base = createLayer({ name: "base" });
    attachInstruction(base.id, "FROM-BASE", "base");
    const root = createLayer({ name: "root" });
    attachInstruction(root.id, "FROM-ROOT", "root");
    const rootLayer = getLayerByName("root");
    if (!rootLayer) throw new Error("missing root");
    await addLayerAttachment({ layer: rootLayer, selector: "layer:base" });

    await runCli([
      "layer",
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
    ]);

    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain(
      "FROM-ROOT",
    );
  });

  it("keeps last-wins for two layers on argv", async () => {
    const a = createLayer({ name: "a" });
    attachInstruction(a.id, "FROM-A", "a");
    const b = createLayer({ name: "b" });
    attachInstruction(b.id, "FROM-B", "b");

    await runCli([
      "layer",
      "apply",
      "a",
      "b",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
    ]);

    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain(
      "FROM-B",
    );
  });

  it("writes a lockfile on apply", async () => {
    createLayer({ name: "base" });
    const root = createLayer({ name: "root" });
    attachInstruction(root.id, "ROOT", "root");
    const rootLayer = getLayerByName("root");
    if (!rootLayer) throw new Error("missing root");
    await addLayerAttachment({ layer: rootLayer, selector: "layer:base" });

    await runCli([
      "layer",
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
    ]);

    const lockPath = join(ctx.projectDir, ".harnesstap", "lock.toml");
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf8")).toContain('name = "base"');
  });

  it("does not write a lockfile on --dry-run", async () => {
    createLayer({ name: "root" });
    await runCli([
      "layer",
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
      "--dry-run",
    ]);
    expect(existsSync(join(ctx.projectDir, ".harnesstap", "lock.toml"))).toBe(false);
  });

  it("does not write a lockfile for multi-selector (ephemeral) apply", async () => {
    const a = createLayer({ name: "a" });
    attachInstruction(a.id, "FROM-A", "a");
    const b = createLayer({ name: "b" });
    attachInstruction(b.id, "FROM-B", "b");

    await runCli([
      "layer",
      "apply",
      "a",
      "b",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
    ]);

    expect(existsSync(join(ctx.projectDir, ".harnesstap", "lock.toml"))).toBe(false);
  });

  it("prints the resolution trail with --explain", async () => {
    const base = createLayer({ name: "base" });
    attachInstruction(base.id, "FROM-BASE", "base");
    const root = createLayer({ name: "root" });
    attachInstruction(root.id, "FROM-ROOT", "root");
    const rootLayer = getLayerByName("root");
    if (!rootLayer) throw new Error("missing root");
    await addLayerAttachment({ layer: rootLayer, selector: "layer:base" });

    const result = await runCli([
      "layer",
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
      "--explain",
      "--dry-run",
    ]);

    expect(result.stdout).toContain("base@");
    expect(result.stdout).toContain("instruction:context");
    expect(result.stdout).toContain("nearest to root");
  });

  it("errors on a singleton conflict at equal depth and names the fix", async () => {
    const a = createLayer({ name: "a" });
    attachInstruction(a.id, "FROM-A", "a");
    const b = createLayer({ name: "b" });
    attachInstruction(b.id, "FROM-B", "b");
    createLayer({ name: "root" });
    const rootLayer = getLayerByName("root");
    if (!rootLayer) throw new Error("missing root");
    await addLayerAttachment({ layer: rootLayer, selector: "layer:a" });
    await addLayerAttachment({ layer: rootLayer, selector: "layer:b" });

    const result = await runCli([
      "layer",
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
      "--no-interactive",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("instruction:context");
    expect(result.stderr).toContain("--override");
  });
});
