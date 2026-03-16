import "dotenv/config";
import React from "react";
import { withFullScreen } from "fullscreen-ink";
import App from "./tui/App.js";
import { themes, loadThemeIndex } from "./tui/theme.js";

/**
 * Set the terminal's DEFAULT background color via OSC 11.
 *
 * This redefines what "default background" MEANS in the terminal,
 * fixing Ink's background color gaps between styled segments.
 */
function setTerminalDefaultBg(hex: string): void {
  const h = hex.replace("#", "");
  process.stdout.write(`\x1b]11;rgb:${h.slice(0, 2)}/${h.slice(2, 4)}/${h.slice(4, 6)}\x07`);
}

/**
 * Reset the terminal's default background to its profile/settings value.
 */
function resetTerminalDefaultBg(): void {
  process.stdout.write("\x1b]111\x07");
}

// ---- Terminal setup ----

// Set terminal default background to match the initial theme BEFORE Ink starts.
const initTheme = themes[loadThemeIndex()]!;
setTerminalDefaultBg(initTheme.bg);

// ---- Start app ----

const workflowPath = process.argv[2] ?? "WORKFLOW.md";

const ink = withFullScreen(<App workflowPath={workflowPath} />, {
  exitOnCtrlC: false,
});

await ink.start();
await ink.waitUntilExit();

// Restore terminal default background to original profile setting
resetTerminalDefaultBg();
