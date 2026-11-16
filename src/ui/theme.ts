// Tokens visuais: paletas, formas e classes Tailwind.

import type { NodeShape } from "../core/model";

export const TONES = [
  // Row 1 — Cool
  "from-indigo-500 to-violet-500","from-sky-400 to-cyan-500","from-cyan-400 to-blue-500","from-blue-500 to-violet-600",
  // Row 2 — Nature
  "from-emerald-400 to-teal-500","from-lime-400 to-green-500","from-teal-400 to-cyan-600","from-green-500 to-emerald-700",
  // Row 3 — Warm
  "from-amber-400 to-orange-500","from-orange-400 to-red-500","from-yellow-300 to-amber-500","from-red-500 to-rose-600",
  // Row 4 — Vivid
  "from-rose-400 to-fuchsia-500","from-purple-400 to-pink-500","from-fuchsia-500 to-pink-500","from-slate-500 to-slate-700",
  // Transparent sentinel
  "",
];
export const TONE_HEX = [
  "#6366f1","#38bdf8","#22d3ee","#60a5fa",
  "#34d399","#a3e635","#2dd4bf","#22c55e",
  "#fb923c","#f97316","#facc15","#f87171",
  "#f472b6","#a78bfa","#e879f9","#94a3b8",
  "transparent",
];

export const SHAPES: {id:NodeShape;label:string}[] = [
  {id:"card",label:"Cartão"},{id:"rect",label:"Retângulo"},{id:"circle",label:"Círculo"},
  {id:"capsule",label:"Cápsula"},{id:"hex",label:"Hexágono"}
];

export function shapeClass(s:NodeShape){
  switch(s){case"circle":return"rounded-full";case"capsule":return"rounded-full";case"rect":return"rounded-xl";case"hex":return"rounded-2xl hex-clip";default:return"rounded-2xl";}
}