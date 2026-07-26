import {
  CATEGORY_SHAPES,
  CATEGORY_SWATCHES,
  type Category,
  type CategoryType,
  type CatShape,
  type Ledger,
  type LedgerEntry,
} from "./ledgerCommands";
import { dateKey, validLocalDateKey } from "./ledgerFormat";
import { createLedgerQuery } from "./ledgerQueries";

type XLSXModule = typeof import("xlsx");

const RECORD_SHEET = "收支记录";
const CATEGORY_SHEET = "分类";
const SUMMARY_SHEET = "汇总";
const RECORD_HEADERS = ["记录ID", "日期", "类型", "分类", "金额", "备注"];
const CATEGORY_HEADERS = ["分类ID", "分类名称", "类型", "形状", "颜色"];
const DATE_SEPARATOR_RE = /[./]/g;
const DATE_MATCH_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

type ExcelRow = Record<string, unknown>;

export type LedgerWorkbookDiagnostics = {
  sourceRecordRows: number;
  importedRecords: number;
  importedCategories: number;
  skippedRecordRows: number;
};

export type LedgerWorkbookDecodeResult =
  | {
      ok: true;
      candidate: Pick<Ledger, "records" | "categories">;
      diagnostics: LedgerWorkbookDiagnostics;
    }
  | {
      ok: false;
      error: {
        code:
          | "missing-record-sheet"
          | "no-importable-records"
          | "unreadable-workbook";
        message: string;
      };
      diagnostics: LedgerWorkbookDiagnostics;
    };

let xlsxModulePromise: Promise<XLSXModule> | null = null;

function loadXLSX(): Promise<XLSXModule> {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("xlsx");
  }
  return xlsxModulePromise;
}

function categoryTypeLabel(type: CategoryType): string {
  return type === "income" ? "收入" : "支出";
}

function parseCategoryType(value: unknown): CategoryType | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (["收入", "income", "in", "收"].includes(text)) return "income";
  if (["支出", "expense", "out", "支"].includes(text)) return "expense";
  return null;
}

function parseShape(value: unknown): CatShape | null {
  const text = String(value ?? "").trim().toLowerCase();
  return (CATEGORY_SHAPES as readonly string[]).includes(text)
    ? (text as CatShape)
    : null;
}

function readCell(row: ExcelRow, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function parseAmount(value: unknown): number {
  if (typeof value === "number") return value;
  const amount = Number(
    String(value ?? "")
      .replace(/[¥￥,\s]/g, "")
      .trim(),
  );
  return Number.isFinite(amount) ? amount : NaN;
}

function parseRecordId(value: unknown, fallback: number): number {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : fallback;
}

function parseDate(value: unknown, xlsx: XLSXModule): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dateKey(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = (
      xlsx.SSF as {
        parse_date_code?: (
          value: number,
        ) => { y: number; m: number; d: number } | null;
      }
    ).parse_date_code?.(value);
    if (parsed) {
      return validLocalDateKey(parsed.y, parsed.m, parsed.d);
    }
  }
  const match = String(value ?? "")
    .trim()
    .replace(DATE_SEPARATOR_RE, "-")
    .match(DATE_MATCH_RE);
  return match
    ? validLocalDateKey(
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
      )
    : "";
}

function makeCategoryId(
  name: string,
  type: CategoryType,
  usedIds: Set<string>,
): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\da-z一-龥]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = `excel-${type}-${slug || "category"}`;
  let id = base;
  let suffix = 1;
  while (usedIds.has(id)) {
    suffix += 1;
    id = `${base}-${suffix}`;
  }
  usedIds.add(id);
  return id;
}

