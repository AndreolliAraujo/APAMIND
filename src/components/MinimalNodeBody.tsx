import type { MNode } from "../core/model";
import { MINIMAL_THEME } from "../ui/minimal";

/**
 * Corpo do nó no template Minimalista: apenas título (e a nota curta, se
 * existir). Sem ícone, checklist, anexos, caixa ou sombra.
 */
export function MinimalNodeBody({
  node,
  isRoot,
  editing,
  onChangeTitle,
  onEndEdit,
}: {
  node: MNode;
  isRoot: boolean;
  editing: boolean;
  onChangeTitle: (value: string) => void;
  onEndEdit: () => void;
}) {
  return (
    <div className={isRoot ? "flex flex-col items-center" : "flex flex-col items-stretch"}>
      {editing ? (
        <input
          autoFocus
          value={node.title}
          onChange={(event) => onChangeTitle(event.target.value)}
          onBlur={onEndEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") onEndEdit();
          }}
          onClick={(event) => event.stopPropagation()}
          className={`w-full border-b bg-transparent outline-none ${isRoot ? "text-center text-2xl font-bold" : "text-sm font-medium"}`}
          style={{ borderColor: MINIMAL_THEME.accent, color: "inherit" }}
        />
      ) : (
        <div className={isRoot ? "max-w-[18rem] break-words" : "truncate"}>{node.title}</div>
      )}
      {node.note && !editing && (
        <div
          className={`mt-1 text-xs font-normal ${isRoot ? "max-w-[16rem] break-words text-center" : "truncate"}`}
          style={{ color: MINIMAL_THEME.note }}
        >
          {node.note}
        </div>
      )}
    </div>
  );
}
