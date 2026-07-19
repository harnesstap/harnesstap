import type { ResourceExport } from "../../types.js";
import {
  RESOURCE_SCHEMA,
  RESOURCE_SCHEMA_VERSION,
} from "../../types.js";
import { parseTransportToml } from "./read.js";
import { readSchemaHeader } from "./validate.js";
import { formatTransportToml } from "./write.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseMetadata(value: unknown): ResourceExport["metadata"] {
  if (isRecord(value)) {
    return value as ResourceExport["metadata"];
  }
  return {};
}

function resourceExportFromTomlDocument(
  document: Record<string, unknown>,
): ResourceExport {
  const metadata = parseMetadata(document.metadata);
  return {
    $schema: RESOURCE_SCHEMA,
    version: RESOURCE_SCHEMA_VERSION,
    type: String(document.type ?? "") as ResourceExport["type"],
    name: String(document.name ?? ""),
    namespace: String(document.namespace ?? ""),
    description: String(document.description ?? ""),
    content: String(document.content ?? ""),
    metadata,
    origin_kind: (document.origin_kind ?? "manual") as ResourceExport["origin_kind"],
    origin_ref: String(document.origin_ref ?? ""),
    content_hash: String(document.content_hash ?? ""),
    content_blob_ref: String(document.content_blob_ref ?? ""),
  };
}

function resourceExportToTomlDocument(
  exportDoc: ResourceExport,
): Record<string, unknown> {
  const document: Record<string, unknown> = {
    schema: RESOURCE_SCHEMA,
    version: RESOURCE_SCHEMA_VERSION,
    type: exportDoc.type,
    name: exportDoc.name,
    namespace: exportDoc.namespace,
    description: exportDoc.description,
    content: exportDoc.content,
    origin_kind: exportDoc.origin_kind,
    origin_ref: exportDoc.origin_ref,
  };
  if (exportDoc.content_hash) {
    document.content_hash = exportDoc.content_hash;
  }
  if (exportDoc.content_blob_ref) {
    document.content_blob_ref = exportDoc.content_blob_ref;
  }
  if (exportDoc.metadata && Object.keys(exportDoc.metadata).length > 0) {
    document.metadata = exportDoc.metadata;
  }
  return document;
}

export function parseResourceExportToml(raw: string): ResourceExport {
  const document = parseTransportToml(raw, "resource export");
  const { schema, version } = readSchemaHeader(document);
  if (schema !== RESOURCE_SCHEMA) {
    throw new Error(`Expected ${RESOURCE_SCHEMA}, got ${schema}`);
  }
  if (version !== RESOURCE_SCHEMA_VERSION) {
    throw new Error(`Unsupported resource export version: ${version}`);
  }
  return resourceExportFromTomlDocument(document);
}

export function formatResourceExportToml(exportDoc: ResourceExport): string {
  const header = [
    "# HarnessTap resource export",
    `# Resource: ${exportDoc.type}:${exportDoc.name}${exportDoc.namespace ? `@${exportDoc.namespace}` : ""}`,
    `# Generated at: ${new Date().toISOString()}`,
    "",
  ].join("\n");
  return `${header}${formatTransportToml(resourceExportToTomlDocument(exportDoc))}`;
}
