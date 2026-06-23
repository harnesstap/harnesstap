import { useEffect, useState } from "@inquirer/core";
import { terminalColumns, terminalRows } from "../../../../ui/theme.js";

export type TerminalSize = {
  width: number;
  height: number;
};

const resizeSubscribers = new Set<() => void>();

function notifyResizeSubscribers(): void {
  for (const subscriber of resizeSubscribers) {
    subscriber();
  }
}

function subscribeResize(onResize: () => void): () => void {
  resizeSubscribers.add(onResize);
  if (resizeSubscribers.size === 1 && process.stdout.isTTY) {
    process.stdout.on("resize", notifyResizeSubscribers);
  }
  return () => {
    resizeSubscribers.delete(onResize);
    if (resizeSubscribers.size === 0 && process.stdout.isTTY) {
      process.stdout.off("resize", notifyResizeSubscribers);
    }
  };
}

export function readTerminalSize(): TerminalSize {
  return {
    width: terminalColumns(),
    height: terminalRows(),
  };
}

export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(readTerminalSize);
  useEffect(() => subscribeResize(() => setSize(readTerminalSize())), []);
  return size;
}
