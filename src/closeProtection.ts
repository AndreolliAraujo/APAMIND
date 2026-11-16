export type CloseProtectionStatus = "initializing" | "error" | "ready";

export interface CloseRequestedEvent {
  preventDefault(): void;
}

export interface CloseProtectionWindow {
  onCloseRequested(handler: (event: CloseRequestedEvent) => void): Promise<() => void>;
}

export interface CloseProtectionOptions {
  getWindow(): CloseProtectionWindow | null;
  confirmNativeProtection(): Promise<void>;
  onCloseRequested(event: CloseRequestedEvent): void;
  onStatus(status: CloseProtectionStatus, error?: string): void;
}

export interface CloseProtectionController {
  start(): Promise<void>;
  retry(): Promise<void>;
  isReady(): boolean;
}

export function isWebDevelopmentMode(isDevBuild: boolean, hasTauriBridge: boolean, hasTauriRuntime: boolean): boolean {
  return isDevBuild && !hasTauriBridge && !hasTauriRuntime;
}

export function createCloseProtectionController(options: CloseProtectionOptions): CloseProtectionController {
  let ready = false;
  let listenerRegistered = false;
  let attemptInFlight: Promise<void> | null = null;

  const attempt = (): Promise<void> => {
    if (ready) return Promise.resolve();
    if (attemptInFlight) return attemptInFlight;

    options.onStatus("initializing");
    attemptInFlight = (async () => {
      const appWindow = options.getWindow();
      if (!appWindow || typeof appWindow.onCloseRequested !== "function") {
        throw new Error("A API de proteção de fechamento do Tauri está indisponível.");
      }

      if (!listenerRegistered) {
        await appWindow.onCloseRequested((event) => {
          // This listener itself blocks close requests until the native gate is
          // confirmed. Once ready, the existing save-and-close guard takes over.
          event.preventDefault();
          if (ready) options.onCloseRequested(event);
        });
        listenerRegistered = true;
      }

      await options.confirmNativeProtection();
      ready = true;
      options.onStatus("ready");
    })()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        options.onStatus("error", message);
      })
      .finally(() => {
        attemptInFlight = null;
      });

    return attemptInFlight;
  };

  return {
    start: attempt,
    retry: attempt,
    isReady: () => ready,
  };
}
