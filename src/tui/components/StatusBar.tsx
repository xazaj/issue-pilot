import React from "react";
import type { Theme } from "../types.js";
import { L, s, trunc, BOX } from "../text-utils.js";
import { Row, HLine } from "./Row.js";

interface StatusBarProps {
  t: Theme;
  width: number;
  running: boolean;
  themeName: string;
  modelShort: string;
}

export function StatusBar({ t, width, running, themeName }: StatusBarProps) {
  // Key hints - truncate from right if terminal is narrow
  const hints = [
    { key: "s", label: running ? "top" : "tart" },
    { key: "t", label: themeName },
    { key: "m", label: "odel" },
    { key: "\u2191\u2193", label: "scroll" },
    { key: "/", label: "filter" },
    { key: "?", label: "help" },
    { key: "q", label: "uit" },
  ];

  const segs: ReturnType<typeof s>[] = [];
  let used = 0;
  for (const hint of hints) {
    const entry = ` [${hint.key}]${hint.label}`;
    if (used + entry.length + 2 > width) break;
    segs.push(s(` [${hint.key}]`, t.accent));
    segs.push(s(hint.label, t.dim));
    used += entry.length;
  }

  return (
    <>
      <HLine t={t} width={width} left={BOX.bl} right={BOX.br} />
      <Row t={t} width={width} line={L(...segs)} />
    </>
  );
}
