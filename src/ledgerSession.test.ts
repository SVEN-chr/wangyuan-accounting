import { describe, expect, it, vi } from "vitest";
import {
  BrowserLedgerPersistenceAdapter,
  TauriLedgerPersistenceAdapter,
  createLedgerSession,
  type LedgerLifecycleAdapter,
  type LedgerPersistenceAdapter,
  type SaveResult,
} from "./ledgerSession";
import { DEFAULT_CATEGORIES, type Ledger } from "./ledgerCommands";

const diskLedger: Ledger = {
  records: [],
  categories: [
    {
      id: "custom-books",
      name: "古籍",
      type: "expense",
      shape: "diamond",
      swatch: "#123456",
    },
  ],
  openingBalance: 500,
};

class TrackingStorage implements Storage {
  readonly reads: string[] = [];
  readonly failWritesFor = new Set<string>();
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    this.reads.push(key);
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWritesFor.has(key)) throw new Error(`write failed: ${key}`);
    this.values.set(key, value);
  }
}

describe("账本持久化适配器", () => {
  it("正常桌面加载不会读取浏览器 fallback payload", async () => {
    const storage = new TrackingStorage();
    storage.setItem(
      "accounting.file-store-fallback",
      JSON.stringify({ ...diskLedger, openingBalance: 999 }),
    );
    const browser = new BrowserLedgerPersistenceAdapter(storage);
    const tauri = new TauriLedgerPersistenceAdapter({
      browser,
      invoke: async (command) => {
        expect(command).toBe("load_accounting_store");
        return JSON.stringify(diskLedger);
      },
    });

    const loaded = await tauri.load();

    expect(loaded).toEqual({
      data: diskLedger,
      storeExists: true,
      recoveredPending: false,
    });
    expect(storage.reads).toEqual(["accounting.pending-save"]);
  });

  it("桌面写盘失败时保存恢复副本并设置 pending", async () => {
    const storage = new TrackingStorage();
    const browser = new BrowserLedgerPersistenceAdapter(storage);
    const tauri = new TauriLedgerPersistenceAdapter({
      browser,
      invoke: async (command) => {
        expect(command).toBe("save_accounting_store");
        throw new Error("disk unavailable");
      },
    });

    const result = await tauri.save(diskLedger);

    expect(result).toEqual({
      ok: false,
      error: "disk unavailable",
      recoverySaved: true,
    });
    expect(
      JSON.parse(storage.getItem("accounting.file-store-fallback")!),
    ).toEqual(diskLedger);
    expect(storage.getItem("accounting.pending-save")).toBe("1");
  });

  it("pending 桌面启动优先返回浏览器恢复副本", async () => {
    const storage = new TrackingStorage();
    const recovered = { ...diskLedger, openingBalance: 999 };
    storage.setItem(
      "accounting.file-store-fallback",
      JSON.stringify(recovered),
    );
    storage.setItem("accounting.pending-save", "1");
    const tauri = new TauriLedgerPersistenceAdapter({
      browser: new BrowserLedgerPersistenceAdapter(storage),
      invoke: async () => JSON.stringify(diskLedger),
    });

    expect(await tauri.load()).toEqual({
      data: recovered,
      storeExists: true,
      recoveredPending: true,
    });
  });

  it("恢复副本刷新失败时保留 pending 等待下次重试", () => {
    const storage = new TrackingStorage();
    storage.setItem("accounting.pending-save", "1");
    storage.failWritesFor.add("accounting.file-store-fallback");
    const tauri = new TauriLedgerPersistenceAdapter({
      browser: new BrowserLedgerPersistenceAdapter(storage),
      invoke: async () => undefined,
    });

    expect(tauri.finalizeSuccessfulSave(diskLedger, true)).toEqual({
      ok: false,
      error: "磁盘已保存，但本地恢复缓存刷新失败",
      recoverySaved: false,
    });
    expect(storage.getItem("accounting.pending-save")).toBe("1");
  });
});

