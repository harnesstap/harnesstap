import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/project-history.ts";
import { getDb, closeDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { createProject } from "../../src/models/project.ts";
import { createSnapshot } from "../../src/models/snapshot.ts";
import { ensureProjectForRoot } from "../../src/services/project-identity.ts";
import { initGitRepo } from "../helpers/git.ts";

const TOKEN = "test-token";
const idle = { isAgentSwitchInProgress: () => false };

describe("parity project history tryHandle", () => {
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

  function withHome() {
    const dir = mkdtempSync(join(tmpdir(), "ht-parity-history-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = join(dir, ".harnesstap");
    initializeSchema(getDb());
    const projectDir = join(dir, "project");
    mkdirSync(projectDir, { recursive: true });
    return { dir, projectDir };
  }

  it("returns null for unrelated paths", async () => {
    const request = new Request("http://127.0.0.1/v1/health");
    expect(await tryHandle(request, TOKEN, idle)).toBeNull();
  });

  it("GET history without projectPath returns 400 project_path_required", async () => {
    const request = new Request("http://127.0.0.1/v1/project/history");
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: "project_path_required",
      message: "projectPath is required",
    });
  });

  it("GET history with blank projectPath returns 400 project_path_required", async () => {
    const request = new Request("http://127.0.0.1/v1/project/history?projectPath=%20");
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: "project_path_required",
      message: "projectPath is required",
    });
  });

  function historyRequest(projectDir: string): Request {
    return new Request(
      `http://127.0.0.1/v1/project/history?projectPath=${encodeURIComponent(projectDir)}`,
    );
  }

  function snapshotOf(projectId: string, label: string, body: string) {
    return createSnapshot({
      project_id: projectId,
      label,
      state: {
        plugins: [],
        resources: [],
        platform_files: { "claude-code": { "CLAUDE.md": body } },
      },
    });
  }

  it("GET history in a folder without git and no project yet returns project_linked false", async () => {
    const { projectDir } = withHome();
    const response = await tryHandle(historyRequest(projectDir), TOKEN, idle);
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ snapshots: [], project_linked: false });
  });

  it("GET history lists snapshots for a folder without git", async () => {
    const { projectDir } = withHome();
    const project = ensureProjectForRoot(projectDir);
    const snapshot = snapshotOf(project.id, "Before applying: no-git", "# a");
    const response = await tryHandle(historyRequest(projectDir), TOKEN, idle);
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as { snapshots: Array<{ id: string }>; project_linked: boolean };
    expect(body.project_linked).toBe(true);
    expect(body.snapshots.map((row) => row.id)).toEqual([snapshot.id]);
  });

  it("GET history lists snapshots for a git repo without origin", async () => {
    const { projectDir } = withHome();
    execFileSync("git", ["init", "-q"], { cwd: projectDir, stdio: "pipe" });
    const project = ensureProjectForRoot(projectDir);
    const snapshot = snapshotOf(project.id, "Before applying: no-origin", "# a");
    const response = await tryHandle(historyRequest(projectDir), TOKEN, idle);
    const body = (await response?.json()) as { snapshots: Array<{ id: string }> };
    expect(body.snapshots.map((row) => row.id)).toEqual([snapshot.id]);
  });

  it("GET history keeps a folder's snapshots after it gains an origin", async () => {
    const { projectDir } = withHome();
    const project = ensureProjectForRoot(projectDir);
    const older = snapshotOf(project.id, "Before applying: older", "# a");
    await Bun.sleep(5);
    const newer = snapshotOf(project.id, "Before applying: newer", "# b");
    initGitRepo(projectDir, "git@github.com:acme/history-gained.git");
    for (let run = 0; run < 2; run += 1) {
      const response = await tryHandle(historyRequest(projectDir), TOKEN, idle);
      const body = (await response?.json()) as { snapshots: Array<{ id: string }> };
      expect(body.snapshots.map((row) => row.id)).toEqual([newer.id, older.id]);
    }
    const rows = getDb().prepare("SELECT git_origin FROM projects").all() as Array<{ git_origin: string }>;
    expect(rows).toEqual([{ git_origin: "git@github.com:acme/history-gained.git" }]);
  });

  it("GET history with origin but no project row returns empty list and project_linked false", async () => {
    const { projectDir } = withHome();
    initGitRepo(projectDir, "git@github.com:acme/history-unlinked.git");
    const request = new Request(
      `http://127.0.0.1/v1/project/history?projectPath=${encodeURIComponent(projectDir)}`,
    );
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      snapshots: [],
      project_linked: false,
    });
  });

  it("GET history lists snapshots newest first without file bodies", async () => {
    const { projectDir } = withHome();
    const origin = "git@github.com:acme/history-list.git";
    initGitRepo(projectDir, origin);
    const project = createProject({
      git_origin: origin,
      name: "history-list",
      local_path: projectDir,
    });
    const older = createSnapshot({
      project_id: project.id,
      label: "Before applying: older",
      state: {
        plugins: [],
        resources: [],
        platform_files: { "claude-code": { "CLAUDE.md": "# secret-body-must-not-leak" } },
      },
    });
    await Bun.sleep(5);
    const newer = createSnapshot({
      project_id: project.id,
      label: "Before applying: newer",
      state: {
        plugins: [],
        resources: [],
        platform_files: {
          "claude-code": { "CLAUDE.md": "# a", "AGENTS.md": "# b" },
        },
      },
    });

    const request = new Request(
      `http://127.0.0.1/v1/project/history?projectPath=${encodeURIComponent(projectDir)}`,
    );
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      snapshots: Array<{ id: string; created_at: string; label: string; file_count: number; state?: unknown }>;
      project_linked: boolean;
    };
    expect(body.project_linked).toBe(true);
    expect(body.snapshots.map((row) => row.id)).toEqual([newer.id, older.id]);
    expect(body.snapshots[0]).toEqual({
      id: newer.id,
      created_at: newer.created_at,
      label: "Before applying: newer",
      file_count: 2,
    });
    expect(body.snapshots[1]?.file_count).toBe(1);
    expect(JSON.stringify(body)).not.toContain("secret-body-must-not-leak");
    expect(body.snapshots[0]?.state).toBeUndefined();
  });

  function authHeaders(): HeadersInit {
    return {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    };
  }

  it("POST revert without auth returns 401", async () => {
    const request = new Request("http://127.0.0.1/v1/project/revert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshotId: "x", projectPath: "/tmp" }),
    });
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Missing or invalid Bearer token",
    });
  });

  it("POST revert returns 409 when a switch is in progress", async () => {
    const request = new Request("http://127.0.0.1/v1/project/revert", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ snapshotId: "x", projectPath: "/tmp" }),
    });
    const response = await tryHandle(request, TOKEN, {
      isAgentSwitchInProgress: () => true,
    });
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: "switch_in_progress",
      message: "Another profile switch is already running",
    });
  });

  it("POST revert with invalid JSON returns 400 invalid_json", async () => {
    const request = new Request("http://127.0.0.1/v1/project/revert", {
      method: "POST",
      headers: authHeaders(),
      body: "{",
    });
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({ error: "invalid_json" });
  });

  it("POST revert with missing fields returns 400 invalid_body", async () => {
    const request = new Request("http://127.0.0.1/v1/project/revert", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ snapshotId: "x" }),
    });
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: "invalid_body",
      message: "snapshotId and projectPath are required",
    });
  });

  it("POST revert works in a folder without git", async () => {
    const { projectDir } = withHome();
    const project = ensureProjectForRoot(projectDir);
    const snapshot = snapshotOf(project.id, "Before applying: no-git", "# Original");
    const request = new Request("http://127.0.0.1/v1/project/revert", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ snapshotId: snapshot.id, projectPath: projectDir }),
    });
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(200);
    expect(((await response?.json()) as { snapshot: { id: string } }).snapshot.id).toBe(snapshot.id);
  });

  it("POST revert refuses a snapshot from another folder without git", async () => {
    const { dir, projectDir } = withHome();
    const otherDir = join(dir, "other");
    mkdirSync(otherDir, { recursive: true });
    ensureProjectForRoot(otherDir);
    const snapshot = snapshotOf(ensureProjectForRoot(projectDir).id, "Before applying: a", "# a");
    const request = new Request("http://127.0.0.1/v1/project/revert", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ snapshotId: snapshot.id, projectPath: otherDir }),
    });
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(409);
  });

  it("POST revert unknown snapshot returns 404", async () => {
    const { projectDir } = withHome();
    initGitRepo(projectDir, "git@github.com:acme/history-missing.git");
    const request = new Request("http://127.0.0.1/v1/project/revert", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ snapshotId: "missing-snapshot", projectPath: projectDir }),
    });
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({
      error: "snapshot_not_found",
      message: "Snapshot not found: missing-snapshot",
    });
  });

  it("POST revert when snapshot project row is gone returns 404", async () => {
    const { projectDir } = withHome();
    initGitRepo(projectDir, "git@github.com:acme/history-orphan.git");
    const project = createProject({
      git_origin: "git@github.com:acme/history-orphan.git",
      name: "orphan",
      local_path: projectDir,
    });
    const snapshot = createSnapshot({
      project_id: project.id,
      label: "Before applying: orphan",
      state: {
        plugins: [],
        resources: [],
        platform_files: { "claude-code": { "CLAUDE.md": "# a" } },
      },
    });
    const db = getDb();
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("DELETE FROM projects WHERE id = ?").run(project.id);
    db.exec("PRAGMA foreign_keys = ON");
    const request = new Request("http://127.0.0.1/v1/project/revert", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ snapshotId: snapshot.id, projectPath: projectDir }),
    });
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({
      error: "snapshot_project_not_found",
      message: "Snapshot project not found.",
    });
  });

  it("POST revert mismatch returns 409 snapshot_project_mismatch", async () => {
    const { dir, projectDir } = withHome();
    const otherDir = join(dir, "other");
    mkdirSync(otherDir, { recursive: true });
    initGitRepo(projectDir, "git@github.com:acme/history-a.git");
    initGitRepo(otherDir, "git@github.com:acme/history-b.git");
    const projectA = createProject({
      git_origin: "git@github.com:acme/history-a.git",
      name: "a",
      local_path: projectDir,
    });
    createProject({
      git_origin: "git@github.com:acme/history-b.git",
      name: "b",
      local_path: otherDir,
    });
    const snapshot = createSnapshot({
      project_id: projectA.id,
      label: "Before applying: a",
      state: {
        plugins: [],
        resources: [],
        platform_files: { "claude-code": { "CLAUDE.md": "# a" } },
      },
    });
    const request = new Request("http://127.0.0.1/v1/project/revert", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ snapshotId: snapshot.id, projectPath: otherDir }),
    });
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: "snapshot_project_mismatch",
      message: "Snapshot does not belong to this project.",
    });
  });

  it("POST revert restores snapshot files and returns 200", async () => {
    const { projectDir } = withHome();
    const origin = "git@github.com:acme/history-restore.git";
    initGitRepo(projectDir, origin);
    const project = createProject({
      git_origin: origin,
      name: "restore",
      local_path: projectDir,
    });
    const snapshot = createSnapshot({
      project_id: project.id,
      label: "Before applying: history-plugin",
      state: {
        plugins: [],
        resources: [],
        platform_files: { "claude-code": { "CLAUDE.md": "# Original instructions" } },
      },
    });
    writeFileSync(join(projectDir, "CLAUDE.md"), "# Modified", "utf-8");

    const request = new Request("http://127.0.0.1/v1/project/revert", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ snapshotId: snapshot.id, projectPath: projectDir }),
    });
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(200);
    const body = await response?.json();
    expect(body).toMatchObject({
      restored_file_count: 0,
      removed_file_count: 0,
      snapshot: {
        id: snapshot.id,
        created_at: snapshot.created_at,
        label: snapshot.label,
      },
    });
    expect(readFileSync(join(projectDir, "CLAUDE.md"), "utf-8")).toBe("# Modified");
  });
  describe("POST /v1/revert (any snapshot)", () => {
    function revertRequest(body: string, headers: HeadersInit = authHeaders()) {
      return new Request("http://127.0.0.1/v1/revert", { method: "POST", headers, body });
    }

    it("requires auth", async () => {
      const response = await tryHandle(
        revertRequest("{}", { "content-type": "application/json" }),
        TOKEN,
        idle,
      );
      expect(response?.status).toBe(401);
    });

    it("refuses while a switch is running", async () => {
      const response = await tryHandle(revertRequest(JSON.stringify({ snapshotId: "x" })), TOKEN, {
        isAgentSwitchInProgress: () => true,
      });
      expect(response?.status).toBe(409);
    });

    it("needs a snapshot id", async () => {
      const response = await tryHandle(revertRequest(JSON.stringify({})), TOKEN, idle);
      expect(response?.status).toBe(400);
      await expect(response?.json()).resolves.toEqual({
        error: "invalid_body",
        message: "snapshotId is required",
      });
    });

    it("returns 404 for an unknown snapshot", async () => {
      withHome();
      const response = await tryHandle(
        revertRequest(JSON.stringify({ snapshotId: "missing-snapshot" })),
        TOKEN,
        idle,
      );
      expect(response?.status).toBe(404);
      await expect(response?.json()).resolves.toEqual({
        error: "snapshot_not_found",
        message: "Snapshot not found: missing-snapshot",
      });
    });

    it("reverts a project snapshot without a project path and keeps edited files", async () => {
      const { projectDir } = withHome();
      const project = createProject({
        git_origin: "git@github.com:acme/history-any.git",
        name: "any",
        local_path: projectDir,
      });
      const snapshot = createSnapshot({
        project_id: project.id,
        label: "Before applying: any",
        state: {
          plugins: [],
          resources: [],
          platform_files: { "claude-code": { "CLAUDE.md": "# Original" } },
        },
      });
      writeFileSync(join(projectDir, "CLAUDE.md"), "# Mine", "utf-8");
      const response = await tryHandle(
        revertRequest(JSON.stringify({ snapshotId: snapshot.id })),
        TOKEN,
        idle,
      );
      expect(response?.status).toBe(200);
      expect(await response?.json()).toMatchObject({
        kind: "project",
        restored_file_count: 0,
        removed_file_count: 0,
        snapshot: { id: snapshot.id, label: snapshot.label },
      });
      expect(readFileSync(join(projectDir, "CLAUDE.md"), "utf-8")).toBe("# Mine");
    });
  });
});
