import type { Attachment, Workspace } from "./core/model";
import { validateAttachmentTarget } from "./attachmentSecurity";

export interface AttachmentOpenRuntime {
  workspace: Workspace;
  switchMap: (mapId: string) => void;
  alert: (message: string) => void;
  confirm: (message: string) => boolean;
  tauri?: unknown;
  openBrowserUrl: (url: string) => void;
}

interface TauriBridge {
  opener?: {
    openUrl?: (url: string) => void | Promise<void>;
    openPath?: (path: string) => void | Promise<void>;
  };
  core?: { invoke?: (command: string, args: Record<string, string>) => Promise<unknown> };
  invoke?: (command: string, args: Record<string, string>) => Promise<unknown>;
}

export async function openAttachment(att: Attachment, runtime: AttachmentOpenRuntime): Promise<void> {
  if (!att.path) return;
  const raw = att.path.trim();
  if (!raw) return;

  if (att.type === "map" && raw.startsWith("map://")) {
    const targetId = raw.slice(6);
    const target = runtime.workspace.maps.find(map => map.id === targetId);
    if (target) runtime.switchMap(targetId);
    else runtime.alert("Mapa vinculado não encontrado. Ele pode ter sido excluído.");
    return;
  }

  // Extensões bloqueadas e validação de esquema/caminho ficam em um único
  // lugar (attachmentSecurity.validateAttachmentTarget) para não divergirem.
  const extension = raw.split(/[?#]/)[0].split(/[/\\]/).pop()?.toLowerCase() ?? "";
  const target = validateAttachmentTarget(raw, att.type === "url");
  if (target.kind === "invalid") {
    runtime.alert(`Abertura bloqueada: ${target.reason}`);
    return;
  }

  const tauri = runtime.tauri as TauriBridge | undefined;
  if (!tauri) {
    if (target.kind === "url") runtime.openBrowserUrl(target.value);
    else if (att.type === "url") runtime.alert("Abertura bloqueada: em preview web, apenas URLs http(s) são permitidas.\nPara abrir arquivos locais, use a versão desktop do APAMIND.");
    else runtime.alert("Abertura de arquivos locais requer a versão desktop do APAMIND.");
    return;
  }

  try {
    const isWebUrl = target.kind === "url";
    const isLocalPath = target.kind === "path";
    if (att.type === "url" && isWebUrl) {
      if (tauri.opener?.openUrl) await tauri.opener.openUrl(target.value);
      else await (tauri.core?.invoke ?? tauri.invoke)!("plugin:opener|open_url", { url: target.value });
      return;
    }

    if (att.type === "url" && !isWebUrl && !isLocalPath) {
      runtime.alert(`Abertura bloqueada: scheme inválido. Apenas http(s) ou caminho local (C:\\ ou file://) é permitido.\nRecebido: ${raw.slice(0, 60)}`);
      return;
    }

    const allowedByType: Record<Attachment["type"], string[]> = {
      url: [],
      map: [],
      image: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif", ".ico"],
      video: [".mp4", ".webm", ".mov", ".mkv", ".avi", ".ogv"],
      audio: [".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".opus"],
      pdf: [".pdf"],
      doc: [".doc", ".docx", ".txt", ".odt", ".rtf"],
      xls: [".xls", ".xlsx", ".csv", ".ods", ".tsv"],
    };
    const allowed = allowedByType[att.type];
    if (allowed.length && extension && !allowed.includes(extension)) {
      if (!runtime.confirm(`Atenção: arquivo "${extension}" não corresponde ao tipo declarado "${att.type}". Tentar abrir mesmo assim?`)) return;
    }

    if (tauri.opener?.openPath) await tauri.opener.openPath(target.value);
    else {
      const invoke = tauri.core?.invoke ?? tauri.invoke;
      await invoke!("plugin:opener|open_path", { path: target.value });
    }
  } catch (error) {
    const message = String((error as { message?: unknown })?.message || error).slice(0, 200);
    runtime.alert(`Não foi possível abrir o anexo.\nTipo: ${att.type}\nErro: ${message}`);
  }
}
