import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createAgentFetchHandler,
  createDefaultAgentRouteDeps,
  type AgentRouteDeps,
} from "../../src/agent/routes.ts";
import {
  isAgentSwitchInProgress,
  resetAgentSwitchRegistryForTests,
} from "../../src/agent/switch-registry.ts";
import {
  preflightAgentSwitchOwnedOverwrite,
  resetAgentSwitchDepsForTests,
  setAgentSwitchDepsForTests,
  startAgentSwitch,
} from "../../src/agent/switch-orchestrator.ts";
import { detectGlobalProfileStatus } from "../../src/services/global-profile-drift.ts";
import { switchProfile } from "../../src/services/profile-switch.ts";
import { detectProfileOwnedOverwriteConflicts } from "../../src/services/profile-owned-overwrite.ts";
import { executeProjectUse } from "../../src/services/project-config-use.ts";

const mockDetectOwnedConflicts = mock(detectProfileOwnedOverwriteConflicts);
mockDetectOwnedConflicts.mockImplementation(async () => ({ paths: [], conflicts: [] }));

const mockDetectGlobalProfileStatus = mock(detectGlobalProfileStatus);
mockDetectGlobalProfileStatus.mockImplementation(async () => ({
  active_profile: "demo",
  profile_exists: true,
  applied: true,
  snapshot_id: "snap-1",
  snapshot_at: "2026-01-01T00:00:00.000Z",
  stack_in_sync: true,
  has_drift: false,
  changes: [],
  depth: "fast" as const,
  as_of: "2026-01-01T00:00:00.000Z",
  panel: { status: "green" as const, reasons: [] },
  harnesses: {},
  drift_summary: {
    global: { status: "clean" as const, owned_changes: 0, non_owned_changes: 0 },
  },
}));

