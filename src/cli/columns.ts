import { ui } from "../ui/index.js";
import type { Column } from "../ui/table.js";

export function makeIdColumn(showId: boolean, width = 12): Column[] {
  return showId
    ? [{
        key: "id",
        header: "ID",
        width,
        transform: (value: string) => ui.format.shortenId(String(value)),
      }]
    : [];
}
