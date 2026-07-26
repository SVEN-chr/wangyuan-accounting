import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATEGORIES,
  applyLedgerCommand,
  type Ledger,
} from "./ledgerCommands";

function makeLedger(): Ledger {
  return {
    records: [
      {
        id: 100,
        catId: "custom-rare-books",
        amount: 36,
        date: "2026-07-18",
        note: "古籍",
      },
    ],
    categories: [
      ...DEFAULT_CATEGORIES,
      {
        id: "custom-rare-books",
        name: "古籍",
        type: "expense",
        shape: "diamond",
        swatch: "#123456",
      },
    ],
    openingBalance: 500,
  };
}

describe("账本命令", () => {
  it("新增账目时在首选标识符冲突后分配下一个可用标识符", () => {
    const ledger = makeLedger();
    const result = applyLedgerCommand(ledger, {
      type: "entry.create",
      preferredId: 100,
      entry: {
        catId: "buy-book",
        amount: 88.5,
        date: "2026-07-18",
        note: "  新收书  ",
      },
    });

    expect(result).toEqual({
      ok: true,
      ledger: {
        ...ledger,
        records: [
          ...ledger.records,
          {
            id: 101,
            catId: "buy-book",
            amount: 88.5,
            date: "2026-07-18",
            note: "新收书",
          },
        ],
      },
    });
    expect(ledger.records).toHaveLength(1);
  });

  it("编辑和删除账目通过同一接口完成", () => {
    const ledger = makeLedger();
    const edited = applyLedgerCommand(ledger, {
      type: "entry.update",
      id: 100,
      entry: {
        catId: "sell-book",
        amount: 125,
        date: "2026-07-19",
        note: "  已售  ",
      },
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.ledger.records[0]).toEqual({
      id: 100,
      catId: "sell-book",
      amount: 125,
      date: "2026-07-19",
      note: "已售",
    });

    const deleted = applyLedgerCommand(edited.ledger, {
      type: "entry.delete",
      id: 100,
    });
    expect(deleted).toEqual({
      ok: true,
      ledger: { ...edited.ledger, records: [] },
    });
  });

  it("拒绝不完整账目和不存在的分类", () => {
    const ledger = makeLedger();
    const invalidAmount = applyLedgerCommand(ledger, {
      type: "entry.create",
      preferredId: 101,
      entry: {
        catId: "buy-book",
        amount: 0,
        date: "2026-07-18",
      },
    });
    const unknownCategory = applyLedgerCommand(ledger, {
      type: "entry.create",
      preferredId: 101,
      entry: {
        catId: "missing",
        amount: 10,
        date: "2026-07-18",
      },
    });

    expect(invalidAmount).toMatchObject({
      ok: false,
      error: { code: "invalid-entry" },
    });
    expect(unknownCategory).toMatchObject({
      ok: false,
      error: { code: "category-not-found" },
    });
  });

  it("拒绝同名同类型分类并在分类标识符冲突时生成后缀", () => {
    const ledger = makeLedger();
    const duplicate = applyLedgerCommand(ledger, {
      type: "category.create",
      preferredId: 7,
      category: {
        name: "  古籍 ",
        type: "expense",
        shape: "circle",
        swatch: "#654321",
      },
    });
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: "duplicate-category" },
    });

    const withCollision: Ledger = {
      ...ledger,
      categories: [
        ...ledger.categories,
        {
          id: "custom-7",
          name: "旧分类",
          type: "income",
          shape: "square",
          swatch: "#111111",
        },
      ],
    };
    const created = applyLedgerCommand(withCollision, {
      type: "category.create",
      preferredId: 7,
      category: {
        name: "新分类",
        type: "income",
        shape: "circle",
        swatch: "#654321",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.ledger.categories[created.ledger.categories.length - 1]?.id).toBe(
      "custom-7-1",
    );
  });

  it("保护默认分类，删除自定义分类时级联删除关联账目", () => {
    const ledger = makeLedger();
    const protectedResult = applyLedgerCommand(ledger, {
      type: "category.delete",
      id: "buy-book",
    });
    expect(protectedResult).toMatchObject({
      ok: false,
      error: { code: "protected-category" },
    });

    const deleted = applyLedgerCommand(ledger, {
      type: "category.delete",
      id: "custom-rare-books",
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.ledger.categories.some((item) => item.id === "custom-rare-books")).toBe(false);
    expect(deleted.ledger.records).toEqual([]);
  });

  it("修改期初余额并在导入替换时保留它", () => {
    const ledger = makeLedger();
    const changed = applyLedgerCommand(ledger, {
      type: "opening-balance.set",
      value: 888,
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;

    const replacementCategory = {
      id: "excel-expense-books",
      name: "导入购书",
      type: "expense" as const,
      shape: "square" as const,
      swatch: "#abcdef",
    };
    const replaced = applyLedgerCommand(changed.ledger, {
      type: "import.replace",
      records: [
        {
          id: 200,
          catId: replacementCategory.id,
          amount: 66,
          date: "2026-07-18",
        },
      ],
      categories: [replacementCategory],
    });

    expect(replaced).toEqual({
      ok: true,
      ledger: {
        records: [
          {
            id: 200,
            catId: replacementCategory.id,
            amount: 66,
            date: "2026-07-18",
          },
        ],
        categories: [replacementCategory],
        openingBalance: 888,
      },
    });
  });

  it("拒绝会破坏分类唯一性的导入替换", () => {
    const ledger = makeLedger();
    const category = {
      id: "excel-expense-books",
      name: "导入购书",
      type: "expense" as const,
      shape: "square" as const,
      swatch: "#abcdef",
    };
    const result = applyLedgerCommand(ledger, {
      type: "import.replace",
      records: [],
      categories: [
        category,
        { ...category, id: "duplicate", name: " 导入购书 " },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "duplicate-category" },
    });
  });

  it("拒绝包含不完整账目的导入替换", () => {
    const ledger = makeLedger();
    const category = {
      id: "excel-expense-books",
      name: "导入购书",
      type: "expense" as const,
      shape: "square" as const,
      swatch: "#abcdef",
    };
    const result = applyLedgerCommand(ledger, {
      type: "import.replace",
      records: [
        {
          id: 200,
          catId: category.id,
          amount: 0,
          date: "",
        },
      ],
      categories: [category],
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-entry" },
    });
  });
});
