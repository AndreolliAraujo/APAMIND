import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { mkEdge, mkNode } from "./core/model";
import { minimalTipId } from "./core/minimal";
import { createMap } from "./core/templates";

const nodeButtons = () => screen.queryAllByRole("button", { name: /^No: /i });

describe("App: atalhos de teclado", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    vi.restoreAllMocks();
  });

  it("Ctrl+A seleciona, Delete apaga e Ctrl+Z desfaz usando o estado atual", async () => {
    render(<App />);
    await screen.findAllByRole("button", { name: /^No: /i });

    const before = nodeButtons().length;
    expect(before).toBeGreaterThan(0);

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Delete" });

    await waitFor(() => expect(nodeButtons()).toHaveLength(0));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    await waitFor(() => expect(nodeButtons()).toHaveLength(before));
  });

  it("aplica zoom com a roda do mouse depois que o canvas é montado", async () => {
    render(<App />);
    // O canvas só aparece depois das telas de boot; o listener nativo precisa ser
    // religado nesse momento (regressão: roda do mouse não fazia zoom no desktop).
    const canvas = await screen.findByTestId("canvas");
    const zoomPercentual = () => Number(screen.getByTestId("zoom-level").textContent?.replace(/\D/g, ""));

    // fitView roda no boot e define o zoom inicial; o teste parte do valor observado.
    const inicial = zoomPercentual();
    expect(inicial).toBeGreaterThan(0);

    fireEvent.wheel(canvas, { deltaY: 100, clientX: 10, clientY: 10 });
    await waitFor(() => expect(zoomPercentual()).toBe(Math.round((inicial / 100) * 0.92 * 100)));

    fireEvent.wheel(canvas, { deltaY: -100, clientX: 10, clientY: 10 });
    await waitFor(() => expect(zoomPercentual()).toBe(Math.round((inicial / 100) * 0.92 * 1.08 * 100)));
  });
});

describe("App: busca de nós", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    vi.restoreAllMocks();
  });

  it("fecha o popup e navega ao clicar em um resultado", async () => {
    render(<App />);
    await screen.findByTestId("canvas");

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const dialog = screen.getByRole("dialog", { name: "Busca de nós" });
    fireEvent.change(within(dialog).getByPlaceholderText("Buscar nos nós…"), {
      target: { value: "ob" },
    });

    fireEvent.click(await within(dialog).findByRole("button", { name: /Objetivo/ }));

    // O popup some ao escolher o resultado e o canvas navega até o nó (zoom 120%).
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Busca de nós" })).toBeNull());
    expect(screen.getByTestId("zoom-level").textContent?.replace(/\D/g, "")).toBe("120");
  });
});

describe("App: geometria das conexões", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    vi.restoreAllMocks();
  });

  it("mantém a curva como padrão e troca para ortogonal pelo menu de contexto", async () => {
    render(<App />);
    const edges = await screen.findByTestId("edges");
    const paths = edges.querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(1);

    // Por conexão existem dois paths: a linha visível e a área de clique.
    // Os dois usam a mesma geometria, e o padrão continua sendo a curva.
    expect(paths[0].getAttribute("d")).toContain(" C ");
    expect(paths[1].getAttribute("d")).toBe(paths[0].getAttribute("d"));

    fireEvent.contextMenu(paths[1], { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Conexão ortogonal/ }));

    await waitFor(() => expect(paths[0].getAttribute("d")).toContain(" L "));
    expect(paths[1].getAttribute("d")).toBe(paths[0].getAttribute("d"));
  });

  it("aplica a geometria escolhida a todas as conexões", async () => {
    render(<App />);
    const edges = await screen.findByTestId("edges");
    const paths = edges.querySelectorAll("path");

    fireEvent.contextMenu(paths[1], { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Conexão ortogonal/ }));
    await waitFor(() => expect(paths[0].getAttribute("d")).toContain(" L "));

    // A opção "Aplicar" usa a geometria atual da conexão clicada: com a primeira
    // conexão já ortogonal, o menu oferece propagar "Ortogonal" para as demais.
    fireEvent.contextMenu(paths[1], { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Aplicar "Ortogonal" a todas as conexões/ }));

    await waitFor(() => {
      const visible = Array.from(edges.querySelectorAll("path")).filter((_, index) => index % 2 === 0);
      expect(visible.length).toBeGreaterThan(1);
      expect(visible.every((path) => path.getAttribute("d")?.includes(" L "))).toBe(true);
    });
  });
});

