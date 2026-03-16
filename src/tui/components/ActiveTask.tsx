import React from "react";
import stringWidth from "string-width";
import type { Theme, TaskState } from "../types.js";
import { s, trunc, fmtDur, fmtTok, progressSegs, fitSegs, borderedFit, sanitize, SPINNER, BOX } from "../text-utils.js";
import { Row, HLine } from "./Row.js";

interface ActiveTaskProps {
  t: Theme;
  width: number;
  task: TaskState;
  timeoutMs: number;
  spin: number;
  cfgErr: string | null;
}

export function ActiveTask({ t, width, task, timeoutMs, spin, cfgErr }: ActiveTaskProps) {
  const innerW = width - 2;

  let segs: ReturnType<typeof s>[];

  if (task.curTask) {
    const pct = Math.min(99, Math.round(
      ((Date.now() - task.curTask.startedAt.getTime()) / timeoutMs) * 100,
    ));
    const elapsed = fmtDur(Date.now() - task.curTask.startedAt.getTime());
    const progW = Math.max(6, Math.min(16, Math.floor(innerW * 0.12)));

    // Token display
    const tokStr = task.liveTokens && (task.liveTokens.input > 0 || task.liveTokens.output > 0)
      ? ` \u2193${fmtTok(task.liveTokens.input)} \u2191${fmtTok(task.liveTokens.output)}`
      : "";

    // Fixed parts: " NOW ►  #NNN " + [title] + "  " + progress + " NN%  Xm00s" + tok + " ⠹ "
    const issuePrefix = `#${task.curTask.issue.number} `;
    const pctStr = ` ${pct}%`;
    const elapsedStr = `  ${elapsed}`;
    const spinnerStr = ` ${SPINNER[spin]}`;

    // Calculate title max width from remaining space
    const fixedW = 8 + stringWidth(issuePrefix) + 2 + progW + stringWidth(pctStr)
      + stringWidth(elapsedStr) + stringWidth(tokStr) + stringWidth(spinnerStr) + 1;
    const titleMaxW = Math.max(1, innerW - fixedW);

    segs = [
      s(" NOW ", t.title, true),
      s("\u25BA  ", t.accent),
      s(issuePrefix, t.highlight),
      s(trunc(sanitize(task.curTask.issue.title), titleMaxW)),
      s("  "),
      ...progressSegs(pct, progW, t),
      s(pctStr),
      s(elapsedStr, undefined, undefined, true),
      s(tokStr, t.dim),
      s(spinnerStr, t.accent),
      s(" "),
    ];
  } else if (cfgErr) {
    segs = [
      s(" NOW ", t.title, true),
      s("   \u26A0 ", t.error),
      s(trunc(cfgErr, Math.max(1, innerW - 12)), t.error),
    ];
  } else {
    segs = [
      s(" NOW ", t.title, true),
      s("   No active task", undefined, undefined, true),
    ];
  }

  // borderedFit guarantees the output is exactly `width` chars
  return (
    <>
      <Row t={t} width={width} line={borderedFit(segs, width, t)} />
      <HLine t={t} width={width} left={BOX.lt} right={BOX.rt} />
    </>
  );
}
