import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { addResourceToPlugin, createPlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addPluginAttachment } from "../../src/services/plugin-composition.ts";
import { resolveComposition } from "../../src/services/resolve/index.ts";
import {
  lockfileFromResolution,
  lockfileMatchesResolution,
  lockfilePath,
  lockedVersionsFrom,
  readLockfile,
  verifyDeployedFileHashes,
  LockIntegrityError,
  writeLockfile,
} from "../../src/services/lockfile.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("lock-");
});

afterEach(async () => {
  await ctx.cleanup();
});

async function buildGraph(): Promise<void> {
  const base = createPlugin({ name: "base", version: "2.1.0" });
  const resource = createResource({
    type: "skill",
    name: "alpha",
    description: "",
    content: "A",
    metadata: {},
    source: "test",
  });
  addResourceToPlugin(base.id, resource.id);
  createPlugin({ name: "root", version: "1.0.0" });
  const root = getPluginByName("root");
  if (!root) throw new Error("missing root");
  await addPluginAttachment({ plugin: root, selector: "plugin:base", version: "^2.0.0" });
}

describe("lockfile", () => {
  it("writes an APM-shaped lockfile at apm.lock.yaml", async () => {
    await buildGraph();
    const result = resolveComposition({ rootSelectors: ["root"] });
    writeLockfile(ctx.projectDir, lockfileFromResolution(result));

    const path = lockfilePath(ctx.projectDir);
    expect(path).toBe(join(ctx.projectDir, "apm.lock.yaml"));
    expect(existsSync(path)).toBe(true);

    const raw = readFileSync(path, "utf8");
    expect(raw).toContain("lockfile_version: \"1\"");
    expect(raw).toContain("resource_map_hash:");
    expect(raw).toContain("root: root");
    expect(raw).not.toContain("x-harnesstap");
    expect(raw).toContain("name: base");
    expect(raw).toContain("version: 2.1.0");
  });

  it("records the bound environment name at the lockfile root", async () => {
    await buildGraph();
    const result = resolveComposition({ rootSelectors: ["root"] });
    writeLockfile(
      ctx.projectDir,
      lockfileFromResolution(result, { environment: "shared" }),
    );

    const raw = readFileSync(lockfilePath(ctx.projectDir), "utf8");
    expect(raw).toContain("environment: shared");
    expect(raw).not.toContain("x-harnesstap");
    expect(readLockfile(ctx.projectDir)?.environment).toBe("shared");
  });

  it("records exec_status on locked dependencies", async () => {
    await buildGraph();
    const result = resolveComposition({ rootSelectors: ["root"] });
    writeLockfile(
      ctx.projectDir,
      lockfileFromResolution(result, {
        execStatuses: { base: "gated_pending_approval" },
      }),
    );
    const lock = readLockfile(ctx.projectDir);
    expect(lock?.plugins[0]?.exec_status).toBe("gated_pending_approval");
    const raw = readFileSync(lockfilePath(ctx.projectDir), "utf8");
    expect(raw).toContain("exec_status: gated_pending_approval");
    expect(raw).not.toContain("x-harnesstap");
  });

  it("round-trips through read and reports locked versions", async () => {
    await buildGraph();
    const result = resolveComposition({ rootSelectors: ["root"] });
    writeLockfile(ctx.projectDir, lockfileFromResolution(result));

    const lock = readLockfile(ctx.projectDir);
    expect(lock?.root).toBe("root");
    expect(lock?.plugins.map((p) => p.name)).toEqual(["base"]);
    expect(lockedVersionsFrom(lock!).get("base")).toBe("2.1.0");
  });

  it("returns undefined when there is no lockfile", () => {
    expect(readLockfile(ctx.projectDir)).toBeUndefined();
  });

  it("detects drift when the resolution no longer matches the lock", async () => {
    await buildGraph();
    const first = resolveComposition({ rootSelectors: ["root"] });
    const lock = lockfileFromResolution(first);
    expect(lockfileMatchesResolution(lock, first)).toBe(true);

    createPlugin({ name: "base", version: "2.2.0" });
    const second = resolveComposition({ rootSelectors: ["root"] });
    expect(second.selected.find((s) => s.name === "base")?.version).toBe("2.2.0");
    expect(lockfileMatchesResolution(lock, second)).toBe(false);
  });

  it("records and verifies SHA-256 hashes of deployed files", async () => {
    await buildGraph();
    const result = resolveComposition({ rootSelectors: ["root"] });
    const files = [
      { path: "AGENTS.md", content: "# Hello\n" },
      { path: ".claude/CLAUDE.md", content: "# Claude\n" },
    ];
    writeLockfile(
      ctx.projectDir,
      lockfileFromResolution(result, { deployedFiles: files }),
    );
    const lock = readLockfile(ctx.projectDir);
    const hashes = lock?.deployed_file_hashes;
    expect(hashes?.["AGENTS.md"]).toMatch(/^sha256:[a-f0-9]{64}$/);
    if (!hashes) throw new Error("missing deployed_file_hashes");
    const agents = files[0];
    if (!agents) throw new Error("missing fixture file");

    expect(() => verifyDeployedFileHashes(hashes, files)).not.toThrow();
    expect(() =>
      verifyDeployedFileHashes(hashes, [
        { path: "AGENTS.md", content: "# Tampered\n" },
        { path: ".claude/CLAUDE.md", content: "# Claude\n" },
      ]),
    ).toThrow(LockIntegrityError);
    expect(() => verifyDeployedFileHashes(hashes, [agents])).toThrow(/missing/);
    expect(() =>
      verifyDeployedFileHashes(hashes, [
        ...files,
        { path: "extra.md", content: "nope" },
      ]),
    ).toThrow(/extra/);
    expect(() =>
      verifyDeployedFileHashes(
        { "skills/../escape.md": "sha256:deadbeef" },
        [{ path: "skills/../escape.md", content: "# Hello\n" }],
      ),
    ).toThrow(/Unsafe local_deployed_file_hashes path/);
  });

  it("merges APM git identity fields onto matching lock entries", async () => {
    await buildGraph();
    const result = resolveComposition({ rootSelectors: ["root"] });
    writeLockfile(
      ctx.projectDir,
      lockfileFromResolution(result, {
        gitLocks: [
          {
            name: "base",
            repo_url: "github.com/acme/base",
            resolved_commit: "a".repeat(40),
            resolved_ref: "v1.2.3",
            constraint: "^1.0.0",
            resolved_tag: "v1.2.3",
            virtual_path: "packages/ship",
          },
        ],
      }),
    );

    const raw = readFileSync(lockfilePath(ctx.projectDir), "utf8");
    expect(raw).toContain("repo_url: github.com/acme/base");
    expect(raw).toContain(`resolved_commit: ${"a".repeat(40)}`);
    expect(raw).toContain("virtual_path: packages/ship");
    expect(raw).toContain("constraint: ^1.0.0");

    const lock = readLockfile(ctx.projectDir);
    const entry = lock?.plugins.find((plugin) => plugin.name === "base");
    expect(entry?.source).toBe("git");
    expect(entry?.repo_url).toBe("github.com/acme/base");
    expect(entry?.resolved_commit).toBe("a".repeat(40));
    expect(entry?.virtual_path).toBe("packages/ship");
  });
});
