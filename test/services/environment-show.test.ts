import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { runEnvironmentDeleteWizard } from "../../src/services/wizards/environment-delete.ts?actual";
import { runEnvironmentShowWizard } from "../../src/services/wizards/environment-show.ts?actual";

describe("environment delete wizard", () => {
  it("returns the selected environment name on enter", async () => {
    const context = await createInitializedTestContext("environment-delete-wizard-pick");

    try {
      const environmentModel = await import("../../src/models/environment.ts");
      environmentModel.createEnvironment({ name: "staging" });
      environmentModel.createEnvironment({ name: "production" });

      const { answer, events } = await render(
        (_config, promptContext) => runEnvironmentDeleteWizard(undefined, promptContext),
        undefined,
        { clearPromptOnDone: true },
      );

      events.type("prod");
      events.keypress("enter");

      await expect(answer).resolves.toEqual(["production"]);
    } finally {
      await context.cleanup();
    }
  });

  it("does not render Active or Show selection line in browse view", async () => {
    const context = await createInitializedTestContext("environment-delete-wizard-chrome");

    try {
      const environmentModel = await import("../../src/models/environment.ts");
      environmentModel.createEnvironment({ name: "staging" });
      environmentModel.createEnvironment({ name: "production" });

      const { getScreen } = await render(
        (_config, promptContext) => runEnvironmentDeleteWizard(undefined, promptContext),
        undefined,
        { clearPromptOnDone: true },
      );

      const frame = getScreen();
      expect(frame).not.toMatch(/\nShow: /);
      expect(frame).not.toMatch(/\nActive: /);
      expect(frame).toMatch(/\bd\b.*delete/);
    } finally {
      await context.cleanup();
    }
  });
});

describe("environment show wizard", () => {
  it("returns undefined when no environments exist", async () => {
    const context = await createInitializedTestContext("environment-show-wizard-empty");

    try {
      const result = await runEnvironmentShowWizard();
      expect(result).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("picks an environment on enter", async () => {
    const context = await createInitializedTestContext("environment-show-wizard-pick");

    try {
      const environmentModel = await import("../../src/models/environment.ts");
      environmentModel.createEnvironment({ name: "staging" });
      environmentModel.createEnvironment({ name: "production" });

      const { answer, events } = await render(
        (_config, promptContext) => runEnvironmentShowWizard(undefined, promptContext),
        undefined,
        { clearPromptOnDone: true },
      );

      events.type("prod");
      events.keypress("enter");

      await expect(answer).resolves.toBe("production");
    } finally {
      await context.cleanup();
    }
  });

  it("does not render Active or Show selection line in browse view", async () => {
    const context = await createInitializedTestContext("environment-show-wizard-chrome");

    try {
      const environmentModel = await import("../../src/models/environment.ts");
      environmentModel.createEnvironment({ name: "staging" });
      environmentModel.createEnvironment({ name: "production" });

      const { getScreen } = await render(
        (_config, promptContext) => runEnvironmentShowWizard(undefined, promptContext),
        undefined,
        { clearPromptOnDone: true },
      );

      const frame = getScreen();
      expect(frame).not.toMatch(/\nShow: /);
      expect(frame).not.toMatch(/\nActive: /);
    } finally {
      await context.cleanup();
    }
  });
});
