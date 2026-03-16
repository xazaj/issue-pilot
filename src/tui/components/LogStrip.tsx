import React from "react";
import type { Theme, LogFilter } from "../types.js";
import type { LogEntry } from "../log-buffer.js";
import { levelLabel } from "../log-buffer.js";
import { s, trunc, fmtLogTime, borderedFit, BOX } from "../text-utils.js";
import { Row, HLine } from "./Row.js";

interface LogStripProps {
  t: Theme;
  width: number;
  lines: number;
  logs: LogEntry[];
  scroll: number;
  filter: LogFilter;
  filterInput: string | null;
}

function applyFilter(logs: LogEntry[], filter: LogFilter): LogEntry[] {
  let result = logs;
  if (filter.level != null) {
    result = result.filter(e => e.level >= filter.level!);
  }
  if (filter.module) {
    const mod = filter.module.toLowerCase();
    result = result.filter(e => ((e.module as string) ?? "").toLowerCase().includes(mod));
  }
  if (filter.keyword) {
    const kw = filter.keyword.toLowerCase();
    result = result.filter(e => e.msg.toLowerCase().includes(kw));
  }
  return result;
}

function logLevelBg(level: number): string | undefined {
  if (level >= 50) return "#3D0000";
  if (level >= 40) return "#3D2B00";
  return undefined;
}

export function LogStrip({ t, width, lines: lineCount, logs, scroll, filter, filterInput }: LogStripProps) {
  const filtered = applyFilter(logs, filter);
  const reversed = [...filtered].reverse();
  const visible = reversed.slice(scroll, scroll + lineCount);
  const innerW = width - 2;

  // Filter status indicator
  const filterTag = filterInput !== null
    ? ` /${filterInput}\u2588`
    : filter.level || filter.module || filter.keyword
      ? ` [${[
          filter.level ? `>=${levelLabel(filter.level)}` : "",
          filter.module ?? "",
          filter.keyword ?? "",
        ].filter(Boolean).join(" ")}]`
      : "";
  const scrollTag = scroll > 0 ? ` +${scroll}` : "";

  const elements: React.ReactNode[] = [];
  elements.push(<HLine key="ls" t={t} width={width} left={BOX.lt} right={BOX.rt} />);

  for (let i = 0; i < lineCount; i++) {
    const entry = visible[i];
    if (entry) {
      const time = fmtLogTime(entry.time);
      const lvl = levelLabel(entry.level);
      const mod = ((entry.module as string) ?? "").slice(0, 10).padEnd(10);
      const lc = entry.level >= 50 ? t.error : entry.level >= 40 ? t.warning : t.info;
      const bg = logLevelBg(entry.level);
      const rowTheme = bg ? { ...t, bg } : t;

      // Tags only on first line
      const tagStr = i === 0 ? filterTag + scrollTag : "";
      const msgWidth = Math.max(1, innerW - 21 - tagStr.length);

      // borderedFit guarantees exact width - safe from overflow
      elements.push(
        <Row key={`ll${i}`} t={rowTheme} width={width} line={borderedFit([
          s(` ${time} `, undefined, undefined, true),
          s(lvl, lc, entry.level >= 50),
          s(` ${mod} `, undefined, undefined, true),
          s(trunc(entry.msg, msgWidth)),
          tagStr ? s(tagStr, t.accent) : s(""),
        ], width, rowTheme)} />,
      );
    } else {
      const emptyMsg = i === 0 && logs.length === 0 ? " Waiting for log output..." : "";
      elements.push(
        <Row key={`ll${i}`} t={t} width={width} line={borderedFit([
          s(emptyMsg, undefined, undefined, true),
        ], width, t)} />,
      );
    }
  }

  return <>{elements}</>;
}
