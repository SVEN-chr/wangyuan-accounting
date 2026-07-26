import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_OPENING_BALANCE,
  applyLedgerCommand,
  type Category,
  type CategoryType,
  type CatShape,
  type Ledger,
  type LedgerCommand,
  type LedgerCommandResult,
  type LedgerEntry,
} from "./ledgerCommands";

const RECORDS_STORAGE_KEY = "accounting.records";
const CATEGORIES_STORAGE_KEY = "accounting.categories";
const OPENING_BALANCE_STORAGE_KEY = "accounting.opening-balance";
const FALLBACK_STORAGE_KEY = "accounting.file-store-fallback";
const FIRST_RUN_KEY = "accounting.first-run-seeded";
const PENDING_SAVE_KEY = "accounting.pending-save";

export type LoadedLedger = {
  data: Ledger;
  storeExists: boolean;
  recoveredPending: boolean;
};

export type SaveResult =
  | { ok: true }
  | { ok: false; error: string; recoverySaved: boolean };

type Invoke = (command: string, args?: unknown) => Promise<unknown>;

export interface LedgerPersistenceAdapter {
  load(): Promise<LoadedLedger>;
  save(data: Ledger): Promise<SaveResult>;
  finalizeSuccessfulSave(
    data: Ledger,
    recoveryPending: boolean,
  ): SaveResult;
  storeRecovery(data: Ledger): boolean;
  syncFallback(data: Ledger): boolean;
  hasFirstRunSeeded(): boolean;
  markFirstRunSeeded(): boolean;
}

export type LedgerSaveStatus =
  | { type: "idle" }
  | { type: "saving" }
  | { type: "success" }
  | { type: "error"; message: string; recoverySaved: boolean };

export type LedgerSessionSnapshot = {
  ledger: Ledger;
  ready: boolean;
  saveStatus: LedgerSaveStatus;
};

export type LedgerCloseRequest = {
  preventDefault: () => void;
  close: () => void;
};

export interface LedgerLifecycleAdapter {
  onBeforeUnload(handler: () => void): () => void;
  onCloseRequested(
    handler: (request: LedgerCloseRequest) => Promise<void>,
  ): Promise<() => void>;
  confirm(message: string): boolean;
}

export function createWindowLedgerLifecycleAdapter(): LedgerLifecycleAdapter {
  return {
    onBeforeUnload(handler) {
      window.addEventListener("beforeunload", handler);
      return () => window.removeEventListener("beforeunload", handler);
    },
    async onCloseRequested(handler) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        return await win.onCloseRequested((event) =>
          handler({
            preventDefault: () => event.preventDefault(),
            close: () => {
              // Awaiting close deadlocks against the close-requested handler.
              void win.close();
            },
          }),
        );
      } catch {
        return () => undefined;
      }
    },
    confirm(message) {
      return window.confirm(message);
    },
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function loadJson<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function migrateCategory(
  category: Partial<Category>,
  fallback?: Category,
): Category {
  const defaults = fallback ?? DEFAULT_CATEGORIES[0];
  return {
    id: category.id ?? defaults.id,
    name: category.name ?? defaults.name,
    type: (category.type as CategoryType) ?? defaults.type,
    shape: (category.shape as CatShape) ?? defaults.shape,
    swatch: category.swatch ?? defaults.swatch,
  };
}

export function normalizePersistedLedger(value: unknown): Ledger | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<Ledger>;
  if (
    !Array.isArray(parsed.records) ||
    !Array.isArray(parsed.categories) ||
    typeof parsed.openingBalance !== "number" ||
    !Number.isFinite(parsed.openingBalance)
  ) {
    return null;
  }
  return {
    records: parsed.records as LedgerEntry[],
    categories: (parsed.categories as Partial<Category>[]).map((category) =>
      migrateCategory(category),
    ),
    openingBalance: parsed.openingBalance,
  };
}

export class BrowserLedgerPersistenceAdapter {
  constructor(private readonly storage: Storage) {}

