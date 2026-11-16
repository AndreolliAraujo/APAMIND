export type AttachmentTarget =
  | { kind: "url"; value: string }
  | { kind: "path"; value: string }
  | { kind: "invalid"; reason: string };

const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/i;
const WINDOWS_UNC_PATH = /^(?:\\\\|\/\/)/;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const SCHEMELESS_WEB_ADDRESS = /^(?:localhost|(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3}|\[[\da-f:]+\])(?::\d{1,5})?(?:[/?#]|$)/i;
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".sh", ".ps1", ".psm1", ".vbs", ".vba", ".jar", ".msi", ".scr", ".com", ".wsf", ".hta",
  ".lnk", ".url", ".reg", ".cpl", ".pif", ".app", ".command", ".desktop", ".scf",
]);

function hasBlockedExtension(value: string): boolean {
  try {
    const pathname = /^https?:\/\//i.test(value) || /^file:/i.test(value)
      ? new URL(value).pathname
      : value.split(/[?#]/, 1)[0];
    const decodedPathname = decodeURIComponent(pathname);
    const extension = decodedPathname.split(/[\\/]/).pop()?.toLowerCase().match(/\.[^.]+$/)?.[0];
    return extension ? BLOCKED_EXTENSIONS.has(extension) : false;
  } catch {
    return false;
  }
}

function hasParentTraversal(path: string): boolean {
  return path.split(/[\\/]+/).some(segment => segment === "..");
}

export function normalizeSchemeLessWebAddress(raw: string): string | null {
  const value = raw.trim();
  if (!SCHEMELESS_WEB_ADDRESS.test(value)) return null;
  try {
    const url = new URL(`https://${value}`);
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Accepts only web URLs explicitly allowed by the caller or absolute local paths. */
export function validateAttachmentTarget(raw: string, allowWebUrl: boolean): AttachmentTarget {
  const value = raw.trim();
  if (!value || value.includes("\0")) return { kind: "invalid", reason: "Caminho vazio ou inválido." };
  if (WINDOWS_UNC_PATH.test(value)) return { kind: "invalid", reason: "Caminhos de rede não são permitidos." };
  const webAddress = /^https?:\/\//i.test(value)
    ? value
    : allowWebUrl ? normalizeSchemeLessWebAddress(value) : null;
  if (/^https?:\/\//i.test(value) && !allowWebUrl) {
    return { kind: "invalid", reason: "URLs só são permitidas em anexos do tipo URL." };
  }
  if (webAddress) {
    try {
      const url = new URL(webAddress);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) {
        return { kind: "invalid", reason: "URL inválida." };
      }
      return { kind: "url", value: url.href };
    } catch {
      return { kind: "invalid", reason: "URL inválida." };
    }
  }

  if (hasBlockedExtension(value)) return { kind: "invalid", reason: "Abertura de arquivos executáveis ou de atalho não é permitida." };

  if (/^file:/i.test(value)) {
    try {
      if (hasParentTraversal(decodeURIComponent(value.slice(5)))) {
        return { kind: "invalid", reason: "O caminho contém navegação para diretórios superiores." };
      }
      const url = new URL(value);
      if (url.protocol !== "file:" || (url.hostname && url.hostname.toLowerCase() !== "localhost") || url.search || url.hash) {
        return { kind: "invalid", reason: "URL de arquivo inválida." };
      }
      let path = decodeURIComponent(url.pathname);
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
      if (!path.startsWith("/") && !WINDOWS_ABSOLUTE_PATH.test(path)) {
        return { kind: "invalid", reason: "O caminho do arquivo precisa ser absoluto." };
      }
      if (hasParentTraversal(path)) return { kind: "invalid", reason: "O caminho contém navegação para diretórios superiores." };
      if (WINDOWS_ABSOLUTE_PATH.test(path)) path = path.replace(/\//g, "\\");
      return { kind: "path", value: path };
    } catch {
      return { kind: "invalid", reason: "URL de arquivo inválida." };
    }
  }

  if (SCHEME.test(value) && !WINDOWS_ABSOLUTE_PATH.test(value)) {
    return { kind: "invalid", reason: "Esquema de URL não permitido." };
  }
  if (!WINDOWS_ABSOLUTE_PATH.test(value) && !value.startsWith("/")) {
    return { kind: "invalid", reason: "O caminho do arquivo precisa ser absoluto." };
  }
  if (hasParentTraversal(value)) return { kind: "invalid", reason: "O caminho contém navegação para diretórios superiores." };
  return { kind: "path", value };
}
