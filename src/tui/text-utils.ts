import stringWidth from "string-width";
import type { Seg, LineContent, Theme } from "./types.js";

// ---- Line builder (width-aware) ----

export function L(...parts: (Seg | string)[]): LineContent {
  const segs: Seg[] = [];
  let chars = 0;
  for (const p of parts) {
    const seg = typeof p === "string" ? { text: p } : p;
    segs.push(seg);
    chars += stringWidth(seg.text);
  }
  return { segs, chars };
}

export function s(text: string, color?: string, bold?: boolean, dim?: boolean): Seg {
  return { text, color, bold, dim };
}

// ---- Exact-width segment fitting ----

/**
 * Fit an array of Seg into exactly `width` display columns.
 * - Truncates (with "…") if content exceeds width.
 * - Pads with trailing spaces if content is shorter.
 * Guarantees: sum of stringWidth(seg.text) === width for returned Seg[].
 */
export function fitSegs(segs: Seg[], width: number): Seg[] {
  if (width <= 0) return [];
  let total = 0;
  const result: Seg[] = [];
  for (const seg of segs) {
    const sw = stringWidth(seg.text);
    if (total + sw <= width) {
      result.push(seg);
      total += sw;
    } else {
      const remaining = width - total;
      if (remaining > 0) {
        const truncated = trunc(seg.text, remaining);
        const tw = stringWidth(truncated);
        result.push({ ...seg, text: truncated });
        total += tw;
      }
      break;
    }
  }
  // Always pad to exact width (handles CJK boundary gaps)
  if (total < width) {
    result.push({ text: " ".repeat(width - total) });
  }
  return result;
}

/**
 * Build a bordered LineContent from segments, guaranteeing exact width.
 * Combines fitSegs + bordered in one call for convenience.
 */
export function borderedFit(segs: Seg[], width: number, t: Theme): LineContent {
  const innerW = width - 2;
  const fitted = fitSegs(segs, innerW);
  const all: Seg[] = [s(BOX.v, t.border), ...fitted, s(BOX.v, t.border)];
  return { segs: all, chars: width };
}

// ---- Text sanitization ----

/** Strip control characters (\r, \n, \t, etc.) from text to prevent terminal corruption. */
export function sanitize(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x1f\x7f]/g, "");
}

// ---- Formatting ----

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function timeNow(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function fmtDur(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const ss = sec % 60;
  if (m < 60) return `${m}m${pad2(ss)}s`;
  return `${Math.floor(m / 60)}h${pad2(m % 60)}m`;
}

export function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function trunc(str: string, max: number): string {
  if (max <= 0) return "";
  if (max === 1) return "\u2026";
  const w = stringWidth(str);
  if (w <= max) return str;
  // Walk character by character, respecting wide chars
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const cw = stringWidth(str[i]!);
    if (width + cw + 1 > max) return str.slice(0, i) + "\u2026";
    width += cw;
  }
  return str;
}

/** Right-pad a string to exact display width. Truncates if too wide.
 *  Handles CJK boundary: trunc may return width-1 due to wide chars,
 *  so we always re-pad after truncation. */
export function padEndW(str: string, width: number): string {
  if (width <= 0) return "";
  const w = stringWidth(str);
  if (w > width) {
    const truncated = trunc(str, width);
    const tw = stringWidth(truncated);
    return tw < width ? truncated + " ".repeat(width - tw) : truncated;
  }
  if (w === width) return str;
  return str + " ".repeat(width - w);
}

/** Left-pad a string to exact display width. Truncates if too wide.
 *  Handles CJK boundary: trunc may return width-1 due to wide chars,
 *  so we always re-pad after truncation. */
export function padStartW(str: string, width: number): string {
  if (width <= 0) return "";
  const w = stringWidth(str);
  if (w > width) {
    const truncated = trunc(str, width);
    const tw = stringWidth(truncated);
    return tw < width ? " ".repeat(width - tw) + truncated : truncated;
  }
  if (w === width) return str;
  return " ".repeat(width - w) + str;
}

export function fmtLogTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  } catch {
    return "??:??:??";
  }
}

/** Format ISO time as HH:MM */
export function fmtTimeShort(iso: string): string {
  try {
    const d = new Date(iso);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  } catch {
    return "??:??";
  }
}

// ---- Visual elements ----

export const SPINNER = ["\u28CB", "\u28D9", "\u28F9", "\u28F8", "\u28FC", "\u28F4", "\u28E6", "\u28E7", "\u28C7", "\u28CF"];

/** Pulse dot animation: 4 frames */
export const PULSE = ["\u25CF\u2219\u2219", "\u2219\u25CF\u2219", "\u2219\u2219\u25CF", "\u2219\u25CF\u2219"];

/** Gradient block animation for header: 3 frames */
export const GRAD_L = ["\u2591\u2592\u2593", "\u2592\u2593\u2591", "\u2593\u2591\u2592"];
export const GRAD_R = ["\u2593\u2592\u2591", "\u2591\u2593\u2592", "\u2592\u2591\u2593"];

export function progressSegs(pct: number, width: number, t: Theme): Seg[] {
  const filled = Math.round((pct / 100) * width);
  return [
    s("\u25B0".repeat(filled), t.bar),
    s("\u25B1".repeat(width - filled), t.barEmpty),
  ];
}

// ---- Bordered line helper ----

/** Wrap a LineContent with │ borders, fitting inner content to exact width.
 *  Safely truncates content if it exceeds inner width. */
export function bordered(line: LineContent, width: number, t: Theme): LineContent {
  const innerW = width - 2;
  const fitted = fitSegs(line.segs, innerW);
  return {
    segs: [s(BOX.v, t.border), ...fitted, s(BOX.v, t.border)],
    chars: width,
  };
}

// ---- Box drawing ----

export const BOX = {
  tl: "\u250C", tr: "\u2510", bl: "\u2514", br: "\u2518",
  h: "\u2500", v: "\u2502",
  lt: "\u251C", rt: "\u2524", tt: "\u252C", bt: "\u2534",
  cross: "\u253C",
  // Double-line header
  dtl: "\u2554", dtr: "\u2557", dbl: "\u255A", dbr: "\u255D",
  dh: "\u2550", dv: "\u2551",
} as const;
