import { lstatSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { detectPlatforms } from "../../src/services/scanner.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

const fixture = join(import.meta.dirname, "../fixtures/superpowers/minimal");

describe("detectPlatforms symlink AGENTS.md", () => {
  it("does not treat symlinked AGENTS.md as a platform signal for every AGENTS-based harness", () => {
    const agentsPath = join(fixture, "AGENTS.md");
    expect(lstatSync(agentsPath).isSymbolicLink()).toBe(true);
    const detected = detectPlatforms(fixture);
    expect(detected).toContain("claude-code");
    expect(detected).toContain("gemini-cli");
    expect(detected.filter((id) => id !== "claude-code" && id !== "gemini-cli").length).toBeLessThan(5);
  });

  it("does not detect AGENTS-only harnesses from a shared AGENTS.md file", () => {
    const projectDir = createTempDir("agents-real-file");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Codex agents");
      expect(detectPlatforms(projectDir)).toEqual(["grok-build"]);
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("detects codex from a harness-specific project path", () => {
    const projectDir = createTempDir("codex-config");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Codex agents");
      writeTextFile(join(projectDir, ".codex", "config.toml"), "[mcp]\n");
      expect(detectPlatforms(projectDir)).toContain("codex");
    } finally {
      cleanupDir(projectDir);
    }
  });
});
