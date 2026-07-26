import { requireAgentBearerAuth } from "./auth.js";
import { PACKAGE_VERSION } from "../version.js";
import {
  detectGlobalProfileStatus,
  type GlobalProfileStatus,
} from "../services/global-profile-drift.js";
import type { GlobalProfileStatusDepth } from "../services/global-profile-status-panel.js";
import {
  isAgentSwitchInProgress,
} from "./switch-registry.js";
import {
  getAgentSwitchSessionById,
  preflightAgentSwitchOwnedOverwrite,
  startAgentSwitch,
  type AgentSwitchRequest,
  type AgentSwitchScope,
} from "./switch-orchestrator.js";
import {
  requestAgentSwitchCancel,
  subscribeAgentSwitchEvents,
  type AgentSwitchFinalEvent,
} from "./switch-registry.js";
import type { ProfileSwitchStepEvent } from "../services/profile-switch.js";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function parseStatusDepth(value: string | null): GlobalProfileStatusDepth | Response {
  if (!value || value === "full") {
    return "full";
  }
  if (value === "fast") {
    return "fast";
  }
  return jsonResponse(
    { error: "invalid_depth", message: "depth must be fast or full" },
    { status: 400 },
  );
}

export interface AgentRouteDeps {
  detectGlobalProfileStatus: typeof detectGlobalProfileStatus;
  preflightAgentSwitchOwnedOverwrite: typeof preflightAgentSwitchOwnedOverwrite;
  startAgentSwitch: typeof startAgentSwitch;
  getAgentSwitchSessionById: typeof getAgentSwitchSessionById;
  requestAgentSwitchCancel: typeof requestAgentSwitchCancel;
  subscribeAgentSwitchEvents: typeof subscribeAgentSwitchEvents;
  isAgentSwitchInProgress: typeof isAgentSwitchInProgress;
}

export function createDefaultAgentRouteDeps(): AgentRouteDeps {
  return {
    detectGlobalProfileStatus,
    preflightAgentSwitchOwnedOverwrite,
    startAgentSwitch,
    getAgentSwitchSessionById,
    requestAgentSwitchCancel,
    subscribeAgentSwitchEvents,
    isAgentSwitchInProgress,
  };
}

function withSwitchingStatus(
  status: GlobalProfileStatus,
  deps: AgentRouteDeps,
): GlobalProfileStatus & { switching: boolean } {
  if (!deps.isAgentSwitchInProgress()) {
    return { ...status, switching: false };
  }

  return {
    ...status,
    switching: true,
    panel: {
      status: "yellow",
      reasons: ["switching", ...status.panel.reasons.filter((reason) => reason !== "switching")],
    },
  };
}

