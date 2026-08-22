import type { HeaderDestination } from "./header-destination";

export const WORKSPACE_BACK_LABEL = "Back";

export function pushScreenHistory(
  stack: readonly HeaderDestination[],
  current: HeaderDestination,
  next: HeaderDestination,
): HeaderDestination[] {
  if (current === next) {
    return [...stack];
  }
  return [...stack, current];
}

export function popScreenHistory(
  stack: readonly HeaderDestination[],
): {
  stack: HeaderDestination[];
  previous: HeaderDestination | null;
} {
  if (stack.length === 0) {
    return { stack: [], previous: null };
  }
  const previous = stack[stack.length - 1];
  if (previous === undefined) {
    return { stack: [], previous: null };
  }
  return { stack: stack.slice(0, -1), previous };
}

export function canPopScreenHistory(
  stack: readonly HeaderDestination[],
): boolean {
  return stack.length > 0;
}

export function workspaceBackEnabled(input: {
  hasLocalPrevious: boolean;
  hasWorkspacePrevious: boolean;
}): boolean {
  return input.hasLocalPrevious || input.hasWorkspacePrevious;
}
