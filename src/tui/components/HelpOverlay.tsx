import React from "react";
import { Text, Box } from "ink";
import type { Theme } from "../types.js";
import { BOX } from "../text-utils.js";

interface HelpOverlayProps {
  t: Theme;
  width: number;
  height: number;
}

const HELP_LINES = [
  "",
  "  SILENT-DEV  -  Keyboard Shortcuts",
  "",
  "  Navigation",
  "    Up/Down     Scroll log output",
  "    Tab         Cycle focus between panels",
  "",
  "  Controls",
  "    s           Start / Stop the service",
  "    t           Cycle through color themes",
  "    m           Cycle through Claude models",
  "",
  "  Log Management",
  "    /           Enter filter mode (type to filter)",
  "    Esc         Clear filter / Close help",
  "    1-4         Quick filter: 1=DBG+ 2=INF+ 3=WRN+ 4=ERR+",
  "",
  "  General",
  "    ?           Toggle this help screen",
  "    q           Quit (confirms if task running)",
  "",
  "  Press any key to close this help screen",
  "",
];

export function HelpOverlay({ t, width, height }: HelpOverlayProps) {
  const boxW = Math.min(60, width - 4);
  const boxH = Math.min(HELP_LINES.length + 2, height - 4);
  const startCol = Math.floor((width - boxW) / 2);
  const startRow = Math.floor((height - boxH) / 2);

  const lines: string[] = [];

  // Top border
  lines.push(BOX.tl + BOX.h.repeat(boxW - 2) + BOX.tr);

  // Content lines
  for (let i = 0; i < boxH - 2; i++) {
    const text = HELP_LINES[i] ?? "";
    const padded = text + " ".repeat(Math.max(0, boxW - 2 - text.length));
    lines.push(BOX.v + padded.slice(0, boxW - 2) + BOX.v);
  }

  // Bottom border
  lines.push(BOX.bl + BOX.h.repeat(boxW - 2) + BOX.br);

  return (
    <Box
      flexDirection="column"
      position="absolute"
      marginLeft={startCol}
      marginTop={startRow}
    >
      {lines.map((line, i) => (
        <Text key={i} backgroundColor="#000000" color={i === 2 ? t.title : t.fg} bold={i === 2}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