describe("账本会话", () => {
  it("默认等待 300ms 后只保存防抖期间的最新账本", async () => {
    vi.useFakeTimers();
    try {
      const persisted: number[] = [];
      const adapter: LedgerPersistenceAdapter = {
        load: async () => ({
          data: diskLedger,
          storeExists: true,
          recoveredPending: false,
        }),
        save: async (ledger) => {
          persisted.push(ledger.openingBalance);
          return { ok: true };
        },
        finalizeSuccessfulSave: () => ({ ok: true }),
        storeRecovery: () => true,
        syncFallback: () => true,
        hasFirstRunSeeded: () => true,
        markFirstRunSeeded: () => true,
      };
      const session = createLedgerSession({ adapter });
      await session.start();

      session.dispatch({ type: "opening-balance.set", value: 600 });
      session.dispatch({ type: "opening-balance.set", value: 700 });
      await vi.advanceTimersByTimeAsync(299);
      expect(persisted).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      await session.flush();
      expect(persisted).toEqual([700]);
      expect(session.getSnapshot().saveStatus).toEqual({ type: "success" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("连续刷新时按提交顺序保存内存适配器收到的快照", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const persisted: number[] = [];
    let saveCount = 0;
    const adapter: LedgerPersistenceAdapter = {
      load: async () => ({
        data: diskLedger,
        storeExists: true,
        recoveredPending: false,
      }),
      save: async (ledger) => {
        saveCount += 1;
        if (saveCount === 1) await firstGate;
        persisted.push(ledger.openingBalance);
        return { ok: true };
      },
      finalizeSuccessfulSave: () => ({ ok: true }),
      storeRecovery: () => true,
      syncFallback: () => true,
      hasFirstRunSeeded: () => true,
      markFirstRunSeeded: () => true,
    };
    const session = createLedgerSession({ adapter, debounceMs: 60_000 });
    await session.start();

    session.dispatch({ type: "opening-balance.set", value: 1 });
    const first = session.flush();
    session.dispatch({ type: "opening-balance.set", value: 2 });
    const second = session.flush();
    await Promise.resolve();

    expect(persisted).toEqual([]);
    expect(saveCount).toBe(1);
    releaseFirst();
    await Promise.all([first, second]);
    expect(persisted).toEqual([1, 2]);
  });

  it("首次启动 untouched defaults 时播种样例并标记待保存", async () => {
    let marked = false;
    const adapter: LedgerPersistenceAdapter = {
      load: async () => ({
        data: {
          records: [],
          categories: DEFAULT_CATEGORIES,
          openingBalance: 0,
        },
        storeExists: false,
        recoveredPending: false,
      }),
      save: async () => ({ ok: true }),
      finalizeSuccessfulSave: () => ({ ok: true }),
      storeRecovery: () => true,
      syncFallback: () => true,
      hasFirstRunSeeded: () => false,
      markFirstRunSeeded: () => {
        marked = true;
        return true;
      },
    };
    const sample = {
      id: 101,
      catId: "buy-book",
      amount: 88,
      date: "2026-07-18",
    };
    const session = createLedgerSession({
      adapter,
      seedRecords: [sample],
      debounceMs: 60_000,
    });

    await session.start();

    expect(session.getSnapshot()).toMatchObject({
      ready: true,
      ledger: { records: [sample], openingBalance: 0 },
    });
    expect(marked).toBe(true);
    expect(await session.flush()).toEqual({ ok: true });
  });

  it("已有零账目桌面账本保留自定义分类且不播种", async () => {
    const adapter: LedgerPersistenceAdapter = {
      load: async () => ({
        data: diskLedger,
        storeExists: true,
        recoveredPending: false,
      }),
      save: async () => ({ ok: true }),
      finalizeSuccessfulSave: () => ({ ok: true }),
      storeRecovery: () => true,
      syncFallback: () => true,
      hasFirstRunSeeded: () => false,
      markFirstRunSeeded: () => true,
    };
    const session = createLedgerSession({
      adapter,
      seedRecords: [
        {
          id: 101,
          catId: "buy-book",
          amount: 88,
          date: "2026-07-18",
        },
      ],
    });

    await session.start();

    expect(session.getSnapshot().ledger).toEqual(diskLedger);
  });

  it("关窗超时保存最新恢复快照且旧写盘不能越过恢复代次", async () => {
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let releaseTimeout!: () => void;
    const timeoutGate = new Promise<void>((resolve) => {
      releaseTimeout = resolve;
    });
    let closeHandler: Parameters<LedgerLifecycleAdapter["onCloseRequested"]>[0]
      | null = null;
    const close = vi.fn();
    const recovered: number[] = [];
    let finalized = 0;
    const lifecycle: LedgerLifecycleAdapter = {
      onBeforeUnload: () => () => undefined,
      onCloseRequested: async (handler) => {
        closeHandler = handler;
        return () => undefined;
      },
      confirm: () => true,
    };
    const adapter: LedgerPersistenceAdapter = {
      load: async () => ({
        data: diskLedger,
        storeExists: true,
        recoveredPending: false,
      }),
      save: async () => {
        await saveGate;
        return { ok: true };
      },
      finalizeSuccessfulSave: () => {
        finalized += 1;
        return { ok: true };
      },
      storeRecovery: (ledger) => {
        recovered.push(ledger.openingBalance);
        return true;
      },
      syncFallback: () => true,
      hasFirstRunSeeded: () => true,
      markFirstRunSeeded: () => true,
    };
    const session = createLedgerSession({
      adapter,
      lifecycle,
      debounceMs: 60_000,
      waitForCloseTimeout: () => timeoutGate,
    });
    await session.start();
    await Promise.resolve();
    session.dispatch({ type: "opening-balance.set", value: 777 });

    const preventDefault = vi.fn();
    const closing = closeHandler!({ preventDefault, close });
    await Promise.resolve();
    releaseTimeout();
    await closing;

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(recovered).toEqual([777]);
    expect(close).toHaveBeenCalledOnce();
    releaseSave();
    await session.flush();
    expect(finalized).toBe(0);
  });

  it("关窗等待三秒后同步恢复失败时允许用户取消关闭", async () => {
    vi.useFakeTimers();
    try {
      let closeHandler: Parameters<
        LedgerLifecycleAdapter["onCloseRequested"]
      >[0] | null = null;
      let beforeUnloadHandler: (() => void) | null = null;
      const confirm = vi.fn(() => false);
      const close = vi.fn();
      const recovered: number[] = [];
      const synced: number[] = [];
      const lifecycle: LedgerLifecycleAdapter = {
        onBeforeUnload: (handler) => {
          beforeUnloadHandler = handler;
          return () => undefined;
        },
        onCloseRequested: async (handler) => {
          closeHandler = handler;
          return () => undefined;
        },
        confirm,
      };
      const adapter: LedgerPersistenceAdapter = {
        load: async () => ({
          data: diskLedger,
          storeExists: true,
          recoveredPending: false,
        }),
        save: () => new Promise<SaveResult>(() => undefined),
        finalizeSuccessfulSave: () => ({ ok: true }),
        storeRecovery: (ledger) => {
          recovered.push(ledger.openingBalance);
          return false;
        },
        syncFallback: (ledger) => {
          synced.push(ledger.openingBalance);
          return true;
        },
        hasFirstRunSeeded: () => true,
        markFirstRunSeeded: () => true,
      };
      const session = createLedgerSession({ adapter, lifecycle });
      await session.start();
      await Promise.resolve();
      session.dispatch({ type: "opening-balance.set", value: 888 });

      beforeUnloadHandler!();
      expect(synced).toEqual([888]);
      session.dispatch({ type: "opening-balance.set", value: 999 });

      const preventDefault = vi.fn();
      const closing = closeHandler!({ preventDefault, close });
      await vi.advanceTimersByTimeAsync(2999);
      expect(recovered).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      await closing;
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(recovered).toEqual([999]);
      expect(confirm).toHaveBeenCalledWith(
        "保存超时，且本地恢复缓存写入失败。最后一次编辑可能丢失。\n仍要关闭吗？",
      );
      expect(close).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("保存失败公开恢复状态且下一次最新成功保存才完成恢复", async () => {
    let attempt = 0;
    const finalizedWith: boolean[] = [];
    const adapter: LedgerPersistenceAdapter = {
      load: async () => ({
        data: diskLedger,
        storeExists: true,
        recoveredPending: false,
      }),
      save: async () => {
        attempt += 1;
        return attempt === 1
          ? {
              ok: false,
              error: "disk unavailable",
              recoverySaved: true,
            }
          : { ok: true };
      },
      finalizeSuccessfulSave: (_ledger, recoveryPending) => {
        finalizedWith.push(recoveryPending);
        return { ok: true };
      },
      storeRecovery: () => true,
      syncFallback: () => true,
      hasFirstRunSeeded: () => true,
      markFirstRunSeeded: () => true,
    };
    const session = createLedgerSession({ adapter, debounceMs: 60_000 });
    await session.start();

    session.dispatch({ type: "opening-balance.set", value: 600 });
    expect(await session.flush()).toEqual({
      ok: false,
      error: "disk unavailable",
      recoverySaved: true,
    });
    expect(session.getSnapshot().saveStatus).toEqual({
      type: "error",
      message: "保存失败：disk unavailable · 已写入本地缓存",
      recoverySaved: true,
    });

    session.dispatch({ type: "opening-balance.set", value: 700 });
    expect(await session.flush()).toEqual({ ok: true });
    expect(finalizedWith).toEqual([true]);
  });

  it("effect 清理后可以重新启动并发布已加载账本", async () => {
    const adapter: LedgerPersistenceAdapter = {
      load: async () => ({
        data: diskLedger,
        storeExists: false,
        recoveredPending: false,
      }),
      save: async () => ({ ok: true }),
      finalizeSuccessfulSave: () => ({ ok: true }),
      storeRecovery: () => true,
      syncFallback: () => true,
      hasFirstRunSeeded: () => true,
      markFirstRunSeeded: () => true,
    };
    const session = createLedgerSession({ adapter });

    const firstStart = session.start();
    session.dispose();
    await firstStart;
    await session.start();

    expect(session.getSnapshot()).toMatchObject({
      ready: true,
      ledger: diskLedger,
    });
  });
});
