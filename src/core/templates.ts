// Templates de mapa e criação de mapas.

import type { MMap, TemplateName } from "./model";
import { mkEdge, mkNode, uid } from "./model";
import { autoLayoutMinimal } from "./layout";

// ── Templates ─────────────────────────────────────────────────────
function tplModeloA(t: string) {
  const c = mkNode(t, "Mapa executivo APAMIND", 500, 380, 0, "capsule");
  const ns = [
    c,
    mkNode("Objetivo", "Resultado desejado", 500, 150, 1, "capsule", { icon: "🎯" }),
    mkNode("Ideias", "Capture sem julgar", 240, 260, 2, "card", { icon: "💡" }),
    mkNode("Referências", "Links e fontes", 760, 260, 5, "rect", { icon: "🔗" }),
    mkNode("Tarefas", "Converta em ação", 240, 520, 3, "card", {
      icon: "✅",
      checklist: [
        { text: "Definir escopo", done: false },
        { text: "Levantar requisitos", done: false },
      ],
    }),
    mkNode("Decisões", "Escolhas chave", 760, 520, 4, "hex", { icon: "⚖️" }),
    mkNode("Riscos", "Pontos de atenção", 370, 650, 2, "rect", { icon: "⚠️" }),
    mkNode("Próx. passos", "Sequência prática", 630, 650, 6, "capsule", { icon: "🚀" }),
  ];
  return {
    nodes: ns,
    edges: [
      mkEdge(c.id, ns[1].id),
      mkEdge(c.id, ns[2].id),
      mkEdge(c.id, ns[3].id),
      mkEdge(c.id, ns[4].id),
      mkEdge(c.id, ns[5].id),
      mkEdge(ns[2].id, ns[4].id),
      mkEdge(ns[3].id, ns[5].id),
      mkEdge(ns[4].id, ns[6].id),
      mkEdge(ns[5].id, ns[7].id),
    ],
  };
}
function tplRadial(t: string) {
  const c = mkNode(t, "Mapa radial", 500, 380, 0, "capsule");
  const ns = [
    c,
    mkNode("Ideias", "Brainstorm", 290, 190, 1, "card", { icon: "💡" }),
    mkNode("Conteúdo", "Markdown e links", 710, 190, 2, "card", { icon: "📝" }),
    mkNode("Automação", "Layout e filtros", 240, 530, 3, "capsule", { icon: "⚙️" }),
    mkNode("Exportação", "PDF, SVG, HTML", 760, 530, 4, "card", { icon: "📤" }),
    mkNode("Plugins", "API futura", 500, 630, 5, "card", { icon: "🔌" }),
  ];
  return { nodes: ns, edges: ns.slice(1).map((n) => mkEdge(c.id, n.id)) };
}
function tplHierarquico(t: string) {
  const c = mkNode(t, "Tópico central", 500, 110, 0, "capsule");
  const ns = [
    c,
    mkNode("Estratégia", "Objetivos", 270, 290, 1, "card", { icon: "📊" }),
    mkNode("Execução", "Plano de trabalho", 500, 290, 3, "card", { icon: "🔨" }),
    mkNode("Resultados", "Métricas", 730, 290, 4, "card", { icon: "📈" }),
    mkNode("Riscos", "Atenção", 380, 470, 2, "rect", { icon: "⚠️" }),
    mkNode("Próx. passos", "Sequência", 620, 470, 5, "rect", { icon: "🚀" }),
  ];
  return {
    nodes: ns,
    edges: [
      mkEdge(c.id, ns[1].id),
      mkEdge(c.id, ns[2].id),
      mkEdge(c.id, ns[3].id),
      mkEdge(ns[2].id, ns[4].id),
      mkEdge(ns[2].id, ns[5].id),
    ],
  };
}
function tplFluxograma(t: string) {
  const ns = [
    mkNode(t, "Início do fluxo", 130, 380, 0, "capsule", { icon: "▶️" }),
    mkNode("Capturar", "Ideias e entradas", 320, 270, 1, "rect", { icon: "📥" }),
    mkNode("Organizar", "Agrupar e priorizar", 510, 380, 3, "rect", { icon: "🗂️" }),
    mkNode("Decidir", "Próximos passos", 700, 270, 2, "hex", { icon: "🤔" }),
    mkNode("Entregar", "Resultado final", 870, 450, 4, "capsule", { icon: "✅" }),
  ];
  return { nodes: ns, edges: ns.slice(0, -1).map((_, i) => mkEdge(ns[i].id, ns[i + 1].id)) };
}
function tplArvore(t: string) {
  const c = mkNode(t, "Raiz", 500, 100, 0, "capsule");
  const ns = [
    c,
    mkNode("Ramo A", "Direção 1", 300, 270, 1, "card"),
    mkNode("Ramo B", "Direção 2", 700, 270, 3, "card"),
    mkNode("A1", "Subtópico", 190, 440, 2, "rect"),
    mkNode("A2", "Subtópico", 410, 440, 4, "rect"),
    mkNode("B1", "Subtópico", 590, 440, 5, "rect"),
    mkNode("B2", "Subtópico", 810, 440, 6, "rect"),
  ];
  return {
    nodes: ns,
    edges: [
      mkEdge(c.id, ns[1].id),
      mkEdge(c.id, ns[2].id),
      mkEdge(ns[1].id, ns[3].id),
      mkEdge(ns[1].id, ns[4].id),
      mkEdge(ns[2].id, ns[5].id),
      mkEdge(ns[2].id, ns[6].id),
    ],
  };
}
function tplArvoreDireita(t: string) {
  const c = mkNode(t, "Raiz", 200, 380, 0, "capsule");
  const ns = [
    c,
    mkNode("Ramo A", "Direita", 500, 220, 1, "card"),
    mkNode("Ramo B", "Direita", 500, 380, 3, "card"),
    mkNode("Ramo C", "Direita", 500, 540, 5, "card"),
    mkNode("A1", "Sub", 780, 160, 2, "rect"),
    mkNode("A2", "Sub", 780, 280, 4, "rect"),
    mkNode("B1", "Sub", 780, 380, 6, "rect"),
    mkNode("B2", "Sub", 780, 480, 7, "rect"),
  ];
  return {
    nodes: ns,
    edges: [
      mkEdge(c.id, ns[1].id),
      mkEdge(c.id, ns[2].id),
      mkEdge(c.id, ns[3].id),
      mkEdge(ns[1].id, ns[4].id),
      mkEdge(ns[1].id, ns[5].id),
      mkEdge(ns[2].id, ns[6].id),
      mkEdge(ns[2].id, ns[7].id),
    ],
  };
}
function tplArvoreEsquerda(t: string) {
  const c = mkNode(t, "Raiz", 800, 380, 0, "capsule");
  const ns = [
    c,
    mkNode("Ramo A", "Esquerda", 500, 220, 1, "card"),
    mkNode("Ramo B", "Esquerda", 500, 380, 3, "card"),
    mkNode("Ramo C", "Esquerda", 500, 540, 5, "card"),
    mkNode("A1", "Sub", 220, 160, 2, "rect"),
    mkNode("A2", "Sub", 220, 280, 4, "rect"),
    mkNode("B1", "Sub", 220, 380, 6, "rect"),
    mkNode("B2", "Sub", 220, 480, 7, "rect"),
  ];
  return {
    nodes: ns,
    edges: [
      mkEdge(c.id, ns[1].id),
      mkEdge(c.id, ns[2].id),
      mkEdge(c.id, ns[3].id),
      mkEdge(ns[1].id, ns[4].id),
      mkEdge(ns[1].id, ns[5].id),
      mkEdge(ns[2].id, ns[6].id),
      mkEdge(ns[2].id, ns[7].id),
    ],
  };
}
function tplEspinhaDePeixe(t: string) {
  const c = mkNode(t, "Problema", 900, 380, 0, "capsule", { icon: "🐟" });
  const ns = [
    c,
    mkNode("Pessoas", "", 200, 200, 1, "card"),
    mkNode("Processos", "", 200, 300, 2, "card"),
    mkNode("Tecnologia", "", 200, 460, 3, "card"),
    mkNode("Materiais", "", 200, 560, 4, "card"),
    mkNode("Método", "", 200, 700, 5, "card"),
    mkNode("Ambiente", "", 200, 800, 6, "card"),
  ];
  return {
    nodes: ns,
    edges: [
      mkEdge(ns[1].id, c.id),
      mkEdge(ns[2].id, c.id),
      mkEdge(ns[3].id, c.id),
      mkEdge(ns[4].id, c.id),
      mkEdge(ns[5].id, c.id),
      mkEdge(ns[6].id, c.id),
    ],
  };
}
function tplOrganograma(t: string) {
  const c = mkNode(t, "Diretoria", 500, 100, 0, "capsule");
  const ns = [
    c,
    mkNode("Operações", "Diretor", 300, 280, 1, "card", { icon: "⚙️" }),
    mkNode("Finanças", "Diretor", 700, 280, 3, "card", { icon: "💰" }),
    mkNode("Produção", "Gerência", 190, 460, 2, "rect"),
    mkNode("Logística", "Gerência", 410, 460, 4, "rect"),
    mkNode("RH", "Gerência", 590, 460, 5, "rect"),
    mkNode("Contabilidade", "Gerência", 810, 460, 6, "rect"),
  ];
  return {
    nodes: ns,
    edges: [
      mkEdge(c.id, ns[1].id),
      mkEdge(c.id, ns[2].id),
      mkEdge(ns[1].id, ns[3].id),
      mkEdge(ns[1].id, ns[4].id),
      mkEdge(ns[2].id, ns[5].id),
      mkEdge(ns[2].id, ns[6].id),
    ],
  };
}
function tplLivre(t: string) {
  const c = mkNode(t, "Canvas livre", 500, 380, 0, "capsule");
  const ns = [
    c,
    mkNode("Insight", "Conecte ideias", 290, 200, 1, "card", { icon: "💡" }),
    mkNode("Referência", "Notas e links", 730, 220, 2, "rect", { icon: "🔗" }),
    mkNode("Tarefa", "Checklist futuro", 270, 550, 3, "capsule", { icon: "✅" }),
    mkNode("Anexo", "Mídia local", 740, 530, 4, "card", { icon: "📎" }),
  ];
  return { nodes: ns, edges: [mkEdge(c.id, ns[1].id), mkEdge(c.id, ns[3].id), mkEdge(ns[2].id, ns[4].id)] };
}
function tplKanban(t: string) {
  const c = mkNode(t, "Kanban mental", 500, 100, 0, "capsule");
  const ns = [
    c,
    mkNode("Backlog", "Ideias abertas", 210, 300, 1, "rect", { icon: "📋" }),
    mkNode("Fazendo", "Em progresso", 500, 300, 2, "rect", { icon: "🔨" }),
    mkNode("Concluído", "Decisões tomadas", 790, 300, 3, "rect", { icon: "✅" }),
    mkNode("Bloqueios", "Dependências", 350, 490, 4, "card", { icon: "🚧" }),
    mkNode("Aprendizados", "Notas relevantes", 650, 490, 5, "card", { icon: "🎓" }),
  ];
  return { nodes: ns, edges: ns.slice(1).map((n) => mkEdge(c.id, n.id)) };
}
function tplTimeline(t: string) {
  const ns = [
    mkNode(t, "Linha do tempo", 110, 380, 0, "capsule", { icon: "📅" }),
    mkNode("Agora", "Estado atual", 310, 250, 1, "card", { icon: "📍" }),
    mkNode("Próxima etapa", "Curto prazo", 520, 470, 2, "card", { icon: "➡️" }),
    mkNode("Marco", "Entrega chave", 720, 250, 3, "hex", { icon: "🏁" }),
    mkNode("Futuro", "Visão final", 900, 470, 4, "card", { icon: "🔮" }),
  ];
  return { nodes: ns, edges: ns.slice(0, -1).map((_, i) => mkEdge(ns[i].id, ns[i + 1].id)) };
}

