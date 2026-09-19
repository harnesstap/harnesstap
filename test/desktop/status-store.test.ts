import { describe, expect, it } from "bun:test";
import type {
  GlobalProfileStatus,
  ProfileApplyPreview,
  ProfileSummary,
} from "../../apps/desktop/src/lib/types.ts";
import {
  createStatusStore,
  type PreviewKey,
  previewKeyId,
  type StatusFetchers,
} from "../../apps/desktop/src/state/status-store.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function status(activeProfile: string, overrides: Partial<GlobalProfileStatus> = {}): GlobalProfileStatus {
  return {
    active_profile: activeProfile,
    profile_exists: true,
    applied: true,
    snapshot_id: null,
    snapshot_at: null,
    stack_in_sync: true,
    has_drift: false,
    depth: "full",
    as_of: "2026-01-01T00:00:00.000Z",
    panel: { status: "green", reasons: [] },
    harnesses: {},
    ...overrides,
  };
}

function preview(profile: string): ProfileApplyPreview {
  return { profile, scope: "home", contents: null, untracked_resources: [] };
}

function profiles(...names: string[]): ProfileSummary[] {
  return names.map((name) => ({ name }) as ProfileSummary);
}

const unused = () => Promise.reject(new Error("not used in this test"));

function storeWith(overrides: Partial<StatusFetchers>) {
  const store = createStatusStore({
    fetchStatus: unused,
    fetchProfiles: unused,
    fetchProfileStash: unused,
    fetchApplyPreview: unused,
    ...overrides,
  });
  store.setClient({ baseUrl: "http://127.0.0.1:7474", token: "t" });
  return store;
}

const globalKey: PreviewKey = { scope: "global", projectPath: null, profile: "work" };

describe("status store generation counter", () => {
  it("drops a late response when a newer request for the same key resolved first", async () => {
    const first = deferred<GlobalProfileStatus>();
    const second = deferred<GlobalProfileStatus>();
    const calls: Deferred<GlobalProfileStatus>[] = [first, second];
    const store = storeWith({
      fetchStatus: () => calls.shift()?.promise ?? unused(),
    });

    const firstRequest = store.refreshStatus("full", "");
    const secondRequest = store.refreshStatus("full", "");

    second.resolve(status("newer"));
    expect(await secondRequest).toBe(true);
    expect(store.getState().status?.active_profile).toBe("newer");

    first.resolve(status("stale"));
    expect(await firstRequest).toBe(false);
    expect(store.getState().status?.active_profile).toBe("newer");
  });

  it("keeps fast and full status requests on separate keys so neither drops the other", async () => {
    const full = deferred<GlobalProfileStatus>();
    const fast = deferred<GlobalProfileStatus>();
    const store = storeWith({
      fetchStatus: (_baseUrl, depth) => (depth === "full" ? full.promise : fast.promise),
    });

    const fullRequest = store.refreshStatus("full", "");
    const fastRequest = store.refreshStatus("fast", "");
    fast.resolve(status("fast", { depth: "fast", harnesses: {} }));
    await fastRequest;
    full.resolve(
      status("full", { harnesses: { cursor: { plugins: [], mcp: [] } } }),
    );
    expect(await fullRequest).toBe(true);
    expect(store.getState().harnessSnapshotComplete).toBe(true);
    expect(Object.keys(store.getState().status?.harnesses ?? {})).toEqual(["cursor"]);
  });

  it("ignores a stale preview response after a direct write for the same key", async () => {
    const pending = deferred<ProfileApplyPreview>();
    const store = storeWith({ fetchApplyPreview: () => pending.promise });

    const load = store.loadPreview(globalKey);
    store.setPreview(globalKey, preview("written"));
    pending.resolve(preview("stale"));
    expect(await load).toBeNull();
    expect(store.getState().previews[previewKeyId(globalKey)]?.data?.profile).toBe("written");
  });

  it("invalidates every in-flight request when aborted", async () => {
    const pending = deferred<ProfileSummary[]>();
    const store = storeWith({ fetchProfiles: () => pending.promise });
    const request = store.refreshProfiles("");
    expect(store.getState().profilesRefreshing).toBe(true);
    store.abortInFlight();
    pending.resolve(profiles("late"));
    await request;
    expect(store.getState().profiles).toEqual([]);
    expect(store.getState().profilesRefreshing).toBe(false);
  });
});

describe("status store never nulls a held value on refetch", () => {
  it("keeps the previous status visible and flags refreshing while a poll is in flight", async () => {
    const calls: Deferred<GlobalProfileStatus>[] = [deferred(), deferred()];
    let index = 0;
    const store = storeWith({ fetchStatus: () => calls[index++]!.promise });

    const first = store.refreshStatus("full", "");
    calls[0]!.resolve(status("held"));
    await first;

    const second = store.refreshStatus("full", "");
    expect(store.getState().statusRefreshing).toBe(true);
    expect(store.getState().status?.active_profile).toBe("held");

    calls[1]!.resolve(status("replaced"));
    await second;
    expect(store.getState().statusRefreshing).toBe(false);
    expect(store.getState().status?.active_profile).toBe("replaced");
  });

  it("keeps the previous apply preview while reloading and after a failed reload", async () => {
    const calls: Deferred<ProfileApplyPreview>[] = [deferred(), deferred(), deferred()];
    let index = 0;
    const store = storeWith({ fetchApplyPreview: () => calls[index++]!.promise });
    const id = previewKeyId(globalKey);

    const first = store.loadPreview(globalKey);
    expect(store.getState().previews[id]).toEqual({ data: null, error: null, refreshing: true });
    calls[0]!.resolve(preview("work"));
    await first;

    const second = store.loadPreview(globalKey);
    expect(store.getState().previews[id]?.refreshing).toBe(true);
    expect(store.getState().previews[id]?.data?.profile).toBe("work");
    calls[1]!.resolve(preview("work"));
    await second;

    const third = store.loadPreview(globalKey);
    calls[2]!.reject(new Error("agent offline"));
    await third;
    expect(store.getState().previews[id]).toEqual({
      data: preview("work"),
      error: "agent offline",
      refreshing: false,
    });
  });

  it("keeps the previous profiles list when a refetch fails", async () => {
    const calls: Deferred<ProfileSummary[]>[] = [deferred(), deferred()];
    let index = 0;
    const store = storeWith({ fetchProfiles: () => calls[index++]!.promise });

    const first = store.refreshProfiles("");
    calls[0]!.resolve(profiles("work", "home"));
    await first;

    const second = store.refreshProfiles("");
    calls[1]!.reject(new Error("boom"));
    await second;
    expect(store.getState().profiles.map((profile) => profile.name)).toEqual(["work", "home"]);
    expect(store.getState().profilesError).toBe("boom");
    expect(store.getState().profilesRefreshing).toBe(false);
  });

  it("resets the harness snapshot flag only when the agent base URL changes", async () => {
    const store = storeWith({ fetchStatus: () => Promise.resolve(status("work")) });
    await store.refreshStatus("full", "");
    expect(store.getState().harnessSnapshotComplete).toBe(true);

    store.setClient({ baseUrl: "http://127.0.0.1:7474", token: "rotated" });
    expect(store.getState().harnessSnapshotComplete).toBe(true);

    store.setClient({ baseUrl: "http://127.0.0.1:7500", token: "rotated" });
    expect(store.getState().harnessSnapshotComplete).toBe(false);
  });
});
