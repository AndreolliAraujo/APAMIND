// Ilha visual do template "Minimalista".
//
// Nada aqui é compartilhado com os modelos existentes: são tokens e classes
// usados apenas quando map.template === "Minimalista". Mudar qualquer valor
// deste arquivo não afeta os outros templates.

import type { TemplateName } from "../core/model";

export const MINIMAL_THEME = {
  background: "#F8FAFC",
  text: "#1E293B",
  note: "rgba(30, 41, 59, 0.62)",
  accent: "#4F46E5",
  accentHover: "#4338CA",
} as const;

/** Largura fixa do bloco de texto dos filhos (previsível para a geometria da Etapa 4). */
export const MINIMAL_NODE_WIDTH = 220;

export function isMinimalTemplate(template: TemplateName): boolean {
  return template === "Minimalista";
}

/**
 * Classes do nó minimalista: sem caixa, sem fundo, sem borda e sem sombra.
 * A raiz é maior, em negrito e centralizada; os demais são texto limpo à
 * esquerda. Seleção/hover usam apenas um fundo translúcido muito leve.
 */
export function minimalNodeClass(isRoot: boolean, isSelected: boolean): string {
  const base = "group absolute select-none rounded-lg transition-colors";
  const typography = isRoot
    ? "px-3 py-2 text-center text-2xl font-bold tracking-tight"
    : "px-2 py-1 text-left text-sm font-medium leading-snug";
  const state = isSelected ? "bg-indigo-500/10" : "hover:bg-indigo-500/5";
  return `${base} ${typography} ${state}`;
}

export function minimalNodeColor(isRoot: boolean): string {
  return isRoot ? MINIMAL_THEME.accent : MINIMAL_THEME.text;
}
