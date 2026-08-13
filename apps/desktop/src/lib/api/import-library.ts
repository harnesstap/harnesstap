import { agentFetch, throwAgentError } from "./http";

export type LibraryImportKind = "scan" | "add" | "from_project";
export type LibraryImportConflictPolicy = "skip" | "overwrite";

export interface LibraryImportPreviewItem {
  type: string;
  name: string;
  description?: string;
  category?: string;
  platformId?: string;
  pluginName?: string;
}

export interface LibraryImportConflict {
  type: string;
  name: string;
  platformId?: string;
}

export type LibraryImportRequest =
  | {
      kind: "scan";
      projectPath: string;
      conflictPolicy?: LibraryImportConflictPolicy;
      attachProfile?: string;
    }
  | {
      kind: "add";
      source: string;
      conflictPolicy?: LibraryImportConflictPolicy;
      attachProfile?: string;
    }
  | {
      kind: "from_project";
      projectPath: string;
      name: string;
      description?: string;
      conflictPolicy?: LibraryImportConflictPolicy;
      attachProfile?: string;
    };

export interface LibraryImportPreview {
  kind: LibraryImportKind;
  totalImports: number;
  warnings: string[];
  conflicts: LibraryImportConflict[];
  items: LibraryImportPreviewItem[];
  namespace?: string;
  pluginExists?: boolean;
}

export interface LibraryImportResult {
  kind: LibraryImportKind;
  totalImports: number;
  resourceIds: string[];
  plugin?: { id: string; name: string };
  namespace?: string;
  snapshotId?: string;
  attachedProfile?: string;
}

export async function previewLibraryImport(
  baseUrl: string,
  token: string | null,
  body: LibraryImportRequest,
): Promise<LibraryImportPreview> {
  const response = await agentFetch(baseUrl, token, "/v1/import/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not preview import");
  }
  return (await response.json()) as LibraryImportPreview;
}

export async function commitLibraryImport(
  baseUrl: string,
  token: string | null,
  body: LibraryImportRequest,
): Promise<LibraryImportResult> {
  const response = await agentFetch(baseUrl, token, "/v1/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not import into library");
  }
  return (await response.json()) as LibraryImportResult;
}
