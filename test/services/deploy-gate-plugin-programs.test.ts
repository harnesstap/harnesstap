import { describe, expect, it } from "bun:test";
import { gateDeployFiles, isClaudePluginProgramFile } from "../../src/services/deploy-gate.ts";
import { CriticalUnicodeError } from "../../src/services/unicode-scan.ts";

const LRE = "\u202A";
const ROOT = ".claude/plugins/cache/mp/plug/1.0.0";

describe("deploy gate in Claude Code plugin installs", () => {
  it("reports hidden Unicode in a plugin script without blocking", () => {
    const result = gateDeployFiles([
      { path: `${ROOT}/scripts/worker.cjs`, content: `const strip = /[${LRE}]/g;\n` },
    ]);
    expect(result.findings.map((finding) => finding.severity)).toEqual(["warning"]);
  });

  it("still blocks hidden Unicode in what the model reads", () => {
    for (const path of [
      `${ROOT}/skills/a/SKILL.md`,
      `${ROOT}/hooks/hooks.json`,
      `${ROOT}/.mcp.json`,
      ".claude/skills/a/scripts/run.js",
    ]) {
      expect(() => gateDeployFiles([{ path, content: `x${LRE}y\n` }])).toThrow(CriticalUnicodeError);
    }
  });

  it("recognizes only program files under the Claude plugin cache", () => {
    expect(isClaudePluginProgramFile(`${ROOT}/scripts/run.sh`)).toBe(true);
    expect(isClaudePluginProgramFile(`${ROOT}/dist/index.mjs`)).toBe(true);
    expect(isClaudePluginProgramFile(`${ROOT}/commands/x.md`)).toBe(false);
    expect(isClaudePluginProgramFile(".cursor/plugins/local/p/scripts/run.js")).toBe(false);
  });
});
