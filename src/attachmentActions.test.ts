import { describe, expect, it, vi } from "vitest";
import type { Attachment } from "./core/model";
import { createMap } from "./core/templates";
import { openAttachment, type AttachmentOpenRuntime } from "./attachmentActions";

function setup() {
  const map = createMap("Map", "Livre");
  const workspace = { active: map.id, maps: [map] };
  const runtime: AttachmentOpenRuntime = {
    workspace,
    switchMap: vi.fn(),
    alert: vi.fn(),
    confirm: vi.fn(() => true),
    tauri: { opener: { openUrl: vi.fn(), openPath: vi.fn() } },
    openBrowserUrl: vi.fn(),
  };
  return { map, runtime };
}

function attachment(type: Attachment["type"], path: string): Attachment {
  return { id: "att-1", type, name: "Reference", path };
}

describe("attachment actions", () => {
  it.each([
    "https://sub.example.com:8443/docs?q=one#section",
    "http://another.example.org/path?x=1#part",
  ])("opens permitted external link %s with the Tauri opener", async url => {
    const { runtime } = setup();
    await openAttachment(attachment("url", url), runtime);
    expect((runtime.tauri as any).opener.openUrl).toHaveBeenCalledWith(url);
    expect((runtime.tauri as any).opener.openPath).not.toHaveBeenCalled();
  });

  it("keeps local file attachments on the openPath route", async () => {
    const { runtime } = setup();
    const path = "C:\\Users\\Ana\\guide.pdf";
    await openAttachment(attachment("pdf", path), runtime);
    expect((runtime.tauri as any).opener.openPath).toHaveBeenCalledWith(path);
    expect((runtime.tauri as any).opener.openUrl).not.toHaveBeenCalled();
  });

  it("rejects a non-HTTP scheme without calling the opener", async () => {
    const { runtime } = setup();
    await openAttachment(attachment("url", "javascript:alert(1)"), runtime);
    expect((runtime.tauri as any).opener.openUrl).not.toHaveBeenCalled();
    expect((runtime.tauri as any).opener.openPath).not.toHaveBeenCalled();
    expect(runtime.alert).toHaveBeenCalledWith(expect.stringContaining("Esquema de URL não permitido"));
  });

  it("routes an internal map attachment through map switching", async () => {
    const { map, runtime } = setup();
    await openAttachment(attachment("map", `map://${map.id}`), runtime);
    expect(runtime.switchMap).toHaveBeenCalledWith(map.id);
    expect((runtime.tauri as any).opener.openPath).not.toHaveBeenCalled();
  });

  it("opens web URLs in the browser fallback while blocking local files", async () => {
    const { runtime } = setup();
    runtime.tauri = undefined;
    await openAttachment(attachment("url", "https://example.com"), runtime);
    await openAttachment(attachment("pdf", "C:\\Users\\Ana\\guide.pdf"), runtime);
    expect(runtime.openBrowserUrl).toHaveBeenCalledWith("https://example.com/");
    expect(runtime.alert).toHaveBeenCalledWith(expect.stringContaining("requer a versão desktop"));
  });
});
