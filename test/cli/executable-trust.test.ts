import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";
import { makeResourceInput } from "../helpers/resources.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("exec-trust-cli-");
});

afterEach(async () => {
  await ctx.cleanup();
});

async function seedHookDependency(depName = "dep-hooks"): Promise<void> {
  const pluginModel = await import("../../src/models/plugin-model.ts");
  const resourceModel = await import("../../src/models/resource.ts");
  const { addDependency } = await import("../../src/services/plugin-dependency.ts");

  const dep = pluginModel.createPlugin({ name: depName, version: "1.0.0" });
  const hook = resourceModel.createResource(
    makeResourceInput({
      type: "hook",
      name: "session-start",
      metadata: { event: "SessionStart", script: "echo ok" },
      content: "",
    }),
  );
  pluginModel.addResourceToPlugin(dep.id, hook.id);

  const root = pluginModel.createPlugin({ name: "root", version: "1.0.0" });
  addDependency(root.id, depName, { versionConstraint: "1.0.0" });
}

describe("ht apply executable trust gate", () => {
  it("deploys dependency hooks when the gate is off", async () => {
    await seedHookDependency();
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
`,
    );
    const result = await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "cursor",
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(existsSync(join(ctx.projectDir, ".cursor", "hooks.json"))).toBe(true);
    const lock = readFileSync(join(ctx.projectDir, "apm.lock.yaml"), "utf8");
    expect(lock).not.toContain("gated_pending_approval");
  });

  it("parks unapproved dependency hooks and still succeeds", async () => {
    await seedHookDependency();
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
executables: {}
`,
    );
    const result = await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "cursor",
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(existsSync(join(ctx.projectDir, ".cursor", "hooks.json"))).toBe(false);
    expect(result.stderr + result.stdout).toMatch(/approve/i);
    const lock = readFileSync(join(ctx.projectDir, "apm.lock.yaml"), "utf8");
    expect(lock).toContain("exec_status: gated_pending_approval");
  });

  it("always trusts local .apm/ hooks when the gate is on", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [cursor]
executables: {}
`,
    );
    writeTextFile(
      join(ctx.projectDir, ".apm", "hooks", "session.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          SessionStart: [{ type: "command", command: "echo local" }],
        },
      }),
    );
    const result = await runCli([
      "apply",
      "--project",
      ctx.projectDir,
      "--harness",
      "cursor",
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(existsSync(join(ctx.projectDir, ".cursor", "hooks.json"))).toBe(true);
  });

  it("parks self-defined MCP from a dependency package", async () => {
    const pluginModel = await import("../../src/models/plugin-model.ts");
    const resourceModel = await import("../../src/models/resource.ts");
    const { addDependency } = await import("../../src/services/plugin-dependency.ts");
    const dep = pluginModel.createPlugin({ name: "dep-mcp", version: "1.0.0" });
    const mcp = resourceModel.createResource(
      makeResourceInput({
        type: "mcp_server",
        name: "inline-tool",
        metadata: { transport: "stdio", command: "npx" },
        content: "",
      }),
    );
    pluginModel.addResourceToPlugin(dep.id, mcp.id);
    const root = pluginModel.createPlugin({ name: "root", version: "1.0.0" });
    addDependency(root.id, "dep-mcp", { versionConstraint: "1.0.0" });
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
executables: {}
`,
    );
    const result = await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "cursor",
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(existsSync(join(ctx.projectDir, ".cursor", "mcp.json"))).toBe(false);
    expect(readFileSync(join(ctx.projectDir, "apm.lock.yaml"), "utf8")).toContain(
      "gated_pending_approval",
    );
  });
});

describe("ht approve / deny / policy explain", () => {
  it("approves a package into project apm.yml then deploys on apply", async () => {
    await seedHookDependency();
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
executables: {}
`,
    );
    await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "cursor",
      "--no-interactive",
    ]);
    const approved = await runCli([
      "approve",
      "dep-hooks",
      "--project",
      ctx.projectDir,
    ]);
    expect(approved.exitCode ?? 0).toBe(0);
    expect(readFileSync(join(ctx.projectDir, "apm.yml"), "utf8")).toContain("dep-hooks");

    const second = await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "cursor",
      "--no-interactive",
    ]);
    expect(second.exitCode ?? 0).toBe(0);
    expect(existsSync(join(ctx.projectDir, ".cursor", "hooks.json"))).toBe(true);
    expect(readFileSync(join(ctx.projectDir, "apm.lock.yaml"), "utf8")).toContain(
      "exec_status: deployed",
    );
  });

  it("writes user grants to ~/.harnesstap/config.jsonc", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
executables: {}
`,
    );
    const result = await runCli(["deny", "evil/pkg", "--user", "--project", ctx.projectDir]);
    expect(result.exitCode ?? 0).toBe(0);
    const config = readFileSync(join(ctx.homeDir, ".harnesstap", "config.jsonc"), "utf8");
    expect(config).toContain("evil/pkg");
  });

  it("explains the deciding layer", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
executables:
  allow:
    acme/hooks:
      hooks: true
`,
    );
    const result = await runCli([
      "policy",
      "explain",
      "acme/hooks",
      "--project",
      ctx.projectDir,
      "--format",
      "json",
    ]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toMatch(/project-allow|allowed/);
  });
});

describe("ht audit --ci required-executable-untrusted", () => {
  it("fails CI when a required package is gated", async () => {
    await seedHookDependency("acme-ci");
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
executables: {}
`,
    );
    writeTextFile(
      join(ctx.projectDir, "apm-policy.yml"),
      `name: baseline
enforcement: warn
executables:
  require:
    - acme-ci
`,
    );
    await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "cursor",
      "--no-interactive",
    ]);
    const audit = await runCli([
      "audit",
      "--ci",
      "--project",
      ctx.projectDir,
      "--format",
      "json",
    ]);
    expect(audit.exitCode).toBe(1);
    expect(audit.stdout).toContain("required-executable-untrusted");
  });
});
