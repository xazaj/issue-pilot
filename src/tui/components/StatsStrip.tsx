import React from "react";
import type { Theme, StatsState } from "../types.js";
import { s, trunc, fmtTok, borderedFit, BOX } from "../text-utils.js";
import { Row, HLine } from "./Row.js";

interface StatsStripProps {
  t: Theme;
  width: number;
  stats: StatsState;
  queueLen: number;
  modelShort: string;
  timeoutStr: string;
}

export function StatsStrip({ t, width, stats, queueLen, modelShort, timeoutStr }: StatsStripProps) {
  const innerW = width - 2;
  const sep = s("  \u2502 ", t.border);
  const todayRate = stats.todayRate;
  const totalRate = stats.totalRate;

  // Model name: truncate to available space
  // Reserve ~55 chars for fixed stats, rest for model + timeout
  const modelMaxW = Math.max(4, innerW - 58);

  // borderedFit guarantees exact width - no overflow possible
  const line = borderedFit([
    s(" TODAY ", t.dim),
    s(`${stats.todayDone}`, t.success), s("\u2713", t.success), s(" "),
    s(`${stats.todayFail}`, t.error), s("\u2717", t.error),
    s(` ${todayRate}%`, todayRate >= 80 ? t.success : t.warning),
    sep,
    s("ALL ", t.dim),
    s(`${stats.totalDone}`, t.success), s("\u2713", t.success), s(" "),
    s(`${stats.totalFail}`, t.error), s("\u2717", t.error),
    s(` ${totalRate}%`, totalRate >= 80 ? t.success : t.warning),
    sep,
    s(`\u2193${fmtTok(stats.totalTokensIn)}`, t.info),
    s(" "),
    s(`\u2191${fmtTok(stats.totalTokensOut)}`, t.info),
    sep,
    s(`Q:${queueLen}`, queueLen > 0 ? t.accent : t.dim),
    sep,
    s(trunc(modelShort, modelMaxW), t.accent),
    s(` T:${timeoutStr}`, t.dim),
    s(" "),
  ], width, t);

  return (
    <>
      <HLine t={t} width={width} left={BOX.lt} right={BOX.rt} />
      <Row t={t} width={width} line={line} />
    </>
  );
}
