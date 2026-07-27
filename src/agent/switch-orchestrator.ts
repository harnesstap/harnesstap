import { resolve } from "node:path";
import { executeProjectUse } from "../services/project-config-use.js";
import {
  detectProfileOwnedOverwriteConflicts,
  type OwnedOverwriteConflictSummary,
} from "../services/profile-owned-overwrite.js";
import {
  SwitchRestoreFailedError,
  switchProfile,
  type SwitchProfileResult,
  type ProfileSwitchStepEvent,
} from "../services/profile-switch.js";
import {
  createAgentSwitchSession,
  emitAgentSwitchFinal,
  emitAgentSwitchStep,
  getAgentSwitchSession,
  isAgentSwitchCancelled,
  type AgentSwitchFinalEvent,
} from "./switch-registry.js";

export type AgentSwitchScope = "home" | "project" | "both";

export interface AgentSwitchRequest {
  profile: string;
  scope: AgentSwitchScope;
  projectPath?: string;
  confirmOwnedOverwrite?: boolean;
  harness?: string;
}

export interface AgentSwitchStartResult {
  id: string;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface AgentSwitchDeps {
  switchProfile: typeof switchProfile;
  executeProjectUse: typeof executeProjectUse;
  detectProfileOwnedOverwriteConflicts: typeof detectProfileOwnedOverwriteConflicts;
}

const defaultAgentSwitchDeps: AgentSwitchDeps = {
  switchProfile,
  executeProjectUse,
  detectProfileOwnedOverwriteConflicts,
};

let agentSwitchDeps: AgentSwitchDeps = defaultAgentSwitchDeps;

export function setAgentSwitchDepsForTests(deps: Partial<AgentSwitchDeps>): void {
  agentSwitchDeps = { ...agentSwitchDeps, ...deps };
}

export function resetAgentSwitchDepsForTests(): void {
  agentSwitchDeps = defaultAgentSwitchDeps;
}

function assertProjectPath(scope: AgentSwitchScope, projectPath?: string): string {
  if (scope === "home") {
    return projectPath ?? "";
  }
  if (!projectPath || projectPath.trim().length === 0) {
    throw new Error("projectPath is required when scope is project or both");
  }
  return resolve(projectPath);
}

export async function preflightAgentSwitchOwnedOverwrite(
  request: AgentSwitchRequest,
): Promise<{ conflict: true; summary: OwnedOverwriteConflictSummary } | { conflict: false }> {
  if (request.confirmOwnedOverwrite || request.scope === "project") {
    return { conflict: false };
  }

  const summary = await agentSwitchDeps.detectProfileOwnedOverwriteConflicts(request.profile, {
    harness: request.harness,
  });
  if (summary.paths.length === 0) {
    return { conflict: false };
  }
  return { conflict: true, summary };
}

async function runHomeSwitch(
  session: ReturnType<typeof createAgentSwitchSession>,
  request: AgentSwitchRequest,
): Promise<SwitchProfileResult | null> {
  const onStep = (event: ProfileSwitchStepEvent) => {
    emitAgentSwitchStep(session, event);
  };

  return agentSwitchDeps.switchProfile(request.profile, {
    apply: {
      harness: request.harness,
      conflictPolicy: "replace",
      pull: false,
    },
    onStep,
    isCancelled: () => isAgentSwitchCancelled(session),
  });
}

async function runProjectSwitch(
  session: ReturnType<typeof createAgentSwitchSession>,
  projectPath: string,
  request: AgentSwitchRequest,
): Promise<unknown> {
  emitAgentSwitchStep(session, {
    step: "apply_project",
    status: "started",
    profile_name: request.profile,
  });

  if (isAgentSwitchCancelled(session)) {
    emitAgentSwitchStep(session, {
      step: "apply_project",
      status: "cancelled",
      profile_name: request.profile,
    });
    return { cancelled: true };
  }

  const result = await agentSwitchDeps.executeProjectUse({
    profile: request.profile,
    project: projectPath,
    noInteractive: true,
    format: "json",
    onConflict: "replace",
    harness: request.harness,
    pull: false,
  });

  if (result.skipped) {
    emitAgentSwitchStep(session, {
      step: "apply_project",
      status: "completed",
      profile_name: request.profile,
    });
    return result;
  }

  emitAgentSwitchStep(session, {
    step: "apply_project",
    status: "completed",
    profile_name: request.profile,
  });
  return result;
}

export async function startAgentSwitch(
  request: AgentSwitchRequest,
): Promise<AgentSwitchStartResult> {
  const projectPath = assertProjectPath(request.scope, request.projectPath);
  const session = createAgentSwitchSession();

  void (async () => {
    try {
      let homeResult: SwitchProfileResult | null = null;
      let projectResult: unknown;

      if (request.scope === "home" || request.scope === "both") {
        homeResult = await runHomeSwitch(session, request);
        if (homeResult?.cancelled) {
          const payload: AgentSwitchFinalEvent = {
            type: "result",
            ok: false,
            cancelled: true,
            result: homeResult,
          };
          emitAgentSwitchFinal(session, payload);
          return;
        }
        if (homeResult && !homeResult.ok) {
          const payload: AgentSwitchFinalEvent = {
            type: "result",
            ok: false,
            result: homeResult,
          };
          emitAgentSwitchFinal(session, payload);
          return;
        }
      }

      if (request.scope === "project" || request.scope === "both") {
        projectResult = await runProjectSwitch(session, projectPath, request);
        if (
          projectResult &&
          typeof projectResult === "object" &&
          "cancelled" in projectResult &&
          projectResult.cancelled
        ) {
          emitAgentSwitchFinal(session, {
            type: "result",
            ok: false,
            cancelled: true,
            result: projectResult,
          });
          return;
        }
      }

      emitAgentSwitchStep(session, {
        step: "complete",
        status: "completed",
        profile_name: request.profile,
      });

      emitAgentSwitchFinal(session, {
        type: "result",
        ok: true,
        result: {
          scope: request.scope,
          profile: request.profile,
          ...(projectPath ? { project_path: projectPath } : {}),
          ...(homeResult ? { home: homeResult } : {}),
          ...(projectResult !== undefined ? { project: projectResult } : {}),
        },
      });
    } catch (error) {
      if (error instanceof SwitchRestoreFailedError) {
        emitAgentSwitchFinal(session, {
          type: "result",
          ok: false,
          error: error.message,
        });
        return;
      }
      emitAgentSwitchFinal(session, {
        type: "result",
        ok: false,
        error: formatError(error),
      });
    }
  })();

  return { id: session.id };
}

export function getAgentSwitchSessionById(id: string) {
  return getAgentSwitchSession(id);
}
