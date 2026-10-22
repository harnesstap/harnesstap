import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { RunCommand } from "../../src/plugins/run-command.ts";
import { checkMarketplaceReachability } from "../../src/services/marketplace-reachability.ts";
import { GIT_LS_REMOTE_TIMEOUT_MS } from "../../src/services/marketplace-source-branches.ts";

describe("checkMarketplaceReachability", () => {
  it("marks a reachable local directory healthy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-mkt-reach-ok-"));
    mkdirSync(join(dir, "plugins"), { recursive: true });

    await expect(checkMarketplaceReachability(dir)).resolves.toEqual({
      status: "healthy",
    });
  });

  it("marks a missing local path as an error with a reason", async () => {
    const missing = join(tmpdir(), `ht-mkt-reach-missing-${Date.now()}-nope`);
    const called: string[] = [];
    const run: RunCommand = (command) => {
      called.push(command);
      return { stdout: "", stderr: "unexpected", exitCode: 1 };
    };

    await expect(checkMarketplaceReachability(missing, { runCommand: run })).resolves.toEqual({
      status: "error",
      reason: "Local directory is missing",
    });
    expect(called).toEqual([]);
  });

  it("marks an unreachable remote as an error with a reason", async () => {
    const run: RunCommand = (_command, args) => {
      if (args.includes("ls-remote")) {
        return {
          stdout: "",
          stderr: "fatal: Authentication failed for 'https://github.com/org/private.git/'",
          exitCode: 128,
        };
      }
      return { stdout: "", stderr: "unexpected", exitCode: 1 };
    };

    await expect(
      checkMarketplaceReachability("https://github.com/org/private.git", { runCommand: run }),
    ).resolves.toEqual({
      status: "error",
      reason: "Could not authenticate with the remote",
    });
  });

  it("marks a reachable remote healthy without cloning", async () => {
    const run: RunCommand = (_command, args) => {
      if (args.includes("ls-remote")) {
        return {
          stdout: "ref: refs/heads/main\tHEAD\nabc\trefs/heads/main\n",
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "unexpected clone", exitCode: 1 };
    };

    await expect(
      checkMarketplaceReachability("https://github.com/org/repo.git", { runCommand: run }),
    ).resolves.toEqual({
      status: "healthy",
    });
  });

  it("reports a timed-out remote check without waiting on the wall clock", async () => {
    const seen: Array<{ args: string[]; timeoutMs?: number }> = [];
    const run: RunCommand = (_command, args, options) => {
      seen.push({ args, timeoutMs: options?.timeoutMs });
      return { stdout: "", stderr: "Command timed out after 20000ms", exitCode: 124 };
    };

    await expect(
      checkMarketplaceReachability("https://github.com/org/slow.git", { runCommand: run }),
    ).resolves.toEqual({
      status: "error",
      reason: "Remote check timed out",
    });
    const lsRemote = seen.find((call) => call.args.includes("ls-remote"));
    expect(lsRemote?.timeoutMs).toBe(GIT_LS_REMOTE_TIMEOUT_MS);
  });
});
