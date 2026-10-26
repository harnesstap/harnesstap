import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Cable,
  Download,
  Library,
  PackageSearch,
  Settings,
  SquareUserRound,
  Upload,
  User,
} from "lucide-react";
import { PROFILE_TAB_TOOLTIP } from "../../lib/profile-scope";
import type { CloudAuthStatus } from "../../lib/types";
import type { AgentClient } from "../../state/agent-session";
import type { Destination } from "../../state/navigation";
import { ChromeTooltip } from "../ChromeTooltip";
import { IconActionButton } from "../IconActionButton";
import { ParityChrome } from "../parity/ParityChrome";
import {
  refreshDesktopUpdateStatus,
  UpdateAvailableControl,
  useDesktopUpdateStatus,
} from "../UpdateAvailableControl";
import { HeaderMoreMenu } from "./HeaderMoreMenu";
import { NotificationsBell } from "./NotificationsBell";
import markUrl from "../../../app-icon.svg";

const HEADER_ICON_SIZE = 18;
export const HEADER_DEST_ICONS_PX = 960;

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0];
      const next = typeof box?.inlineSize === "number"
        ? box.inlineSize
        : entries[0]?.contentRect.width;
      if (typeof next === "number") {
        setWidth(next);
      }
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function maybeTooltip(enabled: boolean, content: string, child: ReactNode): ReactNode {
  if (!enabled) {
    return child;
  }
  return <ChromeTooltip content={content}>{child}</ChromeTooltip>;
}

export interface AppHeaderProps {
  client: AgentClient | null;
  connected: boolean;
  destination: Destination;
  switching: boolean;
  migrateBusy: boolean;
  cloudAuth: CloudAuthStatus | null;
  onDestinationClick: (clicked: Destination) => void;
  onOpenMigrateExport: () => void;
  onOpenMigrateImport: () => void;
  /** Bell row click: open the profile, or the plugin in the Library. */
  onOpenNotification?: (pluginName: string) => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
}

/** Brand, the five destination tabs, and utility actions. */
export function AppHeader({
  client,
  connected,
  destination,
  switching,
  migrateBusy,
  cloudAuth,
  onDestinationClick,
  onOpenMigrateExport,
  onOpenMigrateImport,
  onOpenNotification,
  onOpenSettings,
  onOpenAccount,
}: AppHeaderProps) {
  const baseUrl = client?.baseUrl ?? null;
  const token = client?.token ?? null;
  const headerRef = useRef<HTMLElement>(null);
  const headerWidth = useElementWidth(headerRef);
  const iconDestinations = headerWidth <= HEADER_DEST_ICONS_PX;
  const updateAvailable = useDesktopUpdateStatus()?.updateAvailable === true;

  // The Update menu item only mounts while More is open, so the header owns the check.
  useEffect(() => {
    if (!baseUrl || !connected) {
      return;
    }
    void refreshDesktopUpdateStatus(baseUrl, token);
  }, [baseUrl, connected, token]);

  const accountTooltip = cloudAuth?.authenticated && cloudAuth.email
    ? `Account (${cloudAuth.email})`
    : "Account";

  return (
    <header
      ref={headerRef}
      className={["app-header", iconDestinations ? "is-compact-dest" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="app-header-brand">
        <img className="app-header-logo" src={markUrl} alt="HarnessTap" />
      </div>
      <div className="header-focus-controls" role="navigation" aria-label="Destinations">
        {maybeTooltip(
          iconDestinations,
          "Library",
          <button
            type="button"
            className={`header-focus-btn labeled${destination === "library" ? " on" : ""}`}
            onClick={() => onDestinationClick("library")}
            disabled={switching}
            aria-label="Library"
            aria-current={destination === "library" ? "page" : undefined}
          >
            <Library size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            <span className="header-focus-label">Library</span>
          </button>,
        )}
        {maybeTooltip(
          iconDestinations,
          "Discover",
          <button
            type="button"
            className={`header-focus-btn labeled${destination === "discover" ? " on" : ""}`}
            onClick={() => onDestinationClick("discover")}
            disabled={switching}
            aria-label="Discover"
            aria-current={destination === "discover" ? "page" : undefined}
          >
            <PackageSearch size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            <span className="header-focus-label">Discover</span>
          </button>,
        )}
        <ParityChrome
          workspaceFocus={destination}
          iconOnly={iconDestinations}
          onWorkspaceFocus={() => {
            onDestinationClick("environments");
          }}
          switching={switching}
        />
        {maybeTooltip(
          iconDestinations,
          "Harnesses",
          <button
            type="button"
            className={`header-focus-btn labeled${destination === "harnesses" ? " on" : ""}`}
            onClick={() => onDestinationClick("harnesses")}
            disabled={switching}
            aria-label="Harnesses"
            aria-current={destination === "harnesses" ? "page" : undefined}
          >
            <Cable size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            <span className="header-focus-label">Harnesses</span>
          </button>,
        )}
        <ChromeTooltip content={PROFILE_TAB_TOOLTIP}>
          <button
            type="button"
            className={`header-focus-btn labeled${destination === "scope" ? " on" : ""}`}
            data-testid="nav-profile"
            onClick={() => onDestinationClick("scope")}
            disabled={switching}
            aria-label="Profile"
            aria-current={destination === "scope" ? "page" : undefined}
          >
            <SquareUserRound size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            <span className="header-focus-label">Profile</span>
          </button>
        </ChromeTooltip>
      </div>
      <div className="header-focus-spacer" aria-hidden />
      <div
        className="header-status"
        data-testid={connected ? "agent-connected" : undefined}
      >
        <NotificationsBell
          baseUrl={connected ? baseUrl : null}
          token={token}
          disabled={switching}
          onOpen={onOpenNotification}
        />
        <IconActionButton
          data-testid="open-settings"
          onClick={onOpenSettings}
          disabled={!connected}
          label="Settings"
          icon={<Settings size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
        />
        <span className="header-more-wrap">
          <HeaderMoreMenu
            disabled={switching}
            attention={updateAvailable}
            items={[
              {
                id: "export",
                label: "Export setup",
                icon: <Upload size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />,
                disabled: !connected || switching || migrateBusy,
                onSelect: onOpenMigrateExport,
                testId: "open-migrate-export-more",
              },
              {
                id: "import",
                label: "Import setup",
                icon: <Download size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />,
                disabled: !connected || switching || migrateBusy,
                onSelect: onOpenMigrateImport,
                testId: "open-migrate-import-more",
              },
              {
                id: "account",
                label: accountTooltip,
                icon: <User size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />,
                disabled: !connected,
                onSelect: onOpenAccount,
                testId: "open-account-more",
              },
            ]}
          >
            <UpdateAvailableControl
              baseUrl={baseUrl}
              token={token}
              connected={connected}
              disabled={switching || migrateBusy}
              variant="menuitem"
            />
          </HeaderMoreMenu>
        </span>
      </div>
    </header>
  );
}
