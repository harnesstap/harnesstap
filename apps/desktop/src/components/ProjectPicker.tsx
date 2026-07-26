import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterRecentProjects,
  loadRecentProjects,
  projectDisplayName,
  type RecentProject,
} from "../lib/recent-projects";

interface ProjectPickerProps {
  projectPath: string;
  disabled?: boolean;
  onSelect: (path: string) => void;
  onBrowse: () => void;
}

export function ProjectPicker({
  projectPath,
  disabled = false,
  onSelect,
  onBrowse,
}: ProjectPickerProps) {
  const [open, setOpen] = useState(false);
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const label = projectPath
    ? projectDisplayName(projectPath)
    : "Select a project…";

  return (
    <div className="project-picker" ref={rootRef}>
      <button
        type="button"
        className="project-picker-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        title={projectPath || "Choose a project directory"}
      >
        <span className="project-picker-label">{label}</span>
        <span className="project-picker-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="project-picker-menu" role="listbox">
          <input
            ref={filterRef}
            className="project-picker-filter"
            type="search"
            placeholder="Filter recent projects…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="Filter recent projects"
          />
          <div className="project-picker-list">
            {filtered.length === 0 ? (
              <div className="project-picker-empty muted">
                {recent.length === 0
                  ? "No recent projects yet."
                  : "No matches."}
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
                      {row.path}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="project-picker-footer">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setOpen(false);
                onBrowse();
              }}
            >
              Browse…
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
