import type { MMap } from "../../core/model";
import { download, escMarkdownInline, safeName } from "./files";

// ── Export Markdown ───────────────────────────────────────────────
export function exportMarkdown(map: MMap) {
  let md = `# ${map.title}\n\n`;
  const visited = new Set<string>();
  function walk(nodeId: string, depth = 0) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const n = map.nodes.find(x => x.id === nodeId);
    if (!n) return;
    const indent = "  ".repeat(depth);
    md += `${indent}- **${escMarkdownInline(n.title)}**${n.note ? `: ${escMarkdownInline(n.note)}` : ""}\n`;
    if (n.markdown) md += n.markdown.split("\n").map(l => `${indent}  > ${l}`).join("\n") + "\n";
    if (n.checklist?.length) {
      n.checklist.forEach(c => { md += `${indent}  - [${c.done ? "x" : " "}] ${escMarkdownInline(c.text)}\n`; });
    }
    if (n.links?.length) {
      // Valida scheme dos links antes de emitir
      n.links.forEach(l => {
        if (/^(https?:|mailto:|tel:)/i.test(l.url)) {
          md += `${indent}  - [${escMarkdownInline(l.label)}](${l.url})\n`;
        } else {
          md += `${indent}  - ${escMarkdownInline(l.label)} (link inválido: scheme bloqueado)\n`;
        }
      });
    }
    map.edges.filter(e => e.source === nodeId).forEach(e => walk(e.target, depth + 1));
  }
  const root = map.nodes[0];
  if (root) walk(root.id);
  const blob = new Blob([md], { type: "text/markdown" });
  download(blob, `${safeName(map.title)}.md`);
}

