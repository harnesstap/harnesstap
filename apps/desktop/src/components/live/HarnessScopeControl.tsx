import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ChromeTooltip } from "../ChromeTooltip";
import { HarnessMark } from "../HarnessIcons";
import { useOverlayLayer } from "../../state/overlay-stack";
import {
  displayNameForHarness,
  expandLinkedSelection,
  groupLabel,
  HARNESS_SCOPE_COPY,
  linkedHarnessGroups,
  normalizeScopeToRegistered,
  parseStoredHarnessScope,
  selectionFromGroups,
  sortHarnessOptions,
  type HarnessScope,
  type LinkedHarnessGroup,
  type SerializerTarget,
} from "../../lib/harness-scope-ui";
import { LAST_TOOL_HINT, uncheckHarnessGroup } from "../../lib/chip-harness";

const ICON_PX = 14;
const FILTER_THRESHOLD = 8;

export const TOOLS_COPY = {
  tooltip: "Choose tools",
  title: "Use in",
  aria: (resourceName: string) => `Choose tools for ${resourceName}`,
  off: (name: string) => `${name} (not turned on)`,
} as const;

export interface HarnessScopeControlProps {
  resourceName: string;
  resourceType: string;
  stored: "all" | string[] | undefined;
  registered: readonly string[];
  catalogNames?: Readonly<Record<string, string>>;
  target: SerializerTarget;
  disabled?: boolean;
  onChange: (scope: HarnessScope) => void | Promise<unknown>;
  initialOpen?: boolean;
  /**
   * Called on every change so the pill label can update before the save
   * returns, and with undefined if the save fails.
   */
  onDraftChange?: (stored: "all" | string[] | undefined) => void;
}

function stop(event: MouseEvent) {
  event.stopPropagation();
}

function selectedIds(scope: HarnessScope, registered: readonly string[]): string[] {
  return scope.kind === "all" ? [...registered] : [...scope.harnesses];
}

function storedFrom(scope: HarnessScope): "all" | string[] {
  return scope.kind === "all" ? "all" : [...scope.harnesses];
}

/**
 * The one per-resource way to change which tools a resource is in: a Tools
 * button in the pill's edit actions that opens one checkbox per harness.
 * Every change saves into the profile draft, like the rest of edit.
 */
