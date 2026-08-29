import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("ht apply security slice", () => {
  it("blocks critical hidden Unicode on apply and allows --force", async () => {
    const context = await createTestContext("cli-apply-unicode");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "tainted" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: `visible\u202Ehidden\n`,
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const blocked = await runCli([
        "apply",
        "tainted",
        "--project",
        context.projectDir,
        "--harness",
        "codex",
        "--no-interactive",
      ]);
      expect(blocked.exitCode).toBe(1);
      expect(blocked.stderr + blocked.stdout).toMatch(/U\+202E|hidden Unicode/i);
      expect(existsSync(join(context.projectDir, "AGENTS.md"))).toBe(false);

      const forced = await runCli([
        "apply",
        "tainted",
        "--project",
        context.projectDir,
        "--harness",
        "codex",
        "--no-interactive",
        "--force",
      ]);
      expect(forced.exitCode ?? 0).toBe(0);
      expect(existsSync(join(context.projectDir, "AGENTS.md"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("fails closed on lockfile hash mismatch and accepts --update", async () => {
    const context = await createTestContext("cli-apply-hash");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "hashed" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# First\n",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const first = await runCli([
        "apply",
        "hashed",
        "--project",
        context.projectDir,
        "--harness",
        "codex",
        "--no-interactive",
      ]);
      expect(first.exitCode ?? 0).toBe(0);

      resourceModel.updateResource(resource.id, { content: "# Changed\n" });

      const mismatched = await runCli([
        "apply",
        "hashed",
        "--project",
        context.projectDir,
        "--harness",
        "codex",
        "--no-interactive",
      ]);
      expect(mismatched.exitCode).toBe(1);
      expect(mismatched.stderr + mismatched.stdout).toMatch(/hash mismatch/i);

      const updated = await runCli([
        "apply",
        "hashed",
        "--project",
        context.projectDir,
        "--harness",
        "codex",
        "--no-interactive",
        "--update",
      ]);
      expect(updated.exitCode ?? 0).toBe(0);
    } finally {
      await context.cleanup();
    }
  });
});

describe("ht audit", () => {
  it("scans a file, reports warnings, and strips on request", async () => {
    const context = await createTestContext("cli-audit-file");
    try {
      await runCli(["init"]);
      const target = join(context.projectDir, "notes.md");
      writeTextFile(target, "hello\u200Bworld\n");

      const scanned = await runCli([
        "audit",
        "--project",
        context.projectDir,
        "--file",
        "notes.md",
        "--format",
        "json",
      ]);
      expect(scanned.exitCode).toBe(2);
      const payload = JSON.parse(scanned.stdout) as {
        passed: boolean;
        summary: { warning: number };
        findings: Array<{ codepoint: string }>;
      };
      expect(payload.passed).toBe(false);
      expect(payload.summary.warning).toBeGreaterThan(0);
      expect(payload.findings.some((finding) => finding.codepoint === "U+200B")).toBe(true);

      const stripped = await runCli([
        "audit",
        "--project",
        context.projectDir,
        "--file",
        "notes.md",
        "--strip",
      ]);
      expect(stripped.exitCode ?? 0).toBe(0);
      expect(readFileSync(target, "utf8")).toBe("helloworld\n");
    } finally {
      await context.cleanup();
    }
  });

  it("fails --ci on lockfile hash drift", async () => {
    const context = await createTestContext("cli-audit-ci");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "audited" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# Audited\n",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      await runCli([
        "apply",
        "audited",
        "--project",
        context.projectDir,
        "--harness",
        "codex",
        "--no-interactive",
      ]);

      writeFileSync(join(context.projectDir, "AGENTS.md"), "# Tampered\n");
      const ci = await runCli([
        "audit",
        "--project",
        context.projectDir,
        "--ci",
        "--format",
        "json",
      ]);
      expect(ci.exitCode).toBe(1);
      const payload = JSON.parse(ci.stdout) as {
        integrity: { ok: boolean; issues: Array<{ kind: string }> };
      };
      expect(payload.integrity.ok).toBe(false);
      expect(payload.integrity.issues.some((issue) => issue.kind === "mismatch")).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects combining --ci with --strip", async () => {
    const context = await createTestContext("cli-audit-usage");
    try {
      await runCli(["init"]);
      const result = await runCli([
        "audit",
        "--project",
        context.projectDir,
        "--ci",
        "--strip",
      ]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr + result.stdout).toMatch(/cannot be combined/i);
    } finally {
      await context.cleanup();
    }
  });

  it("reports policy skipped when no apm-policy.yml exists", async () => {
    const context = await createTestContext("cli-audit-policy-skip");
    try {
      await runCli(["init"]);
      const result = await runCli([
        "audit",
        "--project",
        context.projectDir,
        "--format",
        "json",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        policy: { status: string };
      };
      expect(payload.policy.status).toBe("skipped");
    } finally {
      await context.cleanup();
    }
  });

  it("fails --ci --require-policy when no policy file exists", async () => {
    const context = await createTestContext("cli-audit-require-policy");
    try {
      await runCli(["init"]);
      const result = await runCli([
        "audit",
        "--project",
        context.projectDir,
        "--ci",
        "--require-policy",
        "--format",
        "json",
      ]);
      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout) as {
        policy: { status: string; violations: Array<{ code: string }> };
      };
      expect(payload.policy.status).toBe("failed");
      expect(payload.policy.violations.some((violation) => violation.code === "policy-required")).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("fails --ci when policy blocks a disallowed source", async () => {
    const context = await createTestContext("cli-audit-policy-block");
    try {
      await runCli(["init"]);
      writeTextFile(
        join(context.projectDir, "apm.yml"),
        `name: demo
version: "1.0.0"
dependencies:
  apm:
    - https://gitlab.com/acme/widgets.git
`,
      );
      writeTextFile(
        join(context.projectDir, "apm-policy.yml"),
        `name: baseline
enforcement: block
dependencies:
  allow:
    - github.com/*
`,
      );
      const result = await runCli([
        "audit",
        "--project",
        context.projectDir,
        "--ci",
        "--format",
        "json",
      ]);
      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout) as {
        policy: { blocks: boolean; violations: Array<{ code: string }> };
      };
      expect(payload.policy.blocks).toBe(true);
      expect(payload.policy.violations.some((violation) => violation.code === "source-not-allowed")).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("fails closed when policy.hash is pinned and the file is missing", async () => {
    const context = await createTestContext("cli-audit-policy-pin");
    try {
      await runCli(["init"]);
      writeTextFile(
        join(context.projectDir, "apm.yml"),
        `name: demo
version: "1.0.0"
policy:
  hash: sha256:0000000000000000000000000000000000000000000000000000000000000000
`,
      );
      const result = await runCli([
        "audit",
        "--project",
        context.projectDir,
        "--ci",
        "--format",
        "json",
      ]);
      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout) as {
        policy: { violations: Array<{ code: string }> };
      };
      expect(payload.policy.violations.some((violation) => violation.code === "policy-missing")).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });
});
