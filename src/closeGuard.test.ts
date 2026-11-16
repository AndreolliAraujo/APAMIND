import { describe, expect, it, vi } from "vitest";
import { createCloseGuard } from "./closeGuard";
import type { Workspace } from "./core/model";

const workspace = (title: string): Workspace => ({
  active: "m1",
  maps: [{ id: "m1", title, template: "Livre", ts: "2026-01-01", nodes: [], edges: [] }],
});
const saved = { success: true, quotaExceeded: false } as const;
const failed = { success: false, quotaExceeded: false, error: "Disk unavailable" } as const;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("close guard", () => {
  it("salva o workspace atual antes de destruir a janela", async () => {
    const current = workspace("saved");
    const cancelDebounce = vi.fn();
    const save = vi.fn(async (_snapshot: Workspace) => saved);
    const destroy = vi.fn(async () => undefined);
    const onError = vi.fn();
    const guard = createCloseGuard({
      cancelDebounce,
      getWorkspace: () => current,
      saveWorkspace: save,
      closeWindow: destroy,
      onError,
    });
    let prevented = false;

    guard.onCloseRequested({
      preventDefault: () => {
        prevented = true;
      },
    });
    await tick();

    expect(prevented).toBe(true);
    expect(cancelDebounce).toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(current);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenLastCalledWith("", "save");
  });

  it("mantém a janela aberta quando o salvamento retorna falha", async () => {
    const current = workspace("pending edit");
    const save = vi.fn(async () => failed);
    const destroy = vi.fn(async () => undefined);
    const onError = vi.fn();
    const guard = createCloseGuard({
      cancelDebounce: vi.fn(),
      getWorkspace: () => current,
      saveWorkspace: save,
      closeWindow: destroy,
      onError,
    });
    let prevented = false;

    guard.onCloseRequested({
      preventDefault: () => {
        prevented = true;
      },
    });
    await tick();

    expect(prevented).toBe(true);
    expect(destroy).not.toHaveBeenCalled();
    expect(current.maps[0].title).toBe("pending edit");
    expect(onError).toHaveBeenNthCalledWith(1, "", "save");
    expect(onError).toHaveBeenNthCalledWith(2, "Disk unavailable", "save");
  });

  it("mantém a janela aberta quando o salvamento é rejeitado", async () => {
    const destroy = vi.fn(async () => undefined);
    const onError = vi.fn();
    const guard = createCloseGuard({
      cancelDebounce: vi.fn(),
      getWorkspace: () => workspace("pending"),
      saveWorkspace: async () => {
        throw new Error("Write rejected");
      },
      closeWindow: destroy,
      onError,
    });

    guard.onCloseRequested({ preventDefault() {} });
    await tick();

    expect(destroy).not.toHaveBeenCalled();
    expect(onError).toHaveBeenNthCalledWith(2, "Write rejected", "save");
  });

  it("permite nova tentativa após falha no salvamento", async () => {
    const destroy = vi.fn(async () => undefined);
    const onError = vi.fn();
    const save = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(saved);
    const guard = createCloseGuard({
      cancelDebounce: vi.fn(),
      getWorkspace: () => workspace("retry"),
      saveWorkspace: save,
      closeWindow: destroy,
      onError,
    });

    guard.onCloseRequested({ preventDefault() {} });
    await tick();
    expect(destroy).not.toHaveBeenCalled();

    guard.retry();
    await tick();

    expect(save).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenNthCalledWith(1, "", "save");
    expect(onError).toHaveBeenNthCalledWith(2, "Disk unavailable", "save");
    expect(onError).toHaveBeenNthCalledWith(3, "", "save");
  });

  it("bloqueia tentativas concorrentes durante o salvamento", async () => {
    let resolveSave!: (value: typeof saved) => void;
    const save = vi.fn(
      () =>
        new Promise<typeof saved>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const destroy = vi.fn(async () => undefined);
    const guard = createCloseGuard({
      cancelDebounce: vi.fn(),
      getWorkspace: () => workspace("in flight"),
      saveWorkspace: save,
      closeWindow: destroy,
    });
    let firstPrevented = false;
    let secondPrevented = false;

    guard.onCloseRequested({
      preventDefault: () => {
        firstPrevented = true;
      },
    });
    guard.onCloseRequested({
      preventDefault: () => {
        secondPrevented = true;
      },
    });
    await tick();

    expect(firstPrevented).toBe(true);
    expect(secondPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();

    resolveSave(saved);
    await tick();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("bloqueia novos fechamentos e retries enquanto destroy está em andamento", async () => {
    let resolveDestroy!: () => void;
    const save = vi.fn(async () => saved);
    const destroy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDestroy = resolve;
        }),
    );
    const guard = createCloseGuard({
      cancelDebounce: vi.fn(),
      getWorkspace: () => workspace("saved"),
      saveWorkspace: save,
      closeWindow: destroy,
    });
    let duplicatePrevented = false;

    guard.onCloseRequested({ preventDefault() {} });
    await tick();
    expect(destroy).toHaveBeenCalledTimes(1);

    guard.onCloseRequested({
      preventDefault: () => {
        duplicatePrevented = true;
      },
    });
    guard.retry();
    await tick();

    expect(duplicatePrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);

    resolveDestroy();
    await tick();
  });

  it("salva novamente se o workspace mudar durante a primeira gravação", async () => {
    let current = workspace("first");
    const resolves: Array<(value: typeof saved) => void> = [];
    const save = vi.fn(
      (_snapshot: Workspace) =>
        new Promise<typeof saved>((resolve) => {
          resolves.push(resolve);
        }),
    );
    const destroy = vi.fn(async () => undefined);
    const guard = createCloseGuard({
      cancelDebounce: vi.fn(),
      getWorkspace: () => current,
      saveWorkspace: save,
      closeWindow: destroy,
    });

    guard.onCloseRequested({ preventDefault() {} });
    await tick();
    current = workspace("latest edit");
    resolves[0](saved);
    await tick();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].maps[0].title).toBe("latest edit");
    expect(destroy).not.toHaveBeenCalled();

    resolves[1](saved);
    await tick();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("mantém a janela aberta e permite retry se destroy falhar", async () => {
    const save = vi.fn(async () => saved);
    const destroy = vi.fn().mockRejectedValueOnce(new Error("Destroy denied")).mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const guard = createCloseGuard({
      cancelDebounce: vi.fn(),
      getWorkspace: () => workspace("saved before destroy"),
      saveWorkspace: save,
      closeWindow: destroy,
      onError,
    });

    guard.onCloseRequested({ preventDefault() {} });
    await tick();

    expect(save).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenNthCalledWith(2, "Destroy denied", "destroy");

    guard.retry();
    await tick();

    expect(save).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenNthCalledWith(3, "", "save");
  });

  it("não sinaliza demora quando o salvamento termina antes do limite", async () => {
    const onSavingSlow = vi.fn();
    const destroy = vi.fn(async () => undefined);
    const guard = createCloseGuard({
      cancelDebounce: vi.fn(),
      getWorkspace: () => workspace("fast save"),
      saveWorkspace: async () => saved,
      closeWindow: destroy,
      slowSaveTimeoutMs: 60_000,
      onSavingSlow,
    });

    guard.onCloseRequested({ preventDefault() {} });
    await tick();

    expect(onSavingSlow).not.toHaveBeenCalledWith(true, expect.anything());
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("mantém a trava durante salvamento demorado e fecha após a operação original concluir", async () => {
    vi.useFakeTimers();
    try {
      let resolveSave!: (result: typeof saved) => void;
      const save = vi.fn(
        () =>
          new Promise<typeof saved>((resolve) => {
            resolveSave = resolve;
          }),
      );
      const destroy = vi.fn(async () => undefined);
      const onSavingSlow = vi.fn();
      const guard = createCloseGuard({
        cancelDebounce: vi.fn(),
        getWorkspace: () => workspace("slow save"),
        saveWorkspace: save,
        closeWindow: destroy,
        slowSaveTimeoutMs: 500,
        onSavingSlow,
      });

      guard.onCloseRequested({ preventDefault() {} });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(500);

      expect(onSavingSlow).toHaveBeenCalledWith(true, expect.any(Number));
      expect(destroy).not.toHaveBeenCalled();

      // X, Alt+F4 e retry são todos ignorados enquanto a promessa original está pendente.
      guard.onCloseRequested({ preventDefault() {} });
      guard.onCloseRequested({ preventDefault() {} });
      guard.retry();
      expect(save).toHaveBeenCalledTimes(1);
      expect(destroy).not.toHaveBeenCalled();

      resolveSave(saved);
      await vi.runAllTimersAsync();
      for (let i = 0; i < 6; i++) await Promise.resolve();

      expect(save).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(onSavingSlow).toHaveBeenLastCalledWith(false, undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("permite retry somente depois de uma operação demorada terminar com falha", async () => {
    vi.useFakeTimers();
    try {
      let resolveSave!: (result: typeof failed | typeof saved) => void;
      const save = vi
        .fn(async () => saved as typeof failed | typeof saved)
        .mockImplementationOnce(
          () =>
            new Promise<typeof failed | typeof saved>((resolve) => {
              resolveSave = resolve;
            }),
        )
        .mockResolvedValueOnce(saved);
      const destroy = vi.fn(async () => undefined);
      const onError = vi.fn();
      const guard = createCloseGuard({
        cancelDebounce: vi.fn(),
        getWorkspace: () => workspace("slow failure"),
        saveWorkspace: save,
        closeWindow: destroy,
        slowSaveTimeoutMs: 500,
        onError,
      });

      guard.onCloseRequested({ preventDefault() {} });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(500);
      expect(save).toHaveBeenCalledTimes(1);

      resolveSave(failed);
      for (let i = 0; i < 6; i++) await Promise.resolve();
      expect(onError).toHaveBeenLastCalledWith("Disk unavailable", "save");
      expect(destroy).not.toHaveBeenCalled();

      guard.retry();
      for (let i = 0; i < 6; i++) await Promise.resolve();
      expect(save).toHaveBeenCalledTimes(2);
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
