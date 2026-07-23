import { describe, expect, it, vi } from "vitest";
import {
  createUpdateController,
  type PendingUpdate,
  type UpdateControllerAdapters,
  type UpdateDownloadEvent,
  type UpdateState,
} from "./updateController";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createPendingUpdate(
  overrides: Partial<PendingUpdate> = {},
): PendingUpdate {
  return {
    version: "0.2.0",
    body: "更新说明",
    downloadAndInstall: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createAdapters(
  overrides: Partial<UpdateControllerAdapters> = {},
): UpdateControllerAdapters {
  return {
    check: vi.fn(async () => null),
    flushLedger: vi.fn(async () => ({ ok: true as const })),
    isDesktop: vi.fn(async () => true),
    relaunch: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("自动更新控制器", () => {
  it("通过公开接口发布检查结果并关闭提示", async () => {
    const update = createPendingUpdate();
    const adapters = createAdapters({
      check: vi.fn(async () => update),
    });
    const controller = createUpdateController(adapters);
    const states: UpdateState[] = [];
    controller.subscribe((state) => states.push(state));

    expect(controller.getState()).toEqual({ phase: "idle" });

    await controller.check(true);

    expect(controller.getState()).toEqual({
      phase: "available",
      version: "0.2.0",
      notes: "更新说明",
    });
    expect(adapters.check).toHaveBeenCalledWith({ timeout: 20_000 });
    expect(states).toContainEqual({ phase: "checking" });

    controller.dismiss();

    expect(controller.getState()).toEqual({ phase: "idle" });
  });

  it("把手动操作合并进正在进行的静默检查", async () => {
    const result = deferred<PendingUpdate | null>();
    const adapters = createAdapters({
      check: vi.fn(() => result.promise),
    });
    const controller = createUpdateController(adapters);

    const silentCheck = controller.check(false);
    const manualCheck = controller.check(true);

    expect(adapters.check).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toEqual({ phase: "checking" });

    result.resolve(null);
    await Promise.all([silentCheck, manualCheck]);

    expect(controller.getState()).toEqual({ phase: "uptodate" });
  });

  it("按手动语义呈现浏览器检查失败并释放检查锁", async () => {
    const result = deferred<PendingUpdate | null>();
    const check = vi
      .fn<UpdateControllerAdapters["check"]>()
      .mockImplementationOnce(() => result.promise)
      .mockResolvedValueOnce(null);
    const controller = createUpdateController(
      createAdapters({
        check,
        isDesktop: vi.fn(async () => false),
      }),
    );

    const silentCheck = controller.check(false);
    const manualCheck = controller.check(true);
    result.reject(new Error("plugin unavailable"));
    await Promise.all([silentCheck, manualCheck]);

    expect(controller.getState()).toEqual({
      phase: "error",
      error: "仅桌面端支持检查更新",
    });

    await controller.check(true);

    expect(check).toHaveBeenCalledTimes(2);
    expect(controller.getState()).toEqual({ phase: "uptodate" });
  });

  it("运行时环境检测失败时仍把手动检查降级为浏览器提示", async () => {
    const controller = createUpdateController(
      createAdapters({
        check: vi.fn(async () => {
          throw new Error("updater unavailable");
        }),
        isDesktop: vi.fn(async () => {
          throw new Error("runtime unavailable");
        }),
      }),
    );

    await controller.check(true);

    expect(controller.getState()).toEqual({
      phase: "error",
      error: "仅桌面端支持检查更新",
    });
  });

  it("刷新账本后单次安装，发布下载进度并重启", async () => {
    const installDone = deferred<void>();
    let reportProgress:
      | ((event: UpdateDownloadEvent) => void)
      | undefined;
    const update = createPendingUpdate({
      downloadAndInstall: vi.fn(async (onEvent) => {
        reportProgress = onEvent;
        await installDone.promise;
      }),
    });
    const adapters = createAdapters({
      check: vi.fn(async () => update),
    });
    const controller = createUpdateController(adapters);
    await controller.check(true);

    const firstInstall = controller.install();
    await vi.waitFor(() =>
      expect(update.downloadAndInstall).toHaveBeenCalledTimes(1),
    );
    const secondInstall = controller.install();
    await controller.check(true);

    expect(adapters.flushLedger).toHaveBeenCalledTimes(1);
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(adapters.check).toHaveBeenCalledTimes(1);

    reportProgress?.({
      event: "Started",
      data: { contentLength: 100 },
    });
    reportProgress?.({ event: "Progress", data: { chunkLength: 25 } });
    expect(controller.getState()).toEqual({
      phase: "downloading",
      version: "0.2.0",
      downloaded: 25,
      total: 100,
    });
    reportProgress?.({ event: "Finished" });
    expect(controller.getState()).toEqual({
      phase: "downloading",
      version: "0.2.0",
      downloaded: 100,
      total: 100,
    });

    installDone.resolve();
    await Promise.all([firstInstall, secondInstall]);

    expect(adapters.relaunch).toHaveBeenCalledTimes(1);
  });

  it("保存和恢复均失败时取消安装并释放安装锁", async () => {
    const update = createPendingUpdate();
    const flushLedger = vi
      .fn<UpdateControllerAdapters["flushLedger"]>()
      .mockResolvedValueOnce({
        ok: false,
        error: "磁盘不可写",
        recoverySaved: false,
      })
      .mockResolvedValueOnce({
        ok: false,
        error: "磁盘仍不可写",
        recoverySaved: true,
      });
    const adapters = createAdapters({
      check: vi.fn(async () => update),
      flushLedger,
    });
    const controller = createUpdateController(adapters);
    await controller.check(true);

    await controller.install();

    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(adapters.relaunch).not.toHaveBeenCalled();
    expect(controller.getState()).toEqual({
      phase: "error",
      version: "0.2.0",
      error: "更新已取消：磁盘不可写",
    });

    await controller.install();

    expect(adapters.flushLedger).toHaveBeenCalledTimes(2);
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(adapters.relaunch).toHaveBeenCalledTimes(1);
  });

  it("下载失败后保留版本并允许重试安装", async () => {
    const downloadAndInstall = vi
      .fn<PendingUpdate["downloadAndInstall"]>()
      .mockRejectedValueOnce(new Error("下载中断"))
      .mockResolvedValueOnce(undefined);
    const update = createPendingUpdate({ downloadAndInstall });
    const adapters = createAdapters({
      check: vi.fn(async () => update),
    });
    const controller = createUpdateController(adapters);
    await controller.check(true);

    await controller.install();

    expect(controller.getState()).toEqual({
      phase: "error",
      version: "0.2.0",
      error: "下载中断",
    });
    expect(adapters.relaunch).not.toHaveBeenCalled();

    await controller.install();

    expect(downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(adapters.relaunch).toHaveBeenCalledTimes(1);
  });
});
