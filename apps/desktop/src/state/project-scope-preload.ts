import { useEffect } from "react";
import {
  homeScopePreviewKey,
  isPreviewSettled,
  projectScopePreloadKey,
  shouldStartProjectScopePreload,
} from "../lib/project-scope-preload";
import { loadProfileRailOrder } from "../lib/profile-rail-order";
import {
  previewKeyId,
  statusStore,
  useStatusStore,
  type StatusStore,
} from "./status-store";

/**
 * After Global inventory is warm, fetch the Project-scope apply preview in the
 * background so the first Project open hits a cache (or an in-flight request).
 * Does not run during startup Global load and does not abort Global work.
 */
export function useProjectScopePreload(input: {
  enabled: boolean;
  projectPath: string;
  switching: boolean;
  store?: StatusStore;
}): void {
  const store = input.store ?? statusStore;
  const profiles = useStatusStore((state) => state.profiles, store);
  const profilesRefreshing = useStatusStore((state) => state.profilesRefreshing, store);
  const activeProfile = useStatusStore(
    (state) => state.status?.active_profile ?? null,
    store,
  );
  const previews = useStatusStore((state) => state.previews, store);

  useEffect(() => {
    store.abortProjectPreviews(input.projectPath.trim() || null);
  }, [input.projectPath, store]);

  useEffect(() => {
    if (!input.enabled) {
      return;
    }
    const railOrder = loadProfileRailOrder();
    const projectKey = projectScopePreloadKey({
      projectPath: input.projectPath,
      profiles,
      activeProfile,
      railOrder: railOrder.project,
    });
    const homeKey = homeScopePreviewKey({
      profiles,
      activeProfile,
      railOrder: railOrder.home,
    });
    const projectPreview = projectKey
      ? previews[previewKeyId(projectKey)]
      : undefined;
    const homePreview = homeKey ? previews[previewKeyId(homeKey)] : undefined;
    const homePreviewSettled = homeKey ? isPreviewSettled(homePreview) : true;

    if (
      !shouldStartProjectScopePreload({
        connected: true,
        switching: input.switching,
        projectPath: input.projectPath,
        profilesRefreshing,
        projectKey,
        projectPreviewRefreshing: Boolean(projectPreview?.refreshing),
        projectPreviewSettled: isPreviewSettled(projectPreview),
        homePreviewSettled,
      })
      || !projectKey
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void store.loadPreview(projectKey, { mode: "ensure", background: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    activeProfile,
    input.enabled,
    input.projectPath,
    input.switching,
    previews,
    profiles,
    profilesRefreshing,
    store,
  ]);
}
