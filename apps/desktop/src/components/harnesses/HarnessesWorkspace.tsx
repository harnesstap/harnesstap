import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  availableHarnesses,
  configuredHarnesses,
  harnessEntry,
  harnessesViewReducer,
  initialHarnessesViewState,
  removalCopy,
  resourceDetailTargetFor,
  roleOf,
  type HarnessId,
  type HarnessResourceRow,
} from "../../lib/harness-inventory";
import {
  syncHarnessesConfirmBody,
  syncHarnessesDisabledReason,
  syncHarnessesTooltip,
} from "../../lib/harness-sync";
import { escapeAction } from "../../lib/library-pane";
import { workspaceBackEnabled } from "../../lib/screen-history";
import { useRegisterCommands } from "../../state/command-registry";
import { changeSettled, useHarnessesController } from "../../state/harnesses-controller";
import { useEscapeWhenNoLayer } from "../../state/overlay-stack";
import { ConfirmDialog } from "../ConfirmDialog";
import { EmptyState } from "../EmptyState";
import { LibraryDetailChrome } from "../LibraryDetailChrome";
import { ResourceDetailBody } from "../ResourceDetailBody";
import { Banner } from "../shell/Banner";
import { WorkspaceBackButton } from "../WorkspaceBackButton";
import { AddHarnessModal } from "./AddHarnessModal";
import { DetectHarnessesDialog } from "./DetectHarnessesDialog";
import { HarnessDetail } from "./HarnessDetail";
import { HarnessSidebar } from "./HarnessSidebar";

/** Add, detect confirm, and remove confirm never stack. */
type HarnessesOverlay =
  | { readonly kind: "none" }
  | { readonly kind: "add" }
  | { readonly kind: "detect" }
  | { readonly kind: "remove"; readonly id: HarnessId }
  | { readonly kind: "sync" };

const NO_OVERLAY: HarnessesOverlay = { kind: "none" };

export interface HarnessesWorkspaceProps {
  baseUrl: string | null;
  token: string | null;
  connected: boolean;
  disabled?: boolean;
  disconnected?: boolean;
  /** Bump while mounted to return to the inventory entrypoint (header re-click). */
  homeResetNonce?: number;
  canWorkspaceBack?: boolean;
  onWorkspaceBack?: () => void;
  /** 1 while the resource detail pane is open, else 0. */
  onNestedDepthChange?: (depth: number) => void;
  onSuccess: (message: string) => void;
  /** Saved selection changed. App refreshes live status and the Library. */
  onHarnessesChanged?: () => void;
}

