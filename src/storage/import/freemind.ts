import { mkEdge, mkNode, uid, type MEdge, type MMap, type MNode } from "../../core/model";
import { checkParserError } from "./xml";

// ── Import FreeMind (.mm) ─────────────────────────────────────────
export function importFreeMind(xmlText: string, title = "Importado FreeMind"): MMap {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const perr = checkParserError(doc);
  if (perr) throw new Error(perr);
  const nodes: MNode[] = [];
  const edges: MEdge[] = [];
  const visited = new Set<Element>(); // proteção contra ciclos (impossível em DOM, mas defensivo)

  function walk(el: Element, parentId: string | null, x: number, y: number) {
    if (visited.has(el)) return;
    visited.add(el);
    const text = (el.getAttribute("TEXT") || el.getAttribute("text") || el.textContent || "").slice(0, 500);
    const n = mkNode(text, "", x, y, nodes.length % 8, "card");
    nodes.push(n);
    if (parentId) edges.push(mkEdge(parentId, n.id));
    const kids = Array.from(el.children).filter(c => c.tagName === "node");
    kids.forEach((c, i) => walk(c, n.id, x + 220, y + (i - kids.length / 2) * 90));
  }

  const rootEl = doc.querySelector("node");
  if (!rootEl) throw new Error("Arquivo FreeMind sem nó raiz <node>.");
  walk(rootEl, null, 500, 300);
  return { id: uid("map"), title, template: "Arvore", ts: new Date().toISOString(), nodes, edges };
}

