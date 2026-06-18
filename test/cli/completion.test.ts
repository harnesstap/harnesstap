import { describe, expect, it } from "bun:test";
import { createLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("CLI __complete", () => {
  it("returns matching local layers for layer show completion", async () => {
    const context = await createInitializedTestContext("cli-complete-layer");
    try {
      createLayer({ name: "engineering-foundation", version: "1.2.0" });
      createLayer({ name: "demo-layer", version: "0.1.0" });

      const result = await runCli([
        "__complete",
        "zsh",
        "--",
        "hd",
        "layer",
        "show",
        "eng",
      ]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("engineering-foundation");
      expect(result.stdout).toContain("engineering-foundation@1.2.0");
      expect(result.stdout).not.toContain("demo-layer");
    } finally {
      await context.cleanup();
    }
  });

  it("returns harness slugs for init --main without local database", async () => {
    const context = await createTestContextWithoutHarnessdeck();
    try {
      const result = await runCli([
        "__complete",
        "zsh",
        "--",
        "hd",
        "init",
        "--main",
        "cur",
      ]);

      expect(result.stdout).toContain("cursor");
      expect(result.stdout).not.toContain("engineering-foundation");
    } finally {
      await context.cleanup();
    }
  });

  it("returns harness slugs for project apply --harness completion", async () => {
    const context = await createInitializedTestContext("cli-complete-project-harness");
    try {
      const result = await runCli([
        "__complete",
        "zsh",
        "--",
        "hd",
        "project",
        "apply",
        "--harness",
        "cur",
      ]);

      expect(result.stdout).toContain("cursor");
      expect(result.stdout).not.toContain("engineering-foundation");
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty catalog layer completion without auth for layer pull", async () => {
    const context = await createInitializedTestContext("cli-complete-layer-pull");
    try {
      const result = await runCli([
        "__complete",
        "zsh",
        "--",
        "hd",
        "layer",
        "pull",
        "eng",
      ]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout.trim()).toBe("");
    } finally {
      await context.cleanup();
    }
  });

  it("completes global --format flag values", async () => {
    const context = await createInitializedTestContext("cli-complete-format-flag");
    try {
      const result = await runCli([
        "__complete",
        "zsh",
        "--",
        "hd",
        "layer",
        "show",
        "--for",
      ]);

      expect(result.stdout).toContain("human");
      expect(result.stdout).toContain("json");
    } finally {
      await context.cleanup();
    }
  });

  it("completes local profile layers for profile use and root shorthand", async () => {
    const context = await createInitializedTestContext("cli-complete-profile-layer");
    try {
      const work = createLayer({ name: "work" });
      setLayerTags(work.id, ["profile"]);
      createLayer({ name: "foundation" });

      const profileUse = await runCli([
        "__complete",
        "zsh",
        "--",
        "hd",
        "profile",
        "use",
        "wo",
      ]);
      expect(profileUse.stdout).toContain("work");
      expect(profileUse.stdout).not.toContain("foundation");

      const root = await runCli([
        "__complete",
        "zsh",
        "--",
        "hd",
        "wo",
      ]);
      expect(root.stdout).toContain("work");
      expect(root.stdout).not.toContain("foundation");
    } finally {
      await context.cleanup();
    }
  });

  it("returns scenario ids for help scenario completion", async () => {
    const result = await runCli([
      "__complete",
      "zsh",
      "--",
      "hd",
      "help",
      "scenario",
      "1",
    ]);

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("11");
    expect(result.stdout).toContain("7");
  });
});

async function createTestContextWithoutHarnessdeck(): Promise<{
  cleanup: () => Promise<void>;
}> {
  const { createTestContext } = await import("../helpers/db.ts");
  const context = await createTestContext("cli-complete-no-home");
  return context;
}