export function HarnessesWorkspace({
  baseUrl,
  token,
  connected,
  disabled = false,
  disconnected = false,
  homeResetNonce = 0,
  canWorkspaceBack = false,
  onWorkspaceBack,
  onNestedDepthChange,
  onSuccess,
  onHarnessesChanged,
}: HarnessesWorkspaceProps) {
  const ctrl = useHarnessesController({
    baseUrl,
    token,
    connected,
    onChanged: onHarnessesChanged,
  });
  const { inventory } = ctrl;
  const [view, dispatch] = useReducer(
    harnessesViewReducer,
    inventory,
    initialHarnessesViewState,
  );
  const [overlay, setOverlay] = useState<HarnessesOverlay>(NO_OVERLAY);
  const [fieldEditing, setFieldEditing] = useState(false);
  const [detailConfirmOpen, setDetailConfirmOpen] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncHelper, setSyncHelper] = useState<string | null>(null);
  const cancelFieldEditRef = useRef<(() => void) | null>(null);
  const detailTitleId = useId();
  const homeResetNonceSeen = useRef(homeResetNonce);
  const syncedClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const controlsDisabled = disabled || !connected || !baseUrl;
  const working = ctrl.busy.kind !== "idle";
  const detailOpen = view.pane.mode === "detail";

  useEffect(() => {
    if (inventory) {
      dispatch({ type: "inventory-loaded", inventory });
    }
  }, [inventory]);

  // The controller owns the pending proposal; the overlay union mirrors it.
  useEffect(() => {
    if (ctrl.proposal) {
      setOverlay({ kind: "detect" });
      return;
    }
    setOverlay((current) => (current.kind === "detect" ? NO_OVERLAY : current));
  }, [ctrl.proposal]);

  const closeOverlay = useCallback(() => {
    if (ctrl.proposal) {
      ctrl.dismissProposal();
    }
    setOverlay(NO_OVERLAY);
  }, [ctrl.dismissProposal, ctrl.proposal]);

  const openOverlay = useCallback(
    (next: HarnessesOverlay) => {
      if (ctrl.proposal && next.kind !== "detect") {
        ctrl.dismissProposal();
      }
      setOverlay(next);
    },
    [ctrl.dismissProposal, ctrl.proposal],
  );

  useEffect(() => {
    if (homeResetNonceSeen.current === homeResetNonce) {
      return;
    }
    homeResetNonceSeen.current = homeResetNonce;
    dispatch({ type: "reset", inventory });
    closeOverlay();
    setSyncError(null);
    setSyncHelper(null);
  }, [closeOverlay, homeResetNonce, inventory]);

  useEffect(() => {
    return () => {
      if (syncedClearRef.current) {
        clearTimeout(syncedClearRef.current);
      }
    };
  }, []);

  useEffect(() => {
    onNestedDepthChange?.(detailOpen ? 1 : 0);
  }, [detailOpen, onNestedDepthChange]);

  useEffect(() => {
    return () => {
      onNestedDepthChange?.(0);
    };
  }, [onNestedDepthChange]);

  const closeDetail = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    dispatch({ type: "close-detail" });
    setFieldEditing(false);
    setDetailConfirmOpen(false);
    setDetailBusy(false);
  }, []);

  const startDetect = useCallback(() => {
    if (controlsDisabled || working) {
      return;
    }
    setOverlay(NO_OVERLAY);
    void ctrl.detect();
  }, [controlsDisabled, ctrl.detect, working]);

  const openAdd = useCallback(() => {
    if (controlsDisabled || working) {
      return;
    }
    openOverlay({ kind: "add" });
  }, [controlsDisabled, openOverlay, working]);

  useRegisterCommands(
    "harnesses",
    useMemo(
      () => [
        {
          id: "harnesses-add",
          section: "actions" as const,
          label: "Add harness",
          keywords: ["harness", "platform"],
          disabled: controlsDisabled || working,
          run: openAdd,
        },
        {
          id: "harnesses-detect",
          section: "actions" as const,
          label: "Detect harnesses",
          keywords: ["harness", "scan", "disk"],
          disabled: controlsDisabled || working,
          run: startDetect,
        },
      ],
      [controlsDisabled, openAdd, startDetect, working],
    ),
  );

  // Back on Esc while no dialog is open; open layers take Esc first.
  useEscapeWhenNoLayer(
    (event: KeyboardEvent) => {
      if (!detailOpen || detailBusy) {
        return;
      }
      const action = escapeAction({ fieldEditing, confirmOpen: detailConfirmOpen });
      switch (action) {
        case "cancel-field":
          event.preventDefault();
          cancelFieldEditRef.current?.();
          return;
        case "dismiss-confirm":
          return;
        case "leave-pane":
          event.preventDefault();
          closeDetail();
          return;
        default: {
          const exhaustive: never = action;
          return exhaustive;
        }
      }
    },
    detailOpen,
  );

  const handleBack = () => {
    if (detailOpen) {
      closeDetail();
      return;
    }
    onWorkspaceBack?.();
  };

  const rows = useMemo(() => configuredHarnesses(inventory), [inventory]);
  const available = useMemo(() => availableHarnesses(inventory), [inventory]);
  const selection = inventory?.selection ?? null;
  const selectedEntry = harnessEntry(inventory, view.selectedId);
  const selectedRole = view.selectedId ? roleOf(selection, view.selectedId) : null;
  const removeTarget = overlay.kind === "remove" ? overlay.id : null;
  const removeCopy =
    inventory && removeTarget ? removalCopy(inventory, removeTarget) : null;
  const saving = ctrl.busy.kind === "saving";
  const syncing = ctrl.busy.kind === "syncing";
  const mainName =
    selection ? (harnessEntry(inventory, selection.main)?.name ?? selection.main) : "Main";
  const syncDisabledReason = syncHarnessesDisabledReason({
    configuredCount: rows.length,
    hasMain: selection !== null,
    running: working,
  });
  const syncHidden = rows.length === 0;
  const syncDisabled = controlsDisabled || syncDisabledReason !== null || working;

  const backDisabled =
    controlsDisabled
    || !workspaceBackEnabled({
      hasLocalPrevious: detailOpen,
      hasWorkspacePrevious: canWorkspaceBack,
    })
    || (detailOpen && detailConfirmOpen);

  const openRow = (row: HarnessResourceRow) => {
    dispatch({ type: "open-detail", target: resourceDetailTargetFor(row) });
  };

  const onPick = async (id: HarnessId) => {
    const result = await ctrl.change({ kind: "add", id });
    if (changeSettled(result)) {
      setOverlay(NO_OVERLAY);
      dispatch({ type: "select", id });
    }
  };

  const onConfirmRemove = async () => {
    if (!removeTarget) {
      return;
    }
    const result = await ctrl.change({ kind: "remove", id: removeTarget });
    if (changeSettled(result)) {
      setOverlay(NO_OVERLAY);
    }
  };

  const onMakeMain = () => {
    if (!view.selectedId) {
      return;
    }
    void ctrl.change({ kind: "make-main", id: view.selectedId });
  };

  const openSyncConfirm = () => {
    if (syncHidden || syncDisabled) {
      return;
    }
    setSyncError(null);
    openOverlay({ kind: "sync" });
  };

  const onConfirmSync = async () => {
    setOverlay(NO_OVERLAY);
    setSyncError(null);
    setSyncHelper(null);
    const result = await ctrl.sync();
    if (result.ok) {
      if (syncedClearRef.current) {
        clearTimeout(syncedClearRef.current);
      }
      setSyncHelper("Synced");
      syncedClearRef.current = setTimeout(() => {
        setSyncHelper(null);
        syncedClearRef.current = null;
      }, 2000);
      return;
    }
    setSyncError(result.message ?? "Could not sync harnesses");
  };

  const renderMain = (): ReactNode => {
    const pane = view.pane;
    switch (pane.mode) {
      case "detail":
        return (
          <ResourceDetailBody
            chrome="pane"
            Chrome={LibraryDetailChrome}
            target={{
              selector: pane.target.selector,
              label: pane.target.label,
              pathHint: pane.target.pathHint,
            }}
            baseUrl={baseUrl}
            token={token}
            disabled={controlsDisabled}
            titleId={detailTitleId}
            showBack={false}
            onBack={closeDetail}
            onDeleted={() => {
              closeDetail();
              void ctrl.refresh();
            }}
            onSuccess={onSuccess}
            onLibraryChanged={() => void ctrl.refresh()}
            onFieldEditingChange={setFieldEditing}
            onRegisterCancelFieldEdit={(cancel) => {
              cancelFieldEditRef.current = cancel;
            }}
            onConfirmOpenChange={setDetailConfirmOpen}
            onBusyChange={setDetailBusy}
          />
        );
      case "inventory":
        if (!selectedEntry || !selectedRole) {
          return rows.length === 0 ? (
            <EmptyState
              title="No harnesses set up."
              body="Detect the harnesses on this machine or add one."
            />
          ) : (
            <p className="muted">Select a harness to inspect it.</p>
          );
        }
        return (
          <HarnessDetail
            entry={selectedEntry}
            role={selectedRole}
            search={view.search}
            typeTab={view.typeTab}
            disabled={controlsDisabled}
            onSearch={(value) => dispatch({ type: "search", value })}
            onTypeTab={(value) => dispatch({ type: "type-tab", value })}
            onMakeMain={onMakeMain}
            onOpen={openRow}
          />
        );
      default: {
        const exhaustive: never = pane;
        return exhaustive;
      }
    }
  };

  return (
    <main
      className={["resources-panel", disconnected ? "is-disconnected" : ""]
        .filter(Boolean)
        .join(" ")}
      aria-label="Harnesses"
      data-harnesses-pane={view.pane.mode}
    >
      <div className="resources-panel-header">
        <div className="resources-panel-header-row">
          <div className="resources-panel-title-cluster">
            <WorkspaceBackButton
              hidden={!detailOpen}
              disabled={backDisabled}
              onClick={handleBack}
            />
            <div className="resources-panel-title">
              <span>Harnesses</span>
              <span className="muted resources-panel-scope">
                Harnesses set up on this machine
              </span>
            </div>
          </div>
        </div>
      </div>

      {ctrl.error ? (
        <Banner
          tone="error"
          message={ctrl.error}
          onRetry={() => void ctrl.refresh()}
          retryBusy={ctrl.busy.kind === "loading"}
          testId="harnesses-error"
        />
      ) : null}

      <div className="resources-panel-layout harnesses-workspace-layout">
        <HarnessSidebar
          rows={rows}
          selection={selection}
          selectedId={view.selectedId}
          editing={view.editing}
          loading={ctrl.busy.kind === "loading"}
          disabled={controlsDisabled}
          busy={ctrl.busy}
          onSelect={(id) => dispatch({ type: "select", id })}
          onAdd={openAdd}
          onDetect={startDetect}
          onToggleEdit={() => dispatch({ type: "toggle-edit" })}
          onRemove={(id) => openOverlay({ kind: "remove", id })}
          syncLabel={syncing ? "Syncing…" : "Sync harnesses"}
          syncTitle={syncDisabledReason ?? syncHarnessesTooltip(mainName)}
          syncDisabled={syncDisabled}
          syncHidden={syncHidden}
          syncBusy={syncing}
          syncHelper={syncHelper}
          syncError={syncError}
          onSync={openSyncConfirm}
        />
        <div className="resources-panel-body">{renderMain()}</div>
      </div>

      <AddHarnessModal
        open={overlay.kind === "add"}
        rows={available}
        busy={saving}
        disabled={controlsDisabled}
        onClose={closeOverlay}
        onPick={(id) => void onPick(id)}
      />

      <DetectHarnessesDialog
        proposal={overlay.kind === "detect" ? ctrl.proposal : null}
        selection={selection}
        busy={saving}
        onApply={(chosen) => void ctrl.applyProposal(chosen)}
        onCancel={closeOverlay}
      />

      <ConfirmDialog
        open={overlay.kind === "sync"}
        title="Sync harnesses"
        description={syncHarnessesConfirmBody(mainName)}
        confirmLabel={syncing ? "Syncing…" : "Sync"}
        confirmBusy={syncing}
        onConfirm={() => void onConfirmSync()}
        onCancel={() => {
          if (!syncing) {
            closeOverlay();
          }
        }}
      />

      <ConfirmDialog
        open={removeCopy !== null}
        tone="destructive"
        title={removeCopy?.title ?? ""}
        description={removeCopy?.body ?? ""}
        confirmLabel={saving ? "Removing…" : "Remove"}
        confirmBusy={saving}
        onConfirm={() => void onConfirmRemove()}
        onCancel={() => {
          if (!saving) {
            closeOverlay();
          }
        }}
      />
    </main>
  );
}
