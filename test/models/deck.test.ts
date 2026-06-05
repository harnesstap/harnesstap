import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createEnvironment } from "../../src/models/environment.ts";
import {
  addConfiguredLayerToDeck,
  createDeck,
  getDeck,
  listDeckConfiguredLayers,
  setDeckActiveEnvironment,
} from "../../src/models/deck.ts";
import { createConfiguredLayer } from "../../src/models/configured-layer.ts";
import { createPlugin } from "../../src/models/plugin-component.ts";

describe("deck model", () => {
  it("sets active environment on deck", async () => {
    const context = await createInitializedTestContext("deck-active-env");

    try {
      const deck = createDeck({ name: "my-deck", rootPath: "/tmp/my-deck" });
      const prod = createEnvironment({ name: "prod" });
      setDeckActiveEnvironment(deck.id, prod.id);
      expect(getDeck(deck.id)?.active_environment_id).toBe(prod.id);
    } finally {
      await context.cleanup();
    }
  });

  it("orders configured layers on deck", async () => {
    const context = await createInitializedTestContext("deck-layers");

    try {
      const p1 = createPlugin({ name: "pagerduty" });
      const p2 = createPlugin({ name: "slack" });
      const layer1 = createConfiguredLayer({
        name: "oncall",
        pluginIds: [p1.id],
      });
      const layer2 = createConfiguredLayer({
        name: "comms",
        pluginIds: [p2.id],
      });
      const deck = createDeck({ name: "team-deck" });
      addConfiguredLayerToDeck(deck.id, layer1.id);
      addConfiguredLayerToDeck(deck.id, layer2.id);

      const links = listDeckConfiguredLayers(deck.id);
      expect(links).toHaveLength(2);
      expect(links[0]?.configured_layer_id).toBe(layer1.id);
      expect(links[1]?.configured_layer_id).toBe(layer2.id);
    } finally {
      await context.cleanup();
    }
  });
});
