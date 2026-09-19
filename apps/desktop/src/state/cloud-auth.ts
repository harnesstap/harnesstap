import { useCallback, useEffect, useState } from "react";
import { fetchCloudAuthStatus } from "../lib/agent-client";
import type { CloudAuthStatus } from "../lib/types";
import type { AgentClient } from "./agent-session";

export interface CloudAuthState {
  cloudAuth: CloudAuthStatus | null;
  setCloudAuth: (next: CloudAuthStatus | null) => void;
  refresh: () => Promise<void>;
}

/** Cloud sign-in state for the header Account control. Refreshed on connect. */
export function useCloudAuth(client: AgentClient | null): CloudAuthState {
  const [cloudAuth, setCloudAuth] = useState<CloudAuthStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !client.token) {
      setCloudAuth(null);
      return;
    }
    try {
      setCloudAuth(await fetchCloudAuthStatus(client.baseUrl, client.token));
    } catch {
      // Keep last known auth state; panel can retry on open.
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { cloudAuth, setCloudAuth, refresh };
}
