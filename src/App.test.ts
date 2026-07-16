import { describe, expect, it } from "vitest";
import {
  createSaveQueue,
  saveAccountingSnapshot,
  shouldSeedAccountingData,
  storeRecoverySnapshot,
  getCategoryDeletionImpact,
  parseExcelDate,
  buildExcelSummaryRows,
  isImportableWorkbook,
  finalizeLatestSuccessfulSave,
  canFinalizeQueuedSave,
  resolveRecoveryPendingState,
} from "./App";

describe("账本保存队列", () => {
  it("始终按提交顺序落盘，较旧快照不会后写覆盖较新快照", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const persisted: string[] = [];
    const queue = createSaveQueue(async (snapshot: string) => {
      if (snapshot === "旧快照") await firstGate;
      persisted.push(snapshot);
      return { ok: true as const };
    });

    const first = queue.save("旧快照");
    const second = queue.save("新快照");
    await Promise.resolve();

    expect(persisted).toEqual([]);
    expect(queue.isLatest(first)).toBe(false);
    expect(queue.isLatest(second)).toBe(true);
    releaseFirst();
    await Promise.all([first, second]);
    expect(persisted).toEqual(["旧快照", "新快照"]);
  });

  it("关窗恢复代次推进后旧队列尾不能清除新的 pending", () => {
    expect(
      canFinalizeQueuedSave({
        isLatest: true,
        queuedRecoveryGeneration: 2,
        currentRecoveryGeneration: 3,
      }),
    ).toBe(false);
  });

  it("被代次屏障拒绝的旧成功结果不会清除内存 pending", () => {
    expect(
      resolveRecoveryPendingState({
        current: true,
        result: { ok: true },
        finalizedLatest: false,
      }),
    ).toBe(true);
  });
});

describe("Excel 日期", () => {
  it("拒绝不存在的日历日期而不是自动滚入下个月", () => {
    expect(parseExcelDate("2026-02-31", { SSF: {} } as never)).toBe("");
  });
});

describe("Excel 汇总", () => {
  it("总余额包含期初余额", () => {
    const rows = buildExcelSummaryRows({
      stats: {
        income: 100,
        expense: 25,
        balance: 75,
        byCat: {},
        byDay: {},
        byMonth: {},
      },
      openingBalance: 50,
      recordCount: 2,
      categoryCount: 1,
    });

    expect(rows[1]).toEqual(["总余额", 125]);
  });
});

describe("Excel 空账本往返", () => {
  it("允许零记录但包含分类的工作簿清空当前账目", () => {
    expect(
      isImportableWorkbook({
        sourceRecordRows: 0,
        validRecords: 0,
        importedCategories: 3,
      }),
    ).toBe(true);
  });
});

describe("删除分类", () => {
  it("删除前报告会被级联删除的账目数量", () => {
    expect(
      getCategoryDeletionImpact(
        "custom-books",
        [
          {
            id: "custom-books",
            name: "古籍",
            type: "expense",
            shape: "square",
            swatch: "#123456",
          },
        ],
        [
          { id: 1, catId: "custom-books", amount: 10, date: "2026-07-17" },
          { id: 2, catId: "other", amount: 20, date: "2026-07-17" },
        ],
      ),
    ).toEqual({ categoryName: "古籍", affectedRecords: 1 });
  });
});

describe("首次启动样例", () => {
  it("已有桌面账本即使零记录也不会覆盖自定义分类", () => {
    expect(
      shouldSeedAccountingData({
        storeExists: true,
        firstRunSeeded: false,
        data: {
          records: [],
          categories: [
            {
              id: "custom-books",
              name: "古籍",
              type: "income",
              shape: "circle",
              swatch: "#123456",
            },
          ],
          openingBalance: 0,
        },
      }),
    ).toBe(false);
  });
});

describe("账本保存恢复", () => {
  it("桌面写盘失败时写入恢复缓存并设置 pending 标记", async () => {
    let pending = false;
    const result = await saveAccountingSnapshot(
      { records: [], categories: [], openingBalance: 0 },
      {
        isDesktop: true,
        saveToDisk: async () => {
          throw new Error("disk unavailable");
        },
        saveFallback: () => true,
        setPending: (value) => {
          pending = value;
          return true;
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      error: "disk unavailable",
      recoverySaved: true,
    });
    expect(pending).toBe(true);
  });

  it("恢复缓存写入失败时不会虚假承诺已缓存，也不会设置 pending", async () => {
    let pending = false;
    const result = await saveAccountingSnapshot(
      { records: [], categories: [], openingBalance: 0 },
      {
        isDesktop: true,
        saveToDisk: async () => {
          throw new Error("disk unavailable");
        },
        saveFallback: () => false,
        setPending: (value) => {
          pending = value;
          return true;
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      error: "disk unavailable · 本地恢复缓存写入失败",
      recoverySaved: false,
    });
    expect(pending).toBe(false);
  });

  it("关窗超时时只有缓存和 pending 标记都成功才承诺可恢复", () => {
    const snapshot = { records: [], categories: [], openingBalance: 0 };
    expect(
      storeRecoverySnapshot(snapshot, {
        saveFallback: () => true,
        setPending: () => false,
      }),
    ).toBe(false);
  });

  it("pending 清除失败时刷新恢复缓存并返回可见错误", () => {
    let fallbackRefreshed = false;
    const result = finalizeLatestSuccessfulSave(
      { records: [], categories: [], openingBalance: 0 },
      {
        clearPending: () => false,
        hasPending: () => true,
        saveFallback: () => {
          fallbackRefreshed = true;
          return true;
        },
        setPending: () => true,
      },
    );

    expect(fallbackRefreshed).toBe(true);
    expect(result).toEqual({
      ok: false,
      error: "磁盘已保存，但本地恢复标记清除失败",
      recoverySaved: true,
    });
  });

  it("最新磁盘保存成功时先刷新 fallback 再清除 pending", () => {
    const operations: string[] = [];
    const result = finalizeLatestSuccessfulSave(
      { records: [], categories: [], openingBalance: 0 },
      {
        clearPending: () => {
          operations.push("clear-pending");
          return true;
        },
        hasPending: () => true,
        saveFallback: () => {
          operations.push("refresh-fallback");
          return true;
        },
        setPending: () => true,
      },
    );

    expect(result).toEqual({ ok: true });
    expect(operations).toEqual(["refresh-fallback", "clear-pending"]);
  });

  it("没有 pending 时本地缓存不可用也不误报磁盘保存失败", () => {
    const result = finalizeLatestSuccessfulSave(
      { records: [], categories: [], openingBalance: 0 },
      {
        clearPending: () => false,
        hasPending: () => false,
        saveFallback: () => false,
        setPending: () => false,
      },
    );

    expect(result).toEqual({ ok: true });
  });
});
