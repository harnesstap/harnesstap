import { describe, expect, it } from "bun:test";
import {
  applyCancelledMessage,
  applyWroteLine,
  onConflictReplaceHint,
  CLI_ERRORS,
  CLI_HINTS,
  dryRunWouldLine,
  DRY_RUN_NOTHING_CHANGED,
  formatHtCommand,
  NATIVE_MODULE_MISMATCH_MESSAGE,
  marketplaceUnreachableHint,
  quoteCliArg,
} from "../../src/copy/cli.ts";
import {
  formatApproveRemedy,
  formatDenyRemedy,
} from "../../src/services/executable-trust.ts";

describe("CLI copy helpers (DS-6)", () => {
  it("quotes tokens that would split on the shell", () => {
    expect(quoteCliArg("dep-hooks")).toBe("dep-hooks");
    expect(quoteCliArg("acme/my plugin")).toBe('"acme/my plugin"');
    expect(quoteCliArg("")).toBe('""');
  });

  it("always prefixes command hints with ht", () => {
    expect(formatHtCommand("approve dep-hooks")).toBe("ht approve dep-hooks");
    expect(DRY_RUN_NOTHING_CHANGED).toBe("Dry run. Nothing was changed.");
    expect(NATIVE_MODULE_MISMATCH_MESSAGE).toBe(
      "HarnessTap was installed under a different Node.js version. Run: npm rebuild -g harnesstap",
    );
  });

  it("matches DS-6 apply and dry-run summary lines", () => {
    expect(
      dryRunWouldLine({ write: 3, remove: 1, keep: 2, unchanged: 28 }),
    ).toBe("Would write 3, remove 1, keep 2. 28 unchanged.");
    expect(
      applyWroteLine({ wrote: 3, removed: 1, kept: 2, unchanged: 28 }),
    ).toBe("Wrote 3, removed 1, kept 2, unchanged 28.");
  });

  it("keeps Wave 1 error copy next to marketplace strings", () => {
    expect(CLI_ERRORS.pluginAlreadyExists("demo-plugin")).toBe(
      'A plugin named "demo-plugin" already exists.',
    );
    expect(CLI_HINTS.onConflictReplace).toBe("Use --on-conflict replace to replace it.");
    expect(applyCancelledMessage([".cursor/mcp.json"], "profile")).toBe(
      "Profile apply cancelled. .cursor/mcp.json would change.",
    );
    expect(applyCancelledMessage([".cursor/mcp.json", "my file.json"], "apply")).toBe(
      'Apply cancelled. These files would change: .cursor/mcp.json, "my file.json".',
    );
    expect(onConflictReplaceHint([".cursor/mcp.json"])).toBe(
      "Use --on-conflict replace to replace it.",
    );
    expect(onConflictReplaceHint([".cursor/mcp.json", ".codex/config.toml"])).toBe(
      "Use --on-conflict replace to replace them.",
    );
    expect(CLI_HINTS.githubLogin).toBe(marketplaceUnreachableHint());
    expect(CLI_ERRORS.noHarnesses).toBe("Not set up for any harness yet.");
    expect(CLI_HINTS.harnessSet).toBe("Run ht harness set to pick your harnesses.");
  });

  it("quotes package refs in approve and deny hints", () => {
    expect(formatApproveRemedy(["acme/my plugin", "ok"])).toBe(
      'ht approve "acme/my plugin" ok',
    );
    expect(formatDenyRemedy(["acme/my plugin"])).toBe('ht deny "acme/my plugin"');
  });
});
