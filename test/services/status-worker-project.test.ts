import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const ROOT = join(import.meta.dir, "..", "..");
const BIN = join(ROOT, "src", "bin.ts");
const DRIFT = join(ROOT, "src", "services", "global-profile-drift.ts");
const CACHE = join(ROOT, "src", "services", "status-read-cache.ts");

function script(projectPath: string, depth: "full" | "fast"): string {
  return `const { detectGlobalProfileStatus } = await import(${JSON.stringify(DRIFT)});
const { readStatusRefreshWorkerCreateCount } = await import(${JSON.stringify(CACHE)});
try {
  const status = await detectGlobalProfileStatus({ depth: ${JSON.stringify(depth)}, projectPath: ${JSON.stringify(projectPath)} });
  console.log(JSON.stringify({ ok: true, depth: status.depth, workers: readStatusRefreshWorkerCreateCount() }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, message: error.message, workers: readStatusRefreshWorkerCreateCount() }));
}`;
}

function seedProject(root: string): void {
  mkdirSync(join(root, ".claude", "skills", "local-skill"), { recursive: true });
  mkdirSync(join(root, ".claude", "commands"), { recursive: true });
  mkdirSync(join(root, ".cursor", "rules"), { recursive: true });
  writeFileSync(join(root, ".claude", "skills", "local-skill", "SKILL.md"), "---\nname: local-skill\ndescription: d\n---\nbody\n");
  writeFileSync(join(root, ".claude", "commands", "build.md"), "# build\n");
  writeFileSync(join(root, ".claude", "settings.json"), "{\"permissions\":{}}\n");
  writeFileSync(join(root, ".cursor", "rules", "style.mdc"), "---\ndescription: r\n---\nrule\n");
  writeFileSync(join(root, ".cursor", "mcp.json"), "{\"mcpServers\":{}}\n");
  writeFileSync(join(root, "AGENTS.md"), "# agents\n");
  writeFileSync(join(root, "CLAUDE.md"), "# claude\n");
  writeFileSync(join(root, "apm.yml"), "name: demo\nversion: 1.0.0\n");
}

async function run(args: string[], env: Record<string, string | undefined>) {
  const child = Bun.spawn(args, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 30_000);
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  return { stdout, stderr, code, signal: child.signalCode };
}

function homeEnv(home: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HARNESSTAP_HOME: join(home, ".harnesstap"),
    DO_NOT_TRACK: "1",
  };
  delete env.HARNESSTAP_STATUS_CACHE_DEBUG;
  return env;
}

describe("status with a project path through the refresh worker", () => {
  it("returns status for a project that has harness folders at both depths", async () => {
    const home = mkdtempSync(join(tmpdir(), "ht-status-project-home-"));
    const project = join(home, "dev", "demo");
    try {
      seedProject(project);
      const env = homeEnv(home);
      const init = await run([process.execPath, BIN, "--no-interactive", "init", "--harnesses", "claude-code,cursor"], env);
      expect(init.code).toBe(0);
      for (const depth of ["full", "fast"] as const) {
        const result = await run([process.execPath, "-e", script(project, depth)], env);
        expect(result.signal).toBeNull();
        expect(result.code).toBe(0);
        const line = JSON.parse(result.stdout.trim().split("\n").pop() ?? "{}");
        expect(line).toMatchObject({ ok: true, depth });
        expect(line.workers).toBeGreaterThan(0);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 90_000);

  it("surfaces the worker's error message and stack, then exits", async () => {
    const home = mkdtempSync(join(tmpdir(), "ht-status-worker-error-"));
    try {
      mkdirSync(join(home, ".harnesstap"), { recursive: true });
      writeFileSync(join(home, ".harnesstap", "harnesstap.db"), "not a sqlite database\n");
      const project = join(home, "dev", "demo");
      seedProject(project);
      const result = await run([process.execPath, "-e", script(project, "full")], homeEnv(home));
      expect(result.signal).toBeNull();
      expect(result.code).toBe(0);
      const line = JSON.parse(result.stdout.trim().split("\n").pop() ?? "{}");
      expect(line.ok).toBe(false);
      expect(line.workers).toBeGreaterThan(0);
      expect(line.message).toStartWith("Status read failed: ");
      expect(line.message).toContain("not a database");
      expect(result.stderr).toContain("[status-cache] status read failed (projectPath=");
      expect(result.stderr).toMatch(/\n\s+at /);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);
});
