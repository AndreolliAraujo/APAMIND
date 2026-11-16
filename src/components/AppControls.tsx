import { useState } from "react";

export function CloseFailureDialog({
  open,
  saving,
  error,
  failureStage = "save",
  onRetry,
  onCancel,
}: {
  open: boolean;
  saving: boolean;
  error: string | null;
  failureStage?: "save" | "destroy";
  onRetry: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="presentation">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-save-title"
        className="w-full max-w-md rounded-2xl border border-red-400/30 bg-slate-900 p-6 text-slate-100 shadow-2xl"
      >
        <h2 id="close-save-title" className="text-lg font-semibold text-red-300">
          {failureStage === "save"
            ? "Não foi possível salvar antes de fechar"
            : "Os dados foram salvos, mas não foi possível fechar"}
        </h2>
        <p className="mt-3 break-words text-sm leading-6 text-slate-300">
          {error || "O ApaMind não confirmou a gravação das alterações pendentes."}
        </p>
        <p className="mt-2 text-xs text-slate-400">
          {failureStage === "save"
            ? "O aplicativo continua aberto e seus dados permanecem disponíveis para nova tentativa."
            : "Os dados estão salvos; tente novamente para fechar o aplicativo."}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5">
            Cancelar fechamento
          </button>
          <button
            disabled={saving}
            onClick={onRetry}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {saving ? "Salvando..." : failureStage === "save" ? "Tentar salvar novamente" : "Tentar fechar novamente"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[.14em] text-slate-500">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full cursor-pointer rounded-lg border-0 bg-transparent p-0"
      />
    </label>
  );
}

const EMOJI_CATEGORIES = [
  {
    name: "Ideias",
    emojis: ["💡", "🎯", "🚀", "⭐", "🔥", "✨", "🎉", "🏆", "🎨", "🔧", "⚙️", "🔬", "📐", "🧩", "🧠", "💭"],
  },
  {
    name: "Ações",
    emojis: ["✅", "☑️", "✔️", "❌", "➕", "➖", "✏️", "📝", "📌", "📍", "🔍", "🔎", "🔄", "⏩", "⏪", "⏳"],
  },
  {
    name: "Pessoas",
    emojis: ["👤", "👥", "🧑", "👨", "👩", "🧑‍💼", "👨‍💼", "👩‍💼", "🧑‍🔧", "👨‍🔧", "👩‍🔧", "🧑‍🎓", "👨‍🎓", "👩‍🎓", "🧑‍🏫", "👨‍⚕️"],
  },
  {
    name: "Objetos",
    emojis: ["📁", "📂", "📄", "📑", "📊", "📈", "📉", "📅", "📆", "🗓️", "📋", "📌", "📎", "🔗", "📦", "🗂️"],
  },
  {
    name: "Natureza",
    emojis: ["🌱", "🌿", "🍀", "🌳", "🌲", "🌴", "🌵", "🌸", "🌺", "🌻", "🌞", "🌙", "⭐", "🌍", "🌎", "🌏"],
  },
  {
    name: "Símbolos",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖"],
  },
  {
    name: "Alertas",
    emojis: ["⚠️", "🚫", "⛔", "🛑", "❗", "❕", "❓", "❔", "‼️", "⁉️", "🔔", "🔕", "📣", "📢", "💬", "🗯️"],
  },
  {
    name: "Tecnologia",
    emojis: ["💻", "🖥️", "💾", "💿", "📀", "🖱️", "⌨️", "🖨️", "🔌", "🔋", "📡", "🔭", "📷", "📹", "🎥", "📺"],
  },
  {
    name: "Financeiro",
    emojis: ["💰", "💵", "💶", "💷", "💴", "💸", "💳", "🪙", "📈", "📉", "💹", "🏦", "🧾", "💲", "🤑", "🪙"],
  },
  {
    name: "Tempo",
    emojis: ["⏰", "🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛", "📅", "📆", "🗓️"],
  },
];

export function EmojiPicker({
  value,
  onPick,
  isDark,
}: {
  value: string;
  onPick: (icon: string) => void;
  isDark: boolean;
}) {
  const [openCat, setOpenCat] = useState<string | null>("Ideias");
  return (
    <div
      className={`mt-2 rounded-xl border p-2 ${isDark ? "border-white/8 bg-white/[.03]" : "border-black/5 bg-slate-50"}`}
    >
      <div className="flex gap-1 overflow-x-auto pb-1 custom-scroll">
        {EMOJI_CATEGORIES.map((category) => (
          <button
            key={category.name}
            onClick={() => setOpenCat(openCat === category.name ? null : category.name)}
            className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium transition ${
              openCat === category.name
                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                : isDark
                  ? "text-slate-400 hover:bg-white/5 border border-transparent"
                  : "text-slate-600 hover:bg-slate-100 border border-transparent"
            }`}
          >
            {category.emojis[0]} {category.name}
          </button>
        ))}
      </div>
      {openCat && (
        <div className="mt-2 grid grid-cols-8 gap-1">
          {EMOJI_CATEGORIES.find((category) => category.name === openCat)?.emojis.map((emoji) => (
            <button
              key={emoji}
              onClick={() => onPick(emoji)}
              className={`flex items-center justify-center rounded-lg py-1 text-lg transition ${
                value === emoji ? "bg-indigo-500/25 ring-1 ring-indigo-400/40" : "hover:bg-white/10"
              }`}
            >
              <span className="emoji">{emoji}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CtxBtn({ label, onClick, danger = false }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`w-full text-left rounded-md px-2.5 py-1 text-[11px] transition ${danger ? "text-rose-400 hover:bg-rose-500/10" : "hover:bg-white/8"}`}
    >
      {label}
    </button>
  );
}
