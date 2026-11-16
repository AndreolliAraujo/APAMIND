import { describe, expect, it, vi } from "vitest";
import {
  createCloseProtectionController,
  isWebDevelopmentMode,
  type CloseProtectionWindow,
  type CloseProtectionStatus,
  type CloseRequestedEvent,
} from "./closeProtection";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeHarness() {
  let listener: ((event: CloseRequestedEvent) => void) | null = null;
  const onCloseRequested = vi.fn<CloseProtectionWindow["onCloseRequested"]>(async (handler) => {
    listener = handler;
    return () => undefined;
  });
  const confirmNativeProtection = vi.fn(async () => {});
  const onClose = vi.fn();
  const statuses: Array<{ status: CloseProtectionStatus; error?: string }> = [];
  const controller = createCloseProtectionController({
    getWindow: () => ({ onCloseRequested }),
    confirmNativeProtection,
    onCloseRequested: onClose,
    onStatus: (status, error) => statuses.push({ status, error }),
  });
  return {
    controller,
    onCloseRequested,
    confirmNativeProtection,
    onClose,
    statuses,
    get listener() {
      return listener;
    },
  };
}

describe("close protection startup", () => {
  it("allows browser development only when no Tauri bridge or runtime is present", () => {
    expect(isWebDevelopmentMode(true, false, false)).toBe(true);
    expect(isWebDevelopmentMode(true, false, true)).toBe(false);
    expect(isWebDevelopmentMode(true, true, false)).toBe(false);
    expect(isWebDevelopmentMode(false, false, false)).toBe(false);
  });

  it("only reports ready after listener registration and native confirmation", async () => {
    const h = makeHarness();
    await h.controller.start();
    expect(h.onCloseRequested).toHaveBeenCalledTimes(1);
    expect(h.confirmNativeProtection).toHaveBeenCalledTimes(1);
    expect(h.controller.isReady()).toBe(true);
    expect(h.statuses.at(-1)?.status).toBe("ready");
  });

  it("shows an error and remains blocked when listener registration rejects", async () => {
    const h = makeHarness();
    h.onCloseRequested.mockRejectedValueOnce(new Error("listener rejected"));
    await h.controller.start();
    expect(h.controller.isReady()).toBe(false);
    expect(h.confirmNativeProtection).not.toHaveBeenCalled();
    expect(h.statuses.at(-1)).toEqual({ status: "error", error: "listener rejected" });
  });

  it("fails visibly when the Tauri close API is unavailable", async () => {
    const h = makeHarness();
    const controller = createCloseProtectionController({
      getWindow: () => null,
      confirmNativeProtection: h.confirmNativeProtection,
      onCloseRequested: h.onClose,
      onStatus: (status, error) => h.statuses.push({ status, error }),
    });
    await controller.start();
    expect(controller.isReady()).toBe(false);
    expect(h.statuses.at(-1)?.status).toBe("error");
    expect(h.statuses.at(-1)?.error).toMatch(/indisponível/);
  });

  it("keeps startup gated while registration is delayed", async () => {
    const h = makeHarness();
    const registration = deferred<() => void>();
    const pendingHandler: { current: ((event: CloseRequestedEvent) => void) | null } = { current: null };
    h.onCloseRequested.mockImplementationOnce((handler) => {
      pendingHandler.current = handler;
      return registration.promise;
    });
    const started = h.controller.start();
    await Promise.resolve();
    expect(h.controller.isReady()).toBe(false);
    expect(h.statuses.at(-1)?.status).toBe("initializing");
    const preventDefault = vi.fn();
    pendingHandler.current?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(h.onClose).not.toHaveBeenCalled();
    registration.resolve(vi.fn());
    await started;
    expect(h.controller.isReady()).toBe(true);
  });

  it("permits retry after a failure without duplicating an installed listener", async () => {
    const h = makeHarness();
    h.confirmNativeProtection.mockRejectedValueOnce(new Error("native confirmation failed"));
    await h.controller.start();
    expect(h.controller.isReady()).toBe(false);
    await h.controller.retry();
    expect(h.onCloseRequested).toHaveBeenCalledTimes(1);
    expect(h.confirmNativeProtection).toHaveBeenCalledTimes(2);
    expect(h.controller.isReady()).toBe(true);
  });

  it("blocks close during startup and delegates normal close after readiness", async () => {
    const h = makeHarness();
    const nativeConfirmation = deferred<void>();
    h.confirmNativeProtection.mockImplementationOnce(() => nativeConfirmation.promise);
    const started = h.controller.start();
    await Promise.resolve();
    const preventDefault = vi.fn();
    h.listener?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(h.onClose).not.toHaveBeenCalled();

    nativeConfirmation.resolve();
    await started;
    h.listener?.({ preventDefault });
    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent startup attempts", async () => {
    const h = makeHarness();
    const nativeConfirmation = deferred<void>();
    h.confirmNativeProtection.mockImplementationOnce(() => nativeConfirmation.promise);
    const first = h.controller.start();
    const second = h.controller.retry();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.onCloseRequested).toHaveBeenCalledTimes(1);
    expect(h.confirmNativeProtection).toHaveBeenCalledTimes(1);
    nativeConfirmation.resolve();
    await Promise.all([first, second]);
  });
});
