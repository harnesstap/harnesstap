import { afterEach, describe, expect, it } from "bun:test";
import {
  buildCatalogListSources,
  streamCatalogLayers,
  type CatalogListSource,
} from "../../src/services/catalog-list-stream.js";
import { listCatalogLayersPage } from "../../src/services/catalog-client.js";
import type { CatalogScope, RegisteredCatalog } from "../../src/config/catalog.js";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";

function makeScope(overrides: Partial<CatalogScope> = {}): CatalogScope {
  return {
    defaultOrgSlug: "harnesstap-cloud",
    orgs: ["harnesstap-cloud"],
    selectors: ["harnesstap-cloud/default"],
    cloudBaseUrl: "https://cloud.harnesstap.com",
    ...overrides,
  };
}

async function collectStreamEvents(
  sources: CatalogListSource[],
  opts: Parameters<typeof streamCatalogLayers>[1] = {},
) {
  const events = [];
  for await (const event of streamCatalogLayers(sources, opts)) {
    events.push(event);
  }
  return events;
}

describe("buildCatalogListSources", () => {
  it("includes a scope-wide source from catalog scope", () => {
    const scope = makeScope({
      defaultOrgSlug: "harnesstap-cloud",
      orgs: ["harnesstap-cloud", "acme"],
      selectors: ["harnesstap-cloud/default", "acme/internal"],
    });

    const sources = buildCatalogListSources({ scope, registered: [] });

    expect(sources).toEqual([
      {
        label: "harnesstap-cloud",
        kind: "scope",
        orgs: ["harnesstap-cloud", "acme"],
        selectors: ["harnesstap-cloud/default", "acme/internal"],
      },
    ]);
  });

  it("adds registered catalogs not covered by scope orgs", () => {
    const scope = makeScope();
    const registered: RegisteredCatalog[] = [
      { org: "acme", catalog: "internal" },
      { org: "beta", catalog: "staging" },
    ];

    const sources = buildCatalogListSources({ scope, registered });

    expect(sources).toHaveLength(3);
    expect(sources[1]).toEqual({
      label: "acme/internal",
      kind: "registered",
      orgs: ["acme"],
      catalog: "internal",
    });
    expect(sources[2]).toEqual({
      label: "beta/staging",
      kind: "registered",
      orgs: ["beta"],
      catalog: "staging",
    });
  });

  it("skips registered catalogs whose org is already in scope", () => {
    const scope = makeScope({
      orgs: ["harnesstap-cloud", "acme"],
      selectors: ["harnesstap-cloud/default", "acme/internal"],
    });
    const registered: RegisteredCatalog[] = [
      { org: "acme", catalog: "internal" },
      { org: "beta", catalog: "staging" },
    ];

    const sources = buildCatalogListSources({ scope, registered });

    expect(sources).toHaveLength(2);
    expect(sources[1]).toEqual({
      label: "beta/staging",
      kind: "registered",
      orgs: ["beta"],
      catalog: "staging",
    });
  });

  it("includes account override from registered catalog entry", () => {
    const scope = makeScope();
    const registered: RegisteredCatalog[] = [
      { org: "acme", catalog: "internal", account: "work" },
    ];

    const sources = buildCatalogListSources({ scope, registered });

    expect(sources[1]).toEqual({
      label: "acme/internal",
      kind: "registered",
      orgs: ["acme"],
      catalog: "internal",
      account: "work",
    });
  });
});

