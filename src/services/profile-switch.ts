import { getActiveProfileName } from "./active-profile.js";
import type { ApplyProfileLayerOptions, ApplyProfileLayerResult } from "./profile-apply.js";
import { withProfileApplyLock } from "./profile-apply-lock.js";
import { useProfileCommandUnlocked } from "./profile-commands.js";

export type ProfileSwitchStep =
  | "validate_baseline"
  | "apply_home"
  | "apply_project"
  | "restore_previous"
  | "complete";

export type ProfileSwitchStepStatus = "started" | "completed" | "failed" | "cancelled";

export interface ProfileSwitchStepEvent {
  step: ProfileSwitchStep;
  status: ProfileSwitchStepStatus;
  profile_name?: string;
  error?: string;
}

export type ProfileSwitchStepListener = (event: ProfileSwitchStepEvent) => void;

export interface SwitchProfileOptions {
  apply: ApplyProfileLayerOptions;
  onStep?: ProfileSwitchStepListener;
  isCancelled?: () => boolean;
  useProfile?: typeof useProfileCommandUnlocked;
}

export interface SwitchProfileSuccess {
  ok: true;
  cancelled: false;
  previous_profile: string | null;
  apply: ApplyProfileLayerResult;
  events: ProfileSwitchStepEvent[];
}

export interface SwitchProfileCancelled {
  ok: false;
  cancelled: true;
  previous_profile: string | null;
  events: ProfileSwitchStepEvent[];
}

export interface SwitchProfileFailed {
  ok: false;
  cancelled: false;
  previous_profile: string | null;
  apply_error: string;
  restored: ApplyProfileLayerResult;
  events: ProfileSwitchStepEvent[];
}

export type SwitchProfileResult =
  | SwitchProfileSuccess
  | SwitchProfileCancelled
  | SwitchProfileFailed;

export class SwitchRestoreFailedError extends Error {
  readonly targetProfile: string;
  readonly previousProfile: string;
  readonly applyError: string;
  readonly restoreError: string;

  constructor(input: {
    targetProfile: string;
    previousProfile: string;
    applyError: string;
    restoreError: string;
  }) {
    super(
      `Failed to switch to profile "${input.targetProfile}" and could not restore "${input.previousProfile}".`,
    );
    this.name = "SwitchRestoreFailed";
    this.targetProfile = input.targetProfile;
    this.previousProfile = input.previousProfile;
    this.applyError = input.applyError;
    this.restoreError = input.restoreError;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emitStep(
  events: ProfileSwitchStepEvent[],
  onStep: ProfileSwitchStepListener | undefined,
  event: ProfileSwitchStepEvent,
): void {
  events.push(event);
  onStep?.(event);
}

function checkCancellation(
  options: SwitchProfileOptions,
  events: ProfileSwitchStepEvent[],
  previousProfile: string | null,
  step: ProfileSwitchStep,
): SwitchProfileCancelled | null {
  if (!options.isCancelled?.()) {
    return null;
  }
  emitStep(events, options.onStep, {
    step,
    status: "cancelled",
  });
  return {
    ok: false,
    cancelled: true,
    previous_profile: previousProfile,
    events,
  };
}

export async function switchProfile(
  selector: string,
  options: SwitchProfileOptions,
): Promise<SwitchProfileResult> {
  return withProfileApplyLock(async () => {
    const events: ProfileSwitchStepEvent[] = [];
    const previousProfile = getActiveProfileName() ?? null;
    const useProfile = options.useProfile ?? useProfileCommandUnlocked;

    emitStep(events, options.onStep, {
      step: "validate_baseline",
      status: "started",
    });
    const cancelledBeforeBaseline = checkCancellation(
      options,
      events,
      previousProfile,
      "validate_baseline",
    );
    if (cancelledBeforeBaseline) {
      return cancelledBeforeBaseline;
    }
    // First apply after init has no snapshot yet — proceed and establish one.
    // Restore-on-failure only matters when a previous apply baseline exists.
    emitStep(events, options.onStep, {
      step: "validate_baseline",
      status: "completed",
    });

    const cancelledBeforeApply = checkCancellation(
      options,
      events,
      previousProfile,
      "apply_home",
    );
    if (cancelledBeforeApply) {
      return cancelledBeforeApply;
    }

    emitStep(events, options.onStep, {
      step: "apply_home",
      status: "started",
      profile_name: selector,
    });

    try {
      const apply = await useProfile(selector, options.apply);
      if (apply.cancelled) {
        emitStep(events, options.onStep, {
          step: "apply_home",
          status: "cancelled",
          profile_name: selector,
        });
        return {
          ok: false,
          cancelled: true,
          previous_profile: previousProfile,
          events,
        };
      }
      emitStep(events, options.onStep, {
        step: "apply_home",
        status: "completed",
        profile_name: selector,
      });
      emitStep(events, options.onStep, {
        step: "complete",
        status: "completed",
        profile_name: selector,
      });
      return {
        ok: true,
        cancelled: false,
        previous_profile: previousProfile,
        apply,
        events,
      };
    } catch (error) {
      const applyError = formatError(error);
      emitStep(events, options.onStep, {
        step: "apply_home",
        status: "failed",
        profile_name: selector,
        error: applyError,
      });

      if (!previousProfile || previousProfile === selector) {
        throw error;
      }

      const cancelledBeforeRestore = checkCancellation(
        options,
        events,
        previousProfile,
        "restore_previous",
      );
      if (cancelledBeforeRestore) {
        return cancelledBeforeRestore;
      }

      emitStep(events, options.onStep, {
        step: "restore_previous",
        status: "started",
        profile_name: previousProfile,
      });

      try {
        const restored = await useProfile(previousProfile, options.apply);
        if (restored.cancelled) {
          throw new Error("Restore apply was cancelled.");
        }
        emitStep(events, options.onStep, {
          step: "restore_previous",
          status: "completed",
          profile_name: previousProfile,
        });
        return {
          ok: false,
          cancelled: false,
          previous_profile: previousProfile,
          apply_error: applyError,
          restored,
          events,
        };
      } catch (restoreError) {
        const restoreMessage = formatError(restoreError);
        emitStep(events, options.onStep, {
          step: "restore_previous",
          status: "failed",
          profile_name: previousProfile,
          error: restoreMessage,
        });
        throw new SwitchRestoreFailedError({
          targetProfile: selector,
          previousProfile,
          applyError,
          restoreError: restoreMessage,
        });
      }
    }
  });
}
