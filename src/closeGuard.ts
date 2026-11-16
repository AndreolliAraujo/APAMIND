import type { Workspace } from "./core/model";
import type { SaveResult } from "./storage/workspace";

export interface CloseRequestLike {
  preventDefault(): void;
}

export type CloseFailureStage = "save" | "destroy";

export type CloseDiagnosticEvent =
  | "request_received"
  | "request_coalesced"
  | "save_retry_requested"
  | "save_started"
  | "save_slow"
  | "workspace_changed_during_save"
  | "save_succeeded"
  | "save_failed"
  | "destroy_started"
  | "destroy_succeeded"
  | "destroy_failed";

export interface CloseGuardOptions {
  cancelDebounce(): void;
  getWorkspace(): Workspace;
  saveWorkspace(workspace: Workspace): Promise<SaveResult>;
  closeWindow(): Promise<void>;
  /** Elapsed time before a pending save is reported as slow. Defaults to 15 seconds. */
  slowSaveTimeoutMs?: number;
  onSaving?(saving: boolean): void;
  onSavingSlow?(slow: boolean, elapsedMs?: number): void;
  onError?(message: string, stage: CloseFailureStage): void;
  onDiagnostic?(event: CloseDiagnosticEvent, elapsedMs?: number): void;
}

export interface CloseGuard {
  onCloseRequested(event: CloseRequestLike): void;
  retry(): void;
}

export const DEFAULT_CLOSE_SAVE_SLOW_TIMEOUT_MS = 15_000;

export function createCloseGuard(options: CloseGuardOptions): CloseGuard {
  let saving = false;
  let closing = false;
  const slowSaveTimeoutMs = Math.max(0, options.slowSaveTimeoutMs ?? DEFAULT_CLOSE_SAVE_SLOW_TIMEOUT_MS);

  const diagnostic = (event: CloseDiagnosticEvent, startedAt?: number) => {
    try {
      options.onDiagnostic?.(event, startedAt === undefined ? undefined : Date.now() - startedAt);
    } catch {
      // Diagnostics must never block saving or closing.
    }
  };

  const notifySlowState = (slow: boolean, elapsedMs?: number) => {
    try {
      options.onSavingSlow?.(slow, elapsedMs);
    } catch {
      // UI notifications must never affect the save or close operation.
    }
  };

  const attempt = async () => {
    if (saving || closing) return;
    saving = true;
    const startedAt = Date.now();
    let stage: CloseFailureStage = "save";
    options.onSaving?.(true);
    options.onError?.("", "save");
    diagnostic("save_started", startedAt);
    try {
      while (true) {
        options.cancelDebounce();
        const snapshot = options.getWorkspace();
        let slowTimer: ReturnType<typeof setTimeout> | undefined;
        let slowWasReported = false;
        let result: SaveResult;
        try {
          slowTimer = setTimeout(() => {
            slowWasReported = true;
            const elapsedMs = Date.now() - startedAt;
            notifySlowState(true, elapsedMs);
            diagnostic("save_slow", startedAt);
          }, slowSaveTimeoutMs);
          result = await options.saveWorkspace(snapshot);
        } finally {
          if (slowTimer !== undefined) clearTimeout(slowTimer);
          if (slowWasReported) notifySlowState(false);
        }
        if (!result.success) {
          throw new Error(result.error || "N\u00e3o foi poss\u00edvel confirmar a grava\u00e7\u00e3o dos mapas.");
        }

        options.cancelDebounce();
        if (JSON.stringify(snapshot) !== JSON.stringify(options.getWorkspace())) {
          diagnostic("workspace_changed_during_save", startedAt);
          continue;
        }

        diagnostic("save_succeeded", startedAt);
        closing = true;
        stage = "destroy";
        diagnostic("destroy_started", startedAt);
        await options.closeWindow();
        diagnostic("destroy_succeeded", startedAt);
        return;
      }
    } catch (error) {
      if (stage === "destroy") {
        closing = false;
        diagnostic("destroy_failed", startedAt);
      } else {
        diagnostic("save_failed", startedAt);
      }
      options.onError?.(String(error instanceof Error ? error.message : error), stage);
    } finally {
      saving = false;
      options.onSaving?.(false);
    }
  };

  return {
    onCloseRequested(event) {
      diagnostic("request_received");
      event.preventDefault();
      if (saving || closing) {
        diagnostic("request_coalesced");
        return;
      }
      void attempt();
    },
    retry() {
      if (saving || closing) return;
      diagnostic("save_retry_requested");
      void attempt();
    },
  };
}