export function HarnessScopeControl({
  resourceName,
  resourceType,
  stored,
  registered,
  catalogNames,
  target,
  disabled = false,
  onChange,
  initialOpen = false,
  onDraftChange,
}: HarnessScopeControlProps): ReactNode {
  const [open, setOpen] = useState(initialOpen);
  const [filter, setFilter] = useState("");
  const [lastToolHint, setLastToolHint] = useState(false);
  const committed = useMemo(() => parseStoredHarnessScope(stored), [stored]);
  const [draftIds, setDraftIds] = useState<string[]>(() => selectedIds(committed, registered));
  const contentRef = useOverlayLayer<HTMLDivElement>({
    open,
    onClose: () => setOpen(false),
    trapFocus: false,
  });
  const nameOf = useMemo(
    () => (id: string) => displayNameForHarness(id, catalogNames?.[id]),
    [catalogNames],
  );
  const groups = useMemo(() => {
    const live = linkedHarnessGroups(registered, resourceType, target);
    // A harness the resource is in but that is not turned on still gets a
    // row with its own logo, so it can be seen and unchecked.
    const off = committed.kind === "subset"
      ? committed.harnesses.filter((id) => !registered.includes(id))
      : [];
    return [
      ...live.map((group) => ({ group, off: false })),
      ...off.map((id) => ({
        group: { key: `off:${id}`, harnessIds: [id], linked: false } as LinkedHarnessGroup,
        off: true,
      })),
    ];
  }, [committed, registered, resourceType, target]);
  const orderedGroups = useMemo(
    () =>
      sortHarnessOptions(
        groups.map(({ group, off }) => ({
          id: group.key,
          name: off ? TOOLS_COPY.off(nameOf(group.harnessIds[0] ?? "")) : groupLabel(group.harnessIds, nameOf),
          group,
          off,
        })),
      ),
    [groups, nameOf],
  );
  const filteredGroups = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return orderedGroups;
    return orderedGroups.filter((option) => option.name.toLowerCase().includes(query));
  }, [filter, orderedGroups]);
  const draftSet = useMemo(() => new Set(draftIds), [draftIds]);

  useEffect(() => {
    if (!open) {
      setDraftIds(selectedIds(committed, registered));
      setFilter("");
      setLastToolHint(false);
    }
  }, [committed, open, registered]);

  if (registered.length < 2 && committed.kind === "all") {
    return null;
  }

  const persist = (ids: string[]) => {
    const scope = normalizeScopeToRegistered({ kind: "subset", harnesses: ids }, registered);
    onDraftChange?.(storedFrom(scope));
    void Promise.resolve(onChange(scope)).catch(() => onDraftChange?.(undefined));
  };

  const toggleGroup = (group: LinkedHarnessGroup, checked: boolean) => {
    if (checked) {
      const next = expandLinkedSelection(draftIds, group.harnessIds, true);
      setLastToolHint(false);
      setDraftIds(next);
      persist(next);
      return;
    }
    const next = uncheckHarnessGroup(draftIds, group.harnessIds);
    if (!next) {
      setLastToolHint(true);
      return;
    }
    setLastToolHint(false);
    setDraftIds(next);
    persist(next);
  };

  return (
    <span className="harness-scope-control" onClick={stop}>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <ChromeTooltip content={TOOLS_COPY.tooltip}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="icon-action harness-tools-action"
              aria-label={TOOLS_COPY.aria(resourceName)}
              aria-haspopup="dialog"
              aria-expanded={open}
              disabled={disabled}
              data-testid="harness-tools-action"
              onClick={stop}
            >
              <Wrench size={ICON_PX} strokeWidth={2} aria-hidden />
            </button>
          </PopoverTrigger>
        </ChromeTooltip>
        <PopoverContent
          ref={contentRef}
          align="end"
          side="bottom"
          className="harness-scope-popover"
          data-testid="harness-scope-popover"
          aria-label={TOOLS_COPY.aria(resourceName)}
          onClick={stop}
        >
          <header className="harness-scope-popover-header">
            <h3>{TOOLS_COPY.title}</h3>
            <span className="harness-scope-popover-actions">
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  const ids = [...new Set([...draftIds, ...registered])];
                  setLastToolHint(false);
                  setDraftIds(ids);
                  persist(ids);
                }}
              >
                {HARNESS_SCOPE_COPY.selectAll}
              </button>
            </span>
          </header>
          {orderedGroups.length > FILTER_THRESHOLD ? (
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={HARNESS_SCOPE_COPY.filterPlaceholder}
              aria-label={HARNESS_SCOPE_COPY.filterPlaceholder}
              data-testid="harness-scope-filter"
            />
          ) : null}
          <div className="harness-scope-list" role="group" aria-label={TOOLS_COPY.title}>
            {filteredGroups.map((option) => {
              const checked = selectionFromGroups(draftSet, option.group);
              const row = (
                <label
                  key={option.id}
                  className={["harness-scope-row", option.off ? "is-off" : ""].filter(Boolean).join(" ")}
                  data-testid={`harness-tools-row-${option.group.harnessIds.join("-")}`}
                >
                  <Checkbox
                    checked={checked}
                    disabled={option.off && !checked}
                    onCheckedChange={(value) => {
                      toggleGroup(option.group, value === true);
                    }}
                    aria-label={option.name}
                  />
                  <span className="harness-scope-row-icons" aria-hidden>
                    {option.group.harnessIds.slice(0, 2).map((id) => (
                      <HarnessMark key={id} id={id} size={ICON_PX} />
                    ))}
                  </span>
                  <span className="harness-scope-row-name">{option.name}</span>
                </label>
              );
              return option.group.linked ? (
                <ChromeTooltip key={option.id} content={HARNESS_SCOPE_COPY.linkedTooltip}>
                  {row}
                </ChromeTooltip>
              ) : (
                row
              );
            })}
          </div>
          {lastToolHint ? (
            <p className="harness-scope-empty-hint muted" role="status" data-testid="harness-tools-last-hint">
              {LAST_TOOL_HINT}
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
    </span>
  );
}
