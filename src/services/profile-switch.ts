import { ui } from "../ui/index.js";
import { getActiveProfileName } from "./active-profile.js";
import type { ApplyProfilePluginOptions, ApplyProfilePluginResult } from "./profile-apply.js";
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

const WRITE_WINDOW_STEPS = new Set<ProfileSwitchStep>([
  "apply_home",
  "restore_previous",
]);

export function isProfileSwitchCancelAllowed(
  events: readonly ProfileSwitchStepEvent[],
): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || !WRITE_WINDOW_STEPS.has(event.step)) {
      continue;
    }
    return event.status !== "started";
  }
  return true;
}

export const PROFILE_SWITCH_CANCEL_DISABLED_MESSAGE =
  "Cancel is disabled while an apply step is running";

export const PROFILE_SWITCH_SIGINT_HINT =
  "Ctrl-C cancels before apply starts; it is ignored while files are being written.";

function isSigintCancelAllowed(events: readonly ProfileSwitchStepEvent[]): boolean {
  return !events.some(
    (event) => event.step === "apply_home" && event.status === "started",
  );
}

function cliArgvRequestsJson(argv: readonly string[]): boolean {
  const formatIndex = argv.findIndex((arg) => arg === "--format" || arg === "-f");
  if (formatIndex >= 0) {
    return (argv[formatIndex + 1] ?? "").toLowerCase() === "json";
  }
  return argv.some(
    (arg) => arg === "--format=json" || arg === "-f=json",
  );
}

function installProfileSwitchSigint(events: ProfileSwitchStepEvent[]): {
  isCancelled: () => boolean;
  uninstall: () => void;
} {
  let cancelled = false;
  const onSigint = (): void => {
    if (!isSigintCancelAllowed(events)) {
      process.stderr.write(`${PROFILE_SWITCH_CANCEL_DISABLED_MESSAGE}\n`);
      return;
    }
    cancelled = true;
  };
  process.on("SIGINT", onSigint);
  if (!cliArgvRequestsJson(process.argv)) {
    ui.hint(PROFILE_SWITCH_SIGINT_HINT);
  }
  return {
    isCancelled: () => cancelled,
    uninstall: () => {
      process.off("SIGINT", onSigint);
    },
  };
}

export type ProfileSwitchStepListener = (event: ProfileSwitchStepEvent) => void;

export interface SwitchProfileOptions {
  apply: ApplyProfilePluginOptions;
  onStep?: ProfileSwitchStepListener;
  isCancelled?: () => boolean;
  useProfile?: typeof useProfileCommandUnlocked;
}

export interface SwitchProfileSuccess {
  ok: true;
  cancelled: false;
  previous_profile: string | null;
  apply: ApplyProfilePluginResult;
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
  restored: ApplyProfilePluginResult;
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
  const events: ProfileSwitchStepEvent[] = [];
  const ownsSigint = options.isCancelled === undefined;
  const sigint = ownsSigint ? installProfileSwitchSigint(events) : null;
  const resolvedOptions: SwitchProfileOptions = ownsSigint
    ? { ...options, isCancelled: () => sigint?.isCancelled() === true }
    : options;

  try {
    return await withProfileApplyLock(async () => {
      const previousProfile = getActiveProfileName() ?? null;
      const useProfile = resolvedOptions.useProfile ?? useProfileCommandUnlocked;

    emitStep(events, resolvedOptions.onStep, {
      step: "validate_baseline",
      status: "started",
    });
    const cancelledBeforeBaseline = checkCancellation(
      resolvedOptions,
      events,
      previousProfile,
      "validate_baseline",
    );
    if (cancelledBeforeBaseline) {
      return cancelledBeforeBaseline;
    }
    // First apply after init has no snapshot yet — proceed and establish one.
    // Restore-on-failure only matters when a previous apply baseline exists.
    emitStep(events, resolvedOptions.onStep, {
      step: "validate_baseline",
      status: "completed",
    });

    const cancelledBeforeApply = checkCancellation(
      resolvedOptions,
      events,
      previousProfile,
      "apply_home",
    );
    if (cancelledBeforeApply) {
      return cancelledBeforeApply;
    }

    emitStep(events, resolvedOptions.onStep, {
      step: "apply_home",
      status: "started",
      profile_name: selector,
    });

    try {
      const apply = await useProfile(selector, resolvedOptions.apply);
      if (apply.cancelled) {
        emitStep(events, resolvedOptions.onStep, {
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
      emitStep(events, resolvedOptions.onStep, {
        step: "apply_home",
        status: "completed",
        profile_name: selector,
      });
      emitStep(events, resolvedOptions.onStep, {
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
      emitStep(events, resolvedOptions.onStep, {
        step: "apply_home",
        status: "failed",
        profile_name: selector,
        error: applyError,
      });

      if (!previousProfile || previousProfile === selector) {
        throw error;
      }

      const cancelledBeforeRestore = checkCancellation(
        resolvedOptions,
        events,
        previousProfile,
        "restore_previous",
      );
      if (cancelledBeforeRestore) {
        return cancelledBeforeRestore;
      }

      emitStep(events, resolvedOptions.onStep, {
        step: "restore_previous",
        status: "started",
        profile_name: previousProfile,
      });

      try {
        const restored = await useProfile(previousProfile, resolvedOptions.apply);
        if (restored.cancelled) {
          throw new Error("Restore apply was cancelled.");
        }
        emitStep(events, resolvedOptions.onStep, {
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
        emitStep(events, resolvedOptions.onStep, {
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
  } finally {
    sigint?.uninstall();
  }
}