export async function encodeLedgerWorkbook(
  ledger: Ledger,
): Promise<Uint8Array> {
  const XLSX = await loadXLSX();
  const query = createLedgerQuery(ledger);
  const recordRows = query.entries("all", "").map((record) => {
    const category = query.category(record.catId);
    return {
      记录ID: record.id,
      日期: record.date,
      类型: categoryTypeLabel(category.type),
      分类: category.name,
      金额: record.amount,
      备注: record.note ?? "",
    };
  });
  const categoryRows = ledger.categories.map((category) => ({
    分类ID: category.id,
    分类名称: category.name,
    类型: categoryTypeLabel(category.type),
    形状: category.shape,
    颜色: category.swatch,
  }));
  const summaryRows = [
    ["指标", "金额"],
    ["总余额", ledger.openingBalance + query.stats.balance],
    ["总收入", query.stats.income],
    ["总支出", query.stats.expense],
    ["记录数量", ledger.records.length],
    ["分类数量", ledger.categories.length],
  ];

  const workbook = XLSX.utils.book_new();
  const recordSheet = XLSX.utils.json_to_sheet(recordRows, {
    header: RECORD_HEADERS,
  });
  const categorySheet = XLSX.utils.json_to_sheet(categoryRows, {
    header: CATEGORY_HEADERS,
  });
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  recordSheet["!cols"] = [
    { wch: 16 },
    { wch: 12 },
    { wch: 10 },
    { wch: 16 },
    { wch: 12 },
    { wch: 24 },
  ];
  categorySheet["!cols"] = [
    { wch: 24 },
    { wch: 16 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
  ];
  summarySheet["!cols"] = [{ wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(workbook, recordSheet, RECORD_SHEET);
  XLSX.utils.book_append_sheet(workbook, categorySheet, CATEGORY_SHEET);
  XLSX.utils.book_append_sheet(workbook, summarySheet, SUMMARY_SHEET);

  const content = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
  return new Uint8Array(content);
}

async function decodeLedgerWorkbookContents(
  bytes: ArrayBuffer | Uint8Array,
): Promise<LedgerWorkbookDecodeResult> {
  const XLSX = await loadXLSX();
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  const recordSheet =
    workbook.Sheets[RECORD_SHEET] ??
    workbook.Sheets[workbook.SheetNames[0]];
  const emptyDiagnostics: LedgerWorkbookDiagnostics = {
    sourceRecordRows: 0,
    importedRecords: 0,
    importedCategories: 0,
    skippedRecordRows: 0,
  };
  if (!recordSheet) {
    return {
      ok: false,
      error: {
        code: "missing-record-sheet",
        message: "导入失败：Excel 中没有可读取的工作表",
      },
      diagnostics: emptyDiagnostics,
    };
  }

  const categorySheet = workbook.Sheets[CATEGORY_SHEET];
  const categoryRows = categorySheet
    ? XLSX.utils.sheet_to_json<ExcelRow>(categorySheet, { defval: "" })
    : [];
  const usedCategoryIds = new Set<string>();
  const typeByName = new Map<string, CategoryType | "ambiguous">();
  const categories: Category[] = [];
  const categoriesByKey = new Map<string, Category>();
  categoryRows.forEach((row, index) => {
    const name = String(
      readCell(row, ["分类名称", "分类", "name"]),
    ).trim();
    const type = parseCategoryType(
      readCell(row, ["类型", "收支类型", "type"]),
    );
    if (!name || !type) return;
    const lowerName = name.toLowerCase();
    const knownType = typeByName.get(lowerName);
    typeByName.set(
      lowerName,
      knownType !== undefined && knownType !== type ? "ambiguous" : type,
    );
    const key = `${type}:${name}`;
    if (categoriesByKey.has(key)) return;
    const rawId = String(readCell(row, ["分类ID", "id"])).trim();
    const id =
      rawId && !usedCategoryIds.has(rawId)
        ? rawId
        : makeCategoryId(name, type, usedCategoryIds);
    usedCategoryIds.add(id);
    const shape =
      parseShape(readCell(row, ["形状", "shape"])) ??
      CATEGORY_SHAPES[index % CATEGORY_SHAPES.length];
    const rawSwatch = String(
      readCell(row, ["颜色", "color", "swatch"]),
    ).trim();
    const swatch = /^#([\da-f]{3}|[\da-f]{6})$/i.test(rawSwatch)
      ? rawSwatch
      : CATEGORY_SWATCHES[index % CATEGORY_SWATCHES.length];
    const category: Category = { id, name, type, shape, swatch };
    categories.push(category);
    categoriesByKey.set(key, category);
  });
  const recordRows = XLSX.utils.sheet_to_json<ExcelRow>(recordSheet, {
    defval: "",
  });
  let skippedRecordRows = 0;
  const usedRecordIds = new Set<number>();
  let recordIdSequence = Date.now() + recordRows.length;
  const records = recordRows.reduce<LedgerEntry[]>((items, row, index) => {
    const rawAmount = parseAmount(readCell(row, ["金额", "amount"]));
    const categoryName = String(
      readCell(row, ["分类", "分类名称", "category"]),
    ).trim();
    const typeFromCell = parseCategoryType(
      readCell(row, ["类型", "收支类型", "type"]),
    );
    const knownType = typeByName.get(categoryName.toLowerCase());
    const type =
      typeFromCell ??
      (knownType && knownType !== "ambiguous"
        ? knownType
        : rawAmount < 0
          ? "expense"
          : "income");
    const date = parseDate(readCell(row, ["日期", "date"]), XLSX);
    const amount = Math.abs(rawAmount);
    if (
      !categoryName ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !date
    ) {
      skippedRecordRows += 1;
      return items;
    }
    const key = `${type}:${categoryName}`;
    let category = categoriesByKey.get(key);
    if (!category) {
      category = {
        id: makeCategoryId(categoryName, type, usedCategoryIds),
        name: categoryName,
        type,
        shape: CATEGORY_SHAPES[categories.length % CATEGORY_SHAPES.length],
        swatch:
          CATEGORY_SWATCHES[categories.length % CATEGORY_SWATCHES.length],
      };
      categories.push(category);
      categoriesByKey.set(key, category);
    }
    let id = parseRecordId(
      readCell(row, ["记录ID", "id"]),
      Date.now() + index,
    );
    while (usedRecordIds.has(id)) {
      recordIdSequence += 1;
      id = recordIdSequence;
    }
    usedRecordIds.add(id);
    items.push({
      id,
      catId: category.id,
      amount,
      date,
      note: String(readCell(row, ["备注", "note"])).trim(),
    });
    return items;
  }, []);
  const diagnostics: LedgerWorkbookDiagnostics = {
    sourceRecordRows: recordRows.length,
    importedRecords: records.length,
    importedCategories: categories.length,
    skippedRecordRows,
  };
  if (records.length === 0 && !(recordRows.length === 0 && categories.length > 0)) {
    return {
      ok: false,
      error: {
        code: "no-importable-records",
        message: "导入失败：Excel 中没有有效的收支记录",
      },
      diagnostics,
    };
  }
  return {
    ok: true,
    candidate: { records, categories },
    diagnostics,
  };
}

export async function decodeLedgerWorkbook(
  bytes: ArrayBuffer | Uint8Array,
): Promise<LedgerWorkbookDecodeResult> {
  try {
    return await decodeLedgerWorkbookContents(bytes);
  } catch {
    return {
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
    };
  }
}
