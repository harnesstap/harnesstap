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
  LOCK_SCHEMA,
  lockfileFromResolution,
  lockfileMatchesResolution,
  lockfilePath,
  lockedVersionsFrom,
  readLockfile,
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
  it("writes a TOML lockfile at .harnesstap/lock.toml", async () => {
    await buildGraph();
    const result = resolveComposition({ rootSelectors: ["root"] });
    writeLockfile(ctx.projectDir, lockfileFromResolution(result));

    const path = lockfilePath(ctx.projectDir);
    expect(path).toBe(join(ctx.projectDir, ".harnesstap", "lock.toml"));
    expect(existsSync(path)).toBe(true);

    const raw = readFileSync(path, "utf8");
    expect(raw).toContain(`schema = "${LOCK_SCHEMA}"`);
    expect(raw).toContain("[[plugins]]");
    expect(raw).toContain('name = "base"');
    expect(raw).toContain('version = "2.1.0"');
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
});
