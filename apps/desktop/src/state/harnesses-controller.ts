import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rescanResourceTrackedDirectories } from "../lib/agent-client";
import { fetchHarnessInventory, saveHarnessSelection, syncConfiguredHarnesses } from "../lib/api/harnesses";
import {
  detectProposal,
  harnessEntry,
  proposalIsEmpty,
  selectionWith,
  type DetectProposal,
  type HarnessId,
  type HarnessInventory,
  type SelectionChange,
  type SelectionOutcome,
  type SelectionRejection,
} from "../lib/harness-inventory";
import { toast } from "./toast-store";

export type HarnessesBusy =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "detecting" }
  | { readonly kind: "saving"; readonly change: SelectionChange }
  | { readonly kind: "syncing" };

export interface HarnessesControllerInput {
  readonly baseUrl: string | null;
  readonly token: string | null;
  readonly connected: boolean;
  /** Fired after a successful save. */
  readonly onChanged?: () => void;
}

/** `selectionWith` outcome, or `failed` when the PUT / refetch threw. */
export type HarnessesChangeResult =
  | SelectionOutcome
  | { readonly kind: "failed"; readonly message: string };

export interface HarnessesController {
  readonly inventory: HarnessInventory | null;
  readonly error: string | null;
  readonly busy: HarnessesBusy;
  /** Pending detect result; null when no dialog is open. */
  readonly proposal: DetectProposal | null;
  refresh(): Promise<void>;
  detect(): Promise<void>;
  applyProposal(chosen: ReadonlySet<HarnessId>): Promise<void>;
  dismissProposal(): void;
  /** Single mutation entry point for add / remove / make-main / apply-proposal. */
  change(change: SelectionChange): Promise<HarnessesChangeResult>;
  sync(): Promise<{ readonly ok: boolean; readonly message?: string }>;
}

const IDLE: HarnessesBusy = { kind: "idle" };

