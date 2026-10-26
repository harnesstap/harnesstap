import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { closeDb, getDb, getDbPath } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { setProjectHarnessConfig, getProjectHarnessConfig } from "../../src/models/harness.ts";
import { createProject, listProjects } from "../../src/models/project.ts";
import { createSnapshot, listSnapshots } from "../../src/models/snapshot.ts";
import { normalizeGitUrl } from "../../src/services/git.ts";
import {
  ensureProjectForRoot,
  findProjectForRoot,
  migratePathProjectToOrigin,
  normalizeProjectPath,
  pathProjectId,
  resolveProjectIdentity,
} from "../../src/services/project-identity.ts";
import { initGitRepo } from "../helpers/git.ts";

const ORIGIN = "git@github.com:acme/identity.git";
const previousHome = process.env.HARNESSTAP_HOME;
const tempDirs: string[] = [];

afterEach(() => {
  closeDb();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (previousHome === undefined) {
    delete process.env.HARNESSTAP_HOME;
  } else {
    process.env.HARNESSTAP_HOME = previousHome;
  }
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ht-project-identity-"));
  tempDirs.push(dir);
  const home = join(dir, ".harnesstap");
  process.env.HARNESSTAP_HOME = home;
  initializeSchema(getDb());
  const projectDir = join(dir, "project");
  mkdirSync(projectDir, { recursive: true });
  return { dir, home, projectDir };
}

function snapshot(projectId: string, label: string) {
  return createSnapshot({
    project_id: projectId,
    label,
    state: { plugins: [], resources: [], platform_files: { "claude-code": { "CLAUDE.md": label } } },
  });
}

function backups(home: string): string[] {
  try {
    return readdirSync(join(home, "backups"));
  } catch {
    return [];
  }
}

describe("normalizeProjectPath", () => {
  it("resolves symlinks and strips trailing slashes", () => {
    const { dir, projectDir } = setup();
    const link = join(dir, "link");
    symlinkSync(projectDir, link);
    expect(normalizeProjectPath(`${link}/`, "linux")).toBe(normalizeProjectPath(projectDir, "linux"));
    expect(pathProjectId(`${projectDir}//`, "linux")).toBe(`path:${normalizeProjectPath(projectDir, "linux")}`);
  });

  it("folds case on macOS and Windows only", () => {
    expect(normalizeProjectPath("/Missing/Folder/Proj/", "darwin")).toBe("/missing/folder/proj");
    expect(normalizeProjectPath("/Missing/Folder/Proj", "linux")).toBe("/Missing/Folder/Proj");
    expect(normalizeProjectPath("/", "linux")).toBe("/");
  });
});

describe("project identity without a git remote", () => {
  it("keys a folder without git by its path, stably", () => {
    const { projectDir } = setup();
    const identity = resolveProjectIdentity(projectDir);
    expect(identity.kind).toBe("path");
    expect(findProjectForRoot(projectDir)).toBeUndefined();
    const project = ensureProjectForRoot(projectDir);
    expect(project.local_id).toBe(pathProjectId(projectDir));
    expect(project.git_origin).toBe("");
    expect(ensureProjectForRoot(`${projectDir}/`).id).toBe(project.id);
    expect(findProjectForRoot(projectDir)?.id).toBe(project.id);
    expect(listProjects()).toHaveLength(1);
  });

  it("keys a git repo with no origin by its path", () => {
    const { projectDir } = setup();
    execFileSync("git", ["init", "-q"], { cwd: projectDir, stdio: "pipe" });
    expect(resolveProjectIdentity(projectDir).kind).toBe("path");
    const project = ensureProjectForRoot(projectDir);
    expect(project.local_id).toBe(pathProjectId(projectDir));
  });

  it("keeps two folders apart", () => {
    const { dir, projectDir } = setup();
    const other = join(dir, "other");
    mkdirSync(other);
    expect(ensureProjectForRoot(projectDir).id).not.toBe(ensureProjectForRoot(other).id);
  });
});

describe("migrating to the origin once it appears", () => {
  it("moves history to the origin project, backs up first, and a rerun is a no-op", () => {
    const { home, projectDir } = setup();
    const pathProject = ensureProjectForRoot(projectDir);
    const first = snapshot(pathProject.id, "first");
    const second = snapshot(pathProject.id, "second");
    initGitRepo(projectDir, ORIGIN);

    const identity = resolveProjectIdentity(projectDir);
    if (identity.kind !== "origin") throw new Error("expected origin identity");
    const result = migratePathProjectToOrigin(identity);
    expect(result).toMatchObject({ status: "migrated", merged: false, movedSnapshots: 2 });
    expect(backups(home)).toHaveLength(1);

    const project = findProjectForRoot(projectDir);
    expect(project?.git_origin).toBe(normalizeGitUrl(ORIGIN));
    expect(project?.local_id ?? "").toBe("");
    expect(listSnapshots(project?.id ?? "").map((row) => row.id)).toEqual([second.id, first.id]);

    expect(migratePathProjectToOrigin(identity)).toEqual({ status: "none" });
    expect(ensureProjectForRoot(projectDir).id).toBe(project?.id ?? "");
    expect(backups(home)).toHaveLength(1);
    expect(listProjects()).toHaveLength(1);
  });

  it("merges into an existing origin project without duplicates and keeps order", async () => {
    const { home, projectDir } = setup();
    const originProject = createProject({ git_origin: normalizeGitUrl(ORIGIN), name: "identity", local_path: "/elsewhere" });
    const a = snapshot(originProject.id, "origin-a");
    setProjectHarnessConfig({ project_id: originProject.id, registered_harnesses: ["claude-code"] });
    await Bun.sleep(5);
    const pathProject = ensureProjectForRoot(projectDir);
    const b = snapshot(pathProject.id, "path-b");
    setProjectHarnessConfig({ project_id: pathProject.id, registered_harnesses: ["cursor"] });
    await Bun.sleep(5);
    const c = snapshot(originProject.id, "origin-c");
    initGitRepo(projectDir, ORIGIN);

    const project = ensureProjectForRoot(projectDir);
    expect(project.id).toBe(originProject.id);
    expect(project.local_path).toBe(projectDir);
    expect(listProjects()).toHaveLength(1);
    expect(listSnapshots(project.id).map((row) => row.id)).toEqual([c.id, b.id, a.id]);
    // The folder's harness config is newer, so it wins.
    expect(getProjectHarnessConfig(project.id)?.registered_harnesses).toEqual(["cursor"]);
    expect(backups(home)).toHaveLength(1);

    ensureProjectForRoot(projectDir);
    expect(listSnapshots(project.id)).toHaveLength(3);
    expect(backups(home)).toHaveLength(1);
  });

  it("is safe when two processes migrate at once", async () => {
    const { home, dir, projectDir } = setup();
    const pathProject = ensureProjectForRoot(projectDir);
    for (let index = 0; index < 5; index += 1) {
      snapshot(pathProject.id, `s${index}`);
    }
    initGitRepo(projectDir, ORIGIN);
    closeDb();
    const script = join(dir, "migrate.ts");
    const modulePath = join(import.meta.dir, "../../src/services/project-identity.ts");
    writeFileSync(
      script,
      `import { ensureProjectForRoot } from ${JSON.stringify(modulePath)};\nconsole.log(ensureProjectForRoot(${JSON.stringify(projectDir)}).id);\n`,
    );
    const runs = await Promise.all(
      [0, 1].map(async () => {
        const child = Bun.spawn([process.execPath, script], {
          env: { ...process.env, HARNESSTAP_HOME: home },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        return { out: out.trim(), code };
      }),
    );
    expect(runs.map((run) => run.code)).toEqual([0, 0]);
    expect(runs[0]?.out).toBe(runs[1]?.out ?? "");
    expect(getDbPath().startsWith(home)).toBe(true);
    const projects = listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.git_origin).toBe(normalizeGitUrl(ORIGIN));
    expect(listSnapshots(projects[0]?.id ?? "")).toHaveLength(5);
    expect(backups(home).length).toBeGreaterThanOrEqual(1);
  });
});
