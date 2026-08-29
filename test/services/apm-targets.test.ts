import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  detectApmTargetSignals,
  mapApmTargets,
  resolveCompileTargets,
  TargetFlagError,
  TargetResolutionError,
} from "../../src/services/apm-targets.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

let root: string;

beforeEach(() => {
  root = createTempDir("apm-targets-");
});

afterEach(() => {
  cleanupDir(root);
});

describe("mapApmTargets", () => {
  it("maps canonical slugs onto HarnessTap harness ids", () => {
    const mapped = mapApmTargets(["cursor", "claude"]);
    expect(mapped.harnessTargets).toEqual(["cursor", "claude-code"]);
    expect(mapped.canonicalTargets).toEqual(["cursor", "claude"]);
  });

  it("expands all without antigravity or agent-skills", () => {
    const mapped = mapApmTargets(["all"]);
    expect(mapped.harnessTargets).toContain("cursor");
    expect(mapped.harnessTargets).toContain("kiro");
    expect(mapped.harnessTargets).not.toContain("antigravity");
    expect(mapped.skippedTargets).toEqual([]);
  });

  it("skips agent-skills as a non-harness meta-target", () => {
    const mapped = mapApmTargets(["agent-skills"]);
    expect(mapped.harnessTargets).toEqual([]);
    expect(mapped.skippedTargets).toEqual(["agent-skills"]);
  });
});

describe("detectApmTargetSignals", () => {
  it("activates cursor from .cursor/ and claude from CLAUDE.md", () => {
    mkdirSync(join(root, ".cursor"), { recursive: true });
    writeTextFile(join(root, "CLAUDE.md"), "# notes\n");
    const detected = detectApmTargetSignals(root);
    expect(detected.map((entry) => entry.target).sort()).toEqual(["claude", "cursor"]);
  });

  it("does not treat a bare .github/ directory as copilot", () => {
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    expect(detectApmTargetSignals(root)).toEqual([]);
  });

  it("never auto-detects antigravity from .agents/", () => {
    mkdirSync(join(root, ".agents"), { recursive: true });
    expect(detectApmTargetSignals(root)).toEqual([]);
  });
});

describe("resolveCompileTargets", () => {
  it("prefers --target over declared targets and autodetect", () => {
    mkdirSync(join(root, ".cursor"), { recursive: true });
    const resolved = resolveCompileTargets({
      projectRoot: root,
      mode: "install",
      cliTarget: "claude",
      manifestHarnessTargets: ["cursor"],
    });
    expect(resolved.source).toBe("cli");
    expect(resolved.harnessTargets).toEqual(["claude-code"]);
  });

  it("prefers declared targets over autodetect", () => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    const resolved = resolveCompileTargets({
      projectRoot: root,
      mode: "install",
      manifestHarnessTargets: ["cursor"],
    });
    expect(resolved.source).toBe("manifest");
    expect(resolved.harnessTargets).toEqual(["cursor"]);
  });

  it("auto-detects when nothing is declared", () => {
    mkdirSync(join(root, ".cursor"), { recursive: true });
    const resolved = resolveCompileTargets({
      projectRoot: root,
      mode: "install",
    });
    expect(resolved.source).toBe("autodetect");
    expect(resolved.harnessTargets).toEqual(["cursor"]);
  });

  it("fails closed on install when no target can be resolved", () => {
    expect(() =>
      resolveCompileTargets({
        projectRoot: root,
        mode: "install",
      }),
    ).toThrow(TargetResolutionError);
  });

  it("returns an empty compile fallback when nothing resolves", () => {
    const resolved = resolveCompileTargets({
      projectRoot: root,
      mode: "compile",
    });
    expect(resolved.source).toBe("empty");
    expect(resolved.harnessTargets).toEqual([]);
    expect(resolved.warnings.some((warning) => warning.includes("wrote nothing"))).toBe(true);
  });

  it("rejects --all together with --target", () => {
    expect(() =>
      resolveCompileTargets({
        projectRoot: root,
        mode: "compile",
        cliAll: true,
        cliTarget: "cursor",
      }),
    ).toThrow(TargetFlagError);
  });
});
