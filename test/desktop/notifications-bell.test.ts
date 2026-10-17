import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { NotificationItem } from "../../apps/desktop/src/lib/api/notifications.ts";
import {
  bellLabel,
  emptyNotificationsText,
  NOTIFICATION_TABS,
  notificationTime,
  unreadBadgeText,
  withRead,
} from "../../apps/desktop/src/lib/notifications-view.ts";

function item(id: string, read_at: string | null = null): NotificationItem {
  return {
    id,
    kind: "update_available",
    title: `${id} 1.1.0 is available`,
    body: "",
    plugin_name: id,
    payload: { version: "1.1.0" },
    created_at: "2026-10-17T11:00:00.000Z",
    read_at,
  };
}

const bellSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/shell/NotificationsBell.tsx"),
  "utf8",
);
const headerSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/shell/AppHeader.tsx"),
  "utf8",
);

describe("notifications bell", () => {
  it("shows no badge at zero and caps it at 99+", () => {
    expect(unreadBadgeText(undefined)).toBe("");
    expect(unreadBadgeText(0)).toBe("");
    expect(unreadBadgeText(7)).toBe("7");
    expect(unreadBadgeText(140)).toBe("99+");
    expect(bellLabel(0)).toBe("Notifications");
    expect(bellLabel(3)).toBe("Notifications (3 unread)");
  });

  it("has Unread and All tabs with their own empty text", () => {
    expect(NOTIFICATION_TABS.map((tab) => tab.label)).toEqual(["Unread", "All"]);
    expect(emptyNotificationsText("unread")).toBe("No unread notifications.");
    expect(emptyNotificationsText("all")).toBe("No notifications yet.");
  });

  it("drops read items from Unread and keeps them, marked, under All", () => {
    const list = [item("a"), item("b"), item("c", "2026-10-17T10:00:00.000Z")];
    expect(withRead(list, "unread", new Set(["a"]), "t").map((n) => n.id)).toEqual(["b", "c"]);
    expect(withRead(list, "unread", "all", "t")).toEqual([]);
    const all = withRead(list, "all", "all", "t");
    expect(all.map((n) => n.read_at)).toEqual(["t", "t", "2026-10-17T10:00:00.000Z"]);
  });

  it("formats the time relative to now", () => {
    expect(notificationTime("2026-10-17T11:00:00.000Z", new Date("2026-10-17T13:00:00.000Z"))).toBe("2 hours ago");
    expect(notificationTime("not a date")).toBe("not a date");
  });

  it("reads the count from status, sits next to Settings, and only marks read", () => {
    expect(bellSource).toContain("state.status?.unread_count");
    expect(bellSource).toContain("Mark all as read");
    expect(bellSource).toContain("Mark as read");
    expect(bellSource).not.toMatch(/method:\s*"DELETE"/);
    expect(headerSource.indexOf("<NotificationsBell")).toBeLessThan(headerSource.indexOf('data-testid="open-settings"'));
  });
});