function parseSwitchScope(value: unknown): AgentSwitchScope | Response {
  if (value === "home" || value === "project" || value === "both") {
    return value;
  }
  return jsonResponse(
    { error: "invalid_scope", message: "scope must be home, project, or both" },
    { status: 400 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSwitchRequest(body: unknown): AgentSwitchRequest | Response {
  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }

  const persona = body.persona;
  if (typeof persona !== "string" || persona.trim().length === 0) {
    return jsonResponse({ error: "invalid_persona" }, { status: 400 });
  }

  const scope = parseSwitchScope(body.scope);
  if (scope instanceof Response) {
    return scope;
  }

  const projectPath =
    typeof body.projectPath === "string" ? body.projectPath : undefined;
  const confirmOwnedOverwrite = body.confirmOwnedOverwrite === true;
  const harness = typeof body.harness === "string" ? body.harness : undefined;

  return {
    persona: persona.trim(),
    scope,
    ...(projectPath ? { projectPath } : {}),
    ...(confirmOwnedOverwrite ? { confirmOwnedOverwrite } : {}),
    ...(harness ? { harness } : {}),
  };
}

function formatSseEvent(payload: ProfileSwitchStepEvent | AgentSwitchFinalEvent): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export interface AgentRouteHandlers {
  handleHealth(): Response;
  handleStatus(request: Request): Promise<Response>;
  handleSwitch(request: Request): Promise<Response>;
  handleSwitchEvents(switchId: string, request: Request): Response;
  handleSwitchCancel(switchId: string, request: Request): Response;
}

export function createAgentRouteHandlers(
  token: string,
  port: number,
  deps: AgentRouteDeps = createDefaultAgentRouteDeps(),
): AgentRouteHandlers {
  return {
    handleHealth() {
      return jsonResponse({
        status: "healthy",
        version: PACKAGE_VERSION,
        port,
      });
    },

    async handleStatus(request) {
      const url = new URL(request.url);
      const depthResult = parseStatusDepth(url.searchParams.get("depth"));
      if (depthResult instanceof Response) {
        return depthResult;
      }
      const projectPath = url.searchParams.get("projectPath") ?? undefined;
      const harness = url.searchParams.get("harness") ?? undefined;

      const status = await deps.detectGlobalProfileStatus({
        depth: depthResult,
        ...(projectPath ? { projectPath } : {}),
        ...(harness ? { harness } : {}),
      });

      return jsonResponse(withSwitchingStatus(status, deps));
    },

    async handleSwitch(request) {
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

      const parsed = parseSwitchRequest(body);
      if (parsed instanceof Response) {
        return parsed;
      }

      if (parsed.scope !== "home" && !parsed.projectPath) {
        return jsonResponse(
          {
            error: "missing_project_path",
            message: "projectPath is required when scope is project or both",
          },
          { status: 400 },
        );
      }

      if (deps.isAgentSwitchInProgress()) {
        return jsonResponse(
          { error: "switch_in_progress", message: "Another profile switch is already running" },
          { status: 409 },
        );
      }

      try {
        const preflight = await deps.preflightAgentSwitchOwnedOverwrite(parsed);
        if (preflight.conflict) {
          return jsonResponse(
            {
              error: "owned_overwrite_confirmation_required",
              message: "Owned-path conflicts would be replaced. Set confirmOwnedOverwrite to proceed.",
              conflicts: preflight.summary,
            },
            { status: 409 },
          );
        }

        const started = await deps.startAgentSwitch(parsed);
        return jsonResponse({ id: started.id }, { status: 202 });
      } catch (error) {
        return jsonResponse(
          {
            error: "switch_failed",
            message: error instanceof Error ? error.message : String(error),
          },
          { status: 400 },
        );
      }
    },

    handleSwitchEvents(switchId, request) {
      const session = deps.getAgentSwitchSessionById(switchId);
      if (!session) {
        return jsonResponse({ error: "not_found" }, { status: 404 });
      }

      const encoder = new TextEncoder();
      let unsubscribe = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: ProfileSwitchStepEvent | AgentSwitchFinalEvent) => {
            controller.enqueue(encoder.encode(formatSseEvent(event)));
            if ("type" in event && event.type === "result") {
              unsubscribe();
              controller.close();
            }
          };
          unsubscribe = deps.subscribeAgentSwitchEvents(session, send);
          request.signal.addEventListener("abort", () => {
            unsubscribe();
            controller.close();
          });
        },
        cancel() {
          unsubscribe();
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    },

    handleSwitchCancel(switchId, request) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }

      const session = deps.getAgentSwitchSessionById(switchId);
      if (!session) {
        return jsonResponse({ error: "not_found" }, { status: 404 });
      }

      const result = deps.requestAgentSwitchCancel(session);
      if (!result.accepted) {
        const status = result.reason === "already_done" ? 404 : 409;
        return jsonResponse(
          {
            error: result.reason ?? "cancel_rejected",
            message:
              result.reason === "apply_in_progress"
                ? "Cancel is disabled while an apply step is running"
                : "Switch is already complete",
          },
          { status },
        );
      }

      return jsonResponse({ cancelled: true });
    },
  };
}

export function createAgentFetchHandler(
  token: string,
  port: number,
  deps?: AgentRouteDeps,
): (request: Request) => Response | Promise<Response> {
  const handlers = createAgentRouteHandlers(token, port, deps);

  return (request) => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "GET" && url.pathname === "/v1/health") {
      return handlers.handleHealth();
    }

    if (method === "GET" && url.pathname === "/v1/status") {
      return handlers.handleStatus(request);
    }

    if (method === "POST" && url.pathname === "/v1/switch") {
      return handlers.handleSwitch(request);
    }

    const eventsMatch = url.pathname.match(/^\/v1\/switch\/([^/]+)\/events$/);
    if (method === "GET" && eventsMatch) {
      return handlers.handleSwitchEvents(eventsMatch[1] ?? "", request);
    }

    const cancelMatch = url.pathname.match(/^\/v1\/switch\/([^/]+)\/cancel$/);
    if (method === "POST" && cancelMatch) {
      return handlers.handleSwitchCancel(cancelMatch[1] ?? "", request);
    }

    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }
    }

    return jsonResponse({ error: "not_found" }, { status: 404 });
  };
}
