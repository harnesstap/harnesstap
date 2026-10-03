import { useEffect, useId, useMemo, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { fetchMarketplaceReachability } from "../lib/agent-client";
import { shouldCloseDialogOnBackdrop } from "../lib/dialog-dismiss";
import type { PluginMarketplaceEntry } from "../lib/types";
import { useOverlayLayer } from "../state/overlay-stack";
import { ChromeTooltip } from "./ChromeTooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconActionButton } from "./IconActionButton";
import { Presence } from "./motion/Presence";
import { motionClass } from "./motion/motion-utils";

const ACTION_ICON_SIZE = 16;

type ReachabilityState =
  | { status: "checking" }
  | { status: "healthy" }
  | { status: "error"; reason: string };

export interface ManageMarketplacesModalProps {
  open: boolean;
  marketplaces: PluginMarketplaceEntry[];
  baseUrl: string | null;
  token: string | null;
  busy?: boolean;
  disabled?: boolean;
  onClose: () => void;
  onEdit: (entry: PluginMarketplaceEntry) => void;
  onRemove: (name: string) => void;
}

function reachabilityCopy(status: ReachabilityState["status"]): string {
  switch (status) {
    case "checking":
      return "Checking";
    case "healthy":
      return "Healthy";
    case "error":
      return "Error";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

function MarketplaceReachabilityMark({
  name,
  state,
}: {
  name: string;
  state: ReachabilityState | undefined;
}) {
  const status = state?.status ?? "checking";
  const reason = state?.status === "error" ? state.reason : undefined;
  const label = reachabilityCopy(status);
  const mark = (
    <span
      className={
        status === "checking"
          ? "marketplace-row-reachability"
          : "marketplace-row-reachability m-status"
      }
      data-status={status}
      data-testid={`manage-marketplace-reachability-${name}`}
      aria-label={reason ? `${label}. ${reason}` : label}
    >
      <span className="marketplace-row-reachability-label">{label}</span>
      {reason ? (
        <span className="marketplace-row-reachability-reason">{reason}</span>
      ) : null}
    </span>
  );
  if (!reason) {
    return mark;
  }
  return <ChromeTooltip content={reason}>{mark}</ChromeTooltip>;
}

export function ManageMarketplacesModal({
  open,
  marketplaces,
  baseUrl,
  token,
  busy = false,
  disabled = false,
  onClose,
  onEdit,
  onRemove,
}: ManageMarketplacesModalProps) {
  const titleId = useId();
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [reachability, setReachability] = useState<Record<string, ReachabilityState>>(
    {},
  );
  const controlsDisabled = disabled || busy;
  const confirmOpen = pendingName !== null;
  const layerRef = useOverlayLayer<HTMLDivElement>({
    open,
    onClose,
    closeDisabled: busy || confirmOpen,
  });
  const marketplaceKey = useMemo(
    () => marketplaces.map((entry) => `${entry.name}\0${entry.url}`).join("|"),
    [marketplaces],
  );

  useEffect(() => {
    if (!open) {
      setPendingName(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setReachability({});
      return;
    }

    const names = marketplaces.map((entry) => entry.name);
    setReachability(
      Object.fromEntries(names.map((name) => [name, { status: "checking" as const }])),
    );

    if (!baseUrl) {
      setReachability(
        Object.fromEntries(
          names.map((name) => [
            name,
            { status: "error" as const, reason: "Could not check reachability" },
          ]),
        ),
      );
      return;
    }

    const abort = new AbortController();
    void fetchMarketplaceReachability(baseUrl, token, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) {
          return;
        }
        const next: Record<string, ReachabilityState> = {};
        for (const row of result.marketplaces) {
          next[row.name] =
            row.status === "healthy"
              ? { status: "healthy" }
              : { status: "error", reason: row.reason?.trim() || "Could not check reachability" };
        }
        for (const name of names) {
          if (!next[name]) {
            next[name] = { status: "error", reason: "Could not check reachability" };
          }
        }
        setReachability(next);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) {
          return;
        }
        const reason =
          error instanceof Error && error.name === "AbortError"
            ? null
            : "Could not check reachability";
        if (!reason) {
          return;
        }
        setReachability(
          Object.fromEntries(names.map((name) => [name, { status: "error" as const, reason }])),
        );
      });

    return () => {
      abort.abort();
    };
  }, [open, baseUrl, token, marketplaceKey, marketplaces]);

  const close = () => {
    if (busy || confirmOpen) {
      return;
    }
    onClose();
  };

  return (
    <>
      <Presence
        open={open}
        enter="m-scrim-in"
        exit="m-scrim-out"
        className="dialog-backdrop"
        role="presentation"
        onClick={(event) => {
          if (
            shouldCloseDialogOnBackdrop(
              event.target,
              event.currentTarget,
              busy || confirmOpen,
            )
          ) {
            onClose();
          }
        }}
      >
        {(state) => (
          <div
            ref={layerRef}
            className={motionClass(
              "dialog manage-marketplaces-dialog",
              "m-rise",
              state,
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="manage-marketplaces-modal"
          >
            <div className="manage-marketplaces-header">
              <h2 id={titleId}>Marketplaces</h2>
              <IconActionButton
                label="Close"
                disabled={controlsDisabled || confirmOpen}
                onClick={close}
                icon={<X size={ACTION_ICON_SIZE} aria-hidden />}
              />
            </div>
            {marketplaces.length === 0 ? (
              <p className="muted manage-marketplaces-empty">
                No marketplaces yet. Add one from Discover.
              </p>
            ) : (
              <ul className="marketplace-list" aria-label="Marketplaces">
                {marketplaces.map((entry) => (
                  <li key={entry.name} data-testid={`manage-marketplace-row-${entry.name}`}>
                    <div className="manage-marketplaces-row">
                      <div className="manage-marketplaces-copy">
                        <span className="marketplace-row-name">{entry.name}</span>
                        {entry.url ? (
                          <span className="marketplace-row-url muted">{entry.url}</span>
                        ) : null}
                        <MarketplaceReachabilityMark
                          name={entry.name}
                          state={reachability[entry.name]}
                        />
                      </div>
                      <div className="source-row-actions">
                        <IconActionButton
                          label="Edit"
                          disabled={controlsDisabled}
                          onClick={() => onEdit(entry)}
                          icon={<Pencil size={ACTION_ICON_SIZE} aria-hidden />}
                        />
                        <IconActionButton
                          label="Remove"
                          disabled={controlsDisabled}
                          onClick={() => setPendingName(entry.name)}
                          icon={<Trash2 size={ACTION_ICON_SIZE} aria-hidden />}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Presence>
      <ConfirmDialog
        open={pendingName !== null}
        title="Remove marketplace?"
        description={
          pendingName
            ? `Removing ${pendingName} unregisters this source. Plugins already pinned stay installed.`
            : ""
        }
        confirmLabel="Remove marketplace"
        confirmBusy={busy}
        tone="destructive"
        onConfirm={() => {
          if (!pendingName || busy) {
            return;
          }
          const name = pendingName;
          setPendingName(null);
          onRemove(name);
        }}
        onCancel={() => {
          if (!busy) {
            setPendingName(null);
          }
        }}
      />
    </>
  );
}
