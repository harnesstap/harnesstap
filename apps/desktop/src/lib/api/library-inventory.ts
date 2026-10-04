import type { LibraryListEntry } from "../library-list";
import type { PluginOrigin } from "./library-plugins";
import { agentFetch, throwAgentError } from "./http";

export const LIBRARY_INVENTORY_PEEK_LIMIT = 40;

type LibraryInventoryWireRow = {
  listKind: LibraryListEntry["listKind"];
  id: string;
  name: string;
  type: string;
  namespace: string | null;
  description: string | null;
  source?: string | null;
  updated_at?: string | null;
  origin_kind?: string | null;
  origin_ref?: string | null;
  version?: string;
  dirty?: boolean;
  pluginOrigin?: PluginOrigin;
  tags?: string[];
  hook?: LibraryListEntry["hook"];
};

export type LibraryInventoryResult = {
  rows: LibraryListEntry[];
  total: number;
  type_counts: Record<string, number>;
  limit?: number;
  offset: number;
};

function mapInventoryRow(row: LibraryInventoryWireRow): LibraryListEntry {
  return {
    ...row,
    originOutdated: false,
  };
}

export async function fetchLibraryInventory(
  baseUrl: string,
  token: string | null,
  input: {
    limit?: number;
    offset?: number;
    q?: string;
    type?: string | null;
    signal?: AbortSignal;
  } = {},
): Promise<LibraryInventoryResult> {
  const params = new URLSearchParams();
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }
  if (input.offset !== undefined) {
    params.set("offset", String(input.offset));
  }
  const q = input.q?.trim();
  if (q) {
    params.set("q", q);
  }
  const type = input.type?.trim();
  if (type) {
    params.set("type", type);
  }
  const qs = params.toString();
  const path = qs.length > 0 ? `/v1/library/inventory?${qs}` : "/v1/library/inventory";
  const response = await agentFetch(baseUrl, token, path, {
    signal: input.signal,
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not load library inventory");
  }
  const body = (await response.json()) as {
    rows: LibraryInventoryWireRow[];
    total: number;
    type_counts: Record<string, number>;
    limit?: number;
    offset: number;
  };
  return {
    rows: body.rows.map(mapInventoryRow),
    total: body.total,
    type_counts: body.type_counts,
    ...(body.limit !== undefined ? { limit: body.limit } : {}),
    offset: body.offset,
  };
}
