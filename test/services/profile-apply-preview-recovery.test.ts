import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("preview-recovery-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("previewProfileApply constraint recovery", () => {
  it("includes recovery_actions when apply resolution fails", async () => {
    const profile = createPlugin({ name: "my-setup" });
    setPluginTags(profile.id, ["profile"]);
    addDependency(profile.id, "design-doc@anthropics", { versionConstraint: "*" });

    const preview = await previewProfileApply({
      profile: "my-setup",
      scope: "home",
    });

    expect(preview.warning).toContain("No local version of design-doc");
    expect(preview.recovery_actions?.[0]?.id).toBe("sync-install");
  });
});
