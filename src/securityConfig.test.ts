import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const capability = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/capabilities/default.json"), "utf8"));
const viteConfig = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");
const attachmentActions = readFileSync(resolve(process.cwd(), "src/attachmentActions.ts"), "utf8");

describe("configuração de segurança", () => {
  it("mantém o servidor Vite restrito ao loopback", () => {
    expect(viteConfig).toMatch(/host:\s*["']127\.0\.0\.1["']/);
    expect(viteConfig).not.toMatch(/host:\s*["']0\.0\.0\.0["']/);
    expect(viteConfig).not.toMatch(/allowedHosts:\s*true/);
  });

  it("não concede permissões recursivas de filesystem ou abertura global", () => {
    const permissions: Array<string | { identifier: string; allow?: Array<{ path?: string; url?: string }> }> =
      capability.permissions;
    expect(permissions).not.toContain("opener:default");
    expect(permissions).not.toContain("fs:default");
    expect(permissions).not.toContain("fs:allow-applocaldata-read-recursive");
    expect(permissions).not.toContain("fs:allow-applocaldata-write-recursive");

    const pathScopes = permissions.flatMap((permission) =>
      typeof permission === "string"
        ? []
        : (permission.allow ?? []).flatMap((scope) => (scope.path ? [scope.path] : [])),
    );
    expect(pathScopes).not.toContain("**");
    expect(
      pathScopes
        .filter((path) => path.startsWith("$APPLOCALDATA/"))
        .every((path) => path === "$APPLOCALDATA/workspace.json" || path === "$APPLOCALDATA/workspace.json.tmp-*"),
    ).toBe(true);

    const urlPermission = permissions.find(
      (permission) => typeof permission !== "string" && permission.identifier === "opener:allow-open-url",
    );
    expect(urlPermission).toMatchObject({ allow: [{ url: "http://*" }, { url: "https://*" }] });
    expect(attachmentActions).toContain("tauri.opener?.openUrl");
    expect(attachmentActions).toContain('"plugin:opener|open_url"');
    expect(attachmentActions).not.toMatch(/child_process|Command\.new|shell:allow-open/);
  });
});
