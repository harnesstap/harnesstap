import { getHarnessPreference } from "../models/harness.js";
import type { Resource } from "../types.js";
import {
  type HarnessScope,
  HARNESS_SCOPE_ALL,
  resourceHarnessScope,
} from "./harness-scope.js";
import {
  registeredHarnessesOf,
  uniqueHarnessTargets,
} from "./harness-targets.js";

/**
 * Where this resource applies: resource harness scope intersected with the
 * registered harness set, in registered order. Sidecar and CLI share this
 * selector so Desktop hover cards, Use on, Preview, and apply agree.
 */
export type ResourceApplySelector = {
  registered: readonly string[];
  harnesses: string[];
  notSetUp: boolean;
};

export function registeredHarnessIds(): string[] {
  return registeredHarnessesOf(getHarnessPreference());
}

export function whereResourceApplies(
  scope: HarnessScope,
  registered: readonly string[],
): ResourceApplySelector {
  const ordered = uniqueHarnessTargets(registered);
  if (ordered.length === 0) {
    return { registered: ordered, harnesses: [], notSetUp: true };
  }
  if (scope.kind === "all") {
    return { registered: ordered, harnesses: [...ordered], notSetUp: false };
  }
  const allowed = new Set(scope.harnesses);
  return {
    registered: ordered,
    harnesses: ordered.filter((id) => allowed.has(id)),
    notSetUp: false,
  };
}

export function whereResourceAppliesNow(
  resource: Pick<Resource, "harness_scope"> | { harness_scope?: HarnessScope },
  registered: readonly string[] = registeredHarnessIds(),
): ResourceApplySelector {
  return whereResourceApplies(
    resourceHarnessScope(resource as Pick<Resource, "harness_scope">),
    registered,
  );
}

export function allHarnessApplySelector(
  registered: readonly string[] = registeredHarnessIds(),
): ResourceApplySelector {
  return whereResourceApplies(HARNESS_SCOPE_ALL, registered);
}