describe("listCatalogLayersPage", () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  it("returns paginated layers with nextCursor", async () => {
    restoreFetch = createCatalogFetchMock({
      baseUrl: "https://mock",
      layers: [
        { orgSlug: "harnesstap-cloud", slug: "alpha", name: "Alpha" },
        { orgSlug: "harnesstap-cloud", slug: "beta", name: "Beta" },
        { orgSlug: "harnesstap-cloud", slug: "gamma", name: "Gamma" },
      ],
    });

    const first = await listCatalogLayersPage(
      { orgs: ["harnesstap-cloud"], limit: 1 },
      { baseUrl: "https://mock" },
    );
    expect(first.layers).toHaveLength(1);
    expect(first.layers[0]?.slug).toBe("alpha");
    expect(first.nextCursor).not.toBeNull();

    const second = await listCatalogLayersPage(
      {
        orgs: ["harnesstap-cloud"],
        limit: 1,
        cursor: first.nextCursor,
      },
      { baseUrl: "https://mock" },
    );
    expect(second.layers).toHaveLength(1);
    expect(second.layers[0]?.slug).toBe("beta");
    expect(second.nextCursor).not.toBeNull();

    const third = await listCatalogLayersPage(
      {
        orgs: ["harnesstap-cloud"],
        limit: 1,
        cursor: second.nextCursor,
      },
      { baseUrl: "https://mock" },
    );
    expect(third.layers).toHaveLength(1);
    expect(third.layers[0]?.slug).toBe("gamma");
    expect(third.nextCursor).toBeNull();
  });
});

describe("streamCatalogLayers", () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  it("streams paginated chunks per source", async () => {
    restoreFetch = createCatalogFetchMock({
      baseUrl: "https://mock",
      layers: Array.from({ length: 55 }, (_, index) => ({
        orgSlug: "harnesstap-cloud",
        slug: `layer-${index}`,
        name: `Layer ${index}`,
      })),
    });

    const sources: CatalogListSource[] = [{
      label: "harnesstap-cloud",
      kind: "scope",
      orgs: ["harnesstap-cloud"],
      selectors: ["harnesstap-cloud/default"],
    }];

    const events = await collectStreamEvents(sources, { baseUrl: "https://mock" });

    const chunks = events.filter((event) => event.type === "chunk");
    const done = events.find((event) => event.type === "done");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]?.type === "chunk" && chunks[0].chunk.pageIndex).toBe(0);
    expect(chunks.some((event) =>
      event.type === "chunk" && event.chunk.exhausted,
    )).toBe(true);
    expect(done).toEqual({ type: "done", timedOut: false });
  });

  it("continues other sources when one source fails", async () => {
    restoreFetch = createCatalogFetchMock({
      baseUrl: "https://mock",
      failOrgFilters: ["acme"],
      layers: [
        { orgSlug: "harnesstap-cloud", slug: "team", name: "Team Layer" },
        { orgSlug: "acme", catalogSlug: "internal", slug: "secret", name: "Secret" },
      ],
    });

    const sources: CatalogListSource[] = [
      {
        label: "harnesstap-cloud",
        kind: "scope",
        orgs: ["harnesstap-cloud"],
      },
      {
        label: "acme/internal",
        kind: "registered",
        orgs: ["acme"],
        catalog: "internal",
      },
    ];

    const events = await collectStreamEvents(sources, { baseUrl: "https://mock" });

    expect(events.some((event) =>
      event.type === "error" && event.sourceLabel === "acme/internal",
    )).toBe(true);
    expect(events.some((event) =>
      event.type === "chunk"
      && event.chunk.sourceLabel === "harnesstap-cloud"
      && event.chunk.layers.some((layer) => layer.slug === "team"),
    )).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", timedOut: false });
  });

  it("sets timedOut when deadline elapses before all pages finish", async () => {
    restoreFetch = createCatalogFetchMock({
      baseUrl: "https://mock",
      pageDelayMs: 5,
      layers: Array.from({ length: 100 }, (_, index) => ({
        orgSlug: "harnesstap-cloud",
        slug: `layer-${index}`,
        name: `Layer ${index}`,
      })),
    });

    const sources: CatalogListSource[] = [{
      label: "harnesstap-cloud",
      kind: "scope",
      orgs: ["harnesstap-cloud"],
    }];

    const events = await collectStreamEvents(sources, {
      baseUrl: "https://mock",
      deadlineMs: 1,
    });

    const done = events.find((event) => event.type === "done");
    expect(done).toEqual({ type: "done", timedOut: true });
    const chunks = events.filter((event) => event.type === "chunk");
    expect(chunks.length).toBeLessThan(2);
    expect(chunks.some((event) =>
      event.type === "chunk" && !event.chunk.exhausted,
    )).toBe(true);
  });
});
