import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { formatApmManifest, parseApmManifestContents } from "../../src/services/apm-manifest.ts";
import {
  findProjectConfig,
  getProfileEntry,
  mergeProjectConfigLocalOverrides,
  parseProjectConfigFile,
  resolveProfileEnvironment,
  validateProjectConfig,
} from "../../src/services/project-config.ts";
import { writeProjectConfigFile } from "../../src/services/project-config-write.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

const VALID_PROJECT_CONFIG = `name: demo
version: "1.0.0"
default_profile: dev
environments:
  default: shared
  shared:
    values:
      REGION: us
  staging:
    values:
      REGION: eu
    secret_refs:
      PD_TOKEN:
        provider: env
        ref: PD_TOKEN
profiles:
  - name: dev
    source: local
    selector: team-stack
  - name: prod
    source: catalog
    selector: acme/platform/frontend@1.0.0
  - name: custom
    source: inline
    plugin: embedded-plugin
  - name: local-fallback
    source: local
  - name: profile-env
    source: local
    selector: ops
    environment: staging
plugins:
  - name: embedded-plugin
    description: inline plugin for custom profile
`;

describe("project-config", () => {
  it("walk-up finds nearest ancestor apm.yml in monorepo fixture", () => {
    const root = createTempDir("project-config-monorepo");
    try {
      writeTextFile(join(root, "apm.yml"), VALID_PROJECT_CONFIG);
      writeTextFile(
        join(root, "packages", "app", "apm.yml"),
        `name: app
version: "1.0.0"
default_profile: app
profiles:
  - name: app
    source: local
    selector: app-plugin
`,
      );

      const deepPath = join(root, "packages", "app", "src", "index.ts");
      writeTextFile(deepPath, "export {};\n");

      const resolved = findProjectConfig(deepPath);
      expect(resolved).not.toBeNull();
      expect(resolved?.rootPath).toBe(join(root, "packages", "app"));
      expect(resolved?.configPath).toBe(join(root, "packages", "app", "apm.yml"));
      expect(resolved?.default_profile).toBe("app");
    } finally {
      cleanupDir(root);
    }
  });

  it("parses valid config with multiple profiles", () => {
    const root = createTempDir("project-config-valid");
    try {
      const configPath = join(root, "apm.yml");
      writeTextFile(configPath, VALID_PROJECT_CONFIG);

      const config = parseProjectConfigFile(configPath);
      expect(config.apm_name).toBe("demo");
      expect(config.apm_version).toBe("1.0.0");
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

  it("round-trips HarnessTap fields through format and parse", () => {
    const root = createTempDir("project-config-roundtrip");
    try {
      const configPath = join(root, "apm.yml");
      writeTextFile(configPath, VALID_PROJECT_CONFIG);
      const parsed = parseProjectConfigFile(configPath, root);
      writeProjectConfigFile(configPath, parsed);
      const again = parseProjectConfigFile(configPath, root);
      expect(again.default_profile).toBe(parsed.default_profile);
      expect(again.default_environment).toBe(parsed.default_environment);
      expect(again.profiles).toEqual(parsed.profiles);
      expect(again.environments).toEqual(parsed.environments);
      expect(again.plugins).toEqual(parsed.plugins);
      const formatted = formatApmManifest(parsed, root);
      expect(formatted).toContain("default_profile:");
      expect(formatted).toContain("environments:");
      expect(formatted).toContain("default: shared");
      expect(formatted).not.toContain("default_environment:");
      expect(formatted).not.toMatch(/^environment:/m);
      expect(formatted).not.toContain("x-harnesstap");
    } finally {
      cleanupDir(root);
    }
  });

  it("maps APM target aliases onto HarnessTap harness slugs", () => {
    const root = createTempDir("project-config-targets");
    try {
      writeTextFile(
        join(root, "apm.yml"),
        `name: demo
version: "1.0.0"
targets:
  - claude
  - copilot
  - vscode
  - agent-skills
  - mystery-box
`,
      );
      const resolved = findProjectConfig(root);
      expect(resolved?.harnessTargets).toEqual(["claude-code", "github-copilot"]);
      expect(resolved?.skippedTargets).toEqual(["agent-skills", "mystery-box"]);
      expect(resolved?.warnings.some((warning) => warning.includes("agent-skills"))).toBe(true);
      expect(resolved?.warnings.some((warning) => warning.includes("mystery-box"))).toBe(true);
    } finally {
      cleanupDir(root);
    }
  });

  it("maps dependencies.apm git refs and MCP ids", () => {
    const root = createTempDir("project-config-deps");
    try {
      writeTextFile(
        join(root, "apm.yml"),
        `name: demo
version: "1.0.0"
dependencies:
  apm:
    - microsoft/contoso-plugin#v1.2.3
  mcp:
    - io.github.modelcontextprotocol/servers/filesystem
`,
      );
      const resolved = findProjectConfig(root);
      expect(resolved?.apmDependencies).toEqual([
        expect.objectContaining({
          sourceKind: "git",
          name: "contoso-plugin",
          originRef: "https://github.com/microsoft/contoso-plugin.git",
          ref: "v1.2.3",
        }),
      ]);
      expect(resolved?.mcpDependencies).toEqual([
        expect.objectContaining({
          name: "filesystem",
          registryId: "io.github.modelcontextprotocol/servers/filesystem",
          selfDefined: false,
        }),
      ]);
    } finally {
      cleanupDir(root);
    }
  });

  it("imports .apm/skills overlay and warns about other primitive dirs", () => {
    const root = createTempDir("project-config-overlay");
    try {
      writeTextFile(
        join(root, "apm.yml"),
        `name: demo
version: "1.0.0"
`,
      );
      writeTextFile(
        join(root, ".apm", "skills", "ship", "SKILL.md"),
        `---
name: ship
description: Ship checklist
---
Run the checklist.
`,
      );
      writeTextFile(join(root, ".apm", "prompts", "draft.md"), "draft");
      const resolved = findProjectConfig(root);
      expect(resolved?.overlay?.skills).toEqual([
        expect.objectContaining({
          name: "ship",
          description: "Ship checklist",
          skillMdRelative: ".apm/skills/ship/SKILL.md",
        }),
      ]);
      expect(resolved?.warnings.some((warning) => warning.includes(".apm/prompts"))).toBe(true);
    } finally {
      cleanupDir(root);
    }
  });

  it("rejects a manifest missing required name", () => {
    const root = createTempDir("project-config-missing-name");
    try {
      const configPath = join(root, "apm.yml");
      writeTextFile(
        configPath,
        `version: "1.0.0"
default_profile: dev
`,
      );

      expect(() => parseProjectConfigFile(configPath)).toThrow(/missing required field name/);
    } finally {
      cleanupDir(root);
    }
  });

  it("rejects unknown profile source", () => {
    const root = createTempDir("project-config-unknown-source");
    try {
      const configPath = join(root, "apm.yml");
      writeTextFile(
        configPath,
        `name: demo
version: "1.0.0"
profiles:
  - name: bad
    source: remote
    selector: team-stack
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
      const configPath = join(root, "apm.yml");
      writeTextFile(
        configPath,
        `name: demo
version: "1.0.0"
profiles:
  - name: dev
    source: local
    selector: one
  - name: dev
    source: catalog
    selector: acme/platform/two
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
        join(root, "apm.yml"),
        `name: demo
version: "1.0.0"
default_profile: dev
environments:
  default: shared
  shared:
    values:
      REGION: us
profiles:
  - name: dev
    source: local
    selector: team-stack
`,
      );
      writeTextFile(
        join(configDir, "local.toml"),
        `default_profile = "personal"
`,
      );

      const config = parseProjectConfigFile(join(root, "apm.yml"));
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
      const configPath = join(root, "apm.yml");
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
      const configPath = join(root, "apm.yml");
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
      const configPath = join(root, "apm.yml");
      writeTextFile(
        configPath,
        `name: demo
version: "1.0.0"
profiles:
  - name: custom
    source: inline
    plugin: missing-plugin
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
      const configPath = join(root, "apm.yml");
      writeTextFile(
        configPath,
        `name: demo
version: "1.0.0"
default_profile: missing
profiles:
  - name: dev
    source: local
    selector: team-stack
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

  it("parses a vanilla OpenAPM apm.yml without HarnessTap fields", () => {
    const root = createTempDir("project-config-vanilla");
    try {
      const configPath = join(root, "apm.yml");
      writeTextFile(
        configPath,
        `name: vanilla
version: "0.1.0"
targets: [cursor]
dependencies:
  apm:
    - ./plugins/local-pack
`,
      );
      const fields = parseApmManifestContents(
        `name: vanilla
version: "0.1.0"
targets: [cursor]
`,
        configPath,
        root,
      );
      expect(fields.name).toBe("vanilla");
      expect(fields.harnessTargets).toEqual(["cursor"]);
      const config = parseProjectConfigFile(configPath, root);
      expect(config.profiles).toEqual([]);
      expect(config.default_profile).toBeUndefined();
    } finally {
      cleanupDir(root);
    }
  });

  it("validateProjectConfig rejects unknown environments.default", () => {
    const root = createTempDir("project-config-validate-default-env");
    try {
      const configPath = join(root, "apm.yml");
      writeTextFile(
        configPath,
        `name: demo
version: "1.0.0"
environments:
  default: missing
  shared:
    values:
      REGION: us
`,
      );
      const config = parseProjectConfigFile(configPath);

      expect(validateProjectConfig(config)).toEqual({
        valid: false,
        errors: ["environments.default references unknown environment: missing"],
      });
    } finally {
      cleanupDir(root);
    }
  });

  it("preserves extra OpenAPM top-level keys on round-trip", () => {
    const root = createTempDir("project-config-extra-keys");
    try {
      const configPath = join(root, "apm.yml");
      writeTextFile(
        configPath,
        `name: demo
version: "1.0.0"
license: MIT
authors:
  - name: Ada
targets: [cursor]
environments:
  default: shared
  shared:
    values:
      REGION: us
`,
      );
      const parsed = parseProjectConfigFile(configPath, root);
      const formatted = formatApmManifest(parsed, root);
      expect(formatted).toContain("license: MIT");
      expect(formatted).toContain("authors:");
      expect(formatted).toContain("targets:");
      expect(parsed.default_environment).toBe("shared");
    } finally {
      cleanupDir(root);
    }
  });

  it("ignores leftover default_environment and environment singular mapping", () => {
    const root = createTempDir("project-config-ignore-old-env");
    try {
      const configPath = join(root, "apm.yml");
      writeTextFile(
        configPath,
        `name: demo
version: "1.0.0"
default_environment: hidden
environment:
  default: leftover
  leftover:
    values:
      REGION: xx
environments:
  default: shared
  shared:
    values:
      REGION: us
`,
      );
      const config = parseProjectConfigFile(configPath);
      expect(config.default_environment).toBe("shared");
      expect(config.environments).toEqual([
        { name: "shared", values: { REGION: "us" } },
      ]);
      const formatted = formatApmManifest(config, root);
      expect(formatted).not.toContain("default_environment:");
      expect(formatted).not.toMatch(/^environment:/m);
      expect(formatted).toContain("environments:");
    } finally {
      cleanupDir(root);
    }
  });

  it("ignores leftover environment singular mapping when environments is absent", () => {
    const root = createTempDir("project-config-ignore-singular-env");
    try {
      const configPath = join(root, "apm.yml");
      writeTextFile(
        configPath,
        `name: demo
version: "1.0.0"
environment:
  default: leftover
  leftover:
    values:
      REGION: xx
`,
      );
      const config = parseProjectConfigFile(configPath);
      expect(config.default_environment).toBeUndefined();
      expect(config.environments).toEqual([]);
    } finally {
      cleanupDir(root);
    }
  });

  it("rejects environments when it is not a mapping", () => {
    const root = createTempDir("project-config-env-string");
    try {
      const configPath = join(root, "apm.yml");
      writeTextFile(
        configPath,
        `name: demo
version: "1.0.0"
environments: shared
`,
      );
      expect(() => parseProjectConfigFile(configPath)).toThrow(
        /environments must be a mapping/,
      );
    } finally {
      cleanupDir(root);
    }
  });

  it("ignores leftover x-harnesstap instead of reading it", () => {
    const root = createTempDir("project-config-ignore-vendor");
    try {
      const configPath = join(root, "apm.yml");
      writeTextFile(
        configPath,
        `name: demo
version: "1.0.0"
x-harnesstap:
  default_profile: hidden
  profiles:
    - name: hidden
      source: local
      selector: hidden-plugin
`,
      );
      const config = parseProjectConfigFile(configPath);
      expect(config.default_profile).toBeUndefined();
      expect(config.profiles).toEqual([]);
      expect(formatApmManifest(config, root)).not.toContain("x-harnesstap");
    } finally {
      cleanupDir(root);
    }
  });
});
