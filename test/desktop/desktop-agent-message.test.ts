import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { AgentApiError } from "../../apps/desktop/src/lib/api/http.ts";
import {
  commandInstructionIn,
  NO_COMMANDS_RULE,
} from "../../apps/desktop/src/lib/command-instructions.ts";
import {
  AGENT_MESSAGE_FALLBACK,
  desktopAgentText,
  recoveryActionLabel,
} from "../../apps/desktop/src/lib/desktop-agent-message.ts";
import type { RecoveryAction } from "../../apps/desktop/src/lib/types.ts";
import { GIT_ORIGIN_HINTS } from "../../src/cli/shared.ts";
import { UnsatisfiableConstraintError } from "../../src/services/resolve/types.ts";

const DESKTOP_SRC = join(import.meta.dir, "../../apps/desktop/src");

function expectNoCommand(text: string): void {
  const hit = commandInstructionIn(text);
  expect(hit, `${NO_COMMANDS_RULE} Found ${hit ?? ""} in: ${text}`).toBeNull();
}

const requirers = [{ requirer: "team-profile", constraint: "^1.0.0", path: ["team-profile"] }];

/** Agent and core messages Desktop can show, built by the real code where possible. */
function agentMessagesShownInDesktop(): { text: string; actions: RecoveryAction[] }[] {
  const errors = [
    new UnsatisfiableConstraintError({
      pluginName: "lint",
      requirers,
      available: [],
      rootName: "team-profile",
      sourceKind: "marketplace",
      pluginRef: "lint@acme",
    }),
    new UnsatisfiableConstraintError({
      pluginName: "lint",
      requirers,
      available: [],
      rootName: "team-profile",
      sourceKind: "git",
      pluginRef: "github.com/acme/lint",
    }),
    new UnsatisfiableConstraintError({
      pluginName: "lint",
      requirers,
      available: [],
      rootName: "team-profile",
      sourceKind: "marketplace",
      rootOverride: "2.0.0",
    }),
  ];
  return [
    ...errors.map((error) => ({
      text: error.message,
      actions: error.actions as unknown as RecoveryAction[],
    })),
    {
      text: "No harness targets configured. Declare targets: in apm.yml or pass --target / --harness.",
      actions: [],
    },
    {
      text: "Cannot pull lint: multiple catalog dependencies match. Use ht plugin pull with org/catalog/lint.",
      actions: [],
    },
    { text: GIT_ORIGIN_HINTS.join("\n"), actions: [] },
  ];
}

describe("agent messages shown in Desktop", () => {
  it("carry no command instructions once mapped for Desktop", () => {
    const samples = agentMessagesShownInDesktop();
    // The CLI keeps its wording: at least one sample must really contain a command.
    expect(samples.some((sample) => commandInstructionIn(sample.text) !== null)).toBe(true);
    for (const sample of samples) {
      expectNoCommand(desktopAgentText(sample.text));
      for (const action of sample.actions) {
        expectNoCommand(recoveryActionLabel(action));
      }
    }
  });

  it("keeps the useful part of a message and drops the command sentence", () => {
    expect(
      desktopAgentText(
        "Cannot pull lint: multiple catalog dependencies match. Use ht plugin pull with org/catalog/lint.",
      ),
    ).toBe("Cannot pull lint: multiple catalog dependencies match.");
    const missing = new UnsatisfiableConstraintError({
      pluginName: "lint",
      requirers,
      available: [],
      rootName: "team-profile",
      sourceKind: "marketplace",
      pluginRef: "lint@acme",
    });
    const text = desktopAgentText(missing.message);
    expect(text).toContain("No local version of lint is installed.");
    expect(text).toContain("required by: team-profile");
    expect(text).not.toContain("fix:");
  });

  it("points a missing harness at Harnesses > Detect", () => {
    expect(
      desktopAgentText(
        "No harness targets configured. Declare targets: in apm.yml or pass --target / --harness.",
      ),
    ).toBe("No harness is set up for this project. Open Harnesses and select Detect.");
  });

  it("leaves plain messages alone and falls back when only a command is left", () => {
    expect(desktopAgentText("Snapshot not found: abc")).toBe("Snapshot not found: abc");
    expect(desktopAgentText("Run `ht init`.")).toBe(AGENT_MESSAGE_FALLBACK);
  });

  it("AgentApiError messages are mapped for Desktop", () => {
    const error = new AgentApiError("Plugin missing. Run `ht resource sync plugin:lint`.", 400, "x");
    expect(error.message).toBe("Plugin missing.");
  });

  it("gives recovery actions UI labels instead of CLI wording", () => {
    const [marketplace] = new UnsatisfiableConstraintError({
      pluginName: "lint",
      requirers,
      available: [],
      rootName: "team-profile",
      sourceKind: "marketplace",
      pluginRef: "lint@acme",
    }).actions as unknown as RecoveryAction[];
    expect(marketplace?.label).toContain("ht resource sync");
    if (!marketplace) throw new Error("expected a marketplace action");
    expect(recoveryActionLabel(marketplace)).toBe("Install lint");
    const [git] = new UnsatisfiableConstraintError({
      pluginName: "lint",
      requirers,
      available: [],
      rootName: "team-profile",
      sourceKind: "git",
    }).actions as unknown as RecoveryAction[];
    if (!git) throw new Error("expected a git action");
    expect(recoveryActionLabel(git)).toBe("Fetch lint");
    const detach: RecoveryAction = {
      id: "detach-dependency",
      label: "Detach lint from team-profile",
      rootName: "team-profile",
      pluginName: "lint",
    };
    expect(recoveryActionLabel(detach)).toBe("Detach lint from team-profile");
  });

  it("Desktop renders agent text through the mapping", () => {
    const read = (path: string) => readFileSync(join(DESKTOP_SRC, path), "utf-8");
    expect(read("components/live/ConflictRecoveryChoices.tsx")).not.toMatch(/\{action\.label\}/);
    expect(read("state/scope-controller.ts")).not.toMatch(/\$\{action\.label\}/);
    expect(read("components/LiveStatePanel.tsx")).toMatch(
      /previewWarning = rawPreviewWarning \? desktopAgentText\(rawPreviewWarning\)/,
    );
    expect(read("lib/agent-client.ts")).toMatch(/error: desktopAgentText\(parsed\.error\)/);
  });
});

describe("project history without a git remote", () => {
  const drawer = readFileSync(join(DESKTOP_SRC, "components/parity/ProjectHistoryDrawer.tsx"), "utf-8");

  it("offers an Add remote form instead of git command hints", () => {
    expect(drawer).not.toMatch(/hints\.map|originHints/);
    expect(drawer).toContain('aria-label="Remote URL"');
    expect(drawer).toMatch(/"Add remote"/);
    expect(drawer).toMatch(/addProjectGitOrigin\(baseUrl, token, \{ projectPath, url \}\)/);
  });
});
