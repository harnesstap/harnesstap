import { agentFetch, throwAgentError } from "./http";

export type NotificationFilter = "unread" | "all";

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  plugin_name: string;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

export interface NotificationList {
  items: NotificationItem[];
  unread_count: number;
}

export async function fetchNotifications(
  baseUrl: string,
  token: string | null,
  filter: NotificationFilter,
  limit = 50,
): Promise<NotificationList> {
  const response = await agentFetch(baseUrl, token, `/v1/notifications?filter=${filter}&limit=${limit}`);
  if (!response.ok) return throwAgentError(response, "Could not read notifications");
  return (await response.json()) as NotificationList;
}

export async function markNotificationRead(
  baseUrl: string,
  token: string | null,
  id: string,
): Promise<{ item: NotificationItem; unread_count: number }> {
  const response = await agentFetch(baseUrl, token, `/v1/notifications/${encodeURIComponent(id)}/read`, {
    method: "POST",
  });
  if (!response.ok) return throwAgentError(response, "Could not mark the notification as read");
  return (await response.json()) as { item: NotificationItem; unread_count: number };
}

export async function markAllNotificationsRead(
  baseUrl: string,
  token: string | null,
): Promise<{ marked: number; unread_count: number }> {
  const response = await agentFetch(baseUrl, token, "/v1/notifications/read-all", { method: "POST" });
  if (!response.ok) return throwAgentError(response, "Could not mark notifications as read");
  return (await response.json()) as { marked: number; unread_count: number };
}
