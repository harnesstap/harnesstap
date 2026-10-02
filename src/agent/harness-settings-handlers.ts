import {
  getHarnessSettings,
  putHarnessSettings,
  type PutHarnessSettingsInput,
} from "../services/harness-settings.js";
import { registeredFromLegacyParts } from "../services/harness-targets.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseRegistered(record: Record<string, unknown>): string[] | "invalid" | undefined {
  if (record.registered_harnesses !== undefined) {
    const parsed = asStringArray(record.registered_harnesses);
    return parsed ?? "invalid";
  }
  if (record.main_harness !== undefined || record.alias_harnesses !== undefined) {
    if (record.alias_harnesses !== undefined && !Array.isArray(record.alias_harnesses)) {
      return "invalid";
    }
    const main = typeof record.main_harness === "string" ? record.main_harness : null;
    const aliases = asStringArray(record.alias_harnesses);
    return registeredFromLegacyParts(main, aliases);
  }
  return undefined;
}

export function handleHarnessSettingsGet(
  request: Request,
  token: string,
): Response {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  const url = new URL(request.url);
  const project =
    url.searchParams.get("project") ?? url.searchParams.get("projectPath") ?? undefined;
  return jsonResponse(getHarnessSettings(project ?? undefined));
}

export async function handleHarnessSettingsPut(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "invalid_json", message: "Request body must be JSON" },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return jsonResponse(
      { error: "invalid_body", message: "Request body must be an object" },
      { status: 400 },
    );
  }

  const record = body as Record<string, unknown>;
  const global = record.global;
  if (!global || typeof global !== "object") {
    return jsonResponse(
      { error: "invalid_global", message: "global is required" },
      { status: 400 },
    );
  }
  const registered = parseRegistered(global as Record<string, unknown>);
  if (registered === "invalid") {
    return jsonResponse(
      {
        error: "invalid_registered_harnesses",
        message: "global.registered_harnesses must be an array",
      },
      { status: 400 },
    );
  }
  if (!registered || registered.length === 0) {
    return jsonResponse(
      {
        error: "invalid_registered_harnesses",
        message: "global.registered_harnesses must include at least one harness",
      },
      { status: 400 },
    );
  }

  const input: PutHarnessSettingsInput = {
    global: { registered_harnesses: registered },
  };

  if (record.project !== undefined) {
    if (!record.project || typeof record.project !== "object") {
      return jsonResponse(
        { error: "invalid_project", message: "project must be an object" },
        { status: 400 },
      );
    }
    const p = record.project as Record<string, unknown>;
    if (typeof p.path !== "string" || !p.path.trim()) {
      return jsonResponse(
        { error: "invalid_project_path", message: "project.path is required" },
        { status: 400 },
      );
    }
    if (typeof p.override !== "boolean") {
      return jsonResponse(
        { error: "invalid_override", message: "project.override must be a boolean" },
        { status: 400 },
      );
    }
    const projectRegistered = parseRegistered(p);
    if (projectRegistered === "invalid") {
      return jsonResponse(
        {
          error: "invalid_registered_harnesses",
          message: "project.registered_harnesses must be an array",
        },
        { status: 400 },
      );
    }
    input.project = {
      path: p.path.trim(),
      override: p.override,
      ...(projectRegistered ? { registered_harnesses: projectRegistered } : {}),
      ...(p.materialization_strategy === "copy"
        || p.materialization_strategy === "symlink-preferred"
        ? { materialization_strategy: p.materialization_strategy }
        : {}),
    };
  }

  try {
    const result = await putHarnessSettings(input);
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /unknown harness|required|git origin/i.test(message)
      ? 400
      : 500;
    return jsonResponse({ error: "harness_settings_failed", message }, { status });
  }
}
