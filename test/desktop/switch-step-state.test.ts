import { describe, expect, it } from "bun:test";
import type { ProfileSwitchStepEvent } from "../../apps/desktop/src/lib/types.ts";
import {
  stepState,
  switchStepClassName,
} from "../../apps/desktop/src/components/shell/ScopeWorkspace.tsx";

const events = (
  ...items: Array<Pick<ProfileSwitchStepEvent, "step" | "status">>
): ProfileSwitchStepEvent[] => items as ProfileSwitchStepEvent[];

describe("switch step helper", () => {
  it("marks a failed step failed instead of current", () => {
    expect(
      stepState(
        "apply_home",
        events(
          { step: "apply_home", status: "started" },
          { step: "apply_home", status: "failed" },
        ),
      ),
    ).toBe("failed");
    expect(switchStepClassName("failed")).toBe("failed m-status");
    expect(switchStepClassName("failed")).not.toContain("cur");
  });

  it("keeps the current step on started and done on completed", () => {
    expect(
      stepState("apply_home", events({ step: "apply_home", status: "started" })),
    ).toBe("current");
    expect(switchStepClassName("current")).toBe("cur m-status");
    expect(
      stepState("apply_home", events({ step: "apply_home", status: "completed" })),
    ).toBe("done");
    expect(switchStepClassName("done")).toBe("done m-status");
    expect(switchStepClassName("pending")).toBe("m-status");
  });
});
