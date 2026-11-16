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
});
