// Referências entre mapas (map://) e utilidades de deduplicação de destinos.
import type { MMap } from "./model";

const MAP_PREFIX = "map://";

/** Retorna o id do mapa referenciado por um caminho `map://<id>`, ou null. */
export function mapReferenceTarget(path: string): string | null {
  if (!path.startsWith(MAP_PREFIX)) return null;
  const id = path.slice(MAP_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * Reescreve referências `map://<idAntigo>` para `map://<idNovo>` segundo o
 * mapeamento fornecido. Referências sem correspondência são mantidas intactas
 * (ficam como órfãs, detectáveis em uma varredura posterior).
 */
export function remapMapReferences(map: MMap, mapIdMap: Map<string, string>): MMap {
  return {
    ...map,
    nodes: map.nodes.map(node => {
      if (!node.attachments) return node;
      let changed = false;
      const attachments = node.attachments.map(att => {
        const target = mapReferenceTarget(att.path);
        if (target === null) return att;
        const next = mapIdMap.get(target);
        if (!next || next === target) return att;
        changed = true;
        return { ...att, path: `${MAP_PREFIX}${next}` };
      });
      return changed ? { ...node, attachments } : node;
    }),
  };
}
