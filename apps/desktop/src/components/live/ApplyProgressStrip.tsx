import { X } from "lucide-react";
import {
  orderedSwitchSteps,
  SWITCH_STEP_LABELS,
  type ProfileSwitchStep,
  type ProfileSwitchStepEvent,
  type SwitchScope,
} from "../../lib/types";
import { IconActionButton } from "../IconActionButton";
import { ICON_SIZE } from "./shared";

export function stepState(
  step: ProfileSwitchStep,
  events: ProfileSwitchStepEvent[],
): "pending" | "current" | "done" | "failed" {
  const related = events.filter((event) => event.step === step);
  if (related.some((event) => event.status === "failed")) {
    return "failed";
  }
  if (related.some((event) => event.status === "completed")) {
    return "done";
  }
  if (related.some((event) => event.status === "started")) {
    return "current";
  }
  return "pending";
}

export function isApplyStepActive(events: ProfileSwitchStepEvent[]): boolean {
  return events.some(
    (event) =>
      (event.step === "apply_home" || event.step === "apply_project")
      && event.status === "started",
  );
}

function stepClassName(state: ReturnType<typeof stepState>): string {
  switch (state) {
    case "current":
      return "cur m-status";
    case "done":
      return "done m-status";
    case "failed":
      return "failed m-status";
    case "pending":
      return "m-status";
    default: {
      const neverState: never = state;
      return neverState;
    }
  }
}

export interface ApplyProgressStripProps {
  scope: SwitchScope;
  events: ProfileSwitchStepEvent[];
  label?: string;
  success?: boolean;
  onCancel: () => void;
}

/** Yellow (or green-on-success) step strip at the top of the live pane. */
export function ApplyProgressStrip({
  scope,
  events,
  label = "Applying…",
  success = false,
  onCancel,
}: ApplyProgressStripProps) {
  return (
    <section
      className={[
        "apply-progress-strip",
        "m-status",
        success ? "apply-progress-strip-success" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Apply progress"
      data-state={success ? "success" : "running"}
    >
      <div className="apply-progress-strip-head">
        <h2>{label}</h2>
        <IconActionButton
          label="Cancel"
          disabled={success || isApplyStepActive(events)}
          onClick={onCancel}
          icon={<X size={ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
        />
      </div>
      <ol className="steps apply-progress-steps">
        {orderedSwitchSteps(scope).map((step) => {
          const state = stepState(step, events);
          return (
            <li key={step} className={stepClassName(state)}>
              {SWITCH_STEP_LABELS[step]}
              {state === "failed" ? " (failed)" : ""}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
