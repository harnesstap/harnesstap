import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Cable } from "lucide-react";
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
  harnessScopeAriaLabel,
  harnessScopeTooltip,
  isOrphanedHarnessScope,
  linkedHarnessGroups,
  normalizeScopeToRegistered,
  parseStoredHarnessScope,
  selectionFromGroups,
  type HarnessScope,
  type LinkedHarnessGroup,
  type SerializerTarget,
} from "../../lib/harness-scope-ui";

const ICON_PX = 14;
const FILTER_THRESHOLD = 8;

export interface HarnessScopeControlProps {
  resourceName: string;
  resourceType: string;
  stored: "all" | string[] | undefined;
  registered: readonly string[];
  catalogNames?: Readonly<Record<string, string>>;
  target: SerializerTarget;
  disabled?: boolean;
  onChange: (scope: HarnessScope) => void;
  initialOpen?: boolean;
}

function stop(event: MouseEvent) {
  event.stopPropagation();
}

function namesFor(
  catalogNames: Readonly<Record<string, string>> | undefined,
): (id: string) => string {
  return (id) => displayNameForHarness(id, catalogNames?.[id]);
}

function selectedIds(scope: HarnessScope, registered: readonly string[]): string[] {
  if (scope.kind === "all") {
    return [...registered];
  }
  return [...scope.harnesses];
}

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
}: HarnessScopeControlProps): ReactNode {
  const [open, setOpen] = useState(initialOpen);
  const [filter, setFilter] = useState("");
  const committed = useMemo(() => parseStoredHarnessScope(stored), [stored]);
  const [draftIds, setDraftIds] = useState<string[]>(() =>
    selectedIds(committed, registered),
  );
  const restoreRef = useRef<string[]>(selectedIds(committed, registered));
  const contentRef = useOverlayLayer<HTMLDivElement>({
    open,
    onClose: () => setOpen(false),
    trapFocus: false,
  });
  const nameOf = namesFor(catalogNames);
  const mainId = registered[0];
  const groups = useMemo(
    () => linkedHarnessGroups(registered, resourceType, target),
    [registered, resourceType, target],
  );
  const orderedGroups = useMemo(() => {
    const options = groups.map((group) => ({
      id: group.key,
      name: groupLabel(group.harnessIds, nameOf),
      group,
    }));
    const mainGroup = options.find((option) => option.group.harnessIds.includes(mainId ?? ""));
    const rest = options
      .filter((option) => option !== mainGroup)
      .sort((a, b) => a.name.localeCompare(b.name));
    return mainGroup ? [mainGroup, ...rest] : rest;
  }, [groups, mainId, nameOf]);
  const filteredGroups = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return orderedGroups;
    return orderedGroups.filter((option) => option.name.toLowerCase().includes(query));
  }, [filter, orderedGroups]);
  const orphaned = isOrphanedHarnessScope(committed, registered);
  const subset = committed.kind === "subset" || orphaned;
  const showControl = registered.length >= 2;
  const draftSet = useMemo(() => new Set(draftIds), [draftIds]);
  const emptyDraft = open && draftIds.length === 0;

  useEffect(() => {
    if (!open) {
      setDraftIds(selectedIds(committed, registered));
      restoreRef.current = selectedIds(committed, registered);
      setFilter("");
    }
  }, [committed, open, registered]);

  if (!showControl) {
    return null;
  }

  const persist = (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }
    onChange(
      normalizeScopeToRegistered({ kind: "subset", harnesses: ids }, registered),
    );
  };

  const toggleGroup = (group: LinkedHarnessGroup, checked: boolean) => {
    const next = expandLinkedSelection(draftIds, group.harnessIds, checked);
    setDraftIds(next);
    persist(next);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && draftIds.length === 0) {
      const restored = restoreRef.current;
      setDraftIds(restored);
      persist(restored);
    }
    setOpen(nextOpen);
  };

  const tooltip = harnessScopeTooltip(committed, registered, nameOf);
  const aria = harnessScopeAriaLabel(resourceName);
  const visibleIcons = committed.kind === "subset"
    ? committed.harnesses.filter((id) => registered.includes(id)).slice(0, 3)
    : [];
  const extra = committed.kind === "subset"
    ? Math.max(0, committed.harnesses.filter((id) => registered.includes(id)).length - 3)
    : 0;

  const trigger = subset ? (
    <button
      type="button"
      className={[
        "harness-scope-cluster",
        orphaned ? "is-orphaned" : "",
      ].filter(Boolean).join(" ")}
      aria-label={aria}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
      data-testid="harness-scope-cluster"
      onClick={stop}
    >
      {orphaned || visibleIcons.length === 0 ? (
        <HarnessMark id="?" size={ICON_PX} />
      ) : (
        visibleIcons.map((id) => <HarnessMark key={id} id={id} size={ICON_PX} />)
      )}
      {extra > 0 ? (
        <span className="harness-scope-plus">+{extra}</span>
      ) : null}
    </button>
  ) : (
    <button
      type="button"
      className="icon-action harness-scope-all-action"
      aria-label={aria}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
      data-testid="harness-scope-all-action"
      onClick={stop}
    >
      <Cable size={ICON_PX} strokeWidth={2} aria-hidden />
    </button>
  );

  return (
    <span className="harness-scope-control" onClick={stop}>
      <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
        <ChromeTooltip content={tooltip}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </ChromeTooltip>
        <PopoverContent
          ref={contentRef}
          align="end"
          side="bottom"
          className="harness-scope-popover"
          data-testid="harness-scope-popover"
          aria-label={HARNESS_SCOPE_COPY.useOn}
          onClick={stop}
        >
          <header className="harness-scope-popover-header">
            <h3>{HARNESS_SCOPE_COPY.useOn}</h3>
            <span className="harness-scope-popover-actions">
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  const ids = [...registered];
                  setDraftIds(ids);
                  persist(ids);
                }}
              >
                {HARNESS_SCOPE_COPY.selectAll}
              </button>
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setDraftIds([]);
                }}
              >
                {HARNESS_SCOPE_COPY.none}
              </button>
            </span>
          </header>
          {registered.length > FILTER_THRESHOLD ? (
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={HARNESS_SCOPE_COPY.filterPlaceholder}
              aria-label={HARNESS_SCOPE_COPY.filterPlaceholder}
              data-testid="harness-scope-filter"
            />
          ) : null}
          <div className="harness-scope-list" role="group" aria-label={HARNESS_SCOPE_COPY.useOn}>
            {filteredGroups.map((option) => {
              const checked = selectionFromGroups(draftSet, option.group);
              const isMain = Boolean(mainId && option.group.harnessIds.includes(mainId));
              const label = option.name;
              const row = (
                <label
                  key={option.id}
                  className="harness-scope-row"
                  title={option.group.linked ? HARNESS_SCOPE_COPY.linkedTooltip : undefined}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => {
                      toggleGroup(option.group, value === true);
                    }}
                    aria-label={label}
                  />
                  <span className="harness-scope-row-icons" aria-hidden>
                    {option.group.harnessIds.slice(0, 2).map((id) => (
                      <HarnessMark key={id} id={id} size={ICON_PX} />
                    ))}
                  </span>
                  <span className="harness-scope-row-name">{label}</span>
                  {isMain && option.group.harnessIds.length === 1 ? (
                    <span className="badge pill harness-scope-main">{HARNESS_SCOPE_COPY.main}</span>
                  ) : null}
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
          {emptyDraft ? (
            <p className="harness-scope-empty-hint muted">{HARNESS_SCOPE_COPY.emptyHint}</p>
          ) : null}
        </PopoverContent>
      </Popover>
    </span>
  );
}
