import {
  getHarnessSettings,
  putHarnessSettings,
  type PutHarnessSettingsInput,
} from "../services/harness-settings.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

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
  const g = global as Record<string, unknown>;
  if (typeof g.main_harness !== "string" || !g.main_harness.trim()) {
    return jsonResponse(
      { error: "invalid_main_harness", message: "global.main_harness is required" },
      { status: 400 },
    );
  }
  if (
    g.alias_harnesses !== undefined
    && !Array.isArray(g.alias_harnesses)
  ) {
    return jsonResponse(
      { error: "invalid_aliases", message: "global.alias_harnesses must be an array" },
      { status: 400 },
    );
  }

  const input: PutHarnessSettingsInput = {
    global: {
      main_harness: g.main_harness.trim(),
      alias_harnesses: Array.isArray(g.alias_harnesses)
        ? g.alias_harnesses.filter((v): v is string => typeof v === "string")
        : [],
    },
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
    input.project = {
      path: p.path.trim(),
      override: p.override,
      ...(typeof p.main_harness === "string"
        ? { main_harness: p.main_harness }
        : {}),
      ...(Array.isArray(p.alias_harnesses)
        ? {
            alias_harnesses: p.alias_harnesses.filter(
              (v): v is string => typeof v === "string",
            ),
          }
        : {}),
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
