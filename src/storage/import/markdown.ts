import { mkEdge, mkNode, uid, type MEdge, type MMap, type MNode } from "../../core/model";

// ── Import Markdown ───────────────────────────────────────────────
export function importMarkdown(text: string, title = "Importado Markdown"): MMap {
  const lines = text.split("\n");
  const nodes: MNode[] = [];
  const edges: MEdge[] = [];
  const stack: { id: string; depth: number }[] = [];
  let y = 120;

  lines.forEach((line) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const depth = match[1].length;
      const name = match[2].trim();
      const n = mkNode(name, "", 300 + depth * 180, y, (depth - 1) % 8, "card");
      y += 100;
      nodes.push(n);
      // Poda O(1): remove da pilha tudo com depth >= atual
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) edges.push(mkEdge(parent.id, n.id));
      stack.push({ id: n.id, depth });
    }
  });

  if (nodes.length === 0) {
    const root = mkNode(title, "", 500, 200, 0, "capsule");
    nodes.push(root);
  }
  return { id: uid("map"), title, template: "Livre", ts: new Date().toISOString(), nodes, edges };
}
