import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { connectAgent, hasTauriRuntime, probeHealth } from "../lib/agent-client";

export type AgentPhase = "connecting" | "connected" | "disconnected";

export const HEALTH_POLL_MS = 2000;
export const RECONNECT_POLL_MS = 500;

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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Owns the sidecar connection: initial connect, manual retry (restart), and
 * reconnect after the dev watcher rebuilds `ht-agent` (`sidecar-reloaded`).
 * After the first successful connect, a failed health probe dims the shell
 * instead of returning to the splash.
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

  // After the first connect, probe health so killing the agent dims the shell.
  useEffect(() => {
    if (phase !== "connected" || !connection) {
      return;
    }
    const controller = new AbortController();
    const markDisconnected = (probeError: unknown) => {
      if (controller.signal.aborted || isAbortError(probeError)) {
        return;
      }
      setError(
        probeError instanceof Error ? probeError.message : "Sidecar connection failed",
      );
      setPhase("disconnected");
    };
    void probeHealth(connection.client.baseUrl, { signal: controller.signal })
      .then(() => {
        if (!controller.signal.aborted) {
          setError(null);
        }
      })
      .catch(markDisconnected);
    const timer = window.setInterval(() => {
      void probeHealth(connection.client.baseUrl, { signal: controller.signal })
        .then(() => {
          if (!controller.signal.aborted) {
            setError(null);
          }
        })
        .catch(markDisconnected);
    }, HEALTH_POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [connection, phase]);

  // Later disconnects: keep last-good client and wait for health to return.
  useEffect(() => {
    if (phase !== "disconnected" || !connection) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const health = await probeHealth(connection.client.baseUrl, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) {
            return;
          }
          applyConnection({
            baseUrl: connection.client.baseUrl,
            token: connection.client.token,
            health,
          });
          return;
        } catch (reconnectError) {
          if (controller.signal.aborted || isAbortError(reconnectError)) {
            return;
          }
          try {
            await sleep(RECONNECT_POLL_MS, controller.signal);
          } catch {
            return;
          }
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [applyConnection, connection, phase]);

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
