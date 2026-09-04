import { existsSync, readFileSync } from "node:fs";
import { getCloudAccountsPath } from "../config/cloud-accounts.js";
import { PACKAGE_VERSION } from "../version.js";
import { captureEvent, identifyCloudUser } from "./capture.js";
import { isTelemetryEnabled } from "./config.js";
import { detectCliInstallMethod } from "./install-method.js";
import { extractCloudUserId } from "./sanitize.js";
import {
  loadTelemetryState,
  resolveDistinctId,
  updateTelemetryState,
} from "./state.js";
import type { PluginInstallSource, TelemetryProps } from "./types.js";

function peekCloudOrgId(): string | undefined {
  try {
    const path = getCloudAccountsPath();
    if (!existsSync(path)) {
      return undefined;
    }
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
      default_account?: string | null;
      accounts?: Record<string, { orgId?: unknown }>;
    };
    const name = parsed.default_account;
    if (!name || !parsed.accounts) {
      return undefined;
    }
    const orgId = parsed.accounts[name]?.orgId;
    return typeof orgId === "string" && orgId.trim() ? orgId.trim() : undefined;
  } catch {
    return undefined;
  }
}

function withOrgId(props: TelemetryProps, orgId?: string): TelemetryProps {
  const resolved = orgId ?? peekCloudOrgId();
  return resolved ? { ...props, org_id: resolved } : props;
}

export function trackCliStartup(): void {
  try {
    if (!isTelemetryEnabled()) {
      return;
    }
    const state = loadTelemetryState();
    const version = PACKAGE_VERSION;
    if (!state.cli_installed_at) {
      captureEvent("cli_installed", {
        install_method: detectCliInstallMethod(),
        version,
      });
    }
    if (!state.cli_first_run_at) {
      captureEvent("cli_first_run", { version });
    }
    const now = new Date().toISOString();
    updateTelemetryState({
      ...(state.cli_installed_at ? {} : { cli_installed_at: now }),
      ...(state.cli_first_run_at ? {} : { cli_first_run_at: now }),
    });
  } catch {
    // swallow
  }
}

export function trackDesktopStartup(): void {
  try {
    if (!isTelemetryEnabled()) {
      return;
    }
    const state = loadTelemetryState();
    const version = PACKAGE_VERSION;
    captureEvent("desktop_opened", { version });
    if (!state.desktop_installed_at) {
      captureEvent("desktop_installed", { version, os: process.platform });
    }
    if (!state.desktop_first_open_at) {
      captureEvent("desktop_first_open", { version });
    }
    const now = new Date().toISOString();
    updateTelemetryState({
      ...(state.desktop_installed_at ? {} : { desktop_installed_at: now }),
      ...(state.desktop_first_open_at ? {} : { desktop_first_open_at: now }),
    });
  } catch {
    // swallow
  }
}

export function trackCloudConnectStarted(): void {
  captureEvent("cloud_connect_started", {});
}

export function trackCloudConnectFailed(reason: string, errorCode?: string): void {
  captureEvent("cloud_connect_failed", {
    reason,
    ...(errorCode ? { error_code: errorCode } : {}),
  });
}

export function identifyFromCloudWhoami(input: {
  orgId?: string;
  userId?: string;
  whoami?: Record<string, unknown>;
}): string | undefined {
  try {
    const userId = extractCloudUserId(input.whoami, input.userId);
    if (!userId) {
      return undefined;
    }
    const state = loadTelemetryState();
    if (userId !== state.identified_distinct_id) {
      identifyCloudUser(userId, state.distinct_id);
      updateTelemetryState({ identified_distinct_id: userId });
    }
    return userId;
  } catch {
    return undefined;
  }
}

export function trackCloudConnected(input: {
  orgId?: string;
  userId?: string;
  whoami?: Record<string, unknown>;
}): void {
  identifyFromCloudWhoami(input);
  captureEvent("cloud_connected", withOrgId({}, input.orgId));
  captureEvent("signed_in", withOrgId({}, input.orgId));
}

export function trackPluginInstalled(input: {
  pluginSlug: string;
  source: PluginInstallSource;
  orgId?: string;
}): void {
  captureEvent(
    "plugin_installed",
    withOrgId(
      {
        plugin_slug: input.pluginSlug,
        source: input.source,
      },
      input.orgId,
    ),
  );
}

export function trackPluginApplied(input: {
  pluginSlug: string;
  harness?: string;
  orgId?: string;
}): void {
  captureEvent(
    "plugin_applied",
    withOrgId(
      {
        plugin_slug: input.pluginSlug,
        ...(input.harness ? { harness: input.harness } : {}),
      },
      input.orgId,
    ),
  );
}

export function trackPluginUsed(input: {
  pluginSlug: string;
  harness?: string;
  orgId?: string;
}): void {
  captureEvent(
    "plugin_used",
    withOrgId(
      {
        plugin_slug: input.pluginSlug,
        ...(input.harness ? { harness: input.harness } : {}),
      },
      input.orgId,
    ),
  );
}

export { resolveDistinctId };
