import { describe, expect, it, mock } from "bun:test";
import {
  createProfileCloudHandlers,
  type ProfileCloudDeps,
} from "../../src/agent/profile-cloud-handlers.ts";
import {
  createAgentFetchHandler,
  createDefaultAgentRouteDeps,
} from "../../src/agent/routes.ts";
import type { CatalogLayer } from "../../src/services/catalog-types.ts";
import type { Layer } from "../../src/types.ts";

const catalogLayer: CatalogLayer = {
  orgSlug: "acme",
  catalogSlug: "default",
  slug: "focus",
  name: "Focus",
  summary: "A focused profile",
  latestVersion: "2.0.0",
  updatedAt: "2026-07-25T00:00:00.000Z",
  tags: ["profile"],
  visibility: "public",
};

function localLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "layer-1",
    name: "focus",
    version: "2.0.0",
    org_slug: "acme",
    catalog_slug: "default",
    description: "A focused profile",
    tags: ["profile"],
    created_at: "2026-07-25T00:00:00.000Z",
    updated_at: "2026-07-25T00:00:00.000Z",
    ...overrides,
  };
}

function createDeps(overrides: Partial<ProfileCloudDeps> = {}): ProfileCloudDeps {
  let installed = false;
  return {
    resolveAccess: async () => ({ isAuthenticated: true }),
    listLayers: async () => ({ layers: [catalogLayer], nextCursor: null }),
    resolveSelector: async () => ({
      org_slug: "acme",
      catalog_slug: "default",
      layer_slug: "focus",
      version: "2.0.0",
    }),
    installLayer: async () => {
      installed = true;
      return {
        layerId: "layer-1",
        layerName: "focus",
        version: "2.0.0",
        sourceLabel: "acme/default/focus@2.0.0",
      };
    },
    getLayerByName: () => installed ? localLayer() : undefined,
    isProfileLayer: (layer) => layer.tags.includes("profile"),
    tagProfile: () => ({ layer_id: "layer-1", tags: ["profile"] }),
    isSwitchInProgress: () => false,
    ...overrides,
  };
}

function request(
  path: string,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer agent-secret");
  return new Request(`http://127.0.0.1:7474${path}`, { ...init, headers });
}

function postRequest(path: string, body: unknown): Request {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createFetch(deps: ProfileCloudDeps) {
  return createAgentFetchHandler("agent-secret", 7474, {
    ...createDefaultAgentRouteDeps(),
    profileCloudHandlers: createProfileCloudHandlers(deps),
  });
}

describe("agent cloud profile routes", () => {
  it("requires agent bearer auth", async () => {
    const resolveAccess = mock(async () => ({ isAuthenticated: true }));
    const fetch = createFetch(createDeps({ resolveAccess }));

    const response = await fetch(
      new Request("http://127.0.0.1:7474/v1/profiles/cloud"),
    );

    expect(response.status).toBe(401);
    expect(resolveAccess).not.toHaveBeenCalled();
  });

  it("returns auth_required when no cloud token is configured", async () => {
    const fetch = createFetch(createDeps({
      resolveAccess: async () => ({ isAuthenticated: false }),
    }));

    const response = await fetch(request("/v1/profiles/cloud?q=focus"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "auth_required",
      message: expect.any(String),
    });
  });

  it("searches remote catalog layers without a profile tag filter", async () => {
    const listLayers = mock(async () => ({
      layers: [catalogLayer, { ...catalogLayer, slug: "plain", tags: [] }],
      nextCursor: null,
    }));
    const fetch = createFetch(createDeps({ listLayers }));

    const response = await fetch(request("/v1/profiles/cloud?q=focus"));

    expect(response.status).toBe(200);
    expect(listLayers).toHaveBeenCalledWith({
      q: "focus",
      limit: 50,
      sort: "name",
    });
    await expect(response.json()).resolves.toEqual({
      profiles: [
        {
          selector: "acme/default/focus@2.0.0",
          name: "Focus",
          orgSlug: "acme",
          catalogSlug: "default",
          version: "2.0.0",
          tags: ["profile"],
          description: "A focused profile",
        },
        {
          selector: "acme/default/plain@2.0.0",
          name: "Focus",
          orgSlug: "acme",
          catalogSlug: "default",
          version: "2.0.0",
          tags: [],
          description: "A focused profile",
        },
      ],
    });
  });

  it("pulls and auto-tags when the installed layer is not profile-tagged", async () => {
    let installed = false;
    const tagProfile = mock(() => ({ layer_id: "layer-1", tags: ["profile"] }));
    const fetch = createFetch(createDeps({
      installLayer: async () => {
        installed = true;
        return {
          layerId: "layer-1",
          layerName: "focus",
          version: "2.0.0",
          sourceLabel: "acme/default/focus@2.0.0",
        };
      },
      getLayerByName: () => installed ? localLayer({ tags: [] }) : undefined,
      tagProfile,
    }));

    const response = await fetch(postRequest("/v1/profiles/cloud/pull", {
      selector: "acme/default/focus@2.0.0",
    }));

    expect(response.status).toBe(200);
    expect(tagProfile).toHaveBeenCalledWith("focus");
    await expect(response.json()).resolves.toEqual({
      profile: { name: "focus", id: "layer-1" },
      tagged: true,
    });
  });

  it("requires as when the remote name collides with a local layer", async () => {
    const installLayer = mock(createDeps().installLayer);
    const fetch = createFetch(createDeps({
      getLayerByName: () => localLayer(),
      installLayer,
    }));

    const response = await fetch(postRequest("/v1/profiles/cloud/pull", {
      selector: "acme/default/focus",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "name_collision",
      message: expect.any(String),
    });
    expect(installLayer).not.toHaveBeenCalled();
  });

  it("leaves tagged profile use to the desktop switch flow", async () => {
    const fetch = createFetch(createDeps({
      getLayerByName: (name) => name === "renamed" ? localLayer({
        id: "renamed-id",
        name,
      }) : undefined,
      installLayer: async () => ({
        layerId: "renamed-id",
        layerName: "renamed",
        version: "2.0.0",
        sourceLabel: "acme/default/focus@2.0.0",
      }),
    }));

    const response = await fetch(postRequest("/v1/profiles/cloud/pull", {
      selector: "acme/default/focus",
      as: "renamed",
      use: true,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profile: { name: "renamed", id: "renamed-id" },
      tagged: true,
    });
  });

  it("blocks pulls while a profile switch is in progress", async () => {
    const installLayer = mock(createDeps().installLayer);
    const fetch = createFetch(createDeps({
      installLayer,
      isSwitchInProgress: () => true,
    }));

    const response = await fetch(postRequest("/v1/profiles/cloud/pull", {
      selector: "acme/default/focus",
      as: "renamed",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "switch_in_progress",
      message: expect.any(String),
    });
    expect(installLayer).not.toHaveBeenCalled();
  });
});
