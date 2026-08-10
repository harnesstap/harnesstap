import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  findProjectConfig,
  getProfileEntry,
  mergeProjectConfigLocalOverrides,
  parseProjectConfigFile,
  resolveProfileEnvironment,
  validateProjectConfig,
} from "../../src/services/project-config.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

const VALID_PROJECT_CONFIG = `schema = "urn:harnesstap:project:v1"
version = 1
default_profile = "dev"
default_environment = "shared"

[[profiles]]
name = "dev"
source = "local"
selector = "team-stack"

[[profiles]]
name = "prod"
source = "catalog"
selector = "acme/platform/frontend@1.0.0"

[[profiles]]
name = "custom"
source = "inline"
plugin = "embedded-plugin"

[[profiles]]
name = "local-fallback"
source = "local"

[[profiles]]
name = "profile-env"
source = "local"
selector = "ops"
environment = "staging"

[[environments]]
name = "shared"

[environments.values]
REGION = "us"

[[environments]]
name = "staging"

[environments.values]
REGION = "eu"

[environments.secret_refs.PD_TOKEN]
provider = "env"
ref = "PD_TOKEN"

[[plugins]]
name = "embedded-plugin"
description = "inline plugin for custom profile"
`;

describe("project-config", () => {
  it("walk-up finds nearest ancestor config in monorepo fixture", () => {
    const root = createTempDir("project-config-monorepo");
    try {
      writeTextFile(join(root, ".harnesstap", "config.toml"), VALID_PROJECT_CONFIG);
      writeTextFile(
        join(root, "packages", "app", ".harnesstap", "config.toml"),
        `schema = "urn:harnesstap:project:v1"
version = 1
default_profile = "app"

[[profiles]]
name = "app"
source = "local"
selector = "app-plugin"
`,
      );

      const deepPath = join(root, "packages", "app", "src", "index.ts");
      writeTextFile(deepPath, "export {};\n");

      const resolved = findProjectConfig(deepPath);
      expect(resolved).not.toBeNull();
      expect(resolved?.rootPath).toBe(join(root, "packages", "app"));
      expect(resolved?.configPath).toBe(join(root, "packages", "app", ".harnesstap", "config.toml"));
      expect(resolved?.default_profile).toBe("app");
    } finally {
      cleanupDir(root);
    }
  });

  it("parses valid config with multiple profiles", () => {
    const root = createTempDir("project-config-valid");
    try {
      const configPath = join(root, ".harnesstap", "config.toml");
      writeTextFile(configPath, VALID_PROJECT_CONFIG);

      const config = parseProjectConfigFile(configPath);
      expect(config.default_profile).toBe("dev");
      expect(config.default_environment).toBe("shared");
      expect(config.profiles).toEqual([
        {
          name: "dev",
          source: "local",
          selector: "team-stack",
        },
        {
          name: "prod",
          source: "catalog",
          selector: "acme/platform/frontend@1.0.0",
        },
        {
          name: "custom",
          source: "inline",
          plugin: "embedded-plugin",
        },
        {
          name: "local-fallback",
          source: "local",
          selector: "local-fallback",
        },
        {
          name: "profile-env",
          source: "local",
          selector: "ops",
          environment: "staging",
        },
      ]);
      expect(config.environments).toEqual([
        {
          name: "shared",
          values: { REGION: "us" },
        },
        {
          name: "staging",
          values: { REGION: "eu" },
          secret_refs: {
            PD_TOKEN: {
              provider: "env",
              ref: "PD_TOKEN",
            },
          },
        },
      ]);
      expect(config.plugins).toEqual([
        expect.objectContaining({
          name: "embedded-plugin",
          description: "inline plugin for custom profile",
        }),
      ]);
    } finally {
      cleanupDir(root);
    }
  });

  it("rejects plugin v1 schema at config path", () => {
    const root = createTempDir("project-config-plugin-collision");
    try {
      const configPath = join(root, ".harnesstap", "config.toml");
      writeTextFile(
        configPath,
        `schema = "urn:harnesstap:layer:v1"
version = 1

[[plugins]]
name = "team-stack"
version = "1.0.0"
description = "plugin bundle misplaced in project config"
`,
      );

      expect(() => parseProjectConfigFile(configPath)).toThrow(/plugin bundle schema/);
    } finally {
      cleanupDir(root);
    }
  });

  it("rejects unknown profile source", () => {
    const root = createTempDir("project-config-unknown-source");
    try {
      const configPath = join(root, ".harnesstap", "config.toml");
      writeTextFile(
        configPath,
        `schema = "urn:harnesstap:project:v1"
version = 1

[[profiles]]
name = "bad"
source = "remote"
selector = "team-stack"
`,
      );

      expect(() => parseProjectConfigFile(configPath)).toThrow(/Unknown profile source for bad: remote/);
    } finally {
      cleanupDir(root);
    }
  });

  it("rejects duplicate profile names", () => {
    const root = createTempDir("project-config-duplicate-profiles");
    try {
      const configPath = join(root, ".harnesstap", "config.toml");
      writeTextFile(
        configPath,
        `schema = "urn:harnesstap:project:v1"
version = 1

[[profiles]]
name = "dev"
source = "local"
selector = "one"

[[profiles]]
name = "dev"
source = "catalog"
selector = "acme/platform/two"
`,
      );

      expect(() => parseProjectConfigFile(configPath)).toThrow(/Duplicate profile name: dev/);
    } finally {
      cleanupDir(root);
    }
  });

  it("local.toml overrides default_profile", () => {
    const root = createTempDir("project-config-local-overrides");
    try {
      const configDir = join(root, ".harnesstap");
      writeTextFile(
        join(configDir, "config.toml"),
        `schema = "urn:harnesstap:project:v1"
version = 1
default_profile = "dev"
default_environment = "shared"

[[profiles]]
name = "dev"
source = "local"
selector = "team-stack"
`,
      );
      writeTextFile(
        join(configDir, "local.toml"),
        `default_profile = "personal"
`,
      );

      const config = parseProjectConfigFile(join(configDir, "config.toml"));
      const merged = mergeProjectConfigLocalOverrides(config, configDir);
      expect(merged.default_profile).toBe("personal");
      expect(merged.default_environment).toBe("shared");
    } finally {
      cleanupDir(root);
    }
  });

  it("resolveProfileEnvironment uses entry, then default_environment", () => {
    const root = createTempDir("project-config-env-precedence");
    try {
      const configPath = join(root, ".harnesstap", "config.toml");
      writeTextFile(configPath, VALID_PROJECT_CONFIG);
      const config = parseProjectConfigFile(configPath);

      const profileWithEnv = getProfileEntry(config, "profile-env");
      expect(resolveProfileEnvironment(config, profileWithEnv)).toBe("staging");

      const profileWithoutEnv = getProfileEntry(config, "dev");
      expect(resolveProfileEnvironment(config, profileWithoutEnv)).toBe("shared");

      const configWithoutDefault = {
        ...config,
        default_environment: undefined,
      };
      expect(resolveProfileEnvironment(configWithoutDefault, profileWithoutEnv)).toBeUndefined();
    } finally {
      cleanupDir(root);
    }
  });

  it("validateProjectConfig accepts valid inline plugin references", () => {
    const root = createTempDir("project-config-validate-valid");
    try {
      const configPath = join(root, ".harnesstap", "config.toml");
      writeTextFile(configPath, VALID_PROJECT_CONFIG);
      const config = parseProjectConfigFile(configPath);

      expect(validateProjectConfig(config)).toEqual({ valid: true, errors: [] });
    } finally {
      cleanupDir(root);
    }
  });

  it("validateProjectConfig rejects unknown inline plugin references", () => {
    const root = createTempDir("project-config-validate-inline");
    try {
      const configPath = join(root, ".harnesstap", "config.toml");
      writeTextFile(
        configPath,
        `schema = "urn:harnesstap:project:v1"
version = 1

[[profiles]]
name = "custom"
source = "inline"
plugin = "missing-plugin"
`,
      );
      const config = parseProjectConfigFile(configPath);

      expect(validateProjectConfig(config)).toEqual({
        valid: false,
        errors: [
          "Profile custom with inline source references unknown plugin: missing-plugin",
        ],
      });
    } finally {
      cleanupDir(root);
    }
  });

  it("validateProjectConfig rejects unknown default_profile", () => {
    const root = createTempDir("project-config-validate-default-profile");
    try {
      const configPath = join(root, ".harnesstap", "config.toml");
      writeTextFile(
        configPath,
        `schema = "urn:harnesstap:project:v1"
version = 1
default_profile = "missing"

[[profiles]]
name = "dev"
source = "local"
selector = "team-stack"
`,
      );
      const config = parseProjectConfigFile(configPath);

      expect(validateProjectConfig(config)).toEqual({
        valid: false,
        errors: ["default_profile references unknown profile: missing"],
      });
    } finally {
      cleanupDir(root);
    }
  });
});
