import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Última barreira da interface: sem ela, uma exceção de render derrubava a
 * árvore inteira e deixava o usuário sem qualquer orientação ou ação.
 * Os dados já gravados continuam no disco; a ação segura é recarregar.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("APAMIND: erro inesperado de renderização.", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <section
          role="alert"
          className="mx-auto max-w-xl rounded-2xl border border-rose-500/30 bg-slate-900 p-6 shadow-2xl"
        >
          <h1 className="text-lg font-semibold text-rose-300">O ApaMind encontrou um erro inesperado</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            O que já foi salvo continua no disco. Recarregue para continuar. Se o erro se repetir, exporte um Backup
            Total antes de reinstalar o aplicativo.
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-400">
            {String(this.state.error.message || this.state.error)}
          </pre>
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
            >
              Recarregar
            </button>
          </div>
        </section>
      </main>
    );
  }
}
