import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  ...fsMock,
  BaseDirectory: { AppLocalData: "appLocalData" },
}));

import { createMap } from "../core/templates";
import { resolveBootWorkspace } from "./workspace";

const FILE = "workspace.json";

function workspaceWith(title: string) {
  const map = createMap(title, "Livre");
  return { active: map.id, maps: [map] };
}

describe("resolveBootWorkspace", () => {
  const files = new Map<string, string>();
  const tauriWindow = window as typeof window & { __TAURI__?: unknown };

  beforeEach(() => {
    localStorage.clear();
    files.clear();
    tauriWindow.__TAURI__ = {};
    fsMock.exists.mockReset().mockImplementation(async (path: string) => files.has(path));
    fsMock.readTextFile.mockReset().mockImplementation(async (path: string) => {
      if (!files.has(path)) throw new Error(`missing ${path}`);
      return files.get(path)!;
    });
    fsMock.writeTextFile.mockReset().mockImplementation(async (path: string, value: string) => {
      files.set(path, value);
    });
  });

  it("usa o arquivo quando as duas fontes são iguais", async () => {
    const shared = JSON.stringify(workspaceWith("igual"));
    files.set(FILE, shared);
    localStorage.setItem("apamind.v6", shared);

    const outcome = await resolveBootWorkspace();
    expect(outcome).toMatchObject({ kind: "ready", source: "file" });
  });

  it("reporta conflito quando as fontes divergem, sem alterar nenhuma", async () => {
    const fileText = JSON.stringify(workspaceWith("arquivo"));
    const localText = JSON.stringify(workspaceWith("local"));
    files.set(FILE, fileText);
    localStorage.setItem("apamind.v6", localText);

    const outcome = await resolveBootWorkspace();
    expect(outcome.kind).toBe("conflict");
    expect(files.get(FILE)).toBe(fileText);
    expect(localStorage.getItem("apamind.v6")).toBe(localText);
  });

  it("reporta conflito quando o arquivo é inválido, preservando o conteúdo bruto", async () => {
    files.set(FILE, "{");
    localStorage.setItem("apamind.v6", JSON.stringify(workspaceWith("local")));

    const outcome = await resolveBootWorkspace();
    expect(outcome.kind).toBe("conflict");
    if (outcome.kind !== "conflict") return;
    expect(outcome.conflict.file.error).toMatch(/JSON inválido/);
    expect(outcome.conflict.file.raw).toBe("{");
    expect(outcome.conflict.local.workspace).not.toBeNull();
  });

  it("recusa versão futura do arquivo como conflito", async () => {
    const future = workspaceWith("futuro");
    files.set(FILE, JSON.stringify({ ...future, maps: [{ ...future.maps[0], schemaVersion: 2 }] }));

    const outcome = await resolveBootWorkspace();
    expect(outcome.kind).toBe("conflict");
    if (outcome.kind !== "conflict") return;
    expect(outcome.conflict.file.error).toMatch(/versão mais recente/);
  });

  it("usa a cópia local quando não há arquivo", async () => {
    localStorage.setItem("apamind.v6", JSON.stringify(workspaceWith("local")));

    const outcome = await resolveBootWorkspace();
    expect(outcome).toMatchObject({ kind: "ready", source: "local" });
  });

  it("usa o arquivo quando não há cópia local", async () => {
    files.set(FILE, JSON.stringify(workspaceWith("arquivo")));

    const outcome = await resolveBootWorkspace();
    expect(outcome).toMatchObject({ kind: "ready", source: "file" });
  });

  it("retorna empty quando não há nenhuma fonte", async () => {
    const outcome = await resolveBootWorkspace();
    expect(outcome).toEqual({ kind: "empty" });
  });
});