describe("App: modelos de organização", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    vi.restoreAllMocks();
  });

  it("mostra os modelos com miniatura gerada e aplica o escolhido", async () => {
    render(<App />);
    await screen.findByTestId("canvas");

    fireEvent.click(screen.getByRole("button", { name: /Organizar/ }));
    const dialog = screen.getByRole("dialog");
    const cards = within(dialog)
      .getAllByRole("button")
      .filter((button) => /Organograma|Espinha de Peixe|Linha do Tempo|Radial/.test(button.textContent ?? ""));
    expect(cards).toHaveLength(4);
    // A miniatura vem do próprio preset, não é um desenho avulso.
    for (const card of cards) expect(card.querySelector("svg")).not.toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: /Espinha de Peixe/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Modelo aplicado: o canvas desenha a espinha como decoração.
    const edges = await screen.findByTestId("edges");
    await waitFor(() => expect(edges.querySelectorAll("line").length).toBeGreaterThan(0));
  });
});

describe("App: template Minimalista", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    vi.restoreAllMocks();
  });

  it("renderiza só texto, com tema próprio e sem botão de colapsar", async () => {
    const map = createMap("Minimal", "Minimalista");
    localStorage.setItem("apamind.v6", JSON.stringify({ active: map.id, maps: [map] }));

    render(<App />);
    await screen.findByTestId("canvas");

    const nodes = screen.getAllByRole("button", { name: /^No: /i });
    expect(nodes).toHaveLength(map.nodes.length);

    // Raiz: tipografia maior, centralizada e na cor de destaque.
    expect(nodes[0].className).toContain("text-2xl");
    expect(nodes[0].className).toContain("text-center");
    expect(nodes[0].style.color).toBe("rgb(79, 70, 229)");

    // Filhos: texto puro em bloco transparente de largura fixa.
    expect(nodes[1].style.width).toBe("220px");
    expect(nodes[1].style.color).toBe("rgb(30, 41, 59)");
    expect(nodes[1].className).not.toContain("border");
    expect(nodes[1].textContent).toContain("Primeira ideia");

    // Sem botão de expandir/recolher (o círculo da Etapa 4 assume o papel).
    expect(screen.queryByRole("button", { name: "Colapsar ou expandir ramo" })).toBeNull();

    // Tema fixo do template: fundo neutro e linhas azul-índigo.
    expect(document.querySelector("main")!.style.backgroundColor).toBe("rgb(248, 250, 252)");
    const edges = await screen.findByTestId("edges");
    expect(edges.querySelector("path")!.getAttribute("stroke")).toBe("#4F46E5");
  });

  it("desenha a linha sublinhada e recolhe o ramo pelo círculo da ponta", async () => {
    const root = mkNode("Raiz", "", 600, 380, 0);
    const child = mkNode("Ramo", "", 940, 380, 1);
    const leaf = mkNode("Sub", "", 1240, 380, 2);
    const map = {
      ...createMap("Minimal", "Minimalista"),
      nodes: [root, child, leaf],
      edges: [mkEdge(root.id, child.id), mkEdge(child.id, leaf.id)],
    };
    localStorage.setItem("apamind.v6", JSON.stringify({ active: map.id, maps: [map] }));

    render(<App />);
    const edges = await screen.findByTestId("edges");

    // Linha do modelo: curva curta + reta horizontal; a área de clique é só a reta,
    // para não cobrir o texto do nó.
    const [visible, hit] = edges.querySelectorAll("path");
    expect(visible.getAttribute("d")).toContain(" C ");
    expect(visible.getAttribute("d")).toContain(" L ");
    expect(hit.getAttribute("d")).not.toContain(" C ");

    // O círculo da ponta recolhe o ramo e mostra quantos sub-itens ficaram ocultos.
    fireEvent.click(screen.getByRole("button", { name: /Expandir ou recolher ramo de Ramo/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "No: Sub" })).toBeNull());
    expect(screen.getByTestId(minimalTipId(child.id)).closest("g")!.textContent).toContain("1");
  });
});

const BACKGROUND_DARK = {
  name: "Escuro",
  baseDark: "#112233",
  baseLight: "#FFFFFF",
  glowA: "rgba(0,0,0,0)",
  glowB: "rgba(0,0,0,0)",
  pattern: "none" as const,
  animated: false,
};

const BACKGROUND_LIGHT = {
  name: "Claro",
  baseDark: "#000000",
  baseLight: "#ABCDEF",
  glowA: "rgba(0,0,0,0)",
  glowB: "rgba(0,0,0,0)",
  pattern: "none" as const,
  animated: false,
};

