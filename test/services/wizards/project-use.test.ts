import { describe, expect, it } from "bun:test";
import { resolveProjectProfileKey } from "../../../src/services/project-config-use.ts";
import type { ResolvedProjectConfig } from "../../../src/services/project-config.ts";
import { buildProjectProfileChoices } from "../../../src/services/wizards/project-use.ts";

function makeConfig(
  profiles: ResolvedProjectConfig["profiles"],
  overrides: Partial<ResolvedProjectConfig> = {},
): ResolvedProjectConfig {
  return {
    rootPath: "/tmp/project",
    configPath: "/tmp/project/.harnessdeck/config.toml",
    profiles,
    environments: [],
    layers: [],
    ...overrides,
  };
}

describe("project use wizard helpers", () => {
  it("buildProjectProfileChoices includes source and environment in labels", () => {
    const config = makeConfig(
      [
        {
          name: "dev",
          source: "local",
          selector: "team-stack",
        },
        {
          name: "prod",
          source: "catalog",
          selector: "acme/platform/frontend@1.0.0",
          environment: "staging",
        },
        {
          name: "custom",
          source: "inline",
          layer: "embedded-layer",
        },
        {
          name: "local-fallback",
          source: "local",
          selector: "local-fallback",
        },
      ],
      {
        default_environment: "shared",
      },
    );

    const choices = buildProjectProfileChoices(config);

    expect(choices).toEqual([
      {
        name: "dev · local · team-stack · env shared",
        value: "dev",
      },
      {
        name: "prod · catalog · acme/platform/frontend@1.0.0 · env staging",
        value: "prod",
      },
      {
        name: "custom · inline · embedded-layer · env shared",
        value: "custom",
      },
      {
        name: "local-fallback · local · local-fallback · env shared",
        value: "local-fallback",
      },
    ]);
  });

  it("resolveProjectProfileKey returns the sole profile without prompting", async () => {
    const config = makeConfig([
      {
        name: "solo",
        source: "local",
        selector: "solo-layer",
      },
    ]);

    await expect(
      resolveProjectProfileKey(config, {
        noInteractive: true,
      }),
    ).resolves.toBe("solo");
  });

  it("resolveProjectProfileKey throws when multiple profiles exist in non-interactive mode", async () => {
    const config = makeConfig([
      {
        name: "alpha",
        source: "local",
        selector: "alpha",
      },
      {
        name: "beta",
        source: "local",
        selector: "beta",
      },
    ]);

    await expect(
      resolveProjectProfileKey(config, {
        noInteractive: true,
      }),
    ).rejects.toThrow("multiple profiles configured; pass --profile <name>");
  });
});