function tplMinimalista(t: string) {
  // Começo enxuto: raiz central e quatro ramos de texto puro. O arranjo é o
  // bilateral do próprio template (duas colunas de cada lado).
  const c = mkNode(t, "Comece por uma ideia", 500, 380, 0, "capsule");
  const ns = [
    mkNode("Primeira ideia", "Nota curta de apoio", 860, 300, 1, "card"),
    mkNode("Segunda ideia", "", 860, 480, 2, "card"),
    mkNode("Ramo à esquerda", "", 140, 300, 3, "card"),
    mkNode("Outro ramo", "", 140, 480, 4, "card"),
  ];
  const edges = ns.map((n) => mkEdge(c.id, n.id));
  return { nodes: autoLayoutMinimal([c, ...ns], edges, c.id), edges };
}

function buildTpl(title: string, tpl: TemplateName) {
  switch (tpl) {
    case "Modelo A":
      return tplModeloA(title);
    case "Radial":
      return tplRadial(title);
    case "Hierarquico":
      return tplHierarquico(title);
    case "Fluxograma":
      return tplFluxograma(title);
    case "Arvore":
      return tplArvore(title);
    case "Arvore Direita":
      return tplArvoreDireita(title);
    case "Arvore Esquerda":
      return tplArvoreEsquerda(title);
    case "Organograma":
      return tplOrganograma(title);
    case "Espinha de Peixe":
      return tplEspinhaDePeixe(title);
    case "Livre":
      return tplLivre(title);
    case "Kanban":
      return tplKanban(title);
    case "Timeline":
      return tplTimeline(title);
    case "Minimalista":
      return tplMinimalista(title);
    default:
      return tplModeloA(title);
  }
}

export function createMap(title: string, tpl: TemplateName): MMap {
  const { nodes, edges } = buildTpl(title, tpl);
  return { id: uid("map"), title, template: tpl, ts: new Date().toISOString(), nodes, edges };
}
