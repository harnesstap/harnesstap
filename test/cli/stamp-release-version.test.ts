import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const STAMP = join(ROOT, "scripts/stamp-release-version.sh");
const PLAN = join(ROOT, "scripts/tag-release-plan.sh");
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function writeFixture(root: string, version: string, opts?: { unreleased?: boolean }): Promise<void> {
  await mkdir(join(root, ".changes/unreleased"), { recursive: true });
  await mkdir(join(root, "apps/desktop/src-tauri"), { recursive: true });
  await writeFile(join(root, "package.json"), `{\n  "name": "harnesstap",\n  "version": "${version}"\n}\n`);
  await writeFile(
    join(root, "apps/desktop/package.json"),
    `{\n  "name": "harnesstap-desktop",\n  "version": "${version}"\n}\n`,
  );
  await writeFile(
    join(root, "apps/desktop/src-tauri/tauri.conf.json"),
    `{\n  "version": "${version}",\n  "identifier": "dev.harnesstap.desktop"\n}\n`,
  );
  await writeFile(
    join(root, "apps/desktop/src-tauri/Cargo.toml"),
    `[package]\nname = "harnesstap-desktop"\nversion = "${version}"\n\n[dependencies]\nserde = "1"\n`,
  );
  await writeFile(
    join(root, "apps/desktop/src-tauri/Cargo.lock"),
    `[[package]]\nname = "harnesstap-desktop"\nversion = "${version}"\n`,
  );
  await writeFile(join(root, `.changes/v${version}.md`), `## harnesstap v${version}\n`);
  if (opts?.unreleased) {
    await writeFile(join(root, ".changes/unreleased/fixed-example.yaml"), "kind: Fixed\nbody: example\n");
  }
}

function parsePlan(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.trim().split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 0) {
      continue;
    }
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

async function runPlan(
  root: string,
  latest: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["/bin/bash", PLAN], {
    cwd: root,
    env: { ...process.env, TAG_RELEASE_ROOT: root, CHANGIE_LATEST: latest },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("stamp-release-version.sh", () => {
  test("stamps CLI and Desktop version files together", async () => {
    const root = await tempDir("stamp-release-");
    await writeFixture(root, "1.1.0");
    const proc = Bun.spawn(["/bin/bash", STAMP, "v1.2.0"], {
      cwd: root,
      env: { ...process.env, STAMP_RELEASE_ROOT: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Release version stamps set to 1.2.0");
    expect(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version).toBe("1.2.0");
    expect(JSON.parse(await readFile(join(root, "apps/desktop/package.json"), "utf8")).version).toBe(
      "1.2.0",
    );
    expect(
      JSON.parse(await readFile(join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8")).version,
    ).toBe("1.2.0");
    expect(await readFile(join(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8")).toContain(
      'version = "1.2.0"',
    );
    expect(await readFile(join(root, "apps/desktop/src-tauri/Cargo.lock"), "utf8")).toContain(
      'name = "harnesstap-desktop"\nversion = "1.2.0"',
    );
  });
});

describe("tag-release-plan.sh", () => {
  test("prepares a cut when unreleased fragments exist", async () => {
    const root = await tempDir("plan-unreleased-");
    await writeFixture(root, "1.1.0", { unreleased: true });
    const { exitCode, stdout } = await runPlan(root, "v1.1.0");
    expect(exitCode).toBe(0);
    expect(parsePlan(stdout)).toMatchObject({
      has_unreleased: "true",
      batch_args: "auto",
      action: "prepare",
    });
  });

  test("tags when already batched and versions match", async () => {
    const root = await tempDir("plan-tag-");
    await writeFixture(root, "1.1.0");
    const { exitCode, stdout } = await runPlan(root, "v1.1.0");
    expect(exitCode).toBe(0);
    expect(parsePlan(stdout)).toMatchObject({
      has_unreleased: "false",
      batched_version: "v1.1.0",
      versions_match: "true",
      action: "tag",
    });
  });

  test("skips when there is no batched changelog", async () => {
    const root = await tempDir("plan-skip-");
    await writeFixture(root, "0.0.0");
    await rm(join(root, ".changes/v0.0.0.md"));
    const { exitCode, stdout } = await runPlan(root, "v0.0.0");
    expect(exitCode).toBe(0);
    expect(parsePlan(stdout).action).toBe("skip");
  });

  test("prepares a stamp when batched versions are behind", async () => {
    const root = await tempDir("plan-stamp-");
    await writeFixture(root, "1.0.0");
    await writeFile(join(root, ".changes/v1.1.0.md"), "## harnesstap v1.1.0\n");
    const { exitCode, stdout } = await runPlan(root, "v1.1.0");
    expect(exitCode).toBe(0);
    expect(parsePlan(stdout)).toMatchObject({
      has_unreleased: "false",
      batched_version: "v1.1.0",
      versions_match: "false",
      action: "prepare",
    });
  });
});
