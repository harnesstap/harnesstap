import { kvBlock, panel } from "./panel.js";
import { subheader } from "./section.js";
import { table } from "./table.js";
import { theme } from "./theme.js";
import * as format from "./format.js";
import { status } from "./status.js";
import {
  formatDriftStatusLabel,
  formatResourceTypeSummary,
  type ProjectStatusPayload,
} from "../services/project-status-payload.js";
import type { ProjectScanComparisonStatus } from "../services/project-scan-status.js";

function formatLayerLabel(layer: { name: string; version: string }): string {
  return `${layer.name}@${layer.version}`;
}

function formatResourceCountLine(count: number, summary: string): string {
  if (count === 0) {
    return "0 resources";
  }
  return summary.length > 0 ? `${count} resources (${summary})` : `${count} resources`;
}

function formatScanStatusLabel(status: ProjectScanComparisonStatus, payload: ProjectStatusPayload): string {
  const { comparison } = payload.project_resources;
  switch (status) {
    case "no_harness_files":
      return "no harness files";
    case "not_scanned":
      return "not scanned";
    case "up_to_date":
      return "up to date";
    case "stale": {
      const parts: string[] = [];
      if (comparison.new_count > 0) {
        parts.push(`+${comparison.new_count} new`);
      }
      if (comparison.changed_count > 0) {
        parts.push(`${comparison.changed_count} changed`);
      }
      if (comparison.removed_count > 0) {
        parts.push(`${comparison.removed_count} removed`);
      }
      return parts.length > 0 ? `stale (${parts.join(", ")})` : "stale";
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function formatScanHint(payload: ProjectStatusPayload): string | undefined {
  const { comparison } = payload.project_resources;
  if (comparison.status === "no_harness_files") {
    return "Scans project files on disk, not harness setup — see `hd harness status`";
  }
  if (comparison.status === "not_scanned" || comparison.status === "stale") {
    return "run `hd scan` to import";
  }
  return undefined;
}

export function renderProjectStatusHuman(payload: ProjectStatusPayload): void {
  panel({
    title: ["PROJECT"],
    rows: [
      ["Root", payload.project_root],
      ["Git origin", payload.git_origin_raw ?? "(none)"],
      ["Platforms", payload.platforms.join(", ") || "(none detected)"],
      ["Drift", formatDriftStatusLabel(payload.project, payload.drift)],
    ],
  });

  const profileRows: [string, string][] = [["Active", payload.profile.active_profile ?? "(none)"]];
  if (payload.profile.warning) {
    profileRows.push(["Warning", payload.profile.warning]);
  } else if (payload.profile.stack_summary) {
    profileRows.push([
      "Stack",
      formatResourceCountLine(
        payload.profile.stack_resource_count,
        payload.profile.stack_summary,
      ),
    ]);
  }
  panel({ title: ["PROFILE"], rows: profileRows });

  subheader("APPLIED LAYERS");
  if (payload.applied_layers.length === 0) {
    console.log("  (none applied)");
    status.dim("  Run `hd layer apply <layer>` or `hd deck apply <deck>`");
    if (payload.deck_hint) {
      status.hint(payload.deck_hint);
    }
  } else {
    for (const row of payload.applied_layers) {
      const summary = formatResourceCountLine(row.resource_count, row.resource_summary);
      console.log(`  ${theme.accent(formatLayerLabel(row.layer))}  ${summary}`);
      const meta = [
        row.platforms.join(", ") || "(no platforms)",
        format.formatRelativeTime(row.applied_at),
      ].join(" · ");
      console.log(`  ${theme.muted(meta)}`);
    }
  }

  const resolvedRows: [string, string][] = [
    [
      "Total",
      formatResourceCountLine(payload.resolved.resource_count, payload.resolved.resource_summary),
    ],
    [
      "Environment",
      `${payload.resolved.environment_vars} vars · ${payload.resolved.environment_secrets} secrets`,
    ],
  ];
  if (payload.resolved.plugin_pins.length > 0) {
    resolvedRows.splice(1, 0, [
      "Plugin pins",
      `${payload.resolved.plugin_pins.length} pinned`,
    ]);
  }
  panel({ title: ["RESOLVED"], rows: resolvedRows });

  subheader("PROJECT RESOURCES");
  const onDiskSummary = formatResourceTypeSummary(payload.project_resources.on_disk.resources);
  const inLibraryCount = payload.project_resources.in_library.resources.length;
  const inLibrarySummary = formatResourceTypeSummary(
    payload.project_resources.in_library.resources,
  );
  kvBlock([
    {
      key: "On disk",
      value: formatResourceCountLine(
        payload.project_resources.on_disk.resources.length,
        onDiskSummary,
      ),
    },
    {
      key: "In library",
      value: inLibraryCount === 0
        ? "0 resources (not scanned)"
        : formatResourceCountLine(inLibraryCount, inLibrarySummary),
    },
  ], { keyWidth: 14 });

  subheader("SCAN");
  const scanStatus = formatScanStatusLabel(payload.project_resources.comparison.status, payload);
  const scanHint = formatScanHint(payload);
  kvBlock([
    { key: "Status", value: scanStatus },
    ...(scanHint ? [{ key: "Hint", value: scanHint }] : []),
  ], { keyWidth: 14 });

  if (payload.resolved.plugin_pins.length > 0) {
    subheader("PLUGIN PINS");
    table.print({
      columns: [
        { key: "ref", header: "REF", width: 28 },
        { key: "constraint", header: "CONSTRAINT", width: 16 },
        { key: "status", header: "STATUS", width: 14 },
      ],
      rows: payload.resolved.plugin_pins.map((pin) => ({
        ref: pin.ref,
        constraint: pin.version_constraint || "—",
        status: pin.status,
      })),
    });
  }
}

export function projectStatusPayloadToJson(payload: ProjectStatusPayload): Record<string, unknown> {
  return {
    project_root: payload.project_root,
    git_origin: payload.git_origin,
    platforms: payload.platforms,
    environment_cascade: payload.environment_cascade,
    drift: payload.drift,
    profile: {
      active_profile: payload.profile.active_profile,
      stack_summary: payload.profile.stack_summary,
      ...(payload.profile.warning ? { warning: payload.profile.warning } : {}),
    },
    applied_layers: payload.applied_layers.map((row) => ({
      name: row.layer.name,
      version: row.layer.version,
      resource_count: row.resource_count,
      resource_summary: row.resource_summary,
      platforms: row.platforms,
      applied_at: row.applied_at,
    })),
    resolved: {
      resource_count: payload.resolved.resource_count,
      resource_summary: payload.resolved.resource_summary,
      plugin_pins: payload.resolved.plugin_pins,
      environment_vars: payload.resolved.environment_vars,
      environment_secrets: payload.resolved.environment_secrets,
    },
    project_resources: payload.project_resources,
    ...(payload.project
      ? {
          applied_layers_count: payload.applied_layers.length,
          snapshots: payload.snapshots_count,
        }
      : {}),
    ...(payload.deck_hint ? { deck_hint: payload.deck_hint } : {}),
  };
}
