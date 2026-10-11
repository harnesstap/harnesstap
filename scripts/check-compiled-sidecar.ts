import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PACKAGE_VERSION } from "../src/version.ts";

/**
 * Builds the real `bun build --compile` desktop sidecar for this machine and
 * runs it. Running the source agent (`bun src/agent/entry.ts`) cannot catch
 * bugs that only exist inside the compiled binary, such as reading files from
 * the virtual /$bunfs root or an entry that never starts.
 */

const repoRoot = resolve(import.meta.dir, "..");
const exeSuffix = process.platform === "win32" ? ".exe" : "";
const sidecarPath = join(repoRoot, "dist", "sidecar", `ht-agent${exeSuffix}`);
const expectedVersion = PACKAGE_VERSION;
const READY_TIMEOUT_MS = 30_000;

class CheckFailure extends Error {}

function fail(message: string): never {
  throw new CheckFailure(message);
}

function isolatedEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HARNESSTAP_HOME: join(home, ".harnesstap"),
    HARNESSTAP_PRODUCT: "desktop",
    HARNESSTAP_AGENT_PORT: "17474",
  };
}

function buildSidecar(): void {
  const build = spawnSync("bash", [join(repoRoot, "scripts", "build-sidecar.sh")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    fail(`scripts/build-sidecar.sh exited with ${build.status}`);
  }
  if (!existsSync(sidecarPath)) {
    fail(`sidecar binary missing at ${sidecarPath}`);
  }
}

function checkVersionFlag(env: NodeJS.ProcessEnv): void {
  const result = spawnSync(sidecarPath, ["--version"], { env, encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0) {
    fail(
      `ht-agent --version exited ${result.status} (signal ${result.signal}). stderr:\n${result.stderr}`,
    );
  }
  const printed = result.stdout.trim();
  if (printed !== expectedVersion) {
    fail(`ht-agent --version printed '${printed}', expected '${expectedVersion}'`);
  }
  console.log(`ok: ht-agent --version -> ${printed}`);
}

function checkCrashHookExitsNonZero(env: NodeJS.ProcessEnv): void {
  const result = spawnSync(sidecarPath, [], {
    env: { ...env, HARNESSTAP_AGENT_SIMULATE_CRASH: "1" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 1 || !result.stderr.includes("simulated startup crash")) {
    fail(
      `HARNESSTAP_AGENT_SIMULATE_CRASH=1 should exit 1 with a stderr message, got ${result.status}: ${result.stderr}`,
    );
  }
  console.log("ok: simulated crash exits 1 with stderr");
}

async function waitForPort(portFile: string, child: ChildProcess, stderr: () => string): Promise<number> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`ht-agent exited with ${child.exitCode} before reporting its port. stderr:\n${stderr()}`);
    }
    if (existsSync(portFile)) {
      const port = Number.parseInt(readFileSync(portFile, "utf8").trim(), 10);
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  fail(`ht-agent did not write ${portFile} within ${READY_TIMEOUT_MS}ms. stderr:\n${stderr()}`);
}

async function checkHealthHandshake(home: string, env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(sidecarPath, [], { env, stdio: ["pipe", "pipe", "pipe"] });
  let captured = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    captured += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    captured += chunk.toString();
  });
  const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));

  try {
    const port = await waitForPort(join(home, ".harnesstap", "agent-port"), child, () => captured);
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`);
    if (!response.ok) {
      fail(`GET /v1/health returned ${response.status}`);
    }
    const health = (await response.json()) as { status?: string; version?: string; port?: number };
    if (health.status !== "healthy") {
      fail(`health status is '${health.status}', expected 'healthy'`);
    }
    if (health.version !== expectedVersion) {
      fail(`health version is '${health.version}', expected '${expectedVersion}'`);
    }
    if (health.port !== port) {
      fail(`health port is ${health.port}, expected ${port}`);
    }
    console.log(`ok: GET /v1/health -> healthy ${health.version} on ${port}`);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([exited, new Promise((done) => setTimeout(done, 5_000))]);
    }
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }
}

const home = mkdtempSync(join(tmpdir(), "harnesstap-sidecar-check-"));
try {
  const env = isolatedEnv(home);
  buildSidecar();
  checkVersionFlag(env);
  checkCrashHookExitsNonZero(env);
  await checkHealthHandshake(home, env);
  console.log("check-compiled-sidecar: ok");
} catch (error) {
  console.error(`check-compiled-sidecar: FAIL: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
