import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { materializeDeckRepo } from "../../src/services/deck-materializer.ts";
import { runDeckDoctor } from "../../src/services/deck-doctor.ts";
import type { DeckJson, Plugin } from "../../src/types.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

const minimalDeckFixturePath = join(
  import.meta.dir,
  "../fixtures/decks/minimal-deck.json",
);

const pagerdutyPlugin = {
  plugin: {
    id: "plugin-pagerduty",
    name: "pagerduty",
    version: "1.0.0",
    description: "",
    tags: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } satisfies Plugin,
  resources: [],
};

function loadMinimalDeckJson(): DeckJson {
  return JSON.parse(readFileSync(minimalDeckFixturePath, "utf-8")) as DeckJson;
}

async function writeDeckRepoWithDriftedMarketplace(repoRoot: string): Promise<void> {
  const deckJson = loadMinimalDeckJson();
  await materializeDeckRepo(
    {
      deckJson,
      plugins: [pagerdutyPlugin],
      environments: deckJson.environments,
    },
    repoRoot,
  );

  const marketplacePath = join(repoRoot, ".claude-plugin", "marketplace.json");
  const marketplace = JSON.parse(readFileSync(marketplacePath, "utf-8")) as {
    plugins: Array<{ version?: string }>;
  };
  marketplace.plugins[0] = {
    ...marketplace.plugins[0],
    version: "9.9.9",
  };
  writeTextFile(marketplacePath, JSON.stringify(marketplace, null, 2));
}

describe("deck doctor", () => {
  it("reports error when marketplace.json drifts from deck.json", async () => {
    const fixturesDir = createTempDir("deck-doctor-drift");

    try {
      await writeDeckRepoWithDriftedMarketplace(fixturesDir);
      const result = await runDeckDoctor({ repoRoot: fixturesDir });
      expect(result.valid).toBe(false);
      expect(result.results.some((r) => r.check === "generated-manifests")).toBe(true);
    } finally {
      cleanupDir(fixturesDir);
    }
  });

  it("passes when generated manifests match deck.json", async () => {
    const fixturesDir = createTempDir("deck-doctor-clean");

    try {
      const deckJson = loadMinimalDeckJson();
      await materializeDeckRepo(
        {
          deckJson,
          plugins: [pagerdutyPlugin],
          environments: deckJson.environments,
        },
        fixturesDir,
      );

      const result = await runDeckDoctor({ repoRoot: fixturesDir });
      expect(result.valid).toBe(true);
      expect(result.results).toHaveLength(0);
    } finally {
      cleanupDir(fixturesDir);
    }
  });
});
