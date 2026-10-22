import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshGitSource } from "../../src/plugins/refresh.ts";
import type { RunCommand } from "../../src/plugins/run-command.ts";
import { logUnattendedRefreshFailure } from "../../src/services/marketplace-catalog.ts";
import {
  resetTelemetryProductForTests,
  setTelemetryProduct,
} from "../../src/telemetry/product.ts";
import { mapGitStderr } from "../../src/utils/git-errors.ts";

const timedOutClone: RunCommand = (command, args) => ({
  stdout: "",
  stderr: `Command timed out after 15000ms: ${command} ${args.join(" ")}`,
  exitCode: 124,
});

const dirs: string[] = [];

afterEach(() => {
  resetTelemetryProductForTests();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("git refresh timeout", () => {
  it("reports a timeout as a timeout, not as an unreachable repository", () => {
    expect(mapGitStderr("Command timed out after 15000ms: git clone x y", "/srv/mkta")).toBe(
      "Timed out after 15s reaching /srv/mkta.",
    );
    expect(mapGitStderr("fatal: unable to access", "/srv/mkta")).toBe("Couldn't reach /srv/mkta.");
  });

  it("flags timedOut and leaves the cached checkout in place", async () => {
    const root = mkdtempSync(join(tmpdir(), "ht-refresh-timeout-"));
    dirs.push(root);
    const targetDir = join(root, "mkta");
    mkdirSync(targetDir);
    writeFileSync(join(targetDir, "catalog.json"), "{\"cached\":true}");

    const result = await refreshGitSource({
      url: "/srv/mkta",
      targetDir,
      runCommand: timedOutClone,
      unattended: true,
    });

    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.message).toBe("Timed out after 15s reaching /srv/mkta.");
    expect(readFileSync(join(targetDir, "catalog.json"), "utf8")).toBe("{\"cached\":true}");
    expect(existsSync(`${targetDir}.incoming`)).toBe(false);
  });
});

describe("background catalog refresh log", () => {
  it("keeps a CLI run quiet when the background refresh times out", () => {
    setTelemetryProduct("cli");
    const previousDebug = process.env.HARNESSTAP_DEBUG;
    delete process.env.HARNESSTAP_DEBUG;
    const error = spyOn(console, "error").mockImplementation(() => {});
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      logUnattendedRefreshFailure("mkta", {
        message: "Timed out after 15s reaching /srv/mkta.",
        timedOut: true,
      });
      expect(error).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      log.mockRestore();
      if (previousDebug !== undefined) process.env.HARNESSTAP_DEBUG = previousDebug;
    }
  });

  it("notes a timeout in the Desktop agent log as info, without Couldn't reach", () => {
    setTelemetryProduct("desktop");
    const error = spyOn(console, "error").mockImplementation(() => {});
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      logUnattendedRefreshFailure("mkta", {
        message: "Timed out after 15s reaching /srv/mkta.",
        timedOut: true,
      });
      expect(error).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]?.[0]);
      expect(line).toContain("Timed out after 15s reaching /srv/mkta. Using the cached catalog.");
      expect(line).not.toContain("Couldn't reach");
      expect(line).not.toContain("failed");
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
  });

  it("still reports a background failure that is not a timeout", () => {
    setTelemetryProduct("cli");
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      logUnattendedRefreshFailure("mkta", { message: "Couldn't reach /srv/mkta." });
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]?.[0])).toContain("refresh failed for mkta");
    } finally {
      error.mockRestore();
    }
  });
});
