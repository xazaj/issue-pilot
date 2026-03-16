import React from "react";
import stringWidth from "string-width";
import type { Theme, RecentEntry } from "../types.js";
import { s, trunc, fmtDur, fmtTok, fmtTimeShort, padStartW, fitSegs, borderedFit, sanitize, BOX } from "../text-utils.js";
import { Row } from "./Row.js";

// ---- Column definitions ----
// Each column has a fixed width (display chars) including its left gap.
// Layout: [margin1][idx][gap][time][gap][issue...][gap][dur][gap][tokIn][gap][tokOut][gap][st][margin1]
const W_MARGIN = 1;
const W_IDX = 2;
const W_GAP2 = 2;
const W_GAP1 = 1;
const W_TIME = 5;
const W_DUR = 5;
const W_TOK_IN = 6;
const W_TOK_OUT = 6;
const W_ST = 1;
// Total fixed = margins + gaps + fixed columns (everything except flex issue column)
const FIXED_W = W_MARGIN + W_IDX + W_GAP2 + W_TIME + W_GAP2
  + /*issue*/ W_GAP2 + W_DUR + W_GAP2 + W_TOK_IN + W_GAP1 + W_TOK_OUT + W_GAP2 + W_ST + W_MARGIN;
// = 1 + 2 + 2 + 5 + 2 + 2 + 5 + 2 + 6 + 1 + 6 + 2 + 1 + 1 = 38

interface ScoreboardProps {
  t: Theme;
  width: number;
  rows: number;
  recent: RecentEntry[];
  pending: { number: number; title: string }[];
}

export function Scoreboard({ t, width, rows, recent, pending }: ScoreboardProps) {
  const innerW = width - 2;
  const issueW = Math.max(10, innerW - FIXED_W);

  const lines: React.ReactNode[] = [];

  // ---- Table header row ----
  // Each fitSegs call produces segments of EXACT specified width
  lines.push(
    <Row key="th" t={t} width={width} line={borderedFit([
      ...fitSegs([s(" ")], W_MARGIN),
      ...fitSegs([s("#", t.dim, true)], W_IDX),
      ...fitSegs([], W_GAP2),
      ...fitSegs([s("TIME", t.dim, true)], W_TIME),
      ...fitSegs([], W_GAP2),
      ...fitSegs([s("ISSUE", t.dim, true)], issueW),
      ...fitSegs([], W_GAP2),
      ...fitSegs([s("  DUR", t.dim, true)], W_DUR),
      ...fitSegs([], W_GAP2),
      ...fitSegs([s("   IN\u2193", t.dim, true)], W_TOK_IN),
      ...fitSegs([], W_GAP1),
      ...fitSegs([s("  OUT\u2191", t.dim, true)], W_TOK_OUT),
      ...fitSegs([], W_GAP2),
      ...fitSegs([s("S", t.dim, true)], W_ST),
      ...fitSegs([s(" ")], W_MARGIN),
    ], width, t)} />,
  );

  // ---- Table divider ----
  lines.push(
    <Row key="td" t={t} width={width} line={borderedFit([
      ...fitSegs([s(" ")], W_MARGIN),
      ...fitSegs([s("\u2500".repeat(W_IDX), t.border)], W_IDX),
      ...fitSegs([s(" ")], W_GAP2),   // keep 1 space, rest is gap
      ...fitSegs([s(" " + "\u2500".repeat(W_TIME), t.border)], W_TIME + 1),
      ...fitSegs([s(" ")], W_GAP2 - 1),
      ...fitSegs([s("\u2500".repeat(issueW), t.border)], issueW),
      ...fitSegs([s(" ")], W_GAP2),
      ...fitSegs([s("\u2500".repeat(W_DUR), t.border)], W_DUR),
      ...fitSegs([s(" ")], W_GAP2),
      ...fitSegs([s("\u2500".repeat(W_TOK_IN), t.border)], W_TOK_IN),
      ...fitSegs([s(" ")], W_GAP1),
      ...fitSegs([s("\u2500".repeat(W_TOK_OUT), t.border)], W_TOK_OUT),
      ...fitSegs([s(" ")], W_GAP2),
      ...fitSegs([s("\u2500", t.border)], W_ST),
      ...fitSegs([s(" ")], W_MARGIN),
    ], width, t)} />,
  );

  // ---- Allocate remaining rows for entries + queue ----
  const dataRows = Math.max(0, rows - 2); // minus header + divider
  const recentRev = [...recent].reverse();

  // Queue allocation: header + items + optional "+more", max 4 rows total
  let queueSection = 0;
  let queueDisplay = 0;
  if (pending.length > 0 && dataRows > 4) {
    queueDisplay = Math.min(3, pending.length);
    queueSection = 1 + 1 + queueDisplay + (pending.length > 3 ? 1 : 0);
    // Ensure recent gets at least 3 rows
    if (dataRows - queueSection < 3) {
      queueSection = Math.max(0, dataRows - 3);
      queueDisplay = Math.max(0, queueSection - 2 - (pending.length > 3 ? 1 : 0));
    }
  }
  const recentSlots = Math.max(0, dataRows - queueSection);

  // ---- Recent entries ----
  const recentToShow = recentRev.slice(0, recentSlots);
  for (let i = 0; i < recentToShow.length; i++) {
    const e = recentToShow[i]!;
    lines.push(
      <Row key={`r${i}`} t={t} width={width}
        line={buildEntryRow(i + 1, e, issueW, innerW, t)} />,
    );
  }

  // Pad remaining recent slots with blank rows
  for (let i = recentToShow.length; i < recentSlots; i++) {
    lines.push(
      <Row key={`rp${i}`} t={t} width={width} line={borderedFit([s("")], width, t)} />,
    );
  }

  // ---- Queue section ----
  if (queueSection > 0 && pending.length > 0) {
    // Blank separator
    lines.push(
      <Row key="qs" t={t} width={width} line={borderedFit([s("")], width, t)} />,
    );
    // Queue header
    lines.push(
      <Row key="qh" t={t} width={width} line={borderedFit([
        s(`  QUEUE (${pending.length})`, t.title, true),
      ], width, t)} />,
    );
    // Queue items - each guaranteed to fit in innerW via fitSegs
    for (let i = 0; i < queueDisplay; i++) {
      const issue = pending[i]!;
      const prefix = `#${issue.number} `;
      const maxTitleW = Math.max(1, innerW - 6 - stringWidth(prefix));
      lines.push(
        <Row key={`q${i}`} t={t} width={width} line={borderedFit([
          s("  \u25B8 ", t.accent),
          s(prefix, t.highlight),
          s(trunc(sanitize(issue.title), maxTitleW)),
        ], width, t)} />,
      );
    }
    // "+N more" overflow indicator
    if (pending.length > 3 && queueDisplay < pending.length) {
      lines.push(
        <Row key="qm" t={t} width={width} line={borderedFit([
          s(`  +${pending.length - queueDisplay} more`, t.dim),
        ], width, t)} />,
      );
    }
  }

  return <>{lines}</>;
}

