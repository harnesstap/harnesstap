import * as format from "./format.js";
import { renderKv } from "./kv.js";
import { renderTable, table } from "./table.js";
import { renderPanel, panel, kvBlock } from "./panel.js";
import { renderDiffTable, diffTable, renderChangeList } from "./diff.js";
import { progress, createProgress } from "./progress.js";
import { status } from "./status.js";
import { icons, theme, disableColor } from "./theme.js";
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
  renderKv,
  diffTable,
  renderDiffTable,
  renderChangeList,
  spinner: progress,
  createProgress,
  ...status,
  disableColor,
};
