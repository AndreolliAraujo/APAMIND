import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

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
