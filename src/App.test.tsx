import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
