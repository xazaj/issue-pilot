import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface Theme {
  name: string;
  bg: string;
  fg: string;
  dim: string;
  border: string;
  accent: string;
  title: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  highlight: string;
  bar: string;
  barEmpty: string;
}

export const themes: Theme[] = [
  {
    name: "Matrix",
    bg: "#0D0D0D",
    fg: "#00FF41",
    dim: "#006600",
    border: "#007700",
    accent: "#33FF66",
    title: "#00FF41",
    success: "#00FF41",
    error: "#FF0033",
    warning: "#FFAA00",
    info: "#00CC33",
    highlight: "#00FF41",
    bar: "#00FF41",
    barEmpty: "#003300",
  },
  {
    name: "Synthwave",
    bg: "#1A1A2E",
    fg: "#E0E0FF",
    dim: "#7A7A9A",
    border: "#8844AA",
    accent: "#00FFFF",
    title: "#FF00FF",
    success: "#0FFF50",
    error: "#E94560",
    warning: "#F39C12",
    info: "#00FFFF",
    highlight: "#FF00FF",
    bar: "#E94560",
    barEmpty: "#2D1B3D",
  },
  {
    name: "Tron",
    bg: "#0C141F",
    fg: "#6FC3DF",
    dim: "#3A5A6A",
    border: "#2A5A6A",
    accent: "#00FEFF",
    title: "#00FEFF",
    success: "#6FC3DF",
    error: "#DF740C",
    warning: "#DF740C",
    info: "#6FC3DF",
    highlight: "#00FEFF",
    bar: "#00FEFF",
    barEmpty: "#0C2A3A",
  },
  {
    name: "Amber",
    bg: "#1A1200",
    fg: "#FFB000",
    dim: "#7B5800",
    border: "#5D4200",
    accent: "#FFD700",
    title: "#FFD700",
    success: "#FFD700",
    error: "#FF4400",
    warning: "#FF8C00",
    info: "#FFB000",
    highlight: "#FFD700",
    bar: "#FFB000",
    barEmpty: "#3D2B00",
  },
];

const SETTINGS_DIR = path.join(os.homedir(), ".silent-dev");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

export function loadThemeIndex(): number {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    const idx = Number(data.themeIndex ?? 0);
    return idx >= 0 && idx < themes.length ? idx : 0;
  } catch {
    return 0;
  }
}

export function saveThemeIndex(index: number): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {
    // fresh file
  }
  data.themeIndex = index;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2) + "\n");
}
