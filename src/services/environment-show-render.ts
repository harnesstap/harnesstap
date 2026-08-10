import { getLayerById } from "../models/plugin-model.js";
import type { analyzeEnvironmentGaps } from "./environment-requirements.js";
import type { EnvironmentShowPayload } from "./environment-commands.js";
import { renderPanel } from "../ui/panel.js";
import { renderSubheader } from "../ui/section.js";
import { renderTable } from "../ui/table.js";

function formatLayerLabel(layer: { name: string; version: string }): string {
  return `${layer.name}@${layer.version}`;
}

export type EnvironmentShowRenderOptions = {
  requirementGaps?: ReturnType<typeof analyzeEnvironmentGaps>;
};

export function renderEnvironmentShow(
  payload: EnvironmentShowPayload,
  opts?: EnvironmentShowRenderOptions,
): string {
  const sections: string[] = [
    renderPanel({
      title: ["ENVIRONMENT", payload.environment.name],
      rows: [
        ["Description", payload.environment.description || "—"],
        ["Env vars", `${Object.keys(payload.values.env_vars).length}`],
        ["Model configs", `${payload.values.model_configs.length}`],
        ["Permissions", `${payload.values.permissions.length}`],
        ["Secret refs", `${Object.keys(payload.secret_refs).length}`],
      ],
    }),
  ];

  if (Object.keys(payload.values.env_vars).length > 0) {
    sections.push(
      renderSubheader("ENV VARS"),
      renderTable({
        columns: [
          { key: "key", header: "KEY", width: 28 },
          { key: "value", header: "VALUE", width: 60 },
        ],
        rows: Object.entries(payload.values.env_vars).map(([key, value]) => ({ key, value })),
      }),
    );
  }

  if (payload.values.model_configs.length > 0) {
    sections.push(
      renderSubheader("MODEL CONFIGS"),
      renderTable({
        columns: [
          { key: "name", header: "NAME", width: 24 },
          { key: "model", header: "MODEL", width: 28 },
          { key: "provider", header: "PROVIDER", width: 20 },
        ],
        rows: payload.values.model_configs.map((entry) => ({
          ...entry,
          provider: entry.provider ?? "—",
        })),
      }),
    );
  }

  if (payload.values.permissions.length > 0) {
    sections.push(
      renderSubheader("PERMISSIONS"),
      renderTable({
        columns: [
          { key: "name", header: "NAME", width: 30 },
          { key: "action", header: "ACTION", width: 10 },
          { key: "pattern", header: "PATTERN", width: 38 },
        ],
        rows: payload.values.permissions,
      }),
    );
  }

  if (Object.keys(payload.secret_refs).length > 0) {
    sections.push(
      renderSubheader("SECRET REFS"),
      renderTable({
        columns: [
          { key: "key", header: "KEY", width: 24 },
          { key: "provider", header: "PROVIDER", width: 12 },
          { key: "ref", header: "REF", width: 40 },
        ],
        rows: Object.entries(payload.secret_refs).map(([key, value]) => ({
          key,
          provider: value.provider,
          ref: value.ref,
        })),
      }),
    );
  }

  if (payload.references.layers.length > 0) {
    sections.push(
      renderSubheader("REFERENCES"),
      renderTable({
        columns: [
          { key: "layer", header: "LAYER", width: 40 },
        ],
        rows: payload.references.layers.map((ref) => {
          const layer = getLayerById(ref.id);
          return {
            layer: layer ? formatLayerLabel(layer) : ref.name,
          };
        }),
      }),
    );
  }

  const requirementGaps = opts?.requirementGaps;
  if (requirementGaps !== undefined) {
    sections.push(
      renderSubheader("REQUIREMENT GAPS"),
      renderTable({
        columns: [
          { key: "key", header: "KEY", width: 28 },
          { key: "sources", header: "SOURCES", width: 24 },
          { key: "status", header: "STATUS", width: 12 },
        ],
        rows: requirementGaps.map((gap) => ({
          key: gap.key,
          sources: gap.sources.join(", "),
          status: gap.status,
        })),
        empty: "No requirement gaps found.",
      }),
    );
  }

  return sections.join("\n");
}
