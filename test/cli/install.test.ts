import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";
import {
  addResourceToPlugin,
  createPlugin,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("install-");
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

describe("ht install", () => {
  it("applies from apm.yml with no plugin selector", async () => {
    const local = createPlugin({ name: "team-stack" });
    attachInstruction(local.id, "FROM-INSTALL", "team-stack");
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
dependencies:
  apm:
    - team-stack
  mcp:
    - name: demo-mcp
      command: echo
      registry: false
`,
    );

    const result = await runCli([
      "install",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
      "--no-interactive",
    ]);

    expect(result.exitCode ?? 0).toBe(0);
    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain(
      "FROM-INSTALL",
    );
    expect(existsSync(join(ctx.projectDir, "apm.lock.yaml"))).toBe(true);
    expect(readFileSync(join(ctx.projectDir, "apm.lock.yaml"), "utf8")).toContain(
      "resource_map_hash:",
    );
  });

  it("compiles local .apm primitives into harness dirs", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [claude]
`,
    );
    writeTextFile(
      join(ctx.projectDir, ".apm", "instructions", "always.instructions.md"),
      `---
description: Always
---
Be kind.
`,
    );

    const result = await runCli([
      "install",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);

    expect(result.exitCode ?? 0).toBe(0);
    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain(
      "Be kind.",
    );
    expect(existsSync(join(ctx.projectDir, "apm.lock.yaml"))).toBe(true);
  });

  it("rejects a plugin selector", async () => {
    const result = await runCli([
      "install",
      "team-stack",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toContain("does not take a plugin selector");
  });

  it("exposes project-scope apply flags and not --global", async () => {
    const result = await runCli(["install", "--help"]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toContain("--project");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--update");
    expect(result.stdout).toContain("--force");
    expect(result.stdout).toContain("--harness");
    expect(result.stdout).toContain("--target");
    expect(result.stdout).toContain("--all");
    expect(result.stdout).not.toMatch(/^\s+--global\b/m);
  });
});
