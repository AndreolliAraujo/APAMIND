// Ilha visual do template "Minimalista".
//
// Nada aqui é compartilhado com os modelos existentes: são tokens e classes
// usados apenas quando map.template === "Minimalista". As cores e a largura
// vêm do core para canvas e exportadores nunca divergirem.

import type { TemplateName } from "../core/model";
import { MINIMAL_COLORS, MINIMAL_NODE_WIDTH } from "../core/minimal";

export { MINIMAL_NODE_WIDTH };

export const MINIMAL_THEME = MINIMAL_COLORS;

/** Largura fixa do bloco de texto dos filhos (previsível para a geometria bilateral). */
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
