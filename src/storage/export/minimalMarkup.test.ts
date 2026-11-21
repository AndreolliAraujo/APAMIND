import { describe, expect, it } from "vitest";
import { createMap } from "../../core/templates";
import { minimalDocument, minimalMarkup } from "./minimalMarkup";

describe("minimalMarkup (exportação do template Minimalista)", () => {
  it("desenha texto sem caixas, com a linha do modelo e a ponta circular", () => {
    const map = createMap("Mini", "Minimalista");
    const { svg, nodes } = minimalMarkup(map, 0, 0);

    // Conexões: curva curta + reta horizontal, terminando em círculo vazado.
    expect(svg).toContain(" C ");
    expect(svg).toContain(" L ");
    expect(svg).toContain("<circle");
    expect(svg).toContain('stroke="#4F46E5"');

    // Nós: apenas texto (sem retângulos/caixas).
    expect(nodes).not.toContain("<rect");
    expect(nodes).toContain('class="n root"');
    expect(nodes).toContain("Primeira ideia");
  });

  it("gera documento completo com o fundo neutro e modo impressão", () => {
    const map = createMap("Mini", "Minimalista");
    const html = minimalDocument(map, { minX: 0, minY: 0, width: 800, height: 600 });
    expect(html).toContain("#F8FAFC");
    expect(html).toContain("<title>Mini</title>");

    const printable = minimalDocument(map, { minX: 0, minY: 0, width: 800, height: 600, print: true });
    expect(printable).toContain("window.print");
  });
});
