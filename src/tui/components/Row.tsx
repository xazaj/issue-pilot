import React from "react";
import { Text } from "ink";
import stringWidth from "string-width";
import type { LineContent, Theme } from "../types.js";
import { BOX } from "../text-utils.js";

/**
 * Single-line row renderer. Uses wrap="truncate-end" as a safety net
 * to prevent terminal wrapping even if content exceeds width.
 */
export function Row({ line, width, t }: { line: LineContent; width: number; t: Theme }) {
  const pad = Math.max(0, width - line.chars);
  return (
    <Text backgroundColor={t.bg} wrap="truncate-end">
      {line.segs.map((seg, i) => (
        <Text key={i} color={seg.dim ? t.dim : (seg.color ?? t.fg)} bold={seg.bold}>
          {seg.text}
        </Text>
      ))}
      {" ".repeat(pad)}
    </Text>
  );
}

export function HLine({ t, width, char, left, right, mid }: {
  t: Theme; width: number;
  char?: string; left?: string; right?: string; mid?: { pos: number; char: string };
}) {
  const c = char ?? BOX.h;
  const l = left ?? "";
  const r = right ?? "";
  if (mid) {
    const before = mid.pos;
    const after = width - before - 1 - stringWidth(r);
    return (
      <Text backgroundColor={t.bg} color={t.border} wrap="truncate-end">
        {l}{c.repeat(Math.max(0, before - stringWidth(l)))}{mid.char}{c.repeat(Math.max(0, after))}{r}
      </Text>
    );
  }
  const inner = width - stringWidth(l) - stringWidth(r);
  return (
    <Text backgroundColor={t.bg} color={t.border} wrap="truncate-end">
      {l}{c.repeat(Math.max(0, inner))}{r}
    </Text>
  );
}

export function Blank({ t, width }: { t: Theme; width: number }) {
  return <Text backgroundColor={t.bg} wrap="truncate-end">{" ".repeat(width)}</Text>;
}
