import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "src");

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function tsFiles(dir: string): string[] {
  return listFiles(dir).filter((p) => p.endsWith(".ts"));
}

describe("arquitetura: fronteiras de camada", () => {
  it("core nao importa storage, ui nem APIs do host", () => {
    for (const file of tsFiles(resolve(root, "core"))) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} importa de storage`).not.toMatch(/from\s+["'][^"']*\/storage(?:\/|["'])/);
      expect(src, `${file} importa de ui`).not.toMatch(/from\s+["'][^"']*\/ui(?:\/|["'])/);
      expect(src, `${file} usa @tauri-apps`).not.toMatch(/@tauri-apps/);
      expect(src, `${file} toca window`).not.toMatch(/\bwindow\./);
      expect(src, `${file} toca localStorage`).not.toMatch(/\blocalStorage/);
      expect(src, `${file} toca document`).not.toMatch(/\bdocument\./);
    }
  });

  it("storage nao importa de ui", () => {
    for (const file of tsFiles(resolve(root, "storage"))) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} importa de ui`).not.toMatch(/from\s+["'][^"']*\/ui(?:\/|["'])/);
    }
  });

  it("shims antigos foram removidos", () => {
    expect(existsSync(resolve(root, "mind.ts"))).toBe(false);
    expect(existsSync(resolve(root, "io.ts"))).toBe(false);
  });
});
