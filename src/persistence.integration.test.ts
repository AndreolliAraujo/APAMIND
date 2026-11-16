import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  ...fs,
  BaseDirectory: { AppLocalData: "appLocalData" },
}));

import { loadWs, loadWsAsync, saveWs } from "./storage/workspace";
import { createCloseGuard } from "./closeGuard";
import type { Workspace } from "./core/model";

const withTitle = (title: string): Workspace => ({
  active: "m1",
  maps: [{ id: "m1", title, template: "Livre", ts: "2026-01-01", nodes: [], edges: [] }],
});

describe("integração da persistência desktop", () => {
  const files = new Map<string, string>();
  const tauri = window as typeof window & { __TAURI__?: unknown };

  beforeEach(() => {
    localStorage.clear();
    files.clear();
    tauri.__TAURI__ = {};
    fs.exists.mockReset().mockImplementation(async (path: string) => files.has(path));
    fs.readTextFile.mockReset().mockImplementation(async (path: string) => {
      if (!files.has(path)) throw new Error(`missing ${path}`);
      return files.get(path)!;
    });
    fs.writeTextFile.mockReset().mockImplementation(async (path: string, value: string) => {
      files.set(path, value);
    });
    fs.rename.mockReset().mockImplementation(async (from: string, to: string) => {
      const raw = files.get(from);
      if (raw === undefined) throw new Error(`missing ${from}`);
      files.set(to, raw);
      files.delete(from);
    });
  });

  it("recupera v5, verifica a migração, grava o arquivo principal e fecha sem duplicar escrita", async () => {
    const v5 = JSON.stringify(withTitle("mapa v5"));
    localStorage.setItem("apamind.v5", v5);

    // A carga síncrona não materializa v6 no desktop antes da comparação com o arquivo.
    expect(loadWs().maps[0].title).toBe("mapa v5");
    expect(localStorage.getItem("apamind.v6")).toBeNull();

    const recovered = await loadWsAsync();
    expect(recovered?.maps[0].title).toBe("mapa v5");
    expect(localStorage.getItem("apamind.v5")).toBe(v5);
    expect(JSON.parse(localStorage.getItem("apamind.v6")!).maps[0].title).toBe("mapa v5");

    const writesBeforeClose = fs.writeTextFile.mock.calls.length;
    const closeWindow = vi.fn(async () => undefined);
    const guard = createCloseGuard({
      cancelDebounce: vi.fn(),
      getWorkspace: () => recovered!,
      saveWorkspace: saveWs,
      closeWindow,
    });
    guard.onCloseRequested({ preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(JSON.parse(files.get("workspace.json")!).maps[0].title).toBe("mapa v5");
    expect(fs.writeTextFile).toHaveBeenCalledTimes(writesBeforeClose + 1);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it("preserves URL attachments after the workspace is saved and reopened", async () => {
    const workspace = withTitle("map with external link");
    workspace.maps[0].nodes = [
      {
        id: "node-link",
        title: "Reference",
        note: "",
        x: 0,
        y: 0,
        tone: 0,
        shape: "card",
        attachments: [
          {
            id: "attachment-link",
            type: "url",
            name: "External documentation",
            path: "https://docs.sub.example.com:8443/guide?q=1#section",
          },
        ],
      },
    ];

    expect((await saveWs(workspace)).success).toBe(true);
    const reopened = await loadWsAsync();
    expect(reopened?.maps[0].nodes[0].attachments?.[0]).toEqual(workspace.maps[0].nodes[0].attachments?.[0]);
  });

  it("bloqueia inicialização divergente sem sobrescrever o arquivo principal", async () => {
    const main = JSON.stringify(withTitle("arquivo principal"));
    const recovery = JSON.stringify(withTitle("cache de recuperação"));
    files.set("workspace.json", main);
    localStorage.setItem("apamind.v6", recovery);

    await expect(loadWsAsync()).rejects.toThrow(/divergem/);
    expect(files.get("workspace.json")).toBe(main);
    expect(localStorage.getItem("apamind.v6")).toBe(recovery);
    expect(fs.writeTextFile).not.toHaveBeenCalled();
    expect(fs.rename).not.toHaveBeenCalled();
  });

  it("retém dados durante gravação falha e só fecha após retry confirmado", async () => {
    const original = JSON.stringify(withTitle("anterior íntegro"));
    files.set("workspace.json", original);
    localStorage.setItem("apamind.v6", original);
    expect((await loadWsAsync())?.maps[0].title).toBe("anterior íntegro");

    const changed = withTitle("alteração pendente");
    let failuresLeft = 2;
    fs.writeTextFile.mockImplementation(async (path: string, value: string) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("falha simulada de disco");
      }
      files.set(path, value);
    });
    const firstAttempt = await saveWs(changed);
    expect(firstAttempt.success).toBe(false);
    expect(files.get("workspace.json")).toBe(original);
    expect(JSON.parse(localStorage.getItem("apamind.v6")!).maps[0].title).toBe("alteração pendente");

    const errors: string[] = [];
    const closeWindow = vi.fn(async () => undefined);
    const guard = createCloseGuard({
      cancelDebounce: vi.fn(),
      getWorkspace: () => changed,
      saveWorkspace: saveWs,
      closeWindow,
      onError: (error) => errors.push(error),
    });
    guard.onCloseRequested({ preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closeWindow).not.toHaveBeenCalled();
    expect(errors.at(-1)).toContain("falha simulada de disco");
    expect(files.get("workspace.json")).toBe(original);

    guard.retry();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(files.get("workspace.json")!).maps[0].title).toBe("alteração pendente");
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it("aguarda gravação em andamento antes de autorizar o fechamento", async () => {
    const original = JSON.stringify(withTitle("base"));
    files.set("workspace.json", original);
    localStorage.setItem("apamind.v6", original);
    await loadWsAsync();

    let release!: () => void;
    const changed = withTitle("em gravação");
    fs.writeTextFile.mockImplementation(async (path: string, value: string) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      files.set(path, value);
    });
    const inFlight = saveWs(changed);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const closeWindow = vi.fn(async () => undefined);
    const guard = createCloseGuard({
      cancelDebounce: vi.fn(),
      getWorkspace: () => changed,
      saveWorkspace: saveWs,
      closeWindow,
    });
    guard.onCloseRequested({ preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closeWindow).not.toHaveBeenCalled();

    release();
    expect((await inFlight).success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(files.get("workspace.json")!).maps[0].title).toBe("em gravação");
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });
});
