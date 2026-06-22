import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createLayer, addResourceToLayer, setLayerTags } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { getGlobalActiveEnvironmentName } from "../../src/services/environment-session.ts";
import { getEnvironmentByName } from "../../src/models/environment.ts";
import { executeProjectUse } from "../../src/services/project-config-use.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

function writeProjectConfig(projectDir: string, content: string): void {
  writeTextFile(join(projectDir, ".harnessdeck", "config.toml"), content);
}

function createProfileLayer(name: string) {
  const layer = createLayer({ name });
  setLayerTags(layer.id, ["profile"]);
  const resource = createResource({
    type: "instruction",
    name: `${name}-guide`,
    description: "",
    content: `# ${name} guide`,
    metadata: {},
    source: "manual",
  });
  addResourceToLayer(layer.id, resource.id);
  return layer;
}

describe("project-config-use", () => {
  it("applies a local profile source from project config", async () => {
    const context = await createInitializedTestContext("project-use-local");
    try {
      createProfileLayer("team-stack");

      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnessdeck:project:v1"
version = 1

[[profiles]]
name = "dev"
source = "local"
selector = "team-stack"
`,
      );

      const result = await executeProjectUse({
        project: context.projectDir,
        harness: "claude-code",
        onConflict: "replace",
      });

      expect(result.skipped).toBe(false);
      if (result.skipped) {
        throw new Error("Expected project use to apply the profile");
      }
      expect(result.profile_key).toBe("dev");
      expect(result.layer_name).toBe("team-stack");
      expect(result.profile_name).toBe("team-stack");
      expect(result.dry_run).toBe(false);
      expect(result.cancelled).toBe(false);
      expect(
        existsSync(join(context.homeDir, ".claude", "CLAUDE.md")) ||
          existsSync(join(context.homeDir, "CLAUDE.md")),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("imports and applies an inline profile layer from project config", async () => {
    const context = await createInitializedTestContext("project-use-inline");
    try {
      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnessdeck:project:v1"
version = 1

[[profiles]]
name = "custom"
source = "inline"
layer = "embedded-layer"

[[layers]]
name = "embedded-layer"
description = "inline profile layer"
tags = ["profile"]

[[layers.resources]]
type = "instruction"
name = "embedded-guide"
description = ""
content = "# embedded profile"
metadata = {}
namespace = ""
origin_kind = "manual"
origin_ref = ""
content_hash = ""
content_blob_ref = ""
`,
      );

      const result = await executeProjectUse({
        project: context.projectDir,
        harness: "claude-code",
        onConflict: "replace",
      });

      expect(result.skipped).toBe(false);
      if (result.skipped) {
        throw new Error("Expected project use to apply the inline profile");
      }
      expect(result.profile_key).toBe("custom");
      expect(result.layer_name).toBe("embedded-layer");
      expect(result.profile_name).toBe("embedded-layer");
      expect(
        existsSync(join(context.homeDir, ".claude", "CLAUDE.md")) ||
          existsSync(join(context.homeDir, "CLAUDE.md")),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("skips when the profile is already active and in sync", async () => {
    const context = await createInitializedTestContext("project-use-skip");
    try {
      createProfileLayer("team-stack");

      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnessdeck:project:v1"
version = 1

[[profiles]]
name = "dev"
source = "local"
selector = "team-stack"
`,
      );

      await applyProfileLayer("team-stack", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("team-stack");

      const result = await executeProjectUse({
        project: context.projectDir,
        harness: "claude-code",
        onConflict: "replace",
      });

      expect(result.skipped).toBe(true);
      expect(result.profile_key).toBe("dev");
      expect(result.layer_name).toBe("team-stack");
    } finally {
      await context.cleanup();
    }
  });

  it("throws when multiple profiles exist without --profile", async () => {
    const context = await createInitializedTestContext("project-use-multi");
    try {
      createProfileLayer("alpha");
      createProfileLayer("beta");

      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnessdeck:project:v1"
version = 1

[[profiles]]
name = "alpha"
source = "local"
selector = "alpha"

[[profiles]]
name = "beta"
source = "local"
selector = "beta"
`,
      );

      await expect(
        executeProjectUse({
          project: context.projectDir,
          harness: "claude-code",
          onConflict: "replace",
        }),
      ).rejects.toThrow("multiple profiles configured");
    } finally {
      await context.cleanup();
    }
  });

  it("uses the sole profile when --profile is omitted", async () => {
    const context = await createInitializedTestContext("project-use-single");
    try {
      createProfileLayer("solo");

      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnessdeck:project:v1"
version = 1

[[profiles]]
name = "solo"
source = "local"
selector = "solo"
`,
      );

      const result = await executeProjectUse({
        project: context.projectDir,
        harness: "claude-code",
        onConflict: "replace",
      });

      expect(result.skipped).toBe(false);
      expect(result.profile_key).toBe("solo");
      expect(result.layer_name).toBe("solo");
    } finally {
      await context.cleanup();
    }
  });

  it("resolves catalog selector before pull attempt", async () => {
    const context = await createInitializedTestContext("project-use-catalog-resolve");
    try {
      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnessdeck:project:v1"
version = 1

[[profiles]]
name = "prod"
source = "catalog"
selector = "acme/platform/frontend@1.0.0"
`,
      );

      await expect(
        executeProjectUse({
          project: context.projectDir,
          profile: "prod",
          pull: false,
        }),
      ).rejects.toThrow(/not found locally/i);
    } finally {
      await context.cleanup();
    }
  });

  it("does not import environments on dry-run", async () => {
    const context = await createInitializedTestContext("project-use-dry-run-env");
    try {
      createProfileLayer("team-stack");
      await applyProfileLayer("team-stack", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnessdeck:project:v1"
version = 1

[[profiles]]
name = "dev"
source = "local"
selector = "team-stack"
environment = "staging"

[[environments]]
name = "staging"

[environments.values]
REGION = "eu"
`,
      );

      const before = getGlobalActiveEnvironmentName();
      await executeProjectUse({
        project: context.projectDir,
        profile: "dev",
        dryRun: true,
        harness: "claude-code",
        onConflict: "replace",
        force: true,
      });
      expect(getGlobalActiveEnvironmentName()).toBe(before);
      expect(getEnvironmentByName("staging")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("imports environments and sets the active environment", async () => {
    const context = await createInitializedTestContext("project-use-env");
    try {
      createProfileLayer("team-stack");

      writeProjectConfig(
        context.projectDir,
        `schema = "urn:harnessdeck:project:v1"
version = 1
default_environment = "shared"

[[profiles]]
name = "dev"
source = "local"
selector = "team-stack"
environment = "staging"

[[environments]]
name = "shared"

[environments.values]
REGION = "us"

[[environments]]
name = "staging"

[environments.values]
REGION = "eu"
`,
      );

      const result = await executeProjectUse({
        project: context.projectDir,
        harness: "claude-code",
        onConflict: "replace",
      });

      expect(result.skipped).toBe(false);
      expect(result.environment_name).toBe("staging");
      expect(getEnvironmentByName("shared")).toBeDefined();
      expect(getEnvironmentByName("staging")).toBeDefined();
      expect(getGlobalActiveEnvironmentName()).toBe("staging");
    } finally {
      await context.cleanup();
    }
  });
});