describe("App: tema por mapa", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    vi.restoreAllMocks();
  });

  const mainBackground = () => document.querySelector("main")!.style.backgroundColor;

  it("abre com o tema gravado no mapa ativo", async () => {
    const map = { ...createMap("Escuro", "Livre"), theme: { dark: true, background: BACKGROUND_DARK } };
    localStorage.setItem("apamind.v6", JSON.stringify({ active: map.id, maps: [map] }));

    render(<App />);
    await screen.findByTestId("canvas");
    await waitFor(() => expect(mainBackground()).toBe("rgb(17, 34, 51)"));
  });

  it("aplica o tema de cada mapa ao trocar de mapa", async () => {
    const dark = { ...createMap("Escuro", "Livre"), theme: { dark: true, background: BACKGROUND_DARK } };
    const light = { ...createMap("Claro", "Livre"), theme: { dark: false, background: BACKGROUND_LIGHT } };
    localStorage.setItem("apamind.v6", JSON.stringify({ active: dark.id, maps: [dark, light] }));

    render(<App />);
    await screen.findByTestId("canvas");
    await waitFor(() => expect(mainBackground()).toBe("rgb(17, 34, 51)"));

    // A lista de mapas fica na barra lateral (fechada por padrão).
    fireEvent.click(screen.getAllByRole("button", { name: "Alternar barra lateral" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Claro" }));
    await waitFor(() => expect(mainBackground()).toBe("rgb(171, 205, 239)"));
  });

  it("grava no mapa o tema ajustado e mantém no autosave", async () => {
    const map = { ...createMap("Escuro", "Livre"), theme: { dark: true, background: BACKGROUND_DARK } };
    localStorage.setItem("apamind.v6", JSON.stringify({ active: map.id, maps: [map] }));

    render(<App />);
    await screen.findByTestId("canvas");
    fireEvent.click(screen.getByRole("button", { name: "Alternar tema claro/escuro" }));

    await waitFor(
      () => {
        const saved = JSON.parse(localStorage.getItem("apamind.v6")!);
        expect(saved.maps[0].theme).toMatchObject({ dark: false });
        expect(saved.maps[0].theme.background.name).toBe("Escuro");
      },
      { timeout: 3000 },
    );
  });

  it("criar um mapa Minimalista não muda o tema dos outros mapas", async () => {
    const existing = createMap("Existente", "Livre");
    localStorage.setItem("apamind.v6", JSON.stringify({ active: existing.id, maps: [existing] }));

    render(<App />);
    await screen.findByTestId("canvas");

    fireEvent.click(screen.getByRole("button", { name: "+ Novo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Minimalista" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar mapa" }));

    await waitFor(
      () => {
        const saved = JSON.parse(localStorage.getItem("apamind.v6")!);
        expect(saved.maps).toHaveLength(2);
        const minimal = saved.maps.find((m: { template: string }) => m.template === "Minimalista");
        expect(minimal.theme).toMatchObject({ dark: false });
        expect(minimal.theme.background.name).toBe("Minimalista");
        const other = saved.maps.find((m: { template: string }) => m.template !== "Minimalista");
        expect(other.theme).toBeUndefined();
      },
      { timeout: 3000 },
    );
    expect(mainBackground()).toBe("rgb(248, 250, 252)");
  });

  it("voltar para um mapa sem tema não herda o fundo do Minimalista", async () => {
    const minimal = {
      ...createMap("Mini", "Minimalista"),
      theme: {
        dark: false,
        background: {
          name: "Minimalista",
          baseDark: "#F8FAFC",
          baseLight: "#F8FAFC",
          glowA: "rgba(248,250,252,0)",
          glowB: "rgba(248,250,252,0)",
          pattern: "none" as const,
          animated: false,
        },
      },
    };
    const legacy = createMap("Existente", "Livre");
    localStorage.setItem("apamind.v6", JSON.stringify({ active: minimal.id, maps: [minimal, legacy] }));

    render(<App />);
    await screen.findByTestId("canvas");
    await waitFor(() => expect(mainBackground()).toBe("rgb(248, 250, 252)"));

    fireEvent.click(screen.getAllByRole("button", { name: "Alternar barra lateral" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Existente" }));
    // Mapa antigo, sem tema gravado: volta ao padrão do app, não ao Minimalista.
    await waitFor(() => expect(mainBackground()).toBe("rgb(8, 10, 18)"));
  });
});
