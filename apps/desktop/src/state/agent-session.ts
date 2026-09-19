import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { connectAgent, hasTauriRuntime } from "../lib/agent-client";

export type AgentPhase = "connecting" | "connected" | "disconnected";

/** Bound connection handle. A new object is produced on every (re)connect. */
export interface AgentClient {
  baseUrl: string;
  token: string | null;
}

export interface AgentSession {
  baseUrl: string | null;
  token: string | null;
  /** Stable per connection; `null` until the first successful connect. */
  client: AgentClient | null;
  phase: AgentPhase;
  connected: boolean;
  error: string | null;
  retryBusy: boolean;
  retry: () => Promise<void>;
  firstRun: boolean;
}

interface ConnectionState {
  client: AgentClient;
  firstRun: boolean;
}

/**
 * Owns the sidecar connection: initial connect, manual retry (restart), and
 * reconnect after the dev watcher rebuilds `ht-agent` (`sidecar-reloaded`).
 */
export function useAgentSession(): AgentSession {
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [phase, setPhase] = useState<AgentPhase>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const retryBusyRef = useRef(false);

  const applyConnection = useCallback(
    (next: Awaited<ReturnType<typeof connectAgent>>) => {
      setConnection({
        client: { baseUrl: next.baseUrl, token: next.token },
        firstRun: Boolean(next.health.first_run),
      });
      setPhase("connected");
      setError(null);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await connectAgent();
        if (!cancelled) {
          applyConnection(next);
        }
      } catch (connectError) {
        if (!cancelled) {
          setError(
            connectError instanceof Error
              ? connectError.message
              : "Sidecar connection failed",
          );
          setPhase("disconnected");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyConnection]);

  const retry = useCallback(async () => {
    if (retryBusyRef.current) {
      return;
    }
    retryBusyRef.current = true;
    setRetryBusy(true);
    setError(null);
    setPhase("connecting");
    try {
      applyConnection(await connectAgent({ restart: true }));
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Sidecar connection failed",
      );
      setPhase("disconnected");
    } finally {
      retryBusyRef.current = false;
      setRetryBusy(false);
    }
  }, [applyConnection]);

  // Sidecar watcher rebuilds ht-agent in place; reconnect so previews use new code.
  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<number>("sidecar-reloaded", () => {
      if (cancelled) {
        return;
      }
      void (async () => {
        try {
          const next = await connectAgent();
          if (!cancelled) {
            applyConnection(next);
          }
        } catch (connectError) {
          if (!cancelled) {
            setError(
              connectError instanceof Error
                ? connectError.message
                : "Sidecar reconnect after reload failed",
            );
            setPhase("disconnected");
          }
        }
      })();
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [applyConnection]);

  return {
    baseUrl: connection?.client.baseUrl ?? null,
    token: connection?.client.token ?? null,
    client: connection?.client ?? null,
    phase,
    connected: phase === "connected",
    error,
    retryBusy,
    retry,
    firstRun: connection?.firstRun ?? false,
  };
}
