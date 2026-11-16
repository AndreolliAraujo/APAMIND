import { strFromU8, unzipSync } from "fflate";
import { mkEdge, mkNode, uid, type MEdge, type MMap, type MNode } from "../../core/model";
import { validateMMap } from "../../core/validation";
import { MAX_IMPORT_BYTES, type ImportMapResult } from "./types";
import { checkParserError } from "./xml";

// ── Import XMind (zip com content.xml ou content.json) ────────────
export async function importXMind(file: File): Promise<ImportMapResult> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: "Arquivo maior que 50MB" };
  try {
    const zip = await readZip(file);
    const contentXml = zip["content.xml"];
    const contentJson = zip["content.json"];
    if (!contentXml && !contentJson) {
      return { ok: false, error: "XMind sem content.xml/content.json (formato não suportado)" };
    }
    if (contentJson) {
      let data: any;
      try { data = JSON.parse(contentJson); } catch (e) { return { ok: false, error: "content.json inválido: " + String(e) }; }
      const map = parseXMindJSON(data);
      if (!map.nodes.length) return { ok: false, error: "XMind sem tópicos reconhecíveis em content.json." };
      const v = validateMMap(map);
      return v.ok ? { ok: true, map: v.map } : { ok: false, error: v.error };
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(contentXml, "application/xml");
    const perr = checkParserError(doc);
    if (perr) return { ok: false, error: perr };
    const map = parseXMindXML(doc);
    if (!map.nodes.length) return { ok: false, error: "XMind sem tópico raiz em content.xml." };
    const v = validateMMap(map);
    return v.ok ? { ok: true, map: v.map } : { ok: false, error: v.error };
  } catch (e) {
    return { ok: false, error: "Falha ao ler XMind: " + String(e) };
  }
}

function parseXMindJSON(data: any): MMap {
  const nodes: MNode[] = [];
  const edges: MEdge[] = [];
  const rootTopic = data.rootTopic || data.root;
  const visited = new Set<any>();
  function walk(t: any, pid: string | null, x: number, y: number) {
    if (!t || visited.has(t)) return;
    visited.add(t);
    const n = mkNode((t.title || "").slice(0, 500), "", x, y, nodes.length % 8, "card");
    nodes.push(n);
    if (pid) edges.push(mkEdge(pid, n.id));
    const kids = t.children?.attached || t.children || [];
    if (Array.isArray(kids)) {
      kids.forEach((c: any, i: number) => walk(c, n.id, x + 220, y + (i - 1) * 90));
    }
  }
  if (rootTopic) walk(rootTopic, null, 500, 300);
  return { id: uid("map"), title: (rootTopic?.title || "Importado XMind").slice(0, 200), template: "Arvore", ts: new Date().toISOString(), nodes, edges };
}

function parseXMindXML(doc: Document): MMap {
  const nodes: MNode[] = [];
  const edges: MEdge[] = [];
  const visited = new Set<Element>();
  function walk(el: Element, pid: string | null, x: number, y: number) {
    if (visited.has(el)) return;
    visited.add(el);
    const titleEl = el.querySelector("title");
    const text = (titleEl?.textContent || "").slice(0, 500);
    const n = mkNode(text, "", x, y, nodes.length % 8, "card");
    nodes.push(n);
    if (pid) edges.push(mkEdge(pid, n.id));
    const kids = Array.from(el.children).filter(c => c.tagName === "topic");
    kids.forEach((c, i) => walk(c, n.id, x + 220, y + (i - kids.length / 2) * 90));
  }
  const root = doc.querySelector("topic");
  if (root) walk(root, null, 500, 300);
  return { id: uid("map"), title: "Importado XMind", template: "Arvore", ts: new Date().toISOString(), nodes, edges };
}

// Lê arquivo .xmind (zip) real, suportando DEFLATE via fflate
async function readZip(file: File): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const buffer = new Uint8Array(await file.arrayBuffer());
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(buffer);
  } catch {
    return result; // não é zip válido
  }
  for (const [name, data] of Object.entries(unzipped)) {
    // Apenas arquivos de conteúdo relevantes (evita ler metadata/binários)
    if (name === "content.xml" || name === "content.json") {
      try { result[name] = strFromU8(data); } catch { /* ignora falha de decode */ }
    }
  }
  return result;
}

