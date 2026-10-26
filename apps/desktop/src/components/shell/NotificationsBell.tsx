import { useCallback, useEffect, useState } from "react";
import { Bell, Check, CheckCheck } from "lucide-react";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationFilter,
  type NotificationItem,
} from "../../lib/api/notifications";
import {
  bellLabel,
  emptyNotificationsText,
  NOTIFICATION_TABS,
  notificationTime,
  seenKeysFor,
  unreadBadgeText,
  withRead,
} from "../../lib/notifications-view";
import { useOverlayLayer } from "../../state/overlay-stack";
import { markUpdatesSeen } from "../../state/update-seen-store";
import { useStatusStore } from "../../state/status-store";
import { toast } from "../../state/toast-store";
import { ChromeTooltip } from "../ChromeTooltip";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

/** Clears the header bar so the popover sits below the bell, not over its neighbours (P2-20). */
export const NOTIFICATIONS_POPOVER_OFFSET_PX = 14;

const HEADER_ICON_SIZE = 18;

export interface NotificationsBellProps {
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  /** Clicking a row opens the profile (or plugin) it is about. */
  onOpen?: (pluginName: string) => void;
}

/** Header bell. The count comes from the status payload; the list loads on open. */
export function NotificationsBell({ baseUrl, token, disabled = false, onOpen }: NotificationsBellProps) {
  const statusCount = useStatusStore((state) => state.status?.unread_count);
  // After a mark-read the count is known before the next status poll.
  const [override, setOverride] = useState<number | null>(null);
  useEffect(() => setOverride(null), [statusCount]);
  const count = override ?? statusCount ?? 0;

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("unread");
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const contentRef = useOverlayLayer<HTMLDivElement>({ open, onClose: () => setOpen(false), trapFocus: false });

  const load = useCallback(
    async (next: NotificationFilter) => {
      if (!baseUrl) return;
      try {
        const list = await fetchNotifications(baseUrl, token, next);
        setItems(list.items);
        setOverride(list.unread_count);
      } catch (error) {
        setItems([]);
        toast({ tone: "error", title: error instanceof Error ? error.message : "Could not read notifications" });
      }
    },
    [baseUrl, token],
  );

  useEffect(() => {
    if (open) void load(filter);
  }, [open, filter, load]);

  const markOne = async (id: string) => {
    if (!baseUrl) return;
    setBusy(true);
    try {
      const result = await markNotificationRead(baseUrl, token, id);
      markUpdatesSeen(seenKeysFor((items ?? []).filter((item) => item.id === id)));
      setItems((current) => withRead(current ?? [], filter, new Set([id]), result.item.read_at ?? new Date().toISOString()));
      setOverride(result.unread_count);
    } catch (error) {
      toast({ tone: "error", title: error instanceof Error ? error.message : "Could not mark as read" });
    } finally {
      setBusy(false);
    }
  };

  const markAll = async () => {
    if (!baseUrl) return;
    setBusy(true);
    try {
      const result = await markAllNotificationsRead(baseUrl, token);
      markUpdatesSeen(seenKeysFor(items ?? []));
      setItems((current) => withRead(current ?? [], filter, "all", new Date().toISOString()));
      setOverride(result.unread_count);
    } catch (error) {
      toast({ tone: "error", title: error instanceof Error ? error.message : "Could not mark as read" });
    } finally {
      setBusy(false);
    }
  };

  const openItem = (item: NotificationItem) => {
    if (!item.read_at) void markOne(item.id);
    setOpen(false);
    onOpen?.(item.plugin_name);
  };

  const badge = unreadBadgeText(count);
  const label = bellLabel(count);

  // No tooltip while the popover is open: it would sit on top of the tabs.
  const trigger = (
    <PopoverTrigger asChild>
      <button
        type="button"
        className="icon-action notifications-trigger"
        data-testid="notifications-bell"
        disabled={disabled || !baseUrl}
        aria-label={label}
        aria-expanded={open}
      >
        <Bell size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
        {badge ? (
          <span className="notifications-badge" data-testid="notifications-count" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </button>
    </PopoverTrigger>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {open ? trigger : <ChromeTooltip content={label}>{trigger}</ChromeTooltip>}
      <PopoverContent
        ref={contentRef}
        align="end"
        sideOffset={NOTIFICATIONS_POPOVER_OFFSET_PX}
        aria-label="Notifications"
        className="notifications-popover w-auto p-0"
        data-testid="notifications-popover"
      >
        <div className="notifications-head">
          <div className="settings-tabs" role="tablist" aria-label="Notification filter">
            {NOTIFICATION_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                data-testid={`notifications-tab-${tab.id}`}
                aria-selected={filter === tab.id}
                onClick={() => setFilter(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <ChromeTooltip content="Mark all as read">
            <button
              type="button"
              className="icon-action notifications-icon-btn"
              data-testid="notifications-mark-all"
              aria-label="Mark all as read"
              aria-disabled={busy || count === 0}
              onClick={() => {
                // aria-disabled (not disabled) so the tooltip still names the action.
                if (busy || count === 0) return;
                void markAll();
              }}
            >
              <CheckCheck size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </ChromeTooltip>
        </div>
        <ul className="notifications-list" role="list">
          {items === null ? (
            <li className="notifications-empty">Loading</li>
          ) : items.length === 0 ? (
            <li className="notifications-empty" data-testid="notifications-empty">
              {emptyNotificationsText(filter)}
            </li>
          ) : (
            items.map((item) => (
              <li
                key={item.id}
                className={`notifications-item${item.read_at ? "" : " is-unread"}`}
                data-testid={`notification-${item.id}`}
              >
                <button
                  type="button"
                  className="notifications-item-main"
                  data-testid={`notification-open-${item.id}`}
                  onClick={() => openItem(item)}
                >
                  <span className="notifications-dot" aria-hidden="true" />
                  <span className="notifications-item-text">
                    <span className="notifications-item-title">
                      {item.read_at ? null : <span className="sr-only">Unread: </span>}
                      {item.title}
                    </span>
                    {item.body ? <span className="notifications-item-body">{item.body}</span> : null}
                    <span className="notifications-item-time">{notificationTime(item.created_at)}</span>
                  </span>
                </button>
                {item.read_at ? null : (
                  <ChromeTooltip content="Mark as read">
                    <button
                      type="button"
                      className="icon-action notifications-icon-btn notifications-item-read"
                      data-testid={`notification-read-${item.id}`}
                      aria-label="Mark as read"
                      disabled={busy}
                      onClick={() => void markOne(item.id)}
                    >
                      <Check size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </ChromeTooltip>
                )}
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