/** True when the overlay that requested the change can close. */
export function changeSettled(result: HarnessesChangeResult): boolean {
  switch (result.kind) {
    case "changed":
    case "unchanged":
      return true;
    case "rejected":
    case "failed":
      return false;
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

export const HARNESSES_IN_SYNC = "Harnesses are in sync";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function rejectionMessage(reason: SelectionRejection): string {
  switch (reason) {
    case "would-empty":
      return "Keep at least one harness.";
    case "unknown-harness":
      return "That harness is not in the registry.";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function names(inventory: HarnessInventory | null, ids: readonly HarnessId[]): string {
  return ids.map((id) => harnessEntry(inventory, id)?.name ?? id).join(", ");
}

export function saveSuccessMessage(
  inventory: HarnessInventory | null,
  change: SelectionChange,
  outcome: Extract<SelectionOutcome, { kind: "changed" }>,
): string {
  switch (change.kind) {
    case "add":
      return `Added ${names(inventory, outcome.added)}`;
    case "remove":
      return `Removed ${names(inventory, outcome.removed)}`;
    case "make-main":
      return `${names(inventory, [change.id])} is now the main harness`;
    case "apply-proposal": {
      const parts: string[] = [];
      if (outcome.added.length > 0) parts.push(`added ${names(inventory, outcome.added)}`);
      if (outcome.removed.length > 0) {
        parts.push(`removed ${names(inventory, outcome.removed)}`);
      }
      const summary = parts.join(", ");
      return `Harnesses updated: ${summary}`;
    }
    default: {
      const exhaustive: never = change;
      return exhaustive;
    }
  }
}

export function useHarnessesController(
  input: HarnessesControllerInput,
): HarnessesController {
  const { baseUrl, token, connected, onChanged } = input;
  const [inventory, setInventory] = useState<HarnessInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<HarnessesBusy>(IDLE);
  const [proposal, setProposal] = useState<DetectProposal | null>(null);
  const inventoryRef = useRef<HarnessInventory | null>(null);
  inventoryRef.current = inventory;
  const busyRef = useRef<HarnessesBusy>(IDLE);
  busyRef.current = busy;

  const load = useCallback(async (): Promise<HarnessInventory | null> => {
    if (!baseUrl || !connected) {
      return null;
    }
    try {
      const next = await fetchHarnessInventory(baseUrl, token);
      setInventory(next);
      setError(null);
      return next;
    } catch (caught) {
      setError(errorMessage(caught, "Could not load harnesses"));
      return null;
    }
  }, [baseUrl, connected, token]);

  useEffect(() => {
    if (!baseUrl || !connected) {
      return;
    }
    let cancelled = false;
    if (inventoryRef.current === null) {
      setBusy({ kind: "loading" });
    }
    void load().finally(() => {
      if (!cancelled) {
        setBusy((current) => (current.kind === "loading" ? IDLE : current));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, connected, load]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  const detect = useCallback(async () => {
    if (busyRef.current.kind !== "idle") {
      return;
    }
    setBusy({ kind: "detecting" });
    try {
      const next = await load();
      if (!next) {
        return;
      }
      const found = detectProposal(next);
      if (proposalIsEmpty(found)) {
        toast({ tone: "success", title: HARNESSES_IN_SYNC });
        return;
      }
      setProposal(found);
    } finally {
      setBusy(IDLE);
    }
  }, [load]);

  const dismissProposal = useCallback(() => setProposal(null), []);

  // Best effort after an add: a rescan failure must not undo the saved preference.
  const importAdded = useCallback(async () => {
    if (!baseUrl) {
      return;
    }
    try {
      await rescanResourceTrackedDirectories(baseUrl, token);
    } catch (caught) {
      toast({
        tone: "error",
        title: errorMessage(caught, "Could not import harness files"),
      });
      return;
    }
    await load();
  }, [baseUrl, load, token]);

  const change = useCallback(
    async (next: SelectionChange): Promise<HarnessesChangeResult> => {
      const current = inventoryRef.current;
      if (!baseUrl || !current) {
        return { kind: "unchanged" };
      }
      const outcome = selectionWith(current.selection, current.catalog, next);
      if (outcome.kind === "rejected") {
        toast({ tone: "error", title: rejectionMessage(outcome.reason) });
        return outcome;
      }
      if (outcome.kind === "unchanged") {
        return outcome;
      }
      setBusy({ kind: "saving", change: next });
      try {
        const saved = await saveHarnessSelection(baseUrl, token, outcome.next);
        setInventory(saved);
        setError(null);
        toast({ tone: "success", title: saveSuccessMessage(current, next, outcome) });
        onChanged?.();
      } catch (caught) {
        const message = errorMessage(caught, "Could not save harnesses");
        setError(message);
        toast({ tone: "error", title: message });
        return { kind: "failed", message };
      } finally {
        setBusy(IDLE);
      }
      if (outcome.added.length > 0) {
        void importAdded();
      }
      return outcome;
    },
    [baseUrl, importAdded, onChanged, token],
  );

  const applyProposal = useCallback(
    async (chosen: ReadonlySet<HarnessId>) => {
      const pending = proposal;
      if (!pending) {
        return;
      }
      const result = await change({
        kind: "apply-proposal",
        add: pending.add.map((entry) => entry.id).filter((id) => chosen.has(id)),
        remove: pending.remove.map((entry) => entry.id).filter((id) => chosen.has(id)),
      });
      if (changeSettled(result)) {
        setProposal(null);
      }
    },
    [change, proposal],
  );

  const sync = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    if (!baseUrl || busyRef.current.kind !== "idle") {
      return { ok: false, message: "Could not sync harnesses" };
    }
    setBusy({ kind: "syncing" });
    try {
      await syncConfiguredHarnesses(baseUrl, token);
      const next = await load();
      if (next) {
        setInventory(next);
        setError(null);
      }
      onChanged?.();
      return { ok: true };
    } catch (caught) {
      const message = errorMessage(caught, "Could not sync harnesses");
      return { ok: false, message };
    } finally {
      setBusy(IDLE);
    }
  }, [baseUrl, load, onChanged, token]);

  return useMemo(
    () => ({
      inventory,
      error,
      busy,
      proposal,
      refresh,
      detect,
      applyProposal,
      dismissProposal,
      change,
      sync,
    }),
    [
      applyProposal,
      busy,
      change,
      detect,
      dismissProposal,
      error,
      inventory,
      proposal,
      refresh,
      sync,
    ],
  );
}
