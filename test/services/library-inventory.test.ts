import { describe, expect, it, afterEach } from "bun:test";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { queryLibraryInventory } from "../../src/services/library-inventory.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

let ctx: Awaited<ReturnType<typeof createInitializedTestContext>>;

afterEach(async () => {
  await ctx?.cleanup();
});

describe("queryLibraryInventory", () => {
  it("orders All-list rows by filter type localeCompare then display name, and peeks 40", async () => {
    ctx = await createInitializedTestContext("inv-order");
    createPlugin({ name: "zeta-pack", description: "pkg" });
    createResource({
      type: "skill",
      name: "alpha-skill",
      description: "a",
      content: "# a",
      metadata: {},
      source: "manual",
    });
    createResource({
      type: "command",
      name: "mid-cmd",
      description: "c",
      content: "# c",
      metadata: {},
      source: "manual",
    });
    const all = queryLibraryInventory({ q: "", type: null });
    expect(all.rows.map((row) => `${row.listKind}:${row.name}`)).toEqual([
      "resource:mid-cmd",
      "plugin-package:zeta-pack",
      "resource:alpha-skill",
    ]);
    expect(all.type_counts.command).toBe(1);
    expect(all.type_counts.plugin).toBe(1);
    expect(all.type_counts.skill).toBe(1);
    expect(all.total).toBe(3);

    const peek = queryLibraryInventory({ q: "", type: null, limit: 2, offset: 0 });
    expect(peek.rows).toHaveLength(2);
    expect(peek.total).toBe(3);
    expect(peek.type_counts.skill).toBe(1);
    expect(peek.rows.map((row) => row.name)).toEqual(["mid-cmd", "zeta-pack"]);
  });

  it("searches name description namespace and does not attach filesystem_path", async () => {
    ctx = await createInitializedTestContext("inv-search");
    createResource({
      type: "skill",
      name: "ship",
      namespace: "fleet",
      description: "deploy docs",
      content: "# s",
      metadata: {},
      source: "/tmp/missing-skill",
    });
    createResource({
      type: "skill",
      name: "other",
      description: "nope",
      content: "# o",
      metadata: {},
      source: "manual",
    });
    const found = queryLibraryInventory({ q: "fleet", type: null });
    expect(found.rows.map((row) => row.name)).toEqual(["ship"]);
    expect(found.type_counts.skill).toBe(1);
    expect(found.rows[0]).not.toHaveProperty("filesystem_path");
  });

  it("wires hook inventory fields so search matches Desktop display labels", async () => {
    ctx = await createInitializedTestContext("inv-hook");
    createResource({
      type: "hook",
      name: "SessionStart-1",
      description: "",
      content: "echo unused",
      metadata: {
        event: "sessionStart",
        script: "~/.claude/hooks/ponytail-activate.js",
      },
      source: "manual",
    });
    const found = queryLibraryInventory({ q: "ponytail", type: null });
    expect(found.rows.map((row) => row.name)).toEqual(["SessionStart-1"]);
    expect(found.rows[0]?.hook).toEqual({
      event: "sessionStart",
      script: "~/.claude/hooks/ponytail-activate.js",
    });
  });

  it("filters by Library type-tab key plugin vs plugin_ref", async () => {
    ctx = await createInitializedTestContext("inv-type");
    createPlugin({ name: "pack" });
    createResource({
      type: "plugin",
      name: "pack-ref",
      description: "ref",
      content: "",
      metadata: {},
      source: "manual",
    });
    const packs = queryLibraryInventory({ q: "", type: "plugin" });
    expect(packs.rows.every((row) => row.listKind === "plugin-package")).toBe(true);
    const refs = queryLibraryInventory({ q: "", type: "plugin_ref" });
    expect(refs.rows.every((row) => row.listKind === "resource" && row.type === "plugin")).toBe(
      true,
    );
  });
});
