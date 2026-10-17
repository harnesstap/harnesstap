import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
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
  unreadBadgeText,
  withRead,
} from "../../lib/notifications-view";
import { useOverlayLayer } from "../../state/overlay-stack";
import { useStatusStore } from "../../state/status-store";
import { toast } from "../../state/toast-store";
import { ChromeTooltip } from "../ChromeTooltip";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

const HEADER_ICON_SIZE = 18;

export interface NotificationsBellProps {
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
}

/** Header bell. The count comes from the status payload; the list loads on open. */
export function NotificationsBell({ baseUrl, token, disabled = false }: NotificationsBellProps) {
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
      setItems((current) => withRead(current ?? [], filter, "all", new Date().toISOString()));
      setOverride(result.unread_count);
    } catch (error) {
      toast({ tone: "error", title: error instanceof Error ? error.message : "Could not mark as read" });
    } finally {
      setBusy(false);
    }
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
          <button
            type="button"
            className="notifications-link"
            data-testid="notifications-mark-all"
            disabled={busy || count === 0}
            onClick={() => void markAll()}
          >
            Mark all as read
          </button>
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
                <div className="notifications-item-main">
                  <span className="notifications-item-title">{item.title}</span>
                  {item.body ? <span className="notifications-item-body">{item.body}</span> : null}
                  <span className="notifications-item-time">{notificationTime(item.created_at)}</span>
                </div>
                {item.read_at ? null : (
                  <button
                    type="button"
                    className="notifications-link"
                    data-testid={`notification-read-${item.id}`}
                    disabled={busy}
                    onClick={() => void markOne(item.id)}
                  >
                    Mark as read
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
