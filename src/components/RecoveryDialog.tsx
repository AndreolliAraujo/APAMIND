import type { SourceSnapshot, WorkspaceConflict } from "../storage/workspace";

interface RecoveryDialogProps {
  conflict: WorkspaceConflict;
  busy: boolean;
  onUseFile: () => void;
  onUseLocal: () => void;
  onExport: () => void;
  onCloseUnchanged: () => void;
}

function summarize(source: SourceSnapshot): string {
  if (source.workspace) {
    const maps = source.workspace.maps;
    const names = maps
      .slice(0, 3)
      .map((map) => map.title)
      .join(", ");
    const suffix = maps.length > 3 ? "…" : "";
    return `${maps.length} mapa(s): ${names}${suffix}`;
  }
  if (source.raw !== null) return "Conteúdo presente, mas inválido ou ilegível.";
  return "Ausente.";
}

function SourceCard({
  title,
  summary,
  error,
  available,
  actionLabel,
  onAction,
  disabled,
}: {
  title: string;
  summary: string;
  error: string | null;
  available: boolean;
  actionLabel: string;
  onAction: () => void;
  disabled: boolean;
}) {
  return (
    <section
      className={`rounded-xl border p-4 ${available ? "border-white/15 bg-white/[.03]" : "border-white/8 bg-white/[.02] opacity-80"}`}
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-300">{summary}</p>
      {error && <p className="mt-2 break-words text-[11px] leading-4 text-rose-300/90">{error}</p>}
      <button
        onClick={onAction}
        disabled={disabled}
        className={`mt-3 w-full rounded-lg px-3 py-2 text-sm font-medium transition ${
          available
            ? "bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-50"
            : "cursor-not-allowed border border-white/10 text-slate-500"
        }`}
      >
        {actionLabel}
      </button>
    </section>
  );
}

export function RecoveryDialog({
  conflict,
  busy,
  onUseFile,
  onUseLocal,
  onExport,
  onCloseUnchanged,
}: RecoveryDialogProps) {
  const canUseFile = Boolean(conflict.file.workspace);
  const canUseLocal = Boolean(conflict.local.workspace);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="presentation">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
        className="w-full max-w-2xl rounded-2xl border border-amber-400/30 bg-slate-900 p-6 text-slate-100 shadow-2xl"
      >
        <h2 id="recovery-title" className="text-lg font-semibold text-amber-300">
          Os dados precisam de uma decisão
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">{conflict.detail}</p>
        <p className="mt-2 text-xs text-slate-400">
          Nada foi alterado. Escolha uma cópia ou exporte as duas antes de decidir.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <SourceCard
            title="Arquivo workspace.json"
            summary={summarize(conflict.file)}
            error={conflict.file.error}
            available={canUseFile}
            actionLabel={canUseFile ? "Usar o arquivo" : "Indisponível"}
            onAction={onUseFile}
            disabled={!canUseFile || busy}
          />
          <SourceCard
            title="Cópia local (recuperação)"
            summary={summarize(conflict.local)}
            error={conflict.local.error}
            available={canUseLocal}
            actionLabel={canUseLocal ? "Usar a cópia local" : "Indisponível"}
            onAction={onUseLocal}
            disabled={!canUseLocal || busy}
          />
        </div>

        {canUseFile && canUseLocal && (
          <p className="mt-3 text-xs text-amber-400/90">
            Ao usar a cópia local, o arquivo atual é preservado em um temporário antes de ser substituído.
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            onClick={onExport}
            disabled={busy}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
          >
            Exportar as duas cópias
          </button>
          <button
            onClick={onCloseUnchanged}
            disabled={busy}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
          >
            Sair sem alterar
          </button>
        </div>
      </section>
    </div>
  );
}