  loadConsolidated(): Ledger | null {
    try {
      const raw = this.storage.getItem(FALLBACK_STORAGE_KEY);
      return raw ? normalizePersistedLedger(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  loadFallback(): Ledger {
    const consolidated = this.loadConsolidated();
    if (consolidated) return consolidated;
    return (
      normalizePersistedLedger({
        records: loadJson<LedgerEntry[]>(
          this.storage,
          RECORDS_STORAGE_KEY,
          [],
        ),
        categories: loadJson<Category[]>(
          this.storage,
          CATEGORIES_STORAGE_KEY,
          DEFAULT_CATEGORIES,
        ),
        openingBalance: loadJson<number>(
          this.storage,
          OPENING_BALANCE_STORAGE_KEY,
          DEFAULT_OPENING_BALANCE,
        ),
      }) ?? {
        records: [],
        categories: DEFAULT_CATEGORIES,
        openingBalance: DEFAULT_OPENING_BALANCE,
      }
    );
  }

  hasPending(): boolean {
    try {
      return this.storage.getItem(PENDING_SAVE_KEY) === "1";
    } catch {
      return false;
    }
  }

  saveFallback(data: Ledger): boolean {
    try {
      this.storage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  setPending(pending: boolean): boolean {
    try {
      if (pending) this.storage.setItem(PENDING_SAVE_KEY, "1");
      else this.storage.removeItem(PENDING_SAVE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  async save(data: Ledger): Promise<SaveResult> {
    return this.saveFallback(data)
      ? { ok: true }
      : {
          ok: false,
          error: "浏览器本地缓存写入失败",
          recoverySaved: false,
        };
  }

  finalizeSuccessfulSave(): SaveResult {
    return { ok: true };
  }

  storeRecovery(data: Ledger): boolean {
    return this.saveFallback(data);
  }

  syncFallback(data: Ledger): boolean {
    return this.saveFallback(data);
  }

  hasFirstRunSeeded(): boolean {
    try {
      return this.storage.getItem(FIRST_RUN_KEY) === "1";
    } catch {
      return false;
    }
  }

  markFirstRunSeeded(): boolean {
    try {
      this.storage.setItem(FIRST_RUN_KEY, "1");
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<LoadedLedger> {
    return {
      data: this.loadFallback(),
      storeExists: false,
      recoveredPending: false,
    };
  }
}

export class TauriLedgerPersistenceAdapter {
  private readonly browser: BrowserLedgerPersistenceAdapter;
  private readonly invoke: Invoke;

  constructor({
    browser,
    invoke,
  }: {
    browser: BrowserLedgerPersistenceAdapter;
    invoke: Invoke;
  }) {
    this.browser = browser;
    this.invoke = invoke;
  }

  async load(): Promise<LoadedLedger> {
    try {
      const raw = String(await this.invoke("load_accounting_store"));
      const storeExists = raw.length > 0;
      const parsed = storeExists
        ? normalizePersistedLedger(JSON.parse(raw))
        : null;
      const pendingFallback = this.browser.hasPending()
        ? this.browser.loadConsolidated()
        : null;
      if (pendingFallback) {
        return {
          data: pendingFallback,
          storeExists,
          recoveredPending: true,
        };
      }
      return {
        data: parsed ?? this.browser.loadFallback(),
        storeExists,
        recoveredPending: false,
      };
    } catch {
      return {
        data: this.browser.loadFallback(),
        // A desktop read failure cannot prove that the store is absent.
        storeExists: true,
        recoveredPending: false,
      };
    }
  }

  async save(data: Ledger): Promise<SaveResult> {
    try {
      await this.invoke("save_accounting_store", {
        payload: JSON.stringify(data),
      });
      return { ok: true };
    } catch (error) {
      const fallbackSaved = this.browser.saveFallback(data);
      const recoverySaved = fallbackSaved && this.browser.setPending(true);
      return recoverySaved
        ? { ok: false, error: describeError(error), recoverySaved: true }
        : {
            ok: false,
            error: `${describeError(error)} · 本地恢复缓存写入失败`,
            recoverySaved: false,
          };
    }
  }

  finalizeSuccessfulSave(
    data: Ledger,
    recoveryPending: boolean,
  ): SaveResult {
    if (!recoveryPending && !this.browser.hasPending()) return { ok: true };
    const fallbackSaved = this.browser.saveFallback(data);
    if (!fallbackSaved) {
      return {
        ok: false,
        error: "磁盘已保存，但本地恢复缓存刷新失败",
        recoverySaved: false,
      };
    }
    if (this.browser.setPending(false)) return { ok: true };
    return {
      ok: false,
      error: "磁盘已保存，但本地恢复标记清除失败",
      recoverySaved:
        fallbackSaved && this.browser.setPending(true),
    };
  }

  storeRecovery(data: Ledger): boolean {
    return (
      this.browser.saveFallback(data) && this.browser.setPending(true)
    );
  }

  syncFallback(data: Ledger): boolean {
    return this.browser.saveFallback(data);
  }

  hasFirstRunSeeded(): boolean {
    return this.browser.hasFirstRunSeeded();
  }

  markFirstRunSeeded(): boolean {
    return this.browser.markFirstRunSeeded();
  }
}

function emptyLedger(): Ledger {
  return {
    records: [],
    categories: DEFAULT_CATEGORIES,
    openingBalance: DEFAULT_OPENING_BALANCE,
  };
}

export function shouldSeedLedger({
  data,
  storeExists,
  firstRunSeeded,
}: {
  data: Ledger;
  storeExists: boolean;
  firstRunSeeded: boolean;
}): boolean {
  if (storeExists || firstRunSeeded || data.records.length > 0) return false;
  if (data.openingBalance !== DEFAULT_OPENING_BALANCE) return false;
  if (data.categories.length !== DEFAULT_CATEGORIES.length) return false;
  return DEFAULT_CATEGORIES.every((category, index) => {
    const actual = data.categories[index];
    return (
      actual?.id === category.id &&
      actual.name === category.name &&
      actual.type === category.type &&
      actual.shape === category.shape &&
      actual.swatch === category.swatch
    );
  });
}

function createSaveQueue<T, R>(persist: (snapshot: T) => Promise<R>) {
  let tail: Promise<void> = Promise.resolve();
  let latest: Promise<R> | null = null;
  return {
    save(snapshot: T): Promise<R> {
      const result = tail.then(() => persist(snapshot));
      latest = result;
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    isLatest(promise: Promise<R>): boolean {
      return latest === promise;
    },
  };
}

export function createLedgerSession({
  adapter,
  debounceMs = 300,
  seedRecords = [],
  lifecycle,
  waitForCloseTimeout = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
}: {
  adapter: LedgerPersistenceAdapter;
  debounceMs?: number;
  seedRecords?: LedgerEntry[];
  lifecycle?: LedgerLifecycleAdapter;
  waitForCloseTimeout?: () => Promise<void>;
}) {
  let snapshot: LedgerSessionSnapshot = {
    ledger: emptyLedger(),
    ready: false,
    saveStatus: { type: "idle" },
  };
  let latestData = snapshot.ledger;
  let pendingSave: ReturnType<typeof setTimeout> | null = null;
  let inFlightSave: Promise<SaveResult> | null = null;
  let recoveryPending = false;
  let recoveryGeneration = 0;
  let disposed = false;
  let activationGeneration = 0;
  let closing = false;
  let removeBeforeUnload: (() => void) | null = null;
  let removeCloseRequested: (() => void) | null = null;
  const listeners = new Set<(value: LedgerSessionSnapshot) => void>();
  const queue = createSaveQueue((ledger: Ledger) => adapter.save(ledger));

  const publish = (next: LedgerSessionSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };

  const setSaveStatus = (saveStatus: LedgerSaveStatus) => {
    publish({ ...snapshot, saveStatus });
  };

  const runSave = (): Promise<SaveResult> => {
    const data = latestData;
    const queuedRecoveryGeneration = recoveryGeneration;
    const queued = queue.save(data);
    setSaveStatus({ type: "saving" });
    const completion = (async () => {
      let result = await queued;
      let finalizedLatest = false;
      if (
        result.ok &&
        queue.isLatest(queued) &&
        queuedRecoveryGeneration === recoveryGeneration
      ) {
        result = adapter.finalizeSuccessfulSave(data, recoveryPending);
        finalizedLatest = true;
      }
      if (finalizedLatest && result.ok) recoveryPending = false;
      if (!result.ok && result.recoverySaved) recoveryPending = true;
      setSaveStatus(
        result.ok
          ? { type: "success" }
          : {
              type: "error",
              message: result.recoverySaved
                ? `保存失败：${result.error} · 已写入本地缓存`
                : `保存失败：${result.error}`,
              recoverySaved: result.recoverySaved,
            },
      );
      return result;
    })();
    inFlightSave = completion;
    void completion.finally(() => {
      if (inFlightSave === completion) inFlightSave = null;
    });
    return completion;
  };

  const scheduleSave = () => {
    if (!snapshot.ready) return;
    if (pendingSave !== null) clearTimeout(pendingSave);
    pendingSave = setTimeout(() => {
      pendingSave = null;
      void runSave();
    }, debounceMs);
  };

  const storeRecovery = (): boolean => {
    const saved = adapter.storeRecovery(latestData);
    if (saved) {
      recoveryPending = true;
      recoveryGeneration += 1;
    }
    return saved;
  };

  const attachLifecycle = (generation: number) => {
    if (!lifecycle || removeBeforeUnload) return;
    removeBeforeUnload = lifecycle.onBeforeUnload(() => {
      if (pendingSave !== null) {
        clearTimeout(pendingSave);
        pendingSave = null;
      }
      if (snapshot.ready) adapter.syncFallback(latestData);
    });
    void lifecycle
      .onCloseRequested(async (request) => {
        if (closing) return;
        request.preventDefault();
        closing = true;
        const closeTimeout = { type: "close-save-timeout" } as const;
        try {
          const result = await Promise.race<
            SaveResult | null | typeof closeTimeout
          >([
            (async () => {
              if (!snapshot.ready) return null;
              if (pendingSave !== null) {
                clearTimeout(pendingSave);
                pendingSave = null;
                void runSave();
              }
              return inFlightSave ? await inFlightSave : null;
            })(),
            waitForCloseTimeout().then(() => closeTimeout),
          ]);
          if (result === closeTimeout) {
            if (!storeRecovery()) {
              const proceed = lifecycle.confirm(
                "保存超时，且本地恢复缓存写入失败。最后一次编辑可能丢失。\n仍要关闭吗？",
              );
              if (!proceed) {
                closing = false;
                return;
              }
            }
          } else if (result && "ok" in result && !result.ok) {
            const proceed = lifecycle.confirm(
              result.recoverySaved
                ? `保存失败：${result.error}\n已写入本地缓存，下次启动会尝试恢复。\n仍要关闭吗？`
                : `保存失败：${result.error}\n最后一次编辑可能丢失。\n仍要关闭吗？`,
            );
            if (!proceed) {
              closing = false;
              return;
            }
          }
        } catch (error) {
          console.error("[close] flushSave threw", error);
          if (!storeRecovery()) {
            const proceed = lifecycle.confirm(
              "保存异常，且本地恢复缓存写入失败。最后一次编辑可能丢失。\n仍要关闭吗？",
            );
            if (!proceed) {
              closing = false;
              return;
            }
          }
        }
        request.close();
      })
      .then((remove) => {
        if (disposed || generation !== activationGeneration) {
          remove();
        } else {
          removeCloseRequested?.();
          removeCloseRequested = remove;
        }
      });
  };

  return {
    getSnapshot(): LedgerSessionSnapshot {
      return snapshot;
    },

    subscribe(listener: (value: LedgerSessionSnapshot) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start(): Promise<void> {
      disposed = false;
      const generation = ++activationGeneration;
      attachLifecycle(generation);
      const loaded = await adapter.load();
      if (disposed || generation !== activationGeneration) return;
      recoveryPending = loaded.recoveredPending;
      const shouldSeed = shouldSeedLedger({
        data: loaded.data,
        storeExists: loaded.storeExists || loaded.recoveredPending,
        firstRunSeeded: adapter.hasFirstRunSeeded(),
      });
      const ledger = shouldSeed
        ? {
            records: seedRecords,
            categories: DEFAULT_CATEGORIES,
            openingBalance: loaded.data.openingBalance,
          }
        : {
            ...loaded.data,
            categories:
              loaded.data.categories.length > 0
                ? loaded.data.categories
                : DEFAULT_CATEGORIES,
          };
      if (shouldSeed) adapter.markFirstRunSeeded();
      latestData = ledger;
      publish({ ledger, ready: true, saveStatus: { type: "idle" } });
      if (shouldSeed || loaded.recoveredPending) scheduleSave();
    },

    dispatch(command: LedgerCommand): LedgerCommandResult {
      const result = applyLedgerCommand(latestData, command);
      if (!result.ok) return result;
      latestData = result.ledger;
      publish({ ...snapshot, ledger: result.ledger });
      scheduleSave();
      return result;
    },

    async flush(): Promise<SaveResult | null> {
      if (!snapshot.ready) return null;
      if (pendingSave !== null) {
        clearTimeout(pendingSave);
        pendingSave = null;
        void runSave();
      }
      const pending = inFlightSave;
      return pending ? await pending : null;
    },

    dispose(): void {
      disposed = true;
      activationGeneration += 1;
      closing = false;
      if (pendingSave !== null) {
        clearTimeout(pendingSave);
        pendingSave = null;
      }
      listeners.clear();
      removeBeforeUnload?.();
      removeBeforeUnload = null;
      removeCloseRequested?.();
      removeCloseRequested = null;
    },
  };
}

export function createRuntimeLedgerSession({
  seedRecords = [],
  debounceMs = 300,
}: {
  seedRecords?: LedgerEntry[];
  debounceMs?: number;
}) {
  const browser = new BrowserLedgerPersistenceAdapter(window.localStorage);
  const adapter: LedgerPersistenceAdapter = isTauri()
    ? new TauriLedgerPersistenceAdapter({
        browser,
        invoke: async (command, args) =>
          invoke(command, args as Record<string, unknown> | undefined),
      })
    : browser;
  return createLedgerSession({
    adapter,
    debounceMs,
    seedRecords,
    lifecycle: createWindowLedgerLifecycleAdapter(),
  });
}
