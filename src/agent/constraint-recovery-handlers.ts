import { runConstraintRecovery } from "../services/constraint-recovery.js";
import type { RecoveryAction } from "../services/resolve/types.js";
import type { DependencySourceKind } from "../types.js";
import { DEPENDENCY_SOURCE_KINDS } from "../types.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDependencySourceKind(value: unknown): value is DependencySourceKind {
  return (
    typeof value === "string"
    && (DEPENDENCY_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

function parseRecoveryAction(value: unknown): RecoveryAction | Response {
  if (!isRecord(value)) {
    return jsonResponse(
      { error: "invalid_action", message: "action must be an object" },
      { status: 400 },
    );
  }

  const id = value.id;
  if (typeof id !== "string") {
    return jsonResponse(
      { error: "invalid_action", message: "action.id is required" },
      { status: 400 },
    );
  }

  const label = value.label;
  if (typeof label !== "string" || label.trim().length === 0) {
    return jsonResponse(
      { error: "invalid_action", message: "action.label is required" },
      { status: 400 },
    );
  }

  switch (id) {
    case "sync-install": {
      const pluginName = value.pluginName;
      if (typeof pluginName !== "string" || pluginName.trim().length === 0) {
        return jsonResponse(
          {
            error: "invalid_action",
            message: "action.pluginName is required for sync-install",
          },
          { status: 400 },
        );
      }
      const sourceKind = value.sourceKind;
      if (sourceKind !== undefined && !isDependencySourceKind(sourceKind)) {
        return jsonResponse(
          {
            error: "invalid_action",
            message: "action.sourceKind must be a valid dependency source kind",
          },
          { status: 400 },
        );
      }
      return {
        id: "sync-install",
        label: label.trim(),
        pluginName: pluginName.trim(),
        ...(sourceKind ? { sourceKind } : {}),
      };
    }
    case "override-version": {
      const pluginName = value.pluginName;
      if (typeof pluginName !== "string" || pluginName.trim().length === 0) {
        return jsonResponse(
          {
            error: "invalid_action",
            message: "action.pluginName is required for override-version",
          },
          { status: 400 },
        );
      }
      const rootName = value.rootName;
      if (typeof rootName !== "string" || rootName.trim().length === 0) {
        return jsonResponse(
          {
            error: "invalid_action",
            message: "action.rootName is required for override-version",
          },
          { status: 400 },
        );
      }
      const versions = value.versions;
      if (
        !Array.isArray(versions)
        || versions.length === 0
        || !versions.every((version) => typeof version === "string")
      ) {
        return jsonResponse(
          {
            error: "invalid_action",
            message: "action.versions must be a non-empty string array",
          },
          { status: 400 },
        );
      }
      return {
        id: "override-version",
        label: label.trim(),
        pluginName: pluginName.trim(),
        rootName: rootName.trim(),
        versions: versions.map((version) => version.trim()),
      };
    }
    case "detach-dependency": {
      const pluginName = value.pluginName;
      if (typeof pluginName !== "string" || pluginName.trim().length === 0) {
        return jsonResponse(
          {
            error: "invalid_action",
            message: "action.pluginName is required for detach-dependency",
          },
          { status: 400 },
        );
      }
      const rootName = value.rootName;
      if (typeof rootName !== "string" || rootName.trim().length === 0) {
        return jsonResponse(
          {
            error: "invalid_action",
            message: "action.rootName is required for detach-dependency",
          },
          { status: 400 },
        );
      }
      return {
        id: "detach-dependency",
        label: label.trim(),
        rootName: rootName.trim(),
        pluginName: pluginName.trim(),
      };
    }
    case "clear-override": {
      const pluginName = value.pluginName;
      if (typeof pluginName !== "string" || pluginName.trim().length === 0) {
        return jsonResponse(
          {
            error: "invalid_action",
            message: "action.pluginName is required for clear-override",
          },
          { status: 400 },
        );
      }
      const rootName = value.rootName;
      if (typeof rootName !== "string" || rootName.trim().length === 0) {
        return jsonResponse(
          {
            error: "invalid_action",
            message: "action.rootName is required for clear-override",
          },
          { status: 400 },
        );
      }
      return {
        id: "clear-override",
        label: label.trim(),
        rootName: rootName.trim(),
        pluginName: pluginName.trim(),
      };
    }
    default: {
      return jsonResponse(
        {
          error: "invalid_action",
          message: `action.id must be one of sync-install, override-version, detach-dependency, clear-override`,
        },
        { status: 400 },
      );
    }
  }
}

export async function handleConstraintRecoveryRun(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }

  const root = body.root;
  if (typeof root !== "string" || root.trim().length === 0) {
    return jsonResponse(
      { error: "invalid_root", message: "root is required" },
      { status: 400 },
    );
  }

  const actionResult = parseRecoveryAction(body.action);
  if (actionResult instanceof Response) {
    return actionResult;
  }

  const chosenVersion = body.chosenVersion;
  if (chosenVersion !== undefined && typeof chosenVersion !== "string") {
    return jsonResponse(
      { error: "invalid_chosen_version", message: "chosenVersion must be a string" },
      { status: 400 },
    );
  }

  if (actionResult.id === "override-version") {
    if (!chosenVersion || chosenVersion.trim().length === 0) {
      return jsonResponse(
        {
          error: "chosen_version_required",
          message: "chosenVersion is required for override-version actions",
        },
        { status: 400 },
      );
    }
  }

  const projectPath = body.projectPath;
  if (projectPath !== undefined && typeof projectPath !== "string") {
    return jsonResponse(
      { error: "invalid_project_path", message: "projectPath must be a string" },
      { status: 400 },
    );
  }

  try {
    await runConstraintRecovery({
      rootName: root.trim(),
      action: actionResult,
      ...(chosenVersion && chosenVersion.trim()
        ? { chosenVersion: chosenVersion.trim() }
        : {}),
      ...(projectPath && projectPath.trim()
        ? { projectRoot: projectPath.trim() }
        : {}),
    });
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse(
      {
        error: "recovery_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