// ---- Table entry row builder ----
// Uses fitSegs for EVERY column to guarantee exact widths.
// The total of all column widths always equals innerW.

function buildEntryRow(
  idx: number,
  e: RecentEntry,
  issueW: number,
  innerW: number,
  t: Theme,
): ReturnType<typeof borderedFit> {
  const time = fmtTimeShort(e.at);
  const dur = fmtDur(e.durationMs);
  const tokIn = fmtTok(e.tokensIn);
  const tokOut = fmtTok(e.tokensOut);
  const icon = e.status === "success" ? "\u2713" : e.status === "failed" ? "\u2717" : "\u2298";
  const iconColor = e.status === "success" ? t.success : e.status === "failed" ? t.error : t.dim;

  // Issue column: "#NNN title..." - exact issueW chars
  const prefix = `#${e.issue} `;
  const prefixW = stringWidth(prefix);
  const titleMaxW = Math.max(1, issueW - prefixW);
  const issueSegs = fitSegs([
    s(prefix, t.highlight),
    s(trunc(sanitize(e.title), titleMaxW)),
  ], issueW);

  // Assemble row: each fitSegs produces exact width, total = innerW
  return borderedFit([
    ...fitSegs([s(padStartW(String(idx), W_IDX))], W_MARGIN + W_IDX),  // " XX"
    ...fitSegs([], W_GAP2),                                             // "  "
    ...fitSegs([s(time, undefined, undefined, true)], W_TIME),          // "HH:MM"
    ...fitSegs([], W_GAP2),                                             // "  "
    ...issueSegs,                                                       // "#NNN title..."
    ...fitSegs([], W_GAP2),                                             // "  "
    ...fitSegs([s(padStartW(dur, W_DUR), undefined, undefined, true)], W_DUR),  // "Xm00s"
    ...fitSegs([], W_GAP2),                                             // "  "
    ...fitSegs([s(padStartW(tokIn, W_TOK_IN), t.info)], W_TOK_IN),     // " XX.XK"
    ...fitSegs([], W_GAP1),                                             // " "
    ...fitSegs([s(padStartW(tokOut, W_TOK_OUT), t.info)], W_TOK_OUT),  // " XX.XK"
    ...fitSegs([], W_GAP2),                                             // "  "
    ...fitSegs([s(icon, iconColor)], W_ST),                             // "✓"
    ...fitSegs([], W_MARGIN),                                           // " "
  ], innerW + 2, t);
}