const mockSwitchProfile = mock(switchProfile);
mockSwitchProfile.mockImplementation(
  async (
    _selector: string,
    options?: {
      onStep?: (event: {
        step: string;
        status: string;
        profile_name?: string;
      }) => void;
      isCancelled?: () => boolean;
    },
  ) => {
    options?.onStep?.({ step: "validate_baseline", status: "started" });
    if (options?.isCancelled?.()) {
      options.onStep?.({ step: "validate_baseline", status: "cancelled" });
      return { ok: false, cancelled: true, previous_profile: null, events: [] };
    }
    options?.onStep?.({ step: "validate_baseline", status: "completed" });
    options?.onStep?.({ step: "apply_home", status: "started", profile_name: "target" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    options?.onStep?.({ step: "apply_home", status: "completed", profile_name: "target" });
    return {
      ok: true,
      cancelled: false,
      previous_profile: "demo",
      apply: { profile_name: "target" },
      events: [],
    };
  },
);

const mockExecuteProjectUse = mock(executeProjectUse);
mockExecuteProjectUse.mockImplementation(async () => ({
  skipped: false,
  profile_key: "work",
  layer_name: "work-profile",
  profile_name: "work-profile",
  dry_run: false,
  cancelled: false,
  files: [],
  written_files: [],
  skipped_files: [],
  conflicts: [],
  harnesses: ["claude-code"],
}));

function createRouteDeps(): AgentRouteDeps {
  return {
    ...createDefaultAgentRouteDeps(),
    detectGlobalProfileStatus: mockDetectGlobalProfileStatus,
    preflightAgentSwitchOwnedOverwrite,
    startAgentSwitch,
  };
}

describe("agent switch routes", () => {
  const token = "test-token";
  let fetch: (request: Request) => Response | Promise<Response>;

  beforeEach(() => {
    resetAgentSwitchRegistryForTests();
    resetAgentSwitchDepsForTests();
    setAgentSwitchDepsForTests({
      switchProfile: mockSwitchProfile,
      executeProjectUse: mockExecuteProjectUse,
      detectProfileOwnedOverwriteConflicts: mockDetectOwnedConflicts,
    });
    fetch = createAgentFetchHandler(token, 7474, createRouteDeps());
    mockDetectGlobalProfileStatus.mockClear();
    mockSwitchProfile.mockClear();
    mockDetectOwnedConflicts.mockClear();
    mockDetectOwnedConflicts.mockImplementation(async () => ({ paths: [], conflicts: [] }));
  });

  afterEach(() => {
    resetAgentSwitchRegistryForTests();
    resetAgentSwitchDepsForTests();
  });

  it("returns global profile status", async () => {
    const response = await fetch(
      new Request("http://127.0.0.1/v1/status?depth=fast&projectPath=/tmp/demo"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.switching).toBe(false);
    expect(body.active_profile).toBe("demo");
    expect(mockDetectGlobalProfileStatus).toHaveBeenCalledWith({
      depth: "fast",
      projectPath: "/tmp/demo",
    });
  });

  it("marks status as switching while a switch is active", async () => {
    let resolveSwitch: (() => void) | undefined;
    mockSwitchProfile.mockImplementationOnce(async (_selector, options) => {
      options?.onStep?.({ step: "apply_home", status: "started", profile_name: "target" });
      await new Promise<void>((resolve) => {
        resolveSwitch = resolve;
      });
      return {
        ok: true,
        cancelled: false,
        previous_profile: "demo",
        apply: { profile_name: "target" },
        events: [],
      };
    });

    const started = await fetch(
      new Request("http://127.0.0.1/v1/switch", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ persona: "target", scope: "home" }),
      }),
    );
    expect(started.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(isAgentSwitchInProgress()).toBe(true);

    const status = await fetch(new Request("http://127.0.0.1/v1/status"));
    const body = await status.json();
    expect(body.switching).toBe(true);
    expect(body.panel.status).toBe("yellow");
    expect(body.panel.reasons).toContain("switching");

    resolveSwitch?.();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(isAgentSwitchInProgress()).toBe(false);
  });

  it("requires bearer auth for switch and cancel", async () => {
    const unauthorized = await fetch(
      new Request("http://127.0.0.1/v1/switch", {
        method: "POST",
        body: JSON.stringify({ persona: "target", scope: "home" }),
      }),
    );
    expect(unauthorized.status).toBe(401);

    const started = await fetch(
      new Request("http://127.0.0.1/v1/switch", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ persona: "target", scope: "home" }),
      }),
    );
    const { id } = await started.json();

    const cancelUnauthorized = await fetch(
      new Request(`http://127.0.0.1/v1/switch/${id}/cancel`, { method: "POST" }),
    );
    expect(cancelUnauthorized.status).toBe(401);
  });

  it("starts a home switch and streams SSE step events", async () => {
    const started = await fetch(
      new Request("http://127.0.0.1/v1/switch", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ persona: "target", scope: "home" }),
      }),
    );
    expect(started.status).toBe(202);
    const { id } = await started.json();

    const events = await fetch(
      new Request(`http://127.0.0.1/v1/switch/${id}/events`),
    );
    expect(events.status).toBe(200);
    const text = await events.text();
    expect(text).toContain('"step":"validate_baseline"');
    expect(text).toContain('"type":"result"');
    expect(text).toContain('"ok":true');
  });

  it("rejects cancel while apply_home is running", async () => {
    let releaseApply: (() => void) | undefined;
    mockSwitchProfile.mockImplementationOnce(async (_selector, options) => {
      options?.onStep?.({ step: "apply_home", status: "started", profile_name: "target" });
      await new Promise<void>((resolve) => {
        releaseApply = resolve;
      });
      options?.onStep?.({ step: "apply_home", status: "completed", profile_name: "target" });
      return {
        ok: true,
        cancelled: false,
        previous_profile: "demo",
        apply: { profile_name: "target" },
        events: [],
      };
    });

    const started = await fetch(
      new Request("http://127.0.0.1/v1/switch", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ persona: "target", scope: "home" }),
      }),
    );
    const { id } = await started.json();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const cancel = await fetch(
      new Request(`http://127.0.0.1/v1/switch/${id}/cancel`, {
        method: "POST",
        headers: { authorization: "Bearer test-token" },
      }),
    );
    expect(cancel.status).toBe(409);

    releaseApply?.();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  it("cancels between orchestrator steps", async () => {
    let releaseApply: (() => void) | undefined;
    mockSwitchProfile.mockImplementationOnce(async (_selector, options) => {
      options?.onStep?.({ step: "validate_baseline", status: "started" });
      options?.onStep?.({ step: "validate_baseline", status: "completed" });
      await new Promise<void>((resolve) => {
        releaseApply = resolve;
      });
      if (options?.isCancelled?.()) {
        options.onStep?.({ step: "apply_home", status: "cancelled", profile_name: "target" });
        return { ok: false, cancelled: true, previous_profile: "demo", events: [] };
      }
      options?.onStep?.({ step: "apply_home", status: "started", profile_name: "target" });
      options?.onStep?.({ step: "apply_home", status: "completed", profile_name: "target" });
      return {
        ok: true,
        cancelled: false,
        previous_profile: "demo",
        apply: { profile_name: "target" },
        events: [],
      };
    });

    const started = await fetch(
      new Request("http://127.0.0.1/v1/switch", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ persona: "target", scope: "home" }),
      }),
    );
    const { id } = await started.json();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const cancel = await fetch(
      new Request(`http://127.0.0.1/v1/switch/${id}/cancel`, {
        method: "POST",
        headers: { authorization: "Bearer test-token" },
      }),
    );
    expect(cancel.status).toBe(200);

    releaseApply?.();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const events = await fetch(
      new Request(`http://127.0.0.1/v1/switch/${id}/events`),
    );
    const text = await events.text();
    expect(text).toContain('"status":"cancelled"');
    expect(text).toContain('"cancelled":true');
  });

  it("returns 409 when owned overwrite confirmation is required", async () => {
    setAgentSwitchDepsForTests({
      detectProfileOwnedOverwriteConflicts: mock(async () => ({
        paths: [".claude/skills/demo/SKILL.md"],
        conflicts: [
          {
            path: ".claude/skills/demo/SKILL.md",
            owners: [
              {
                snapshot_id: "snap-old",
                platform_id: "claude-code",
                plugin_name: "demo",
              },
            ],
          },
        ],
      })),
    });
    fetch = createAgentFetchHandler(token, 7474, createRouteDeps());

    const response = await fetch(
      new Request("http://127.0.0.1/v1/switch", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ persona: "target", scope: "home" }),
      }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "owned_overwrite_confirmation_required",
      conflicts: {
        paths: [".claude/skills/demo/SKILL.md"],
      },
    });
  });

  it("requires projectPath for project scope", async () => {
    const response = await fetch(
      new Request("http://127.0.0.1/v1/switch", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ persona: "work", scope: "project" }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
