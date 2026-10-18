import {
  getNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "../../services/notifications.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

const ROOT = "/v1/notifications";
const READ_ONE = /^\/v1\/notifications\/([^/]+)\/read$/;

/**
 * GET  /v1/notifications?filter=unread|all&limit=  {items, unread_count}
 * POST /v1/notifications/:id/read                  {item, unread_count}
 * POST /v1/notifications/read-all                  {marked, unread_count}
 * Nothing here deletes a notification.
 */
export async function tryHandle(
  request: Request,
  token: string,
  _deps: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname !== ROOT && !pathname.startsWith(`${ROOT}/`)) return null;
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  if (pathname === ROOT) {
    if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
    const filter = url.searchParams.get("filter") ?? "unread";
    if (filter !== "unread" && filter !== "all") {
      return jsonResponse({ error: "invalid_filter", message: "filter must be unread or all" }, { status: 400 });
    }
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) {
      return jsonResponse({ error: "invalid_limit", message: "limit must be a positive integer" }, { status: 400 });
    }
    return jsonResponse({ items: listNotifications({ filter, limit }), unread_count: unreadNotificationCount() });
  }

  if (pathname === `${ROOT}/read-all`) {
    if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
    const marked = markAllNotificationsRead();
    return jsonResponse({ marked, unread_count: unreadNotificationCount() });
  }

  const match = READ_ONE.exec(pathname);
  if (match) {
    if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
    const id = decodeURIComponent(match[1] ?? "");
    if (!getNotification(id)) return jsonResponse({ error: "not_found" }, { status: 404 });
    return jsonResponse({ item: markNotificationRead(id), unread_count: unreadNotificationCount() });
  }
  return jsonResponse({ error: "not_found" }, { status: 404 });
}
