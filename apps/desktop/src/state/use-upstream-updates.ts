import { useCallback, useEffect, useState } from "react";
import { fetchUpdates, type UpdateList } from "../lib/api/updates";

const POLL_MS = 5 * 60 * 1000;

/** The stored update check. Reads only; the sidecar does the checking. */
export function useUpstreamUpdates(baseUrl: string | null, token: string | null) {
  const [list, setList] = useState<UpdateList | null>(null);
  const refresh = useCallback(async () => {
    if (!baseUrl) return;
    try {
      setList(await fetchUpdates(baseUrl, token));
    } catch {
      // An older sidecar has no /v1/updates. No banner, no dot.
      setList(null);
    }
  }, [baseUrl, token]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  return { list, setList, refresh };
}
