import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { parseDeckToml } from "../../src/services/transport/deck.ts";
import {
  materializeDeckRepo,
  stableJsonStringify,
} from "../../src/services/deck-materializer.ts";
import {
  DECK_JSON_VERSION,
  DECK_SCHEMA,
  type DeckJson,
  type DeckJsonEnvironment,
  type Layer,
} from "../../src/types.ts";
import { makeResource } from "../helpers/resources.ts";
import type { MaterializeDeckPlugin } from "../../src/services/deck-materializer.ts";

const minimalDeckJson: DeckJson = {
  $schema: DECK_SCHEMA,
  version: DECK_JSON_VERSION,
  name: "oncall-deck",
  layers: [
    {
      name: "oncall",
      version: "1.0.0",
      environment: "prod",
    },
  ],
  environments: [
    { name: "prod", values: { PD_REGION: "us" } },
    { name: "staging", values: { PD_REGION: "eu" } },
  ],
  active_environment: "prod",
};

const samplePlugin: MaterializeDeckPlugin = {
  plugin: {
    id: "plugin-pd",
    name: "pagerduty",
    version: "1.0.0",
    description: "PagerDuty integration",
    tags: ["oncall"],
    needs: ["PD_TOKEN", "PD_REGION"],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } satisfies Layer,
  resources: [
    makeResource({
      type: "skill",
      name: "page",
      description: "Page on-call",
      content: "# Page\n",
    }),
  ],
};

const prodEnv: DeckJsonEnvironment = {
  name: "prod",
  values: { PD_REGION: "us" },
  secret_refs: { PD_TOKEN: { provider: "keychain", ref: "pagerduty-token" } },
};

const stagingEnv: DeckJsonEnvironment = {
  name: "staging",
  values: { PD_REGION: "eu" },
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeOutDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deck-materializer-"));
  tempDirs.push(dir);
  return dir;
}

describe("deck materializer", () => {
  it("writes marketplace.json and harnessdeck deck.toml", async () => {
    const outDir = makeOutDir();
    await materializeDeckRepo(
      {
        deckJson: minimalDeckJson,
        plugins: [samplePlugin],
        environments: [prodEnv, stagingEnv],
      },
      outDir,
    );

    expect(existsSync(join(outDir, ".claude-plugin", "marketplace.json"))).toBe(
      true,
    );
    expect(existsSync(join(outDir, ".harnessdeck", "deck.toml"))).toBe(true);

    const manifest = JSON.parse(
      readFileSync(
        join(outDir, "pagerduty", ".claude-plugin", "plugin.json"),
        "utf8",
      ),
    ) as { harnessdeck: { needs: string[] } };
    expect(manifest.harnessdeck.needs).toEqual(["PD_REGION", "PD_TOKEN"]);
  });

  it("embeds environments inline in deck.toml", async () => {
    const outDir = makeOutDir();
    await materializeDeckRepo(
      {
        deckJson: minimalDeckJson,
        plugins: [samplePlugin],
        environments: [prodEnv, stagingEnv],
      },
      outDir,
    );

    const deck = parseDeckToml(
      readFileSync(join(outDir, ".harnessdeck", "deck.toml"), "utf8"),
    );
    const prod = deck.environments?.find((environment) => environment.name === "prod");
    expect(prod?.values).toEqual({
      PD_REGION: "us",
    });
    expect(prod?.secret_refs?.PD_TOKEN).toEqual({
      provider: "keychain",
      ref: "pagerduty-token",
    });

    const staging = deck.environments?.find((environment) => environment.name === "staging");
    expect(staging?.values).toEqual({ PD_REGION: "eu" });
  });

  it("emits sorted marketplace plugin entries and deterministic JSON", async () => {
    const outDir = makeOutDir();
    const slackPlugin: MaterializeDeckPlugin = {
      plugin: {
        ...samplePlugin.plugin,
        id: "plugin-slack",
        name: "slack",
        needs: ["SLACK_TOKEN"],
      },
      resources: [],
    };

    await materializeDeckRepo(
      {
        deckJson: { ...minimalDeckJson, name: "sorted-deck" },
        plugins: [samplePlugin, slackPlugin],
        environments: [],
      },
      outDir,
    );

    const marketplaceRaw = readFileSync(
      join(outDir, ".claude-plugin", "marketplace.json"),
      "utf8",
    );
    expect(marketplaceRaw).toBe(
      `${stableJsonStringify({
        name: "sorted-deck",
        plugins: [
          { name: "pagerduty", source: "./pagerduty", version: "1.0.0" },
          { name: "slack", source: "./slack", version: "1.0.0" },
        ],
      }).trimEnd()}\n`,
    );
    expect(marketplaceRaw.indexOf("pagerduty")).toBeLessThan(
      marketplaceRaw.indexOf("slack"),
    );
  });

  it("materializes per-plugin native harness files", async () => {
    const outDir = makeOutDir();
    await materializeDeckRepo(
      {
        deckJson: minimalDeckJson,
        plugins: [samplePlugin],
        environments: [prodEnv],
        platforms: ["claude-code", "codex"],
      },
      outDir,
    );

    expect(
      existsSync(join(outDir, "pagerduty", ".claude", "skills", "page", "SKILL.md")),
    ).toBe(true);
    expect(
      existsSync(
        join(outDir, "pagerduty", ".agents", "skills", "page", "SKILL.md"),
      ),
    ).toBe(true);
  });
});
