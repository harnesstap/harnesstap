import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  addPluginAttachment,
  attachPluginPinToPlugin,
} from "../../src/services/plugin-composition.ts";

const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-resolve-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function attachInstruction(pluginId: string, content: string, ns: string): void {
  const resource = createResource({
    type: "instruction",
    name: "context",
    description: "",
    content,
    metadata: {},
    source: "test",
    namespace: ns,
  });
  addResourceToPlugin(pluginId, resource.id);
}

describe("plugin apply resolution", () => {
  it("gives the root's own resource precedence over its dependency", async () => {
    const base = createPlugin({ name: "base" });
    attachInstruction(base.id, "FROM-BASE", "base");
    const root = createPlugin({ name: "root" });
    attachInstruction(root.id, "FROM-ROOT", "root");
    const rootPlugin = getPluginByName("root");
    if (!rootPlugin) throw new Error("missing root");
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:base" });

    await runCli([
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

  it("keeps last-wins for two plugins on argv", async () => {
    const a = createPlugin({ name: "a" });
    attachInstruction(a.id, "FROM-A", "a");
    const b = createPlugin({ name: "b" });
    attachInstruction(b.id, "FROM-B", "b");

    await runCli([
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
    createPlugin({ name: "base" });
    const root = createPlugin({ name: "root" });
    attachInstruction(root.id, "ROOT", "root");
    const rootPlugin = getPluginByName("root");
    if (!rootPlugin) throw new Error("missing root");
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:base" });

    await runCli([
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
    createPlugin({ name: "root" });
    await runCli([
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
    const a = createPlugin({ name: "a" });
    attachInstruction(a.id, "FROM-A", "a");
    const b = createPlugin({ name: "b" });
    attachInstruction(b.id, "FROM-B", "b");

    await runCli([
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
    const base = createPlugin({ name: "base" });
    attachInstruction(base.id, "FROM-BASE", "base");
    const root = createPlugin({ name: "root" });
    attachInstruction(root.id, "FROM-ROOT", "root");
    const rootPlugin = getPluginByName("root");
    if (!rootPlugin) throw new Error("missing root");
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:base" });

    const result = await runCli([
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
    const a = createPlugin({ name: "a" });
    attachInstruction(a.id, "FROM-A", "a");
    const b = createPlugin({ name: "b" });
    attachInstruction(b.id, "FROM-B", "b");
    createPlugin({ name: "root" });
    const rootPlugin = getPluginByName("root");
    if (!rootPlugin) throw new Error("missing root");
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:a" });
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:b" });

    const result = await runCli([
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

  it("prepares marketplace pins before composition so first apply includes plugin skills", async () => {
    cpSync(join(fixtureHome, ".claude"), join(ctx.homeDir, ".claude"), {
      recursive: true,
    });

    const root = createPlugin({ name: "root" });
    attachPluginPinToPlugin(root.id, "formatter@acme-marketplace", "1.2.3");
    // Deliberately do not call materializeUpstreamPluginPlugin — apply must
    // prepare the pin before the first composition resolve.
    expect(getPluginByName("formatter", "1.2.3")).toBeUndefined();

    const result = await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code,cursor",
    ]);

    expect(result.exitCode ?? 0).toBe(0);
    expect(getPluginByName("formatter", "1.2.3")).toBeDefined();
    expect(
      existsSync(join(ctx.projectDir, ".cursor", "rules", "format-code.mdc")),
    ).toBe(true);
  });
});
