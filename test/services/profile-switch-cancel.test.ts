import { describe, expect, it, spyOn } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { addResourceToPlugin, createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import * as profileApply from "../../src/services/profile-apply.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { useProfileCommandUnlocked } from "../../src/services/profile-commands.ts";
import {
  PROFILE_SWITCH_CANCEL_DISABLED_MESSAGE,
  PROFILE_SWITCH_SIGINT_HINT,
  isProfileSwitchCancelAllowed,
  switchProfile,
} from "../../src/services/profile-switch.ts";
import type { ProfileSwitchStepEvent } from "../../src/services/profile-switch.ts";

function createSkill(name: string, content: string) {
  return createResource({
    type: "skill",
    name,
    description: `${name} skill`,
    content,
    metadata: {},
    source: "manual",
  });
}

function createProfile(name: string, skillName: string) {
  const plugin = createPlugin({ name });
  setPluginTags(plugin.id, ["profile"]);
  addResourceToPlugin(plugin.id, createSkill(skillName, `# ${skillName}`).id);
  return plugin;
}

describe("isProfileSwitchCancelAllowed", () => {
  it("is true before any write step starts", () => {
    const events: ProfileSwitchStepEvent[] = [
      { step: "validate_baseline", status: "started" },
      { step: "validate_baseline", status: "completed" },
    ];
    expect(isProfileSwitchCancelAllowed(events)).toBe(true);
  });

  it("is false while apply_home is started", () => {
    const events: ProfileSwitchStepEvent[] = [
      { step: "validate_baseline", status: "completed" },
      { step: "apply_home", status: "started", profile_name: "b" },
    ];
    expect(isProfileSwitchCancelAllowed(events)).toBe(false);
  });

  it("is true again after apply_home completes, fails, or is cancelled", () => {
    expect(
      isProfileSwitchCancelAllowed([
        { step: "apply_home", status: "started" },
        { step: "apply_home", status: "completed" },
      ]),
    ).toBe(true);
    expect(
      isProfileSwitchCancelAllowed([
        { step: "apply_home", status: "started" },
        { step: "apply_home", status: "failed", error: "boom" },
      ]),
    ).toBe(true);
    expect(
      isProfileSwitchCancelAllowed([
        { step: "apply_home", status: "started" },
        { step: "apply_home", status: "cancelled" },
      ]),
    ).toBe(true);
  });

  it("is false while restore_previous is started", () => {
    const events: ProfileSwitchStepEvent[] = [
      { step: "apply_home", status: "failed", error: "boom" },
      { step: "restore_previous", status: "started", profile_name: "a" },
    ];
    expect(isProfileSwitchCancelAllowed(events)).toBe(false);
  });
});

describe("switchProfile isCancelled hook", () => {
  it("returns cancelled and does not call useProfile when cancelled before apply_home", async () => {
    const context = await createInitializedTestContext("switch-cancel-before-apply");
    try {
      createProfile("profile-a", "skill-a");
      createProfile("profile-b", "skill-b");
      await profileApply.applyProfilePlugin("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      let useProfileCalls = 0;
      const result = await switchProfile("profile-b", {
        apply: { harness: "claude-code", conflictPolicy: "replace" },
        isCancelled: () => true,
        useProfile: async () => {
          useProfileCalls += 1;
          throw new Error("useProfile must not run");
        },
      });

      expect(result.ok).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(useProfileCalls).toBe(0);
      expect(result.events.some((event) => event.status === "cancelled")).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});

describe("switchProfile SIGINT (when isCancelled is omitted)", () => {
  it("cancels before apply_home when SIGINT arrives during validate_baseline", async () => {
    const context = await createInitializedTestContext("switch-sigint-before-apply");
    try {
      createProfile("profile-a", "skill-a");
      createProfile("profile-b", "skill-b");
      await profileApply.applyProfilePlugin("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      let useProfileCalls = 0;
      const result = await switchProfile("profile-b", {
        apply: { harness: "claude-code", conflictPolicy: "replace" },
        onStep: (event) => {
          if (event.step === "validate_baseline" && event.status === "started") {
            process.emit("SIGINT");
          }
        },
        useProfile: async () => {
          useProfileCalls += 1;
          throw new Error("useProfile must not run");
        },
      });

      expect(result.ok).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(useProfileCalls).toBe(0);
    } finally {
      await context.cleanup();
    }
  });

  it("ignores SIGINT during useProfile and still completes the switch", async () => {
    const context = await createInitializedTestContext("switch-sigint-during-apply");
    try {
      createProfile("profile-a", "skill-a");
      createProfile("profile-b", "skill-b");
      await profileApply.applyProfilePlugin("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      const stderrChunks: string[] = [];
      const stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk) => {
        stderrChunks.push(String(chunk));
        return true;
      });

      let resume: () => void = () => {};
      const hold = new Promise<void>((resolve) => {
        resume = resolve;
      });

      const switchPromise = switchProfile("profile-b", {
        apply: { harness: "claude-code", conflictPolicy: "replace" },
        onStep: (event) => {
          if (event.step === "apply_home" && event.status === "started") {
            queueMicrotask(() => {
              process.emit("SIGINT");
              process.emit("SIGINT");
              resume();
            });
          }
        },
        useProfile: async (selector, options) => {
          if (selector === "profile-b") {
            await hold;
          }
          return useProfileCommandUnlocked(selector, options);
        },
      });

      const result = await switchPromise;
      stderrSpy.mockRestore();

      expect(result.ok).toBe(true);
      expect(result.cancelled).toBe(false);
      expect(stderrChunks.join("")).toContain(PROFILE_SWITCH_CANCEL_DISABLED_MESSAGE);
    } finally {
      await context.cleanup();
    }
  });

  it("ignores SIGINT during restore and still restores the previous profile", async () => {
    const context = await createInitializedTestContext("switch-sigint-during-restore");
    try {
      createProfile("profile-a", "skill-a");
      createProfile("profile-b", "skill-b");
      await profileApply.applyProfilePlugin("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      const stderrChunks: string[] = [];
      const stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk) => {
        stderrChunks.push(String(chunk));
        return true;
      });

      let resume: () => void = () => {};
      const hold = new Promise<void>((resolve) => {
        resume = resolve;
      });

      const result = await switchProfile("profile-b", {
        apply: { harness: "claude-code", conflictPolicy: "replace" },
        onStep: (event) => {
          if (event.step === "restore_previous" && event.status === "started") {
            queueMicrotask(() => {
              process.emit("SIGINT");
              resume();
            });
          }
        },
        useProfile: async (selector, options) => {
          if (selector === "profile-b") {
            throw new Error("injected apply failure");
          }
          await hold;
          return useProfileCommandUnlocked(selector, options);
        },
      });

      stderrSpy.mockRestore();

      expect(result.ok).toBe(false);
      expect(result.cancelled).toBe(false);
      if (result.ok || result.cancelled) {
        return;
      }
      expect(result.restored.profile_name).toBe("profile-a");
      expect(stderrChunks.join("")).toContain(PROFILE_SWITCH_CANCEL_DISABLED_MESSAGE);
    } finally {
      await context.cleanup();
    }
  });

  it("does not install SIGINT when the caller passes isCancelled", async () => {
    const context = await createInitializedTestContext("switch-no-sigint-when-hook");
    try {
      createProfile("profile-a", "skill-a");
      await profileApply.applyProfilePlugin("profile-a", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("profile-a");

      const before = process.listenerCount("SIGINT");
      await switchProfile("profile-a", {
        apply: { harness: "claude-code", conflictPolicy: "replace" },
        isCancelled: () => false,
        onStep: () => {
          expect(process.listenerCount("SIGINT")).toBe(before);
        },
      });
      expect(process.listenerCount("SIGINT")).toBe(before);
    } finally {
      await context.cleanup();
    }
  });

  it("prints the human hint once when installing SIGINT and skips it for --format json", async () => {
    const context = await createInitializedTestContext("switch-sigint-hint");
    try {
      createProfile("profile-a", "skill-a");
      const originalArgv = process.argv;
      const logChunks: string[] = [];
      const logSpy = spyOn(console, "log").mockImplementation((...values) => {
        logChunks.push(values.map(String).join(" "));
      });

      process.argv = ["bun", "harnesstap", "profile", "switch", "profile-a"];
      await switchProfile("profile-a", {
        apply: { harness: "claude-code", conflictPolicy: "replace" },
      });
      expect(logChunks.join("\n")).toContain(PROFILE_SWITCH_SIGINT_HINT);

      logChunks.length = 0;
      process.argv = ["bun", "harnesstap", "profile", "switch", "profile-a", "--format", "json"];
      await switchProfile("profile-a", {
        apply: { harness: "claude-code", conflictPolicy: "replace" },
      });
      expect(logChunks.join("\n")).not.toContain(PROFILE_SWITCH_SIGINT_HINT);

      logSpy.mockRestore();
      process.argv = originalArgv;
    } finally {
      await context.cleanup();
    }
  });

  it("removes the SIGINT handler after switchProfile returns", async () => {
    const context = await createInitializedTestContext("switch-sigint-teardown");
    try {
      createProfile("profile-a", "skill-a");
      const before = process.listenerCount("SIGINT");
      await switchProfile("profile-a", {
        apply: { harness: "claude-code", conflictPolicy: "replace" },
      });
      expect(process.listenerCount("SIGINT")).toBe(before);
    } finally {
      await context.cleanup();
    }
  });
});
