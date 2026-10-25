import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import { useOverlayLayer } from "../state/overlay-stack";
import {
  filterRecentProjects,
  loadRecentProjects,
  projectDisplayName,
  type RecentProject,
} from "../lib/recent-projects";
import { compactHomePath } from "../lib/compact-path";
import { noResultsTitle } from "../lib/empty-copy";
import { noSpellcheckProps } from "../lib/no-spellcheck";
import { ChromeTooltip } from "./ChromeTooltip";
import { IconActionButton } from "./IconActionButton";
import { Presence } from "./motion/Presence";

interface ProjectPickerProps {
  projectPath: string;
  disabled?: boolean;
  testId?: string;
  onSelect: (path: string) => void;
  onBrowse: () => void;
  /** `chevron`: icon-only trigger labelled `chevronLabel` (Profile scope switch). */
  variant?: "field" | "chevron";
  chevronLabel?: string;
  /** Controlled open state; omit both to let the picker own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ProjectPicker({
  projectPath,
  disabled = false,
  testId = "project-path",
  onSelect,
  onBrowse,
  variant = "field",
  chevronLabel = "Switch project",
  open: openProp,
  onOpenChange,
}: ProjectPickerProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const openRef = useRef(open);
  openRef.current = open;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const controlled = openProp !== undefined;
  const setOpen = useCallback(
    (next: boolean) => {
      if (next === openRef.current) {
        return;
      }
      if (!controlled) {
        setOpenState(next);
      }
      onOpenChangeRef.current?.(next);
    },
    [controlled],
  );
  const [filter, setFilter] = useState("");
  const [recent, setRecent] = useState<RecentProject[]>(() => loadRecentProjects());
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () => filterRecentProjects(recent, filter),
    [filter, recent],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setRecent(loadRecentProjects());
    setFilter("");
    const timer = window.setTimeout(() => filterRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, setOpen]);

  // Popover layer: Esc closes it, Tab is not trapped, focus returns to the trigger.
  useOverlayLayer({
    open,
    onClose: () => setOpen(false),
    initialFocusRef: filterRef,
    trapFocus: false,
  });

  const label = projectPath
    ? projectDisplayName(projectPath)
    : "Select a project...";

  const trigger = variant === "chevron"
    ? (
      <ChromeTooltip content={chevronLabel}>
        <button
          type="button"
          className="project-picker-trigger is-chevron"
          id={testId}
          data-testid={testId}
          disabled={disabled}
          aria-label={chevronLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </ChromeTooltip>
    )
    : (
      <button
        type="button"
        className="project-picker-trigger"
        id={testId}
        data-testid={testId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={projectPath || "Choose a project directory"}
      >
        <span className="project-picker-label">{label}</span>
        <span className="project-picker-caret" aria-hidden>
          ▾
        </span>
      </button>
    );

  return (
    <div
      className={`project-picker${variant === "chevron" ? " is-chevron" : ""}`}
      ref={rootRef}
    >
      {trigger}
      <Presence
        open={open}
        enter="m-scale-in"
        exit="m-scale-out"
        className="project-picker-menu"
        role="listbox"
      >
        <input
          ref={filterRef}
          className="project-picker-filter"
          type="search"
          placeholder="Filter recent projects..."
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter recent projects"
          {...noSpellcheckProps}
        />
        <div className="project-picker-list">
          {filtered.length === 0 ? (
            <div className="project-picker-empty muted">
              {recent.length === 0
                ? "No recent projects yet."
                : noResultsTitle(filter)}
            </div>
          ) : (
            filtered.map((row) => {
              const selected = row.path === projectPath;
              return (
                <button
                  key={row.path}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`project-picker-item${selected ? " selected" : ""}`}
                  onClick={() => {
                    onSelect(row.path);
                    setOpen(false);
                  }}
                >
                  <span className="project-picker-item-name">
                    {projectDisplayName(row.path)}
                  </span>
                  <span className="project-picker-item-path mono muted">
                    {compactHomePath(row.path)}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="project-picker-footer">
          <IconActionButton
            label="Browse..."
            onClick={() => {
              setOpen(false);
              onBrowse();
            }}
            icon={<FolderOpen size={16} aria-hidden />}
          />
        </div>
      </Presence>
    </div>
  );
}
