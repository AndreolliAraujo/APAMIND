import { presetDecoration, presetEdgePath, projectorFor, timelineAxisY, type LayoutPreset } from "../core/presets";

const WIDTH = 120;
const HEIGHT = 80;
const PADDING = 8;

/**
 * Miniatura do card gerada a partir do próprio preset: aplica o layout na
 * amostra do modelo, projeta as coordenadas na caixa do card e desenha as
 * mesmas conexões (e a decoração) que o canvas vai desenhar. A figura do card é,
 * literalmente, o resultado do modelo em escala reduzida.
 */
export function PresetPreview({ preset }: { preset: LayoutPreset }) {
  const sample = preset.sample();
  const placed = preset.layout(sample.nodes, sample.edges, sample.nodes[0]?.id);
  const project = projectorFor(placed, WIDTH, HEIGHT, PADDING);
  const spots = new Map(placed.map((node) => [node.id, { x: project.x(node.x), y: project.y(node.y) }]));
  const axisY = project.y(timelineAxisY(placed));
  const decorations = presetDecoration(preset, placed).map((line) => ({
    x1: project.x(line.x1),
    y1: project.y(line.y1),
    x2: project.x(line.x2),
    y2: project.y(line.y2),
  }));

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-14" aria-hidden="true">
      {decorations.map((line, i) => (
        <line key={`decoration-${i}`} {...line} stroke="currentColor" strokeWidth={1.6} opacity={0.45} />
      ))}
      {sample.edges.map((edge) => {
        const source = spots.get(edge.source);
        const target = spots.get(edge.target);
        if (!source || !target) return null;
        return (
          <path
            key={edge.id}
            d={presetEdgePath(preset, source.x, source.y, target.x, target.y, axisY)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            opacity={0.4}
          />
        );
      })}
      {placed.map((node, i) => {
        const spot = spots.get(node.id) ?? { x: 0, y: 0 };
        return (
          <rect
            key={node.id}
            x={spot.x - 5}
            y={spot.y - 3.5}
            width={10}
            height={7}
            rx={2}
            fill="currentColor"
            opacity={i === 0 ? 0.75 : 0.5}
          />
        );
      })}
    </svg>
  );
}
