import {
  publishCatalogKey,
  type CatalogScope,
  type RegisteredCatalog,
} from "../config/catalog.js";
import { listCatalogLayersPage } from "./catalog-client.js";
import type { CatalogLayer } from "./catalog-types.js";
import { formatCatalogRequestError } from "./transport/fetch-with-timeout.js";

export type CatalogListSourceKind = "scope" | "registered";

export interface CatalogListSource {
  label: string;
  kind: CatalogListSourceKind;
  orgs?: string[];
  selectors?: string[];
  catalog?: string;
  account?: string;
}

export interface CatalogListChunk {
  sourceLabel: string;
  layers: CatalogLayer[];
  pageIndex: number;
  exhausted: boolean;
}

export type CatalogListStreamEvent =
  | { type: "chunk"; chunk: CatalogListChunk }
  | { type: "error"; sourceLabel: string; message: string }
  | { type: "done"; timedOut: boolean };

export interface StreamCatalogLayersOptions {
  q?: string;
  tag?: string;
  sort?: "updated" | "name";
  baseUrl?: string;
  deadlineMs?: number;
}

const visibilityRank = { organization: 3, shared: 2, public: 1 } as const;

function catalogLayerKey(layer: CatalogLayer): string {
  return `${layer.orgSlug}/${layer.catalogSlug}/${layer.slug}`;
}

function dedupePageLayers(
  layers: CatalogLayer[],
  seen: Map<string, CatalogLayer>,
): CatalogLayer[] {
  const result: CatalogLayer[] = [];
  for (const layer of layers) {
    const key = catalogLayerKey(layer);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, layer);
      result.push(layer);
      continue;
    }
    if (visibilityRank[layer.visibility] > visibilityRank[existing.visibility]) {
      seen.set(key, layer);
      result.push(layer);
    }
  }
  return result;
}

type QueueItem =
  | { type: "chunk"; chunk: CatalogListChunk }
  | { type: "error"; sourceLabel: string; message: string };

export async function* streamCatalogLayers(
  sources: CatalogListSource[],
  opts: StreamCatalogLayersOptions = {},
): AsyncGenerator<CatalogListStreamEvent> {
  const deadlineMs = opts.deadlineMs ?? 30_000;
  const deadline = Date.now() + deadlineMs;
  const pageSize = opts.q?.trim() ? 25 : 50;
  const seen = new Map<string, CatalogLayer>();

  const queue: QueueItem[] = [];
  let pendingSources = sources.length;
  let timedOut = false;
  let notify: (() => void) | null = null;

  function enqueue(item: QueueItem) {
    queue.push(item);
    notify?.();
    notify = null;
  }

  function sourceFinished() {
    pendingSources -= 1;
    notify?.();
    notify = null;
  }

  function isPastDeadline(): boolean {
    if (Date.now() >= deadline) {
      timedOut = true;
      return true;
    }
    return false;
  }

  async function fetchSource(source: CatalogListSource) {
    let cursor: string | null = null;
    let pageIndex = 0;

    try {
      while (!isPastDeadline()) {
        const result = await listCatalogLayersPage(
          {
            q: opts.q,
            tag: opts.tag,
            sort: opts.sort,
            orgs: source.orgs,
            selectors: source.selectors,
            catalog: source.catalog,
            limit: pageSize,
            cursor,
          },
          {
            ...(source.account ? { account: source.account } : {}),
            ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
          },
        );

        const layers = dedupePageLayers(result.layers, seen);
        const exhausted = result.nextCursor === null;
        enqueue({
          type: "chunk",
          chunk: {
            sourceLabel: source.label,
            layers,
            pageIndex,
            exhausted,
          },
        });

        if (exhausted) break;
        cursor = result.nextCursor;
        pageIndex += 1;
      }
    } catch (error) {
      const message = formatCatalogRequestError(error);
      enqueue({ type: "error", sourceLabel: source.label, message });
    } finally {
      sourceFinished();
    }
  }

  for (const source of sources) {
    void fetchSource(source);
  }

  while (pendingSources > 0 || queue.length > 0) {
    if (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) {
        continue;
      }
      switch (item.type) {
        case "chunk":
          yield { type: "chunk", chunk: item.chunk };
          break;
        case "error":
          yield { type: "error", sourceLabel: item.sourceLabel, message: item.message };
          break;
        default: {
          const _exhaustive: never = item;
          throw new Error(`Unhandled queue item: ${String(_exhaustive)}`);
        }
      }
      continue;
    }

    if (pendingSources === 0) break;

    await new Promise<void>((resolve) => {
      notify = resolve;
    });
  }

  yield { type: "done", timedOut };
}

export async function listCatalogLayersFromSources(
  sources: CatalogListSource[],
  opts: StreamCatalogLayersOptions & { limit?: number },
): Promise<{ layers: CatalogLayer[]; timedOut: boolean }> {
  const limit = opts.limit ?? (opts.q?.trim() ? 25 : 50);
  const collected: CatalogLayer[] = [];
  const seen = new Set<string>();
  let timedOut = false;

  for await (const event of streamCatalogLayers(sources, opts)) {
    switch (event.type) {
      case "chunk": {
        for (const layer of event.chunk.layers) {
          const key = catalogLayerKey(layer);
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          collected.push(layer);
          if (collected.length >= limit) {
            return { layers: collected, timedOut };
          }
        }
        break;
      }
      case "error":
        break;
      case "done":
        timedOut = event.timedOut;
        break;
      default: {
        const neverEvent: never = event;
        throw new Error(`Unhandled catalog stream event: ${String(neverEvent)}`);
      }
    }
  }

  return { layers: collected, timedOut };
}

export function buildCatalogListSources(input: {
  scope: CatalogScope;
  registered: RegisteredCatalog[];
}): CatalogListSource[] {
  const scopeOrgs = new Set(input.scope.orgs.map((o) => o.toLowerCase()));
  const sources: CatalogListSource[] = [
    {
      label: input.scope.defaultOrgSlug,
      kind: "scope",
      orgs: [...input.scope.orgs],
      selectors: [...input.scope.selectors],
    },
  ];

  const seenRegistered = new Set<string>();
  for (const entry of input.registered) {
    const key = publishCatalogKey(entry);
    if (seenRegistered.has(key)) continue;
    seenRegistered.add(key);
    if (scopeOrgs.has(entry.org.toLowerCase())) continue;
    sources.push({
      label: `${entry.org}/${entry.catalog}`,
      kind: "registered",
      orgs: [entry.org],
      catalog: entry.catalog,
      ...(entry.account ? { account: entry.account } : {}),
    });
  }
  return sources;
}
