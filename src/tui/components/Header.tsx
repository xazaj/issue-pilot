import React from "react";
import stringWidth from "string-width";
import type { Theme } from "../types.js";
import { s, trunc, timeNow, SPINNER, PULSE, GRAD_L, GRAD_R, fitSegs, borderedFit, BOX } from "../text-utils.js";
import { Row, HLine } from "./Row.js";

interface HeaderProps {
  t: Theme;
  width: number;
  running: boolean;
  repo: string;
  uptime: string;
  spin: number;
}

export function Header({ t, width, running, repo, uptime, spin }: HeaderProps) {
  const innerW = width - 2;
  const time = timeNow();

  // Animated gradient title
  const gFrame = running ? spin % 3 : 0;
  const gradL = GRAD_L[gFrame]!;
  const gradR = GRAD_R[gFrame]!;
  const titlePart = ` ${gradL} SILENT-DEV ${gradR}`;
  const gradColor = running ? t.accent : t.dim;

  // Status indicator with animation
  const statusText = running
    ? `${SPINNER[spin]} RUNNING ${PULSE[spin % 4]}`
    : "\u25CB STOPPED";
  const statusColor = running ? t.success : t.dim;

  // Right section: ▲ uptime  HH:MM:SS  STATUS
  const rightPart = `\u25B2 ${uptime}  ${time}  ${statusText} `;
  const rightW = stringWidth(rightPart);

  // Repo: takes the flex space between title and right section
  const repoMaxW = Math.max(4, innerW - stringWidth(titlePart) - rightW - 2);
  const repoStr = trunc(repo, repoMaxW);

  // Build as a single fitted row: title + flex(repo) + right
  // fitSegs handles the total width guarantee
  const titleW = stringWidth(titlePart);
  const flexW = Math.max(0, innerW - titleW - rightW);

  const headerLine = borderedFit([
    s(titlePart, gradColor, true),
    // Center repo in the flex space
    ...fitSegs([
      s(" ".repeat(Math.max(1, Math.floor((flexW - stringWidth(repoStr)) / 2)))),
      s(repoStr, t.accent),
    ], flexW),
    s(`\u25B2 ${uptime}`, t.dim),
    s("  "),
    s(time, undefined, undefined, true),
    s("  "),
    s(statusText, statusColor, running),
    s(" "),
  ], width, t);

  return (
    <>
      <HLine t={t} width={width} left={BOX.tl} right={BOX.tr} />
      <Row t={t} width={width} line={headerLine} />
      <HLine t={t} width={width} left={BOX.lt} right={BOX.rt} />
    </>
  );
}
