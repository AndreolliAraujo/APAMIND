export type BackgroundPreset = {
  name: string;
  baseDark: string;
  baseLight: string;
  glowA: string;
  glowB: string;
  glowC?: string;
  glowD?: string;
  pattern?: "none" | "grid" | "dots" | "hex" | "crosshatch";
  animated?: boolean;
};

export const PATTERN_CSS: Record<string, string> = {
  grid: "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
  dots: "radial-gradient(circle, rgba(255,255,255,1) 1.5px, transparent 1.5px)",
  hex: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V16L28 0l28 16v34L28 66zm0 0v34M0 50l28 16m0-66L0 16m56 34L28 50M28 0L0 16' fill='none' stroke='rgba(255,255,255,1)' stroke-width='1'/%3E%3C/svg%3E\")",
  crosshatch:
    "repeating-linear-gradient(45deg, rgba(255,255,255,1) 0, rgba(255,255,255,1) 1px, transparent 0, transparent 50%), repeating-linear-gradient(135deg, rgba(255,255,255,1) 0, rgba(255,255,255,1) 1px, transparent 0, transparent 50%)",
};

export const PATTERN_SIZES: Record<string, string> = {
  grid: "40px 40px",
  dots: "24px 24px",
  hex: "56px 100px",
  crosshatch: "14px 14px",
};

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    name: "Aurora",
    baseDark: "#060810",
    baseLight: "#f3f0f8",
    glowA: "rgba(99,102,241,.65)",
    glowB: "rgba(244,114,182,.50)",
    glowC: "rgba(45,212,191,.40)",
    glowD: "rgba(168,85,247,.35)",
    pattern: "none",
    animated: true,
  },
  {
    name: "Oceano",
    baseDark: "#020e1c",
    baseLight: "#e8f6ff",
    glowA: "rgba(14,165,233,.70)",
    glowB: "rgba(6,182,212,.55)",
    glowC: "rgba(56,189,248,.45)",
    glowD: "rgba(99,102,241,.30)",
    pattern: "none",
    animated: true,
  },
  {
    name: "Ciberpunk",
    baseDark: "#05010f",
    baseLight: "#fff0fc",
    glowA: "rgba(236,72,153,.75)",
    glowB: "rgba(6,182,212,.65)",
    glowC: "rgba(251,191,36,.40)",
    pattern: "grid",
    animated: false,
  },
  {
    name: "Galáxia",
    baseDark: "#020008",
    baseLight: "#f5f0ff",
    glowA: "rgba(168,85,247,.70)",
    glowB: "rgba(99,102,241,.60)",
    glowC: "rgba(244,114,182,.45)",
    glowD: "rgba(14,165,233,.30)",
    pattern: "dots",
    animated: true,
  },
  {
    name: "Floresta",
    baseDark: "#030d07",
    baseLight: "#edfbf0",
    glowA: "rgba(34,197,94,.65)",
    glowB: "rgba(16,185,129,.55)",
    glowC: "rgba(132,204,22,.40)",
    pattern: "hex",
    animated: false,
  },
  {
    name: "Vulcão",
    baseDark: "#120403",
    baseLight: "#fff7ed",
    glowA: "rgba(239,68,68,.70)",
    glowB: "rgba(251,146,60,.60)",
    glowC: "rgba(250,204,21,.45)",
    pattern: "none",
    animated: true,
  },
  {
    name: "Gelo",
    baseDark: "#030c14",
    baseLight: "#f0f8ff",
    glowA: "rgba(186,230,253,.60)",
    glowB: "rgba(147,197,253,.50)",
    glowC: "rgba(196,181,253,.40)",
    pattern: "crosshatch",
    animated: false,
  },
  {
    name: "Grafite",
    baseDark: "#09090b",
    baseLight: "#f4f4f5",
    glowA: "rgba(148,163,184,.35)",
    glowB: "rgba(100,116,139,.28)",
    pattern: "grid",
    animated: false,
  },
  {
    name: "Crepúsculo",
    baseDark: "#120a18",
    baseLight: "#fff1f8",
    glowA: "rgba(251,113,133,.65)",
    glowB: "rgba(168,85,247,.55)",
    glowC: "rgba(251,146,60,.40)",
    pattern: "none",
    animated: true,
  },
];

export function rgbaToHex(value: string): string {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return "#6366f1";
  return `#${[match[1], match[2], match[3]].map((channel) => Number(channel).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
