import { describe, expect, it } from "vitest";
import {
  buildExcelSummaryRows,
  isImportableWorkbook,
  parseExcelDate,
} from "./App";
import { createLedgerQuery } from "./ledgerQueries";

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
      createLedgerQuery({
        openingBalance: 0,
        categories: [
          {
            id: "custom-books",
            name: "古籍",
            type: "expense",
            shape: "square",
            swatch: "#123456",
          },
        ],
        records: [
          { id: 1, catId: "custom-books", amount: 10, date: "2026-07-17" },
          { id: 2, catId: "other", amount: 20, date: "2026-07-17" },
        ],
      }).categoryDeletionImpact("custom-books"),
    ).toEqual({ categoryName: "古籍", affectedEntries: 1 });
  });
});
