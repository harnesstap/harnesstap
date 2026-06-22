import { useEffect, useState } from "@inquirer/core";
import { terminalColumns } from "../../../../ui/theme.js";

export function useTerminalSize(): number {
  const [width, setWidth] = useState(terminalColumns());
  useEffect(() => {
    const onResize = () => setWidth(terminalColumns());
    process.stdout.on("resize", onResize);
    return () => process.stdout.off("resize", onResize);
  }, []);
  return width;
}
