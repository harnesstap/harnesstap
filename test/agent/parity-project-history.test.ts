import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/project-history.ts";
import { getDb, closeDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { createProject } from "../../src/models/project.ts";
import { createSnapshot } from "../../src/models/snapshot.ts";
import { GIT_ORIGIN_HINTS } from "../../src/cli/shared.ts";
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

  it("GET history without origin returns 400 no_git_origin and GIT_ORIGIN_HINTS", async () => {
    const { projectDir } = withHome();
    const request = new Request(
      `http://127.0.0.1/v1/project/history?projectPath=${encodeURIComponent(projectDir)}`,
    );
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: "no_git_origin",
      message: "No git remote origin configured.",
      hints: [...GIT_ORIGIN_HINTS],
    });
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

  it("POST revert without origin returns 400 no_git_origin", async () => {
    const { projectDir } = withHome();
    const request = new Request("http://127.0.0.1/v1/project/revert", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ snapshotId: "missing", projectPath: projectDir }),
    });
    const response = await tryHandle(request, TOKEN, idle);
    expect(response?.status).toBe(400);
    const body = (await response?.json()) as { error: string; hints: string[] };
    expect(body.error).toBe("no_git_origin");
    expect(body.hints).toEqual([...GIT_ORIGIN_HINTS]);
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
    await expect(response?.json()).resolves.toEqual({
      restored_file_count: 1,
      snapshot: {
        id: snapshot.id,
        created_at: snapshot.created_at,
        label: snapshot.label,
      },
    });
    expect(readFileSync(join(projectDir, "CLAUDE.md"), "utf-8")).toBe(
      "# Original instructions",
    );
  });
});
