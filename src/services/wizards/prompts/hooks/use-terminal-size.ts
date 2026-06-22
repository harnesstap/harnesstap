import { useEffect, useState } from "@inquirer/core";
import { terminalColumns, terminalRows } from "../../../../ui/theme.js";

export type TerminalSize = {
  width: number;
  height: number;
};

export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>({
    width: terminalColumns(),
    height: terminalRows(),
  });
  useEffect(() => {
    const onResize = () =>
      setSize({ width: terminalColumns(), height: terminalRows() });
    process.stdout.on("resize", onResize);
    return () => process.stdout.off("resize", onResize);
  }, []);
  return size;
}
