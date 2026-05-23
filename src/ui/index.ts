import * as format from "./format.js";
import { renderTable, table } from "./table.js";
import { renderPanel, panel, kvBlock } from "./panel.js";
import { renderDiffTable, diffTable } from "./diff.js";
import { progress } from "./progress.js";
import { status } from "./status.js";
import { icons, theme } from "./theme.js";
import { header, renderHeader, subheader, renderSubheader, rule, renderRule } from "./section.js";

export const ui = {
  format,
  icons,
  theme,
  header,
  renderHeader,
  subheader,
  renderSubheader,
  rule,
  renderRule,
  table,
  renderTable,
  panel,
  renderPanel,
  kvBlock,
  diffTable,
  renderDiffTable,
  spinner: progress,
  ...status,
};
