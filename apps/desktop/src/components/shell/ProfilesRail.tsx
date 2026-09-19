import { useCallback, useRef, useState, type DragEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  FilterX,
  GripVertical,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import {
  insertBeforeIndexForDrop,
  moveNameByDelta,
  reorderProfileNames,
} from "../../lib/profile-rail-order";
import type { ProfileCreateSource } from "../../lib/types";
import type { ScopeController } from "../../state/scope-controller";
import { ButtonSpinner } from "../ButtonSpinner";
import { IconActionButton } from "../IconActionButton";
import { PublishProfileDrawer } from "../parity/PublishProfileDrawer";
import { WorkspaceBackButton } from "../WorkspaceBackButton";
import { toast } from "../../state/toast-store";
import { useStatusStore } from "../../state/status-store";
import { SkeletonRow } from "./Skeleton";

const RAIL_ICON_SIZE = 15;

export interface ProfilesRailProps {
  ctrl: ScopeController;
  canGoBack: boolean;
  onBack: () => void;
  onOpenCreateProfile: (source?: ProfileCreateSource, switchAfterCreate?: boolean) => void;
  onOpenStashBrowse: () => void;
  onRequestSignIn: () => void;
}

export function ProfilesRail({
  ctrl,
  canGoBack,
  onBack,
  onOpenCreateProfile,
  onOpenStashBrowse,
  onRequestSignIn,
}: ProfilesRailProps) {
  const {
    client,
    connected,
    switching,
    scope,
    profiles,
    profilesError,
    visibleProfiles,
    filteredProfiles,
    profileFilter,
    setProfileFilter,
    selectedProfile,
    selectedProfileSummary,
    activeProfile,
    editingProfile,
    canReorderProfiles,
    persistRailOrder,
    stashBusy,
    stashAction,
    stashEntries,
    canStashProfile,
    canUnstashProfile,
    stashDisabledReason,
    untrackedCount,
  } = ctrl;
  const token = client?.token ?? null;
  const topStashEntry = stashEntries[0];
  const profilesRefreshing = useStatusStore((state) => state.profilesRefreshing);
  const hasStatus = useStatusStore((state) => state.status !== null);
  const showRailSkeleton =
    profiles.length === 0 && !profilesError && (profilesRefreshing || !hasStatus);

  const [draggingProfile, setDraggingProfile] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<
    { name: string; placeAfter: boolean } | "end" | null
  >(null);
  const skipProfileClickRef = useRef(false);

  const persistProfileRailOrder = useCallback(
    (fromName: string, toName: string | null, placeAfter: boolean) => {
      const names = visibleProfiles.map((profile) => profile.name);
      const fromIndex = names.indexOf(fromName);
      if (fromIndex < 0) {
        return;
      }
      let insertBeforeIndex = names.length;
      if (toName !== null) {
        const targetIndex = names.indexOf(toName);
        if (targetIndex < 0) {
          return;
        }
        insertBeforeIndex = insertBeforeIndexForDrop(targetIndex, placeAfter);
      }
      const nextNames = reorderProfileNames(names, fromIndex, insertBeforeIndex);
      if (nextNames.every((name, index) => name === names[index])) {
        return;
      }
      persistRailOrder(nextNames);
    },
    [persistRailOrder, visibleProfiles],
  );

  const onProfileDragStart = useCallback(
    (event: DragEvent<HTMLElement>, name: string) => {
      if (!canReorderProfiles) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData("text/plain", name);
      event.dataTransfer.effectAllowed = "move";
      setDraggingProfile(name);
      setDropTarget(null);
    },
    [canReorderProfiles],
  );

  const onProfileDragEnd = useCallback(() => {
    if (draggingProfile) {
      skipProfileClickRef.current = true;
    }
    setDraggingProfile(null);
    setDropTarget(null);
  }, [draggingProfile]);

  const onProfileRowDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, name: string) => {
      if (!canReorderProfiles || !draggingProfile || draggingProfile === name) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const placeAfter = event.clientY > rect.top + rect.height / 2;
      setDropTarget((current) => {
        if (
          current !== "end"
          && current?.name === name
          && current.placeAfter === placeAfter
        ) {
          return current;
        }
        return { name, placeAfter };
      });
    },
    [canReorderProfiles, draggingProfile],
  );

  const onProfileRowDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, name: string) => {
      if (!canReorderProfiles) {
        return;
      }
      event.preventDefault();
      const fromName = draggingProfile || event.dataTransfer.getData("text/plain");
      const rect = event.currentTarget.getBoundingClientRect();
      const placeAfter = event.clientY > rect.top + rect.height / 2;
      persistProfileRailOrder(fromName, name, placeAfter);
      skipProfileClickRef.current = true;
      setDraggingProfile(null);
      setDropTarget(null);
    },
    [canReorderProfiles, draggingProfile, persistProfileRailOrder],
  );

  const onProfileListDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!canReorderProfiles || !draggingProfile) {
        return;
      }
      if ((event.target as HTMLElement).closest(".profile-item")) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget("end");
    },
    [canReorderProfiles, draggingProfile],
  );

  const onProfileListDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!canReorderProfiles || !draggingProfile) {
        return;
      }
      if ((event.target as HTMLElement).closest(".profile-item")) {
        return;
      }
      event.preventDefault();
      persistProfileRailOrder(draggingProfile, null, true);
      skipProfileClickRef.current = true;
      setDraggingProfile(null);
      setDropTarget(null);
    },
    [canReorderProfiles, draggingProfile, persistProfileRailOrder],
  );

  return (
    <nav className="profiles-rail" aria-label="Profiles">
      <div className="profiles-brand">
        <div className="resources-panel-title-cluster">
          <WorkspaceBackButton
            hidden={!canGoBack}
            disabled={switching}
            onClick={onBack}
          />
          <span>Profiles</span>
        </div>
        <div className="profiles-brand-actions">
          <div className="profiles-rail-toolbar">
            <IconActionButton
              className={["rail-icon-action", stashAction === "stash" ? "is-busy" : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => void ctrl.onStashProfile()}
              disabled={!connected || !token || switching || stashBusy || !canStashProfile}
              busy={stashAction === "stash"}
              label={
                canStashProfile
                  ? `Stash not-staged resources for ${activeProfile}`
                  : "Stash not-staged resources"
              }
              title={
                canStashProfile
                  ? `Stash ${untrackedCount} not-staged resource${untrackedCount === 1 ? "" : "s"}`
                  : stashDisabledReason ?? "Stash not-staged resources"
              }
              icon={<Archive size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
            />
            <IconActionButton
              className={["rail-icon-action", stashAction === "unstash" ? "is-busy" : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => void ctrl.onUnstashProfile()}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!canUnstashProfile || !connected || switching || stashBusy) {
                  return;
                }
                onOpenStashBrowse();
              }}
              disabled={!connected || !token || switching || stashBusy || !canUnstashProfile}
              busy={stashAction === "unstash"}
              label={
                canUnstashProfile && topStashEntry
                  ? `Restore stashed untracked resources from ${topStashEntry.profile_name}`
                  : "Restore stashed untracked resources"
              }
              title={
                canUnstashProfile && topStashEntry
                  ? `Restore ${topStashEntry.contents.resources.length} untracked resource${topStashEntry.contents.resources.length === 1 ? "" : "s"} · right-click to browse`
                  : "No stashed untracked resources to restore"
              }
              icon={
                <ArchiveRestore size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
              }
            />
            <PublishProfileDrawer
              profileName={editingProfile ?? selectedProfile}
              profileVersion={selectedProfileSummary?.version ?? ""}
              baseUrl={client?.baseUrl ?? null}
              token={token}
              disabled={!connected || switching || stashBusy}
              triggerClassName="icon-action rail-icon-action"
              iconSize={RAIL_ICON_SIZE}
              onSuccess={(message) => toast({ tone: "success", title: message })}
              onRequestSignIn={onRequestSignIn}
              onRequestCut={
                (editingProfile ?? selectedProfile) && client && token
                  ? (name, version) => ctrl.openCutForProfile(name, version)
                  : undefined
              }
            />
            <IconActionButton
              primary
              className="rail-icon-action profile-create-action"
              data-testid="open-create-profile"
              onClick={() => onOpenCreateProfile()}
              disabled={!connected || switching || stashBusy}
              label="Create a new profile"
              title="Create a new profile"
              icon={<Plus size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
            />
          </div>
        </div>
      </div>
      <div className="profiles-filter-row">
        <input
          className="profiles-filter"
          type="search"
          placeholder="Filter profiles…"
          value={profileFilter}
          onChange={(event) => setProfileFilter(event.target.value)}
          disabled={!connected || switching || visibleProfiles.length === 0}
          aria-label="Filter profiles by name, description, or tags"
        />
        {profileFilter.trim() ? (
          <IconActionButton
            label="Clear"
            title="Clear"
            disabled={switching}
            onClick={ctrl.clearProfileFilter}
            icon={<X size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
          />
        ) : null}
      </div>
      <div
        className={["profiles-list", dropTarget === "end" ? "drop-target-end" : ""]
          .filter(Boolean)
          .join(" ")}
        onDragOver={onProfileListDragOver}
        onDrop={onProfileListDrop}
      >
        {profilesError && (
          <div className="empty-state">
            <p>{profilesError}</p>
            <IconActionButton
              label="Retry"
              disabled={switching}
              onClick={() => void ctrl.refreshProfiles()}
              icon={<RefreshCw size={16} strokeWidth={2} aria-hidden="true" />}
            />
          </div>
        )}
        {showRailSkeleton ? <SkeletonRow count={6} height={40} /> : null}
        {!showRailSkeleton && !profilesError && visibleProfiles.length === 0 && (
          <div className="empty-state">
            <h2>
              {profiles.length === 0
                ? "No profiles yet"
                : scope === "project"
                  ? "No project profiles"
                  : "No global profiles"}
            </h2>
            <p className="muted">
              {profiles.length === 0 ? (
                <>Create a profile to apply harness files.</>
              ) : scope === "project" ? (
                <>
                  Profiles listed in this project&apos;s{" "}
                  <span className="mono">apm.yml</span> appear in Project view.
                  Global-only profiles stay in Global.
                </>
              ) : (
                <>
                  Local profile plugins appear in Global. Switch to Project for
                  profiles enabled in the current project.
                </>
              )}
            </p>
            <IconActionButton
              primary
              data-testid="open-create-profile"
              label="Create profile"
              disabled={!connected || switching}
              onClick={() => onOpenCreateProfile()}
              icon={<Plus size={16} strokeWidth={2} aria-hidden="true" />}
            />
          </div>
        )}
        {!profilesError && visibleProfiles.length > 0 && filteredProfiles.length === 0 && (
          <div className="empty-state">
            <h2>No matching profiles</h2>
            <p className="muted">
              No profiles match “{profileFilter.trim()}”. Try a different name,
              description, or tag.
            </p>
            <IconActionButton
              label="Clear filter"
              onClick={() => setProfileFilter("")}
              icon={<FilterX size={16} strokeWidth={2} aria-hidden="true" />}
            />
          </div>
        )}
        {filteredProfiles.map((profile) => {
          const isActive = profile.name === activeProfile;
          const isSelected = profile.name === selectedProfile;
          const isDragging = draggingProfile === profile.name;
          const isDropBefore =
            dropTarget !== "end" && dropTarget?.name === profile.name && !dropTarget.placeAfter;
          const isDropAfter =
            dropTarget !== "end" && dropTarget?.name === profile.name && dropTarget.placeAfter;
          return (
            <div
              key={profile.name}
              className={[
                "profile-item",
                isActive ? "active" : "",
                isSelected ? "selected" : "",
                isDragging ? "dragging" : "",
                isDropBefore ? "drop-target-before" : "",
                isDropAfter ? "drop-target-after" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable={canReorderProfiles}
              aria-grabbed={isDragging}
              tabIndex={canReorderProfiles ? 0 : undefined}
              onDragStart={(event) => onProfileDragStart(event, profile.name)}
              onDragOver={(event) => onProfileRowDragOver(event, profile.name)}
              onDrop={(event) => onProfileRowDrop(event, profile.name)}
              onDragEnd={onProfileDragEnd}
              onKeyDown={(event) => {
                if (!canReorderProfiles) {
                  return;
                }
                if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                  event.preventDefault();
                  const names = visibleProfiles.map((entry) => entry.name);
                  const next = moveNameByDelta(
                    names,
                    profile.name,
                    event.key === "ArrowUp" ? -1 : 1,
                  );
                  if (next.some((name, index) => name !== names[index])) {
                    persistRailOrder(next);
                  }
                }
              }}
            >
              <span className="profile-item-handle" aria-hidden>
                <GripVertical size={RAIL_ICON_SIZE} strokeWidth={2} />
              </span>
              <button
                type="button"
                className="profile-item-main"
                data-testid={`profile-rail-${profile.name}`}
                draggable={canReorderProfiles}
                onDragStart={(event) => {
                  event.stopPropagation();
                  onProfileDragStart(event, profile.name);
                }}
                onClick={() => {
                  if (skipProfileClickRef.current) {
                    skipProfileClickRef.current = false;
                    return;
                  }
                  ctrl.selectProfile(profile.name);
                }}
                disabled={switching}
              >
                {profile.name}
                {isActive ? <span className="badge">active</span> : null}
              </button>
              <IconActionButton
                className="profile-item-action profile-item-edit"
                data-testid={`edit-profile-${profile.name}`}
                label={`Edit ${profile.name}`}
                title={`Edit ${profile.name}`}
                draggable={false}
                onDragStart={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                disabled={!connected || switching || stashBusy}
                onClick={() => ctrl.openEditProfile(profile.name)}
                icon={<Pencil size={RAIL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
              />
            </div>
          );
        })}
      </div>
      <div className="rail-controls">
        {ctrl.applyHelperState.kind === "changes" ? (
          <p className="muted apply-helper">
            {ctrl.applyHelperState.changeCount}{" "}
            {ctrl.applyHelperState.changeCount === 1 ? "change" : "changes"}
            {" · "}
            <button
              type="button"
              className="apply-helper-preview"
              onClick={() => ctrl.setPreviewChanges(true)}
            >
              Preview
            </button>
          </p>
        ) : ctrl.applyHelper ? (
          <p className="muted apply-helper">{ctrl.applyHelper}</p>
        ) : null}
        <button
          className={["btn", "primary", "rail-apply-action", switching ? "is-busy" : ""]
            .filter(Boolean)
            .join(" ")}
          type="button"
          onClick={ctrl.onApplyClick}
          disabled={ctrl.applyDisabled}
          aria-busy={switching}
          title={ctrl.applyButtonTitle}
        >
          {switching ? "Applying…" : ctrl.showReapply ? "Re-apply" : "Apply"}
          {switching ? (
            <ButtonSpinner size={16} />
          ) : ctrl.showReapply ? (
            <RotateCw size={16} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Check size={16} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
      </div>
    </nav>
  );
}
