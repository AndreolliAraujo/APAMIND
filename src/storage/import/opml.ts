import { mkEdge, mkNode, uid, type MEdge, type MMap, type MNode } from "../../core/model";
import { checkParserError } from "./xml";

// ── Import MindMeister (OPML fallback) ────────────────────────────
export function importMindMeister(opmlText: string, title = "Importado MindMeister"): MMap {
  const parser = new DOMParser();
  const doc = parser.parseFromString(opmlText, "application/xml");
  const perr = checkParserError(doc);
  if (perr) throw new Error(perr);
  const nodes: MNode[] = [];
  const edges: MEdge[] = [];
  const visited = new Set<Element>();
  function walk(el: Element, pid: string | null, x: number, y: number) {
    if (visited.has(el)) return;
    visited.add(el);
    const text = (el.getAttribute("text") || el.getAttribute("title") || el.getAttribute("TEXT") || el.textContent || "").slice(0, 500);
    const n = mkNode(text, "", x, y, nodes.length % 8, "card");
    nodes.push(n);
    if (pid) edges.push(mkEdge(pid, n.id));
    const kids = Array.from(el.children).filter(c => c.tagName === "outline");
    kids.forEach((c, i) => walk(c, n.id, x + 220, y + (i - kids.length / 2) * 90));
  }
  const root = doc.querySelector("outline");
  if (!root) throw new Error("Arquivo OPML sem tópico <outline>.");
  walk(root, null, 500, 300);
  return { id: uid("map"), title, template: "Arvore", ts: new Date().toISOString(), nodes, edges };
}

