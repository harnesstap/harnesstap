import { useEffect, useState } from "@inquirer/core";
import { terminalColumns, terminalRows } from "../../../../ui/theme.js";

export type TerminalSize = {
  width: number;
  height: number;
};

export function readTerminalSize(): TerminalSize {
  return {
    width: terminalColumns(),
    height: terminalRows(),
  };
}

export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(readTerminalSize);
  useEffect(() => {
    const onResize = () => setSize(readTerminalSize());
    onResize();
    process.stdout.on("resize", onResize);
    return () => process.stdout.off("resize", onResize);
  }, []);
  return size;
}
