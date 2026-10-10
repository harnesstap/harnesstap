import { describe, expect, it } from "bun:test";
import {
  CLI_ERRORS,
  CLI_HINTS,
  DRY_RUN_NOTHING_CHANGED,
  formatHtCommand,
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
  });

  it("keeps Wave 1 error copy next to marketplace strings", () => {
    expect(CLI_ERRORS.pluginAlreadyExists("demo-plugin")).toBe(
      'A plugin named "demo-plugin" already exists.',
    );
    expect(CLI_HINTS.onConflictReplace).toBe("Use --on-conflict replace to replace it.");
    expect(CLI_HINTS.githubLogin).toBe(marketplaceUnreachableHint());
  });

  it("quotes package refs in approve and deny hints", () => {
    expect(formatApproveRemedy(["acme/my plugin", "ok"])).toBe(
      'ht approve "acme/my plugin" ok',
    );
    expect(formatDenyRemedy(["acme/my plugin"])).toBe('ht deny "acme/my plugin"');
  });
});
