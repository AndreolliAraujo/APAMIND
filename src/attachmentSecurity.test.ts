import { describe, expect, it } from "vitest";
import { normalizeSchemeLessWebAddress, validateAttachmentTarget } from "./attachmentSecurity";

describe("validateAttachmentTarget", () => {
  it.each([
    "https://example.com/doc",
    "http://localhost:5173/preview",
    "https://docs.sub.example.com:8443/path/to/page?mode=full&lang=pt#section-2",
    "https://example.com/download.exe?source=docs#file",
  ])("allows any valid HTTP(S) URL for URL attachments: %s", (value) => {
    expect(validateAttachmentTarget(value, true)).toMatchObject({ kind: "url" });
  });

  it("preserves URL path, port, parameters, fragment, and subdomain", () => {
    const address = "https://docs.sub.example.com:8443/path?q=1&lang=pt#part-a";
    expect(validateAttachmentTarget(address, true)).toEqual({ kind: "url", value: address });
  });

  it.each([
    ["example.com", "https://example.com/"],
    ["docs.sub.example.com:8443/guide?q=1#part", "https://docs.sub.example.com:8443/guide?q=1#part"],
    ["localhost:5173/app", "https://localhost:5173/app"],
  ])("normalizes a bare web address to HTTPS: %s", (input, expected) => {
    expect(normalizeSchemeLessWebAddress(input)).toBe(expected);
    expect(validateAttachmentTarget(input, true)).toEqual({ kind: "url", value: expected });
  });

  it("does not normalize an absolute local path as a web address", () => {
    expect(normalizeSchemeLessWebAddress("C:\\Users\\Ana\\document.pdf")).toBeNull();
  });

  it.each(["javascript:alert(1)", "data:text/html,hi", "mailto:user@example.com", "ftp://example.com/file"])(
    "rejects unauthorized URL schemes: %s",
    (value) => expect(validateAttachmentTarget(value, true).kind).toBe("invalid"),
  );

  it.each([
    "https://",
    "https://bad host/path",
    "https://example.com:invalid/path",
    "https://user:password@example.com/private",
    "http://user@example.com/private",
  ])("rejects malformed or credential-bearing URLs: %s", (value) => {
    expect(validateAttachmentTarget(value, true).kind).toBe("invalid");
  });

  it("rejects web URLs on non-URL attachment types", () => {
    expect(validateAttachmentTarget("https://example.com/file.pdf", false).kind).toBe("invalid");
  });

  it.each([
    "C:\\Users\\Ana\\..\\Windows\\file.pdf",
    "/home/ana/../etc/passwd",
    "file:///C:/Users/Ana/../Windows/file.pdf",
  ])("rejects parent directory traversal: %s", (value) =>
    expect(validateAttachmentTarget(value, false).kind).toBe("invalid"),
  );

  it.each([
    "C:\\Users\\Ana\\shortcut.lnk",
    "file:///home/ana/script.sh",
    "file:///home/ana/payload%2Eexe",
    // convenções do Windows que escondem a extensão real
    "C:\\Users\\Ana\\payload.exe.",
    "C:\\Users\\Ana\\payload.exe ",
    "C:\\Users\\Ana\\payload.exe::$DATA",
  ])("rejects executable and shortcut targets: %s", (value) =>
    expect(validateAttachmentTarget(value, /^https?:/i.test(value)).kind).toBe("invalid"),
  );

  it.each([
    ["C:\\Users\\Ana\\map.pdf", "C:\\Users\\Ana\\map.pdf"],
    ["/home/ana/map.pdf", "/home/ana/map.pdf"],
    ["file:///C:/Users/Ana/My%20Map.pdf", "C:\\Users\\Ana\\My Map.pdf"],
    ["file:///home/ana/My%20Map.pdf", "/home/ana/My Map.pdf"],
  ])("accepts absolute local path %s", (input, expected) => {
    expect(validateAttachmentTarget(input, false)).toEqual({ kind: "path", value: expected });
  });

  it.each([
    "relative/file.pdf",
    "\\\\server\\share\\file.pdf",
    "//server/share/file.pdf",
    "file://server/share/file.pdf",
  ])("rejects relative and network paths: %s", (value) =>
    expect(validateAttachmentTarget(value, false).kind).toBe("invalid"),
  );
});
