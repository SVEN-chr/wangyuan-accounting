import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { Ledger } from "./ledgerCommands";
import {
  decodeLedgerWorkbook,
  encodeLedgerWorkbook,
} from "./ledgerWorkbook";

const ledger: Ledger = {
  openingBalance: 50,
  categories: [
    {
      id: "income-books",
      name: "卖书",
      type: "income",
      shape: "square",
      swatch: "#3F6212",
    },
    {
      id: "expense-books",
      name: "收书",
      type: "expense",
      shape: "circle",
      swatch: "#78350F",
    },
  ],
  records: [
    {
      id: 1,
      catId: "income-books",
      amount: 100,
      date: "2026-07-01",
      note: "订单",
    },
    {
      id: 2,
      catId: "expense-books",
      amount: 25,
      date: "2026-07-02",
    },
  ],
};

describe("账本工作簿编码", () => {
  it("编码为兼容的收支记录、分类和汇总三张工作表", async () => {
    const bytes = await encodeLedgerWorkbook(ledger);
    const workbook = XLSX.read(bytes, { type: "array" });

    expect(workbook.SheetNames).toEqual(["收支记录", "分类", "汇总"]);
    expect(
      XLSX.utils.sheet_to_json(workbook.Sheets["收支记录"], {
        header: 1,
        defval: "",
      }),
    ).toEqual([
      ["记录ID", "日期", "类型", "分类", "金额", "备注"],
      [2, "2026-07-02", "支出", "收书", 25, ""],
      [1, "2026-07-01", "收入", "卖书", 100, "订单"],
    ]);
    expect(
      XLSX.utils.sheet_to_json(workbook.Sheets["分类"], {
        header: 1,
        defval: "",
      }),
    ).toEqual([
      ["分类ID", "分类名称", "类型", "形状", "颜色"],
      ["income-books", "卖书", "收入", "square", "#3F6212"],
      ["expense-books", "收书", "支出", "circle", "#78350F"],
    ]);
    expect(
      XLSX.utils.sheet_to_json(workbook.Sheets["汇总"], {
        header: 1,
        defval: "",
      }),
    ).toEqual([
      ["指标", "金额"],
      ["总余额", 125],
      ["总收入", 100],
      ["总支出", 25],
      ["记录数量", 2],
      ["分类数量", 2],
    ]);
  });
});

describe("账本工作簿解码", () => {
  it("把三表工作簿解码为不覆盖期初余额的导入候选和诊断", async () => {
    const bytes = await encodeLedgerWorkbook(ledger);

    const result = await decodeLedgerWorkbook(bytes);

    expect(result).toEqual({
      ok: true,
      candidate: {
        records: [
          {
            id: 2,
            catId: "expense-books",
            amount: 25,
            date: "2026-07-02",
            note: "",
          },
          {
            id: 1,
            catId: "income-books",
            amount: 100,
            date: "2026-07-01",
            note: "订单",
          },
        ],
        categories: ledger.categories,
      },
      diagnostics: {
        sourceRecordRows: 2,
        importedRecords: 2,
        importedCategories: 2,
        skippedRecordRows: 0,
      },
    });
    if (result.ok) {
      expect(result.candidate).not.toHaveProperty("openingBalance");
    }
  });

  it("兼容缺少类型和分类 ID 的中文旧表头及斜杠日期", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          日期: "2026/07/18",
          分类: "旧表头购书",
          金额: 66,
          备注: "旧表头导入",
        },
      ]),
      "收支记录",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          分类名称: "旧表头购书",
          类型: "支出",
          形状: "square",
          颜色: "#123456",
        },
      ]),
      "分类",
    );
    const bytes = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer;

    const result = await decodeLedgerWorkbook(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.categories).toEqual([
      {
        id: "excel-expense-旧表头购书",
        name: "旧表头购书",
        type: "expense",
        shape: "square",
        swatch: "#123456",
      },
    ]);
    expect(result.candidate.records).toEqual([
      {
        id: expect.any(Number),
        catId: "excel-expense-旧表头购书",
        amount: 66,
        date: "2026-07-18",
        note: "旧表头导入",
      },
    ]);
    expect(result.diagnostics.skippedRecordRows).toBe(0);
  });

  it("兼容英文表头和 Excel 日期并去重同名同类型分类", async () => {
    const workbook = XLSX.utils.book_new();
    const excelDate =
      (Date.UTC(2026, 6, 18) - Date.UTC(1899, 11, 30)) / 86_400_000;
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          id: 21,
          date: excelDate,
          type: "expense",
          category: "Imported Books",
          amount: 45,
          note: "English headers",
        },
      ]),
      "Records",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          id: "english-books",
          name: "Imported Books",
          type: "expense",
          shape: "Circle",
        },
        {
          id: "duplicate-books",
          name: "Imported Books",
          type: "expense",
        },
      ]),
      "分类",
    );
    const bytes = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer;

    const result = await decodeLedgerWorkbook(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.categories).toEqual([
      {
        id: "english-books",
        name: "Imported Books",
        type: "expense",
        shape: "circle",
        swatch: "#B5532A",
      },
    ]);
    expect(result.candidate.records).toEqual([
      {
        id: 21,
        catId: "english-books",
        amount: 45,
        date: "2026-07-18",
        note: "English headers",
      },
    ]);
    expect(result.diagnostics).toEqual({
      sourceRecordRows: 1,
      importedRecords: 1,
      importedCategories: 1,
      skippedRecordRows: 0,
    });
  });

  it("把损坏文件报告为结构化失败而不是抛出解析异常", async () => {
    const result = await decodeLedgerWorkbook(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "unreadable-workbook",
        message: "导入失败：无法读取 Excel 文件",
      },
      diagnostics: {
        sourceRecordRows: 0,
        importedRecords: 0,
        importedCategories: 0,
        skippedRecordRows: 0,
      },
    });
  });

  it("拒绝非法日期并在仍有有效账目时报告跳过行数", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          日期: "2026-02-31",
          类型: "支出",
          分类: "收书",
          金额: 20,
        },
        {
          日期: "2026-02-28",
          类型: "支出",
          分类: "收书",
          金额: 30,
        },
      ]),
      "收支记录",
    );
    const bytes = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer;

    const result = await decodeLedgerWorkbook(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.records).toHaveLength(1);
    expect(result.candidate.records[0].date).toBe("2026-02-28");
    expect(result.diagnostics.skippedRecordRows).toBe(1);
  });

  it("同名跨收支类型有歧义时按金额符号推断账目类型", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          日期: "2026-07-18",
          分类: "往来",
          金额: -45,
        },
      ]),
      "收支记录",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        { 分类ID: "income-trade", 分类名称: "往来", 类型: "收入" },
        { 分类ID: "expense-trade", 分类名称: "往来", 类型: "支出" },
      ]),
      "分类",
    );
    const bytes = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer;

    const result = await decodeLedgerWorkbook(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.records[0]).toMatchObject({
      catId: "expense-trade",
      amount: 45,
    });
  });

  it("允许零账目但包含分类的工作簿清空账目", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([], {
        header: ["记录ID", "日期", "类型", "分类", "金额", "备注"],
      }),
      "收支记录",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        { 分类ID: "expense-books", 分类名称: "收书", 类型: "支出" },
      ]),
      "分类",
    );
    const bytes = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer;

    const result = await decodeLedgerWorkbook(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.records).toEqual([]);
    expect(result.candidate.categories).toHaveLength(1);
    expect(result.diagnostics.sourceRecordRows).toBe(0);
  });
});
