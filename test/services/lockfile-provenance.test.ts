import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";
import { resolveComposition } from "../../src/services/resolve/index.ts";
import { lockfileFromResolution } from "../../src/services/lockfile.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("lock-prov-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("lockfile provenance", () => {
  it("records the dependency source per entry", () => {
    const upstream = createPlugin({ name: "web-search", version: "1.2.0" });
    setPluginOrigin(upstream.id, "upstream");
    createPlugin({ name: "base", version: "1.0.0" });

    const root = createPlugin({ name: "root" });
    addDependency(root.id, "web-search@anthropics");
    addDependency(root.id, "base");

    const lock = lockfileFromResolution(
      resolveComposition({ rootSelectors: ["root"] }),
    );
    const byName = new Map(lock.plugins.map((entry) => [entry.name, entry.source]));
    expect(byName.get("web-search")).toBe("marketplace");
    expect(byName.get("base")).toBe("local");
  });
});
