import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GIT_TIMEOUT_ENV,
  gitRemoteFromArgs,
  gitTimeoutOverrideMs,
  isClaudePluginCommand,
  isGitNetworkCommand,
  redactRemote,
} from "../../src/utils/git-network.ts";
import { resolveCommandTimeoutMs, spawnCommand } from "../../src/utils/spawn-command.ts";
import { shortRemoteReachabilityReason } from "../../src/services/marketplace-reachability.ts";

const SAVED = ["PATH", GIT_TIMEOUT_ENV, "GIT_HTTP_LOW_SPEED_LIMIT", "GIT_HTTP_LOW_SPEED_TIME"] as const;
let saved: Record<string, string | undefined>;
let server: Server | undefined;
let sockets: Socket[] = [];
let dir: string;

beforeEach(() => {
  saved = Object.fromEntries(SAVED.map((key) => [key, process.env[key]]));
  dir = mkdtempSync(join(tmpdir(), "ht-git-timeout-"));
});

afterEach(() => {
  for (const key of SAVED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  for (const socket of sockets) socket.destroy();
  sockets = [];
  server?.close();
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** A server that takes the connection and never answers, like a stalled remote. */
async function listenStalled(): Promise<number> {
  server = createServer((socket) => {
    sockets.push(socket);
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server?.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

function fakeExecutable(name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}:${saved.PATH ?? ""}`;
}

describe("git network limits", () => {
  it("reads the timeout from HARNESSTAP_GIT_TIMEOUT_SECONDS", () => {
    expect(gitTimeoutOverrideMs({})).toBeUndefined();
    expect(gitTimeoutOverrideMs({ [GIT_TIMEOUT_ENV]: "" })).toBeUndefined();
    expect(gitTimeoutOverrideMs({ [GIT_TIMEOUT_ENV]: "abc" })).toBeUndefined();
    expect(gitTimeoutOverrideMs({ [GIT_TIMEOUT_ENV]: "0" })).toBeUndefined();
    expect(gitTimeoutOverrideMs({ [GIT_TIMEOUT_ENV]: "90" })).toBe(90_000);
    expect(gitTimeoutOverrideMs({ [GIT_TIMEOUT_ENV]: "0.5" })).toBe(500);
  });

  it("limits clone, fetch and ls-remote, and nothing local", () => {
    delete process.env[GIT_TIMEOUT_ENV];
    expect(resolveCommandTimeoutMs(undefined, "git", ["ls-remote", "https://x/y.git"])).toBe(60_000);
    expect(resolveCommandTimeoutMs(undefined, "git", ["-C", "d", "fetch", "origin"])).toBe(60_000);
    expect(resolveCommandTimeoutMs({ timeoutMs: 5_000 }, "git", ["clone", "u", "d"])).toBe(5_000);
    expect(resolveCommandTimeoutMs(undefined, "git", ["rev-parse", "HEAD"])).toBeUndefined();
    expect(resolveCommandTimeoutMs(undefined, "claude", ["plugin", "marketplace", "add", "o/r"])).toBe(600_000);
    expect(resolveCommandTimeoutMs(undefined, "claude", ["--version"])).toBeUndefined();
    process.env[GIT_TIMEOUT_ENV] = "7";
    expect(resolveCommandTimeoutMs({ timeoutMs: 120_000 }, "git", ["ls-remote", "u"])).toBe(7_000);
    expect(resolveCommandTimeoutMs({ unattended: true }, "git", ["fetch", "origin"])).toBe(15_000);
  });

  it("names the repository without its credentials", () => {
    expect(redactRemote("https://x-access-token:s3cret@github.com/o/r.git")).toBe("https://github.com/o/r.git");
    expect(gitRemoteFromArgs(["ls-remote", "--tags", "https://tok@github.com/o/r.git"])).toBe("https://github.com/o/r.git");
    expect(gitRemoteFromArgs(["clone", "--depth", "1", "--branch", "v1", "https://github.com/o/r.git", "/tmp/d"])).toBe(
      "https://github.com/o/r.git",
    );
    expect(isGitNetworkCommand(["-c", "http.extraheader=x", "ls-remote", "u"])).toBe(true);
    expect(isGitNetworkCommand(["status"])).toBe(false);
    expect(isClaudePluginCommand("/usr/bin/claude", ["plugin", "install", "a@b"])).toBe(true);
    expect(isClaudePluginCommand("claude", ["--version"])).toBe(false);
  });

  it("stops a git call to a remote that never answers and names the repo", async () => {
    const port = await listenStalled();
    process.env[GIT_TIMEOUT_ENV] = "1";
    process.env.GIT_HTTP_LOW_SPEED_TIME = "120";
    const url = `http://user:secret@127.0.0.1:${port}/owner/repo.git`;
    const started = Date.now();

    const result = await spawnCommand("git", ["ls-remote", url]);

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain(`http://127.0.0.1:${port}/owner/repo.git`);
    expect(result.stderr).toContain("git ls-remote timed out after 1s");
    expect(result.stderr).toContain(GIT_TIMEOUT_ENV);
    expect(result.stderr).not.toContain("secret");
    expect(shortRemoteReachabilityReason(result.stderr)).toBe("Remote check timed out");
  });

  it("lets git abort a stalled transfer on its own and names the repo", async () => {
    const port = await listenStalled();
    process.env[GIT_TIMEOUT_ENV] = "60";
    process.env.GIT_HTTP_LOW_SPEED_LIMIT = "1000";
    process.env.GIT_HTTP_LOW_SPEED_TIME = "1";
    const url = `http://user:secret@127.0.0.1:${port}/owner/repo.git`;
    const started = Date.now();

    const result = await spawnCommand("git", ["ls-remote", url]);

    expect(Date.now() - started).toBeLessThan(20_000);
    expect(result.exitCode).not.toBe(0);
    expect(result.exitCode).not.toBe(124);
    expect(result.stderr).toContain(`git ls-remote stalled for http://127.0.0.1:${port}/owner/repo.git`);
    expect(result.stderr).not.toContain("secret");
  });

  it("stops a fake git that hangs, naming the remote of a named remote", async () => {
    fakeExecutable("git", 'if [ "$1" = "-C" ] && [ "$3" = "remote" ]; then echo https://u:p@example.com/o/named.git; exit 0; fi\nsleep 30');
    process.env[GIT_TIMEOUT_ENV] = "1";

    const result = await spawnCommand("git", ["-C", dir, "fetch", "origin"]);

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("git fetch timed out after 1s for https://example.com/o/named.git");
  });

  it("gives the claude plugin calls git's stall detection and a limit", async () => {
    const out = join(dir, "env.txt");
    fakeExecutable("claude", `echo "$GIT_HTTP_LOW_SPEED_LIMIT $GIT_HTTP_LOW_SPEED_TIME" > "${out}"\nsleep 30`);
    delete process.env.GIT_HTTP_LOW_SPEED_LIMIT;
    delete process.env.GIT_HTTP_LOW_SPEED_TIME;

    const result = await spawnCommand("claude", ["plugin", "marketplace", "add", "owner/repo"], { timeoutMs: 1_000 });

    expect(readFileSync(out, "utf8").trim()).toBe("1000 30");
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("claude plugin marketplace add owner/repo timed out after 1s");
    expect(result.stderr).toContain(GIT_TIMEOUT_ENV);
  });

  it("keeps a git value the user already set", async () => {
    const out = join(dir, "env.txt");
    fakeExecutable("git", `echo "$GIT_HTTP_LOW_SPEED_LIMIT $GIT_HTTP_LOW_SPEED_TIME" > "${out}"`);
    process.env.GIT_HTTP_LOW_SPEED_LIMIT = "5";
    process.env.GIT_HTTP_LOW_SPEED_TIME = "9";

    await spawnCommand("git", ["ls-remote", "https://example.com/o/r.git"]);

    expect(readFileSync(out, "utf8").trim()).toBe("5 9");
  });
});
