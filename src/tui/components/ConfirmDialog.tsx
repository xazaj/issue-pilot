import React from "react";
import { Text, Box } from "ink";
import type { Theme } from "../types.js";
import { BOX } from "../text-utils.js";

interface ConfirmDialogProps {
  t: Theme;
  width: number;
  height: number;
  message: string;
}

export function ConfirmDialog({ t, width, height, message }: ConfirmDialogProps) {
  const boxW = Math.min(50, width - 4);
  const startCol = Math.floor((width - boxW) / 2);
  const startRow = Math.floor((height - 7) / 2);

  const inner = boxW - 2;
  const msgPad = message + " ".repeat(Math.max(0, inner - message.length));
  const hint = "[y] Confirm  [n] Cancel";
  const hintPad = hint + " ".repeat(Math.max(0, inner - hint.length));
  const empty = " ".repeat(inner);

  return (
    <Box
      flexDirection="column"
      position="absolute"
      marginLeft={startCol}
      marginTop={startRow}
    >
      <Text backgroundColor="#1A0000" color={t.border}>{BOX.tl}{BOX.h.repeat(inner)}{BOX.tr}</Text>
      <Text backgroundColor="#1A0000" color={t.fg}>{BOX.v}{empty}{BOX.v}</Text>
      <Text backgroundColor="#1A0000" color={t.warning} bold>{BOX.v}{msgPad.slice(0, inner)}{BOX.v}</Text>
      <Text backgroundColor="#1A0000" color={t.fg}>{BOX.v}{empty}{BOX.v}</Text>
      <Text backgroundColor="#1A0000" color={t.dim}>{BOX.v}{hintPad.slice(0, inner)}{BOX.v}</Text>
      <Text backgroundColor="#1A0000" color={t.fg}>{BOX.v}{empty}{BOX.v}</Text>
      <Text backgroundColor="#1A0000" color={t.border}>{BOX.bl}{BOX.h.repeat(inner)}{BOX.br}</Text>
    </Box>
  );
}
