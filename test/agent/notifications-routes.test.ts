import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/notifications.ts";
import { addNotification, listNotifications } from "../../src/services/notifications.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

const TOKEN = "test-token";
let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("notifications-routes-");
});

afterEach(async () => {
  await ctx.cleanup();
});

async function handle(method: string, path: string, token: string | null = TOKEN): Promise<Response> {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await tryHandle(new Request(`http://127.0.0.1${path}`, { method, headers }), TOKEN, {});
  if (!response) throw new Error(`no route for ${method} ${path}`);
  return response;
}

function seed(): string[] {
  return ["a", "b", "c"].map(
    (name) => addNotification({ kind: "update_available", plugin_name: name, title: `${name} 1.1.0 is available`, payload: { version: "1.1.0" } })!.id,
  );
}

describe("notifications API", () => {
  it("leaves other paths alone and needs the token", async () => {
    expect(await tryHandle(new Request("http://127.0.0.1/v1/updates"), TOKEN, {})).toBeNull();
    expect(await tryHandle(new Request("http://127.0.0.1/v1/notificationsx"), TOKEN, {})).toBeNull();
    expect((await handle("GET", "/v1/notifications", null)).status).toBe(401);
  });

  it("lists unread by default, all on request, with unread_count and a limit", async () => {
    const [a] = seed();
    await handle("POST", `/v1/notifications/${a}/read`);
    const unread = (await (await handle("GET", "/v1/notifications")).json()) as { items: { id: string }[]; unread_count: number };
    expect(unread.items).toHaveLength(2);
    expect(unread.unread_count).toBe(2);
    const all = (await (await handle("GET", "/v1/notifications?filter=all")).json()) as { items: unknown[] };
    expect(all.items).toHaveLength(3);
    const limited = (await (await handle("GET", "/v1/notifications?filter=all&limit=1")).json()) as { items: unknown[] };
    expect(limited.items).toHaveLength(1);
    expect((await handle("GET", "/v1/notifications?filter=new")).status).toBe(400);
    expect((await handle("GET", "/v1/notifications?limit=0")).status).toBe(400);
  });

  it("marks one as read, 404s an unknown id, and marks all as read without deleting", async () => {
    const [a] = seed();
    const one = (await (await handle("POST", `/v1/notifications/${a}/read`)).json()) as {
      item: { id: string; read_at: string | null };
      unread_count: number;
    };
    expect(one.item.id).toBe(a!);
    expect(one.item.read_at).toBeTruthy();
    expect(one.unread_count).toBe(2);
    expect((await handle("POST", "/v1/notifications/nope/read")).status).toBe(404);
    expect((await handle("GET", `/v1/notifications/${a}/read`)).status).toBe(405);
    const all = (await (await handle("POST", "/v1/notifications/read-all")).json()) as { marked: number; unread_count: number };
    expect(all).toEqual({ marked: 2, unread_count: 0 });
    expect(listNotifications({ filter: "all" })).toHaveLength(3);
    expect((await handle("DELETE", "/v1/notifications")).status).toBe(405);
  });
});
