import { describe, expect, it } from "vitest";
import type { Ledger } from "./ledgerCommands";
import { createLedgerQuery } from "./ledgerQueries";

const categories: Ledger["categories"] = [
  {
    id: "expense-books",
    name: "购书",
    type: "expense",
    shape: "square",
    swatch: "#B95C3A",
  },
  {
    id: "income-books",
    name: "售书",
    type: "income",
    shape: "circle",
    swatch: "#7A8060",
  },
];

describe("账本概览查询", () => {
  it("以当前月和本周为口径并让未来账目只扩展月度窗口", () => {
    const ledger: Ledger = {
      categories,
      openingBalance: 500,
      records: [
        { id: 1, catId: "income-books", amount: 100, date: "2026-06-20" },
        { id: 2, catId: "expense-books", amount: 40, date: "2026-06-21" },
        { id: 3, catId: "income-books", amount: 250, date: "2026-07-18" },
        { id: 4, catId: "expense-books", amount: 100, date: "2026-07-18" },
        { id: 5, catId: "income-books", amount: 999, date: "2026-08-19" },
      ],
    };

    const query = createLedgerQuery(ledger);
    const overview = query.ledgerOverview("2026-07-18");

    expect(overview.today).toEqual({
      expense: 100,
      entryCount: 2,
    });
    expect(overview.weekNet).toBe(150);
    expect(overview.entryCounts).toEqual({ income: 3, expense: 2 });
    expect(overview.currentMonth).toEqual({
      income: 250,
      expense: 100,
      net: 150,
      balanceWithOpening: 650,
    });
    expect(overview.monthOverMonthPercent).toBe(150);
    expect(overview.trendNote).toBe("本月节余创近半年新高");
    expect(overview.monthSeries.map((month) => month.key)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("跨年切换月份时使用上一自然月作为环比基准", () => {
    const overview = createLedgerQuery({
      categories,
      openingBalance: 0,
      records: [
        { id: 1, catId: "income-books", amount: 100, date: "2025-12-31" },
        { id: 2, catId: "income-books", amount: 150, date: "2026-01-01" },
      ],
    }).ledgerOverview("2026-01-15");

    expect(overview.monthOverMonthPercent).toBe(50);
    expect(overview.monthSeries.map((month) => month.key)).toEqual([
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
  });
});

describe("账目与分类查询", () => {
  it("统一筛选、排序、分类分组和级联影响统计", () => {
    const query = createLedgerQuery({
      categories,
      openingBalance: 0,
      records: [
        { id: 1, catId: "expense-books", amount: 20, date: "2026-07-17" },
        { id: 3, catId: "expense-books", amount: 30, date: "2026-07-18" },
        { id: 2, catId: "income-books", amount: 50, date: "2026-07-18" },
        { id: 4, catId: "income-books", amount: 80, date: "2026-08-01" },
      ],
    });

    expect(query.entries("expense", "2026-07").map((entry) => entry.id)).toEqual([3, 1]);
    expect(query.entries("month", "2026-07").map((entry) => entry.id)).toEqual([3, 2, 1]);
    expect(query.entriesOnDay("2026-07-18").map((entry) => entry.id)).toEqual([3, 2]);
    expect(query.categorySummary()).toEqual({
      expense: [categories[0]],
      income: [categories[1]],
      entryCountByCategory: {
        "expense-books": 2,
        "income-books": 2,
      },
    });
    expect(query.breakdown("expense")).toMatchObject({
      items: [{ id: "expense-books", amount: 50 }],
      total: 50,
    });
    expect(query.categoryDeletionImpact("expense-books")).toEqual({
      categoryName: "购书",
      affectedEntries: 2,
    });
    expect(query.category("missing")).toMatchObject({
      id: "unknown",
      name: "未分类",
      type: "expense",
    });
  });
});

describe("账本热力图查询", () => {
  it("返回可达历史和未来账目的日期边界及零值安全窗口", () => {
    const query = createLedgerQuery({
      categories,
      openingBalance: 0,
      records: [
        { id: 1, catId: "expense-books", amount: 80, date: "2026-06-01" },
        { id: 2, catId: "expense-books", amount: 100, date: "2026-07-18" },
        { id: 3, catId: "income-books", amount: 500, date: "2026-08-19" },
      ],
    });

    expect(query.dateBounds("2026-07-18")).toEqual({
      min: "2026-06-01",
      max: "2026-08-19",
    });
    expect(query.heatmap("2026-07-19", 3)).toEqual({
      days: [
        { date: "2026-07-17", value: 0 },
        { date: "2026-07-18", value: 100 },
        { date: "2026-07-19", value: 0 },
      ],
      max: 100,
    });
    expect(query.heatmap("2026-05-03", 3).max).toBe(1);
  });
});

describe("统计页查询", () => {
  it("集中返回分类、月份、收入和周内支出口径", () => {
    const query = createLedgerQuery({
      categories,
      openingBalance: 0,
      records: [
        { id: 1, catId: "expense-books", amount: 100, date: "2026-07-18" },
        { id: 2, catId: "expense-books", amount: 50, date: "2026-07-19" },
        { id: 3, catId: "income-books", amount: 250, date: "2026-07-18" },
        { id: 4, catId: "income-books", amount: 150, date: "2026-07-19" },
      ],
    });

    const report = query.statistics("2026-07-18");

    expect(report.breakdowns.expense).toMatchObject({
      total: 150,
      items: [{ id: "expense-books", amount: 150 }],
    });
    expect(report.breakdowns.income).toMatchObject({
      total: 400,
      items: [{ id: "income-books", amount: 400 }],
    });
    expect(report.income).toEqual({
      maxEntry: {
        id: 3,
        catId: "income-books",
        amount: 250,
        date: "2026-07-18",
      },
      mean: 200,
    });
    expect(report.expenseByWeekday).toEqual({
      values: [50, 0, 0, 0, 0, 0, 100],
      max: 100,
      peakIndex: 6,
    });
    expect(report.savingRate).toBe(62.5);
    expect(report.incomeExpenseRatio).toBeCloseTo(400 / 150);
    expect(report.maxMonthValue).toBe(400);
    expect(report.maxNet).toBe(250);
  });

  it("空账本返回可安全用于图表除法的零值结果", () => {
    const report = createLedgerQuery({
      categories,
      openingBalance: 0,
      records: [],
    }).statistics("2026-07-18");

    expect(report.breakdowns.expense).toEqual({ items: [], total: 1 });
    expect(report.breakdowns.income).toEqual({ items: [], total: 1 });
    expect(report.income).toEqual({ maxEntry: null, mean: 0 });
    expect(report.expenseByWeekday).toEqual({
      values: [0, 0, 0, 0, 0, 0, 0],
      max: 1,
      peakIndex: 0,
    });
    expect(report.monthSeries).toHaveLength(6);
    expect(report.maxMonthValue).toBe(1);
    expect(report.maxNet).toBe(1);
    expect(report.savingRate).toBe(0);
    expect(report.incomeExpenseRatio).toBe(0);
  });
});
