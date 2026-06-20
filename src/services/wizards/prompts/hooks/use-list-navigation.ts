import { isDownKey, isUpKey } from "@inquirer/core";
import { clampActiveIndex } from "../primitives.js";

export function moveActiveIndex(
  active: number,
  direction: -1 | 1,
  length: number,
  loop = false,
): number {
  if (length === 0) {
    return 0;
  }

  if (loop) {
    return (active + direction + length) % length;
  }

  return clampActiveIndex(active + direction, length);
}

export type NavigationKeypressParams = {
  clampedActive: number;
  length: number;
  setActive: (active: number) => void;
  key: { name?: string; sequence?: string };
  loop?: boolean;
};

export function handleNavigationKeypress(params: NavigationKeypressParams): boolean {
  const { clampedActive, length, setActive, key, loop = false } = params;

  if (length === 0 || (!isUpKey(key) && !isDownKey(key))) {
    return false;
  }

  const direction = isUpKey(key) ? -1 : 1;
  setActive(moveActiveIndex(clampedActive, direction, length, loop));
  return true;
}
