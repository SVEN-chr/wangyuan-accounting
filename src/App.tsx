import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import * as XLSX from "xlsx";
import "./App.css";

/* =================================================================
   Types & constants
================================================================= */

type CategoryType = "expense" | "income";
type CatShape = "square" | "circle" | "diamond" | "triangle" | "halfcircle";
type PageKey = "ledger" | "stats" | "cats" | "backup";
type EntryFilter = "all" | "expense" | "income" | "month";

type Category = {
  id: string;
  name: string;
  type: CategoryType;
  shape: CatShape;
  swatch: string;
};

type RecordItem = {
  id: number;
  catId: string;
  amount: number;
  date: string;
  note?: string;
};

type RecordForm = {
  type: CategoryType;
  catId: string;
  amount: string;
  date: string;
  note: string;
};

type CategoryForm = {
  name: string;
  type: CategoryType;
  shape: CatShape;
  swatch: string;
};

type PersistedAccountingData = {
  records: RecordItem[];
  categories: Category[];
  openingBalance: number;
};

type ExcelRow = Record<string, unknown>;

type BackupStatus = {
  type: "idle" | "success" | "error";
  message: string;
};

type Stats = {
  income: number;
  expense: number;
  balance: number;
  byCat: Record<string, number>;
  byDay: Record<string, number>;
  byMonth: Record<string, { income: number; expense: number }>;
};

const RECORDS_STORAGE_KEY = "accounting.records";
const CATEGORIES_STORAGE_KEY = "accounting.categories";
const OPENING_BALANCE_STORAGE_KEY = "accounting.opening-balance";
const FALLBACK_STORAGE_KEY = "accounting.file-store-fallback";
const FIRST_RUN_KEY = "accounting.first-run-seeded";
const DEFAULT_OPENING_BALANCE = 0;
const EXCEL_RECORD_SHEET = "收支记录";
const EXCEL_CATEGORY_SHEET = "分类";
const EXCEL_SUMMARY_SHEET = "汇总";
const EXCEL_RECORD_HEADERS = ["记录ID", "日期", "类型", "分类", "金额", "备注"];
const EXCEL_CATEGORY_HEADERS = ["分类ID", "分类名称", "类型", "形状", "颜色"];

const PALETTE = [
  "#B5532A",
  "#7C3A0E",
  "#5C7C2C",
  "#92400E",
  "#9B2226",
  "#3D405B",
  "#264653",
  "#000000",
];

const SHAPES: CatShape[] = [
  "square",
  "circle",
  "diamond",
  "triangle",
  "halfcircle",
];

const DEFAULT_CATEGORIES: Category[] = [
  { id: "rent", name: "房租", type: "expense", swatch: "#C2410C", shape: "square" },
  { id: "fuel", name: "加油", type: "expense", swatch: "#9A3412", shape: "diamond" },
  { id: "parking", name: "停车费", type: "expense", swatch: "#B45309", shape: "circle" },
  { id: "entertainment", name: "商务招待", type: "expense", swatch: "#92400E", shape: "triangle" },
  { id: "buy-book", name: "收书", type: "expense", swatch: "#78350F", shape: "halfcircle" },
  { id: "sell-book", name: "卖书", type: "income", swatch: "#3F6212", shape: "square" },
  { id: "consult", name: "咨询费", type: "income", swatch: "#4D7C0F", shape: "circle" },
];

const SAMPLE_RECORDS: RecordItem[] = [
  { id: 101, catId: "sell-book", amount: 4280, date: "2026-05-01", note: "孔网订单 · 古籍三函" },
  { id: 102, catId: "fuel", amount: 312, date: "2026-04-30", note: "嘉实多 95#" },
  { id: 103, catId: "parking", amount: 24, date: "2026-04-30" },
  { id: 104, catId: "buy-book", amount: 1860, date: "2026-04-29", note: "潘家园早市" },
  { id: 105, catId: "sell-book", amount: 980, date: "2026-04-29", note: "微信成交" },
  { id: 106, catId: "entertainment", amount: 768, date: "2026-04-28", note: "晚饭 · 老主顾" },
  { id: 107, catId: "rent", amount: 6800, date: "2026-04-28", note: "工作室四月" },
  { id: 108, catId: "consult", amount: 2400, date: "2026-04-27", note: "鉴定费" },
  { id: 109, catId: "parking", amount: 18, date: "2026-04-27" },
  { id: 110, catId: "buy-book", amount: 3450, date: "2026-04-26", note: "私人藏家收书" },
  { id: 111, catId: "fuel", amount: 286, date: "2026-04-25" },
  { id: 112, catId: "sell-book", amount: 1560, date: "2026-04-24", note: "线下同行" },
  { id: 113, catId: "entertainment", amount: 432, date: "2026-04-23" },
  { id: 114, catId: "buy-book", amount: 2100, date: "2026-04-22", note: "民国版四册" },
  { id: 115, catId: "sell-book", amount: 3200, date: "2026-04-21" },
  { id: 116, catId: "parking", amount: 30, date: "2026-04-21" },
  { id: 117, catId: "consult", amount: 1200, date: "2026-04-20" },
  { id: 118, catId: "fuel", amount: 298, date: "2026-04-19" },
  { id: 119, catId: "buy-book", amount: 880, date: "2026-04-18" },
  { id: 120, catId: "sell-book", amount: 2680, date: "2026-04-17", note: "线装古籍一套" },
  { id: 121, catId: "entertainment", amount: 596, date: "2026-04-16" },
  { id: 122, catId: "parking", amount: 24, date: "2026-04-15" },
  { id: 123, catId: "buy-book", amount: 1340, date: "2026-04-14" },
  { id: 124, catId: "sell-book", amount: 5400, date: "2026-04-12", note: "整批出货" },
  { id: 125, catId: "fuel", amount: 308, date: "2026-04-10" },
  { id: 126, catId: "consult", amount: 800, date: "2026-04-08" },
  { id: 127, catId: "buy-book", amount: 2240, date: "2026-04-06" },
  { id: 128, catId: "sell-book", amount: 1980, date: "2026-04-04" },
  { id: 129, catId: "entertainment", amount: 360, date: "2026-04-02" },
  { id: 130, catId: "rent", amount: 6800, date: "2026-04-01", note: "工作室三月" },
];

const DEFAULT_CATEGORY_IDS = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
const EXCEL_DATE_SEPARATOR_RE = /[./]/g;
const EXCEL_DATE_MATCH_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})/;

/* =================================================================
   Helpers
================================================================= */

const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const today = () => dateKey(new Date());
const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const fmtAmount = (n: number, decimals = 2) =>
  Number(n).toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

const fmtMoney = (n: number, decimals = 2) => "¥" + fmtAmount(n, decimals);

const splitMoney = (n: number): [string, string] => {
  const parts = Number(n).toFixed(2).split(".");
  const intPart = Number(parts[0]).toLocaleString("zh-CN");
  return [intPart, "." + parts[1]];
};

const fmtCompact = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
};

const HEAT_COLORS: Array<[number, string]> = [
  [0.5, "#7C3A0E"],
  [0.25, "#C6701D"],
  [0.05, "#E8B97A"],
];
const HEAT_BASE = "#F5E6CC";
const heatColor = (intensity: number): string => {
  for (const [threshold, color] of HEAT_COLORS) {
    if (intensity > threshold) return color;
  }
  return HEAT_BASE;
};

const netColor = (net: number): string =>
  net > 0 ? "#5C7C2C" : net < 0 ? "#7C3A0E" : "#FAF3E2";

const DOW_LABEL = ["日", "一", "二", "三", "四", "五", "六"];

function buildMonthSeq(records: RecordItem[], now: Date): string[] {
  let endMonth = monthKey(now);
  for (const r of records) {
    const m = r.date.slice(0, 7);
    if (m && m > endMonth) endMonth = m;
  }
  const [y, m] = endMonth.split("-").map(Number);
  const seq: string[] = [];
  for (let i = 5; i >= 0; i--) {
    seq.push(monthKey(new Date(y, m - 1 - i, 1)));
  }
  return seq;
}

function timeGreeting(d: Date) {
  const h = d.getHours();
  if (h < 5) return "凌晨好";
  if (h < 9) return "早上好";
  if (h < 12) return "上午好";
  if (h < 14) return "中午好";
  if (h < 17) return "下午好";
  if (h < 19) return "傍晚好";
  return "晚上好";
}

function weekdayCN(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return DOW_LABEL[date.getDay()];
}

function loadFallbackJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveFallbackJson<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* swallow — restricted webview */
  }
}

function migrateCategory(c: Partial<Category>, fallback?: Category): Category {
  const def = fallback ?? DEFAULT_CATEGORIES[0];
  return {
    id: c.id ?? def.id,
    name: c.name ?? def.name,
    type: (c.type as CategoryType) ?? def.type,
    shape: (c.shape as CatShape) ?? def.shape,
    swatch: c.swatch ?? def.swatch,
  };
}

function loadFallback(): PersistedAccountingData {
  return loadFallbackJson<PersistedAccountingData>(FALLBACK_STORAGE_KEY, {
    records: loadFallbackJson<RecordItem[]>(RECORDS_STORAGE_KEY, []),
    categories: loadFallbackJson<Category[]>(
      CATEGORIES_STORAGE_KEY,
      DEFAULT_CATEGORIES,
    ),
    openingBalance: loadFallbackJson<number>(
      OPENING_BALANCE_STORAGE_KEY,
      DEFAULT_OPENING_BALANCE,
    ),
  });
}

async function loadAccountingData(): Promise<PersistedAccountingData> {
  try {
    const raw = await invoke<string>("load_accounting_store");
    if (!raw) return loadFallback();
    const parsed = JSON.parse(raw) as Partial<PersistedAccountingData>;
    const fb = loadFallback();
    return {
      records: Array.isArray(parsed.records) ? parsed.records : fb.records,
      categories: Array.isArray(parsed.categories)
        ? parsed.categories.map((c) => migrateCategory(c))
        : fb.categories,
      openingBalance:
        typeof parsed.openingBalance === "number" &&
        Number.isFinite(parsed.openingBalance)
          ? parsed.openingBalance
          : fb.openingBalance,
    };
  } catch {
    return loadFallback();
  }
}

async function saveAccountingData(data: PersistedAccountingData) {
  try {
    await invoke("save_accounting_store", { payload: JSON.stringify(data) });
  } catch {
    saveFallbackJson(FALLBACK_STORAGE_KEY, data);
  }
}

function categoryTypeLabel(t: CategoryType) {
  return t === "income" ? "收入" : "支出";
}

function parseCategoryType(value: unknown): CategoryType | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (["收入", "income", "in", "收"].includes(text)) return "income";
  if (["支出", "expense", "out", "支"].includes(text)) return "expense";
  return null;
}

function parseShape(value: unknown): CatShape | null {
  const t = String(value ?? "").trim().toLowerCase() as CatShape;
  return SHAPES.includes(t) ? t : null;
}

function readExcelCell(row: ExcelRow, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "")
      return value;
  }
  return "";
}

function parseExcelAmount(value: unknown) {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "")
    .replace(/[¥￥,\s]/g, "")
    .trim();
  const a = Number(cleaned);
  return Number.isFinite(a) ? a : NaN;
}

function parseExcelRecordId(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseExcelDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = (XLSX.SSF as { parse_date_code?: (n: number) => { y: number; m: number; d: number } | null })
      .parse_date_code?.(value);
    if (parsed) {
      const month = String(parsed.m).padStart(2, "0");
      const day = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${month}-${day}`;
    }
  }
  const text = String(value ?? "").trim();
  if (!text) return "";
  const normalized = text.replace(EXCEL_DATE_SEPARATOR_RE, "-");
  const match = normalized.match(EXCEL_DATE_MATCH_RE);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function makeCategoryId(name: string, type: CategoryType, used: Set<string>) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\da-z一-龥]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = `excel-${type}-${slug || "category"}`;
  let next = base;
  let i = 1;
  while (used.has(next)) {
    i += 1;
    next = `${base}-${i}`;
  }
  used.add(next);
  return next;
}

function computeStats(records: RecordItem[], cats: Category[]): Stats {
  const byId = new Map(cats.map((c) => [c.id, c]));
  let income = 0;
  let expense = 0;
  const byCat: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const byMonth: Record<string, { income: number; expense: number }> = {};
  for (const r of records) {
    const cat = byId.get(r.catId);
    if (!cat) continue;
    if (cat.type === "income") income += r.amount;
    else expense += r.amount;
    byCat[r.catId] = (byCat[r.catId] || 0) + r.amount;
    byDay[r.date] = (byDay[r.date] || 0) + (cat.type === "expense" ? r.amount : 0);
    const m = r.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { income: 0, expense: 0 };
    byMonth[m][cat.type] += r.amount;
  }
  return { income, expense, balance: income - expense, byCat, byDay, byMonth };
}

function createInitialForm(
  cats: Category[],
  type: CategoryType = "expense",
): RecordForm {
  const cat = cats.find((c) => c.type === type) ?? cats[0];
  return {
    type: cat.type,
    catId: cat.id,
    amount: "",
    date: today(),
    note: "",
  };
}

type BreakdownItem = Category & { amount: number };

function categoryBreakdown(
  cats: Category[],
  byCat: Record<string, number>,
  type: CategoryType,
): { items: BreakdownItem[]; total: number } {
  const items: BreakdownItem[] = [];
  let total = 0;
  for (const c of cats) {
    if (c.type !== type) continue;
    const amount = byCat[c.id] || 0;
    if (amount <= 0) continue;
    items.push({ ...c, amount });
    total += amount;
  }
  items.sort((a, b) => b.amount - a.amount);
  return { items, total: total || 1 };
}

/* =================================================================
   Atoms — CountUp, CatGlyph
================================================================= */

function CountUp({
  value,
  duration = 900,
  prefix = "¥",
  className = "",
}: {
  value: number;
  duration?: number;
  prefix?: string;
  className?: string;
}) {
  const [shown, setShown] = useState(0);
  const startedRef = useRef<number | null>(null);
  const startValRef = useRef(0);
  const targetRef = useRef(value);

  useEffect(() => {
    startedRef.current = null;
    startValRef.current = shown;
    targetRef.current = value;
    let raf = 0;
    const tick = (t: number) => {
      if (startedRef.current == null) startedRef.current = t;
      const p = Math.min(1, (t - startedRef.current) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v =
        startValRef.current +
        (targetRef.current - startValRef.current) * eased;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const [intPart, decPart] = splitMoney(shown);
  return (
    <span className={className}>
      <span className="cu-prefix">{prefix}</span>
      <span className="cu-int">{intPart}</span>
      <span className="cu-dec">{decPart}</span>
    </span>
  );
}

function CatGlyph({
  shape,
  color,
  size = 14,
  className = "",
}: {
  shape: CatShape;
  color: string;
  size?: number;
  className?: string;
}) {
  const s = size;
  if (shape === "circle")
    return (
      <span
        className={className}
        style={{
          width: s,
          height: s,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
    );
  if (shape === "diamond")
    return (
      <span
        className={className}
        style={{
          width: s,
          height: s,
          background: color,
          display: "inline-block",
          transform: "rotate(45deg)",
          flexShrink: 0,
        }}
      />
    );
  if (shape === "triangle")
    return (
      <span
        className={className}
        style={{
          width: 0,
          height: 0,
          display: "inline-block",
          borderLeft: `${s / 2}px solid transparent`,
          borderRight: `${s / 2}px solid transparent`,
          borderBottom: `${s}px solid ${color}`,
          flexShrink: 0,
        }}
      />
    );
  if (shape === "halfcircle")
    return (
      <span
        className={className}
        style={{
          width: s,
          height: s / 2,
          background: color,
          display: "inline-block",
          borderRadius: `${s}px ${s}px 0 0`,
          flexShrink: 0,
        }}
      />
    );
  return (
    <span
      className={className}
      style={{
        width: s,
        height: s,
        background: color,
        display: "inline-block",
        borderRadius: 2,
        flexShrink: 0,
      }}
    />
  );
}

/* =================================================================
   App
================================================================= */

function App() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [openingBalance, setOpeningBalance] = useState<number>(
    DEFAULT_OPENING_BALANCE,
  );
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [page, setPage] = useState<PageKey>("ledger");
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<RecordForm>(() =>
    createInitialForm(DEFAULT_CATEGORIES),
  );
  const [pendingDelete, setPendingDelete] = useState<RecordItem | null>(null);
  const [entryFilter, setEntryFilter] = useState<EntryFilter>("all");
  const [backupStatus, setBackupStatus] = useState<BackupStatus>({
    type: "idle",
    message: "",
  });
  const importInputRef = useRef<HTMLInputElement | null>(null);

  /* ---- load on mount ---- */
  useEffect(() => {
    let cancelled = false;
    loadAccountingData()
      .then((data) => {
        if (cancelled) return;
        const seeded = window.localStorage.getItem(FIRST_RUN_KEY);
        if (!seeded && data.records.length === 0) {
          setRecords(SAMPLE_RECORDS);
          setCategories(DEFAULT_CATEGORIES);
          setOpeningBalance(data.openingBalance);
          try {
            window.localStorage.setItem(FIRST_RUN_KEY, "1");
          } catch {
            /* ignore */
          }
        } else {
          setRecords(data.records);
          setCategories(
            data.categories.length > 0 ? data.categories : DEFAULT_CATEGORIES,
          );
          setOpeningBalance(data.openingBalance);
        }
        setStorageLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setStorageLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- persist (debounced — bursts of edits coalesce) ---- */
  useEffect(() => {
    if (!storageLoaded) return;
    const handle = window.setTimeout(() => {
      void saveAccountingData({ records, categories, openingBalance });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [records, categories, openingBalance, storageLoaded]);

  /* ---- derived ---- */
  const catsById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const getCat = useMemo(() => {
    const fallback: Category = {
      id: "unknown",
      name: "未分类",
      type: "expense",
      shape: "square",
      swatch: "#999",
    };
    return (id: string): Category => catsById.get(id) ?? fallback;
  }, [catsById]);

  const sortedRecords = useMemo(
    () =>
      records
        .slice()
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) || b.id - a.id,
        ),
    [records],
  );

  const stats = useMemo(
    () => computeStats(records, categories),
    [records, categories],
  );

  const filteredEntries = useMemo(() => {
    const month = monthKey(new Date());
    const predicates: Record<EntryFilter, (r: RecordItem) => boolean> = {
      all: () => true,
      expense: (r) => getCat(r.catId).type === "expense",
      income: (r) => getCat(r.catId).type === "income",
      month: (r) => r.date.startsWith(month),
    };
    return sortedRecords.filter(predicates[entryFilter]);
  }, [sortedRecords, entryFilter, getCat]);

  /* ---- actions ---- */
  function openAddModal(type: CategoryType = "expense") {
    setForm(createInitialForm(categories, type));
    setEditId(null);
    setModalOpen(true);
  }

  function openEditModal(record: RecordItem) {
    const cat = getCat(record.catId);
    setForm({
      type: cat.type,
      catId: record.catId,
      amount: String(record.amount),
      date: record.date,
      note: record.note ?? "",
    });
    setEditId(record.id);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditId(null);
  }

  function saveRecord() {
    const amount = Number(form.amount);
    if (!form.catId || !form.amount || !Number.isFinite(amount) || amount <= 0)
      return;

    if (editId !== null) {
      setRecords((items) =>
        items.map((r) =>
          r.id === editId
            ? {
                ...r,
                catId: form.catId,
                amount,
                date: form.date,
                note: form.note.trim(),
              }
            : r,
        ),
      );
    } else {
      setRecords((items) => [
        ...items,
        {
          id: Date.now(),
          catId: form.catId,
          amount,
          date: form.date,
          note: form.note.trim(),
        },
      ]);
    }
    closeModal();
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    setRecords((items) => items.filter((r) => r.id !== pendingDelete.id));
    setPendingDelete(null);
  }

  function addCategory(c: Omit<Category, "id">) {
    const trimmed = c.name.trim();
    if (!trimmed) return;
    setCategories((items) => [
      ...items,
      { ...c, name: trimmed, id: `custom-${Date.now()}` },
    ]);
  }

  function deleteCategory(id: string) {
    if (DEFAULT_CATEGORY_IDS.has(id)) return;
    setCategories((items) => items.filter((c) => c.id !== id));
    setRecords((items) => items.filter((r) => r.catId !== id));
  }

  /* ---- backup ---- */
  async function exportBackup() {
    const recordRows = sortedRecords.map((record) => {
      const c = getCat(record.catId);
      return {
        记录ID: record.id,
        日期: record.date,
        类型: categoryTypeLabel(c.type),
        分类: c.name,
        金额: record.amount,
        备注: record.note ?? "",
      };
    });
    const categoryRows = categories.map((c) => ({
      分类ID: c.id,
      分类名称: c.name,
      类型: categoryTypeLabel(c.type),
      形状: c.shape,
      颜色: c.swatch,
    }));
    const summaryRows: (string | number)[][] = [
      ["指标", "金额"],
      ["总余额", stats.balance],
      ["总收入", stats.income],
      ["总支出", stats.expense],
      ["记录数量", records.length],
      ["分类数量", categories.length],
    ];

    const wb = XLSX.utils.book_new();
    const recordSheet = XLSX.utils.json_to_sheet(recordRows, {
      header: EXCEL_RECORD_HEADERS,
    });
    const categorySheet = XLSX.utils.json_to_sheet(categoryRows, {
      header: EXCEL_CATEGORY_HEADERS,
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
    XLSX.utils.book_append_sheet(wb, recordSheet, EXCEL_RECORD_SHEET);
    XLSX.utils.book_append_sheet(wb, categorySheet, EXCEL_CATEGORY_SHEET);
    XLSX.utils.book_append_sheet(wb, summarySheet, EXCEL_SUMMARY_SHEET);
    const filename = `wangyuan-${today()}.xlsx`;

    try {
      const content = XLSX.write(wb, {
        bookType: "xlsx",
        type: "array",
      }) as ArrayBuffer;
      const path = await invoke<string>("save_excel_backup", {
        filename,
        bytes: Array.from(new Uint8Array(content)),
      });
      setBackupStatus({
        type: "success",
        message: `已导出 ${records.length} 条记录到 ${path}`,
      });
    } catch {
      XLSX.writeFile(wb, filename);
      setBackupStatus({
        type: "success",
        message: `已导出 ${records.length} 条记录到 ${filename}`,
      });
    }
  }

  function openImportPicker() {
    importInputRef.current?.click();
  }

  async function importFromFile(file: File) {
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { cellDates: true });
      const recordSheet =
        wb.Sheets[EXCEL_RECORD_SHEET] ?? wb.Sheets[wb.SheetNames[0]];
      if (!recordSheet) {
        setBackupStatus({
          type: "error",
          message: "导入失败：Excel 中没有可读取的工作表",
        });
        return;
      }

      const usedIds = new Set<string>();
      const importedCats: Category[] = [];
      const catByKey = new Map<string, Category>();
      const catSheet = wb.Sheets[EXCEL_CATEGORY_SHEET];

      if (catSheet) {
        const rows = XLSX.utils.sheet_to_json<ExcelRow>(catSheet, {
          defval: "",
        });
        rows.forEach((row, idx) => {
          const name = String(
            readExcelCell(row, ["分类名称", "分类", "name"]),
          ).trim();
          const type = parseCategoryType(
            readExcelCell(row, ["类型", "收支类型", "type"]),
          );
          if (!name || !type) return;
          const rawId = String(readExcelCell(row, ["分类ID", "id"])).trim();
          const id =
            rawId && !usedIds.has(rawId)
              ? rawId
              : makeCategoryId(name, type, usedIds);
          usedIds.add(id);
          const shape =
            parseShape(readExcelCell(row, ["形状", "shape"])) ??
            SHAPES[idx % SHAPES.length];
          const swatchRaw = String(
            readExcelCell(row, ["颜色", "color", "swatch"]),
          ).trim();
          const swatch = /^#([\da-f]{3}|[\da-f]{6})$/i.test(swatchRaw)
            ? swatchRaw
            : PALETTE[idx % PALETTE.length];
          const cat: Category = { id, name, type, shape, swatch };
          importedCats.push(cat);
          catByKey.set(`${type}:${name}`, cat);
        });
      }

      const recordRows = XLSX.utils.sheet_to_json<ExcelRow>(recordSheet, {
        defval: "",
      });
      let skipped = 0;
      const importedRecords = recordRows.reduce<RecordItem[]>((items, row, idx) => {
        const rawAmount = parseExcelAmount(readExcelCell(row, ["金额", "amount"]));
        const typeFromCell = parseCategoryType(
          readExcelCell(row, ["类型", "收支类型", "type"]),
        );
        const type = typeFromCell ?? (rawAmount < 0 ? "expense" : "income");
        const categoryName = String(
          readExcelCell(row, ["分类", "分类名称", "category"]),
        ).trim();
        const date = parseExcelDate(readExcelCell(row, ["日期", "date"]));
        const amount = Math.abs(rawAmount);
        if (
          !categoryName ||
          !date ||
          !Number.isFinite(amount) ||
          amount <= 0
        ) {
          skipped += 1;
          return items;
        }
        const key = `${type}:${categoryName}`;
        let cat = catByKey.get(key);
        if (!cat) {
          cat = {
            id: makeCategoryId(categoryName, type, usedIds),
            name: categoryName,
            type,
            shape: SHAPES[importedCats.length % SHAPES.length],
            swatch: PALETTE[importedCats.length % PALETTE.length],
          };
          importedCats.push(cat);
          catByKey.set(key, cat);
        }
        items.push({
          id: parseExcelRecordId(
            readExcelCell(row, ["记录ID", "id"]),
            Date.now() + idx,
          ),
          catId: cat.id,
          amount,
          date,
          note: String(readExcelCell(row, ["备注", "note"])).trim(),
        });
        return items;
      }, []);

      if (importedRecords.length === 0) {
        setBackupStatus({
          type: "error",
          message: "导入失败：Excel 中没有有效的收支记录",
        });
        return;
      }

      const ok = window.confirm(
        `导入会覆盖当前 ${records.length} 条记录、${categories.length} 个分类。确认导入 ${importedRecords.length} 条记录？`,
      );
      if (!ok) {
        setBackupStatus({ type: "idle", message: "" });
        return;
      }
      setRecords(importedRecords);
      setCategories(importedCats.length > 0 ? importedCats : DEFAULT_CATEGORIES);
      setBackupStatus({
        type: "success",
        message: `已导入 ${importedRecords.length} 条记录${
          skipped > 0 ? ` · 跳过 ${skipped} 行` : ""
        }`,
      });
    } catch {
      setBackupStatus({
        type: "error",
        message: "导入失败：无法读取 Excel 文件",
      });
    }
  }

  async function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await importFromFile(file);
  }

  /* =================================================================
     Render
  ================================================================= */
  return (
    <div className="v2-root">
      <TopBar
        page={page}
        onPage={setPage}
        onAdd={() => openAddModal("expense")}
      />

      {page === "ledger" && (
        <LedgerPage
          records={records}
          filtered={filteredEntries}
          stats={stats}
          categories={categories}
          getCat={getCat}
          entryFilter={entryFilter}
          setEntryFilter={setEntryFilter}
          onEdit={openEditModal}
          onDelete={(r) => setPendingDelete(r)}
          openingBalance={openingBalance}
          onOpeningBalance={setOpeningBalance}
        />
      )}

      {page === "stats" && (
        <StatsPage
          records={records}
          stats={stats}
          categories={categories}
        />
      )}

      {page === "cats" && (
        <CategoriesPage
          categories={categories}
          stats={stats}
          records={records}
          onAdd={addCategory}
          onDelete={deleteCategory}
        />
      )}

      {page === "backup" && (
        <BackupPage
          records={records}
          categories={categories}
          status={backupStatus}
          onExport={exportBackup}
          onImport={openImportPicker}
          onImportFile={importFromFile}
        />
      )}

      <input
        ref={importInputRef}
        className="v2-file-input-hidden"
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={importBackup}
      />

      {modalOpen && (
        <NewRecordModal
          form={form}
          setForm={setForm}
          categories={categories}
          isEdit={editId !== null}
          onClose={closeModal}
          onSave={saveRecord}
        />
      )}

      {pendingDelete && (
        <DeleteConfirmModal
          record={pendingDelete}
          category={getCat(pendingDelete.catId)}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

/* =================================================================
   TopBar
================================================================= */
function TopBar({
  page,
  onPage,
  onAdd,
}: {
  page: PageKey;
  onPage: (p: PageKey) => void;
  onAdd: () => void;
}) {
  return (
    <header className="v2-top">
      <div className="v2-brand">
        <div className="v2-brand-logo">
          <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
            <rect
              x="3"
              y="3"
              width="26"
              height="26"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <rect x="9" y="9" width="14" height="14" fill="currentColor" />
          </svg>
        </div>
        <div>
          <div className="v2-brand-name">书 业 账 房</div>
          <div className="v2-brand-sub mono">CHRONICLE BOOKS · LEDGER 2026</div>
        </div>
      </div>
      <nav className="v2-nav" aria-label="主导航">
        {(
          [
            ["ledger", "账目"],
            ["stats", "统计"],
            ["cats", "分类"],
            ["backup", "备份"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            className={page === k ? "active" : ""}
            onClick={() => onPage(k)}
            type="button"
          >
            {l}
          </button>
        ))}
      </nav>
      <div className="v2-top-actions">
        <button className="v2-btn-ghost mono" type="button" aria-label="快捷搜索">
          ⌘ K
        </button>
        <button className="v2-btn-primary" type="button" onClick={onAdd}>
          + 记一笔
        </button>
      </div>
    </header>
  );
}

/* =================================================================
   Greeting
================================================================= */
function GreetingStrip({
  date,
  todayExpense,
  weekNet,
  recordedToday,
  note,
}: {
  date: Date;
  todayExpense: number;
  weekNet: number;
  recordedToday: number;
  note: string;
}) {
  const dateText = date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <div className="v2-greet">
      <div className="v2-greet-l">
        <div className="v2-greet-time mono">
          {dateText} · 周{weekdayCN(date)}
        </div>
        <div className="v2-greet-hi">
          {timeGreeting(date).split("").join(" ")}，
          <span className="v2-greet-name">王 源</span>
        </div>
        <div className="v2-greet-sub">
          今日已记 {recordedToday} 笔 · 距月末{" "}
          {(() => {
            const last = new Date(
              date.getFullYear(),
              date.getMonth() + 1,
              0,
            ).getDate();
            return Math.max(0, last - date.getDate());
          })()}{" "}
          日 · {note}
        </div>
      </div>
      <div className="v2-greet-r">
        <div className="v2-greet-stat">
          <div className="mono">今日支出</div>
          <div className="v2-greet-num">{fmtMoney(todayExpense)}</div>
        </div>
        <div className="v2-greet-stat">
          <div className="mono">本周净流入</div>
          <div className={`v2-greet-num ${weekNet >= 0 ? "positive" : ""}`}>
            {weekNet >= 0 ? "+" : "−"}
            {fmtMoney(Math.abs(weekNet), 0)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =================================================================
   Opening balance row (editable)
================================================================= */
function OpeningBalanceRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  function commit() {
    const n = Number(draft.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(n)) onChange(n);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="v2-rec-row">
        <span className="mono">期 初</span>
        <input
          autoFocus
          className="v2-rec-edit mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(String(value));
              setEditing(false);
            }
          }}
          inputMode="decimal"
        />
      </div>
    );
  }
  return (
    <div
      className="v2-rec-row v2-rec-editable"
      onClick={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      role="button"
      tabIndex={0}
      title="点击编辑期初余额"
    >
      <span className="mono">期 初</span>
      <span className="v2-rec-num mono">{fmtAmount(value)}</span>
    </div>
  );
}

/* =================================================================
   Ledger (main) page
================================================================= */
function LedgerPage({
  records,
  filtered,
  stats,
  categories,
  getCat,
  entryFilter,
  setEntryFilter,
  onEdit,
  onDelete,
  openingBalance,
  onOpeningBalance,
}: {
  records: RecordItem[];
  filtered: RecordItem[];
  stats: Stats;
  categories: Category[];
  getCat: (id: string) => Category;
  entryFilter: EntryFilter;
  setEntryFilter: (f: EntryFilter) => void;
  onEdit: (r: RecordItem) => void;
  onDelete: (r: RecordItem) => void;
  openingBalance: number;
  onOpeningBalance: (n: number) => void;
}) {
  const now = new Date();
  const todayKey = dateKey(now);
  const currentMonthKey = monthKey(now);

  const dailyAggregates = useMemo(() => {
    const reference = new Date(todayKey);
    reference.setDate(reference.getDate() - 6);
    const weekStartKey = dateKey(reference);
    let todayExpense = 0;
    let weekNet = 0;
    let recordedToday = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    for (const r of records) {
      const c = getCat(r.catId);
      if (c.type === "income") incomeCount += 1;
      else expenseCount += 1;
      if (r.date === todayKey) {
        recordedToday += 1;
        if (c.type === "expense") todayExpense += r.amount;
      }
      if (r.date >= weekStartKey) {
        weekNet += c.type === "income" ? r.amount : -r.amount;
      }
    }
    return { todayExpense, weekNet, recordedToday, incomeCount, expenseCount };
  }, [records, getCat, todayKey]);

  // 6-month series — covers up to latest activity month (handles future-dated records)
  const monthSeq = useMemo(
    () => buildMonthSeq(records, new Date(currentMonthKey + "-01")),
    [records, currentMonthKey],
  );

  const { maxMonthVal, curNet, momPct } = useMemo(() => {
    let maxVal = 1;
    for (const m of monthSeq) {
      const v = stats.byMonth[m];
      if (!v) continue;
      if (v.income > maxVal) maxVal = v.income;
      if (v.expense > maxVal) maxVal = v.expense;
    }
    const cur = stats.byMonth[monthSeq[5]] ?? { income: 0, expense: 0 };
    const prev = stats.byMonth[monthSeq[4]] ?? { income: 0, expense: 0 };
    const curN = cur.income - cur.expense;
    const prevN = prev.income - prev.expense;
    const hasPrev = prev.income > 0 || prev.expense > 0;
    return {
      maxMonthVal: maxVal,
      curNet: curN,
      momPct:
        hasPrev && prevN !== 0
          ? ((curN - prevN) / Math.abs(prevN)) * 100
          : null,
    };
  }, [stats.byMonth, monthSeq]);

  const trendNote = useMemo(() => {
    const cm = stats.byMonth[currentMonthKey];
    if (!cm || (cm.income === 0 && cm.expense === 0)) {
      return "本月暂无记录 · 开始记一笔";
    }
    const cmNet = cm.income - cm.expense;
    const [y, m] = currentMonthKey.split("-").map(Number);
    const prevNets: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const key = monthKey(new Date(y, m - 1 - i, 1));
      const v = stats.byMonth[key];
      if (v && (v.income !== 0 || v.expense !== 0)) {
        prevNets.push(v.income - v.expense);
      }
    }
    if (prevNets.length === 0) return "本月节余暂无历史可比";
    const maxPrev = Math.max(...prevNets);
    const minPrev = Math.min(...prevNets);
    if (cmNet > maxPrev) return "本月节余创近半年新高";
    if (cmNet < minPrev) return "本月节余为近半年新低";
    if (cmNet >= 0)
      return `本月节余 ${fmtCompact(cmNet)} · 近半年区间 ${fmtCompact(minPrev)} ~ ${fmtCompact(maxPrev)}`;
    return `本月入不敷出 · 缺口 ${fmtCompact(Math.abs(cmNet))}`;
  }, [stats.byMonth, currentMonthKey]);

  const expenseBreakdown = useMemo(
    () => categoryBreakdown(categories, stats.byCat, "expense"),
    [categories, stats.byCat],
  );
  const expenseCats = expenseBreakdown.items;
  const totalExp = expenseBreakdown.total;

  const heatDays = useMemo(() => {
    const days: { date: string; value: number }[] = [];
    let max = 1;
    const reference = new Date(todayKey);
    for (let i = 41; i >= 0; i--) {
      const d = new Date(reference);
      d.setDate(reference.getDate() - i);
      const key = dateKey(d);
      const value = stats.byDay[key] || 0;
      if (value > max) max = value;
      days.push({ date: key, value });
    }
    return { days, max };
  }, [stats.byDay, todayKey]);

  const monthData = stats.byMonth[currentMonthKey] ?? { income: 0, expense: 0 };
  const monthBalance = monthData.income - monthData.expense;
  const stampDate = `${now.getFullYear()} / ${String(now.getMonth() + 1).padStart(2, "0")} / ${String(now.getDate()).padStart(2, "0")}`;
  const stampTime = now.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <>
      <GreetingStrip
        date={now}
        todayExpense={dailyAggregates.todayExpense}
        weekNet={dailyAggregates.weekNet}
        recordedToday={dailyAggregates.recordedToday}
        note={trendNote}
      />

      <div className="v2-body">
        {/* Receipt rail */}
        <aside className="v2-receipt">
          <div className="v2-receipt-perf top" />
          <div className="v2-receipt-head">
            <div className="mono v2-rec-no">N° {todayKey}</div>
            <div className="v2-rec-title">月 度 凭 单</div>
            <div className="mono v2-rec-sub">MONTHLY SUMMARY</div>
          </div>
          <div className="v2-receipt-rows">
            <OpeningBalanceRow
              value={openingBalance}
              onChange={onOpeningBalance}
            />
            <div className="v2-rec-row income">
              <span className="mono">+ 收入</span>
              <span className="v2-rec-num mono">
                {fmtAmount(monthData.income)}
              </span>
            </div>
            <div className="v2-rec-row expense">
              <span className="mono">− 支出</span>
              <span className="v2-rec-num mono">
                {fmtAmount(monthData.expense)}
              </span>
            </div>
            <div className="v2-rec-rule" />
            <div className="v2-rec-row total">
              <span>结  余</span>
              <span className="v2-rec-num mono">
                {fmtAmount(monthBalance + openingBalance)}
              </span>
            </div>
          </div>
          <div className="v2-receipt-stamp">
            <div className="v2-stamp">
              <div className="v2-stamp-inner">
                <div>已</div>
                <div>核</div>
                <div>对</div>
              </div>
            </div>
            <div className="v2-stamp-meta mono">
              <div>{stampDate}</div>
              <div>{stampTime}</div>
              <div>WY-001</div>
            </div>
          </div>
          <div className="v2-receipt-perf bottom" />
        </aside>

        {/* Main */}
        <main className="v2-main">
          {/* Hero stats */}
          <section className="v2-stats">
            <article className="v2-stat-card big">
              <div className="v2-stat-label mono">本月结余 · NET BALANCE</div>
              <div className="v2-stat-value">
                <CountUp value={curNet} className="v2-bignum" />
              </div>
              <div className="v2-stat-trend">
                {momPct === null ? (
                  <span className="mono">无 上 月 数 据</span>
                ) : (
                  <>
                    <span
                      className={`v2-trend-pill ${momPct < 0 ? "down" : ""}`}
                    >
                      {momPct >= 0 ? "▲" : "▼"} {Math.abs(momPct).toFixed(1)}%
                    </span>
                    <span className="mono">较 上 月</span>
                  </>
                )}
              </div>
            </article>
            <article className="v2-stat-card">
              <div className="v2-stat-label mono">收入 · INCOME</div>
              <CountUp value={stats.income} className="v2-midnum income-c" />
              <div className="v2-stat-foot mono">
                {dailyAggregates.incomeCount} 笔
              </div>
            </article>
            <article className="v2-stat-card">
              <div className="v2-stat-label mono">支出 · EXPENSE</div>
              <CountUp value={stats.expense} className="v2-midnum expense-c" />
              <div className="v2-stat-foot mono">
                {dailyAggregates.expenseCount} 笔
              </div>
            </article>
          </section>

          {/* Bars + donut */}
          <section className="v2-charts">
            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>收 支 走 势</h3>
                  <div className="mono">
                    {monthSeq[0]} ~ {monthSeq[monthSeq.length - 1]} · 6 MO
                  </div>
                </div>
                <div className="v2-legend">
                  <span>
                    <span className="dot income" /> 收入
                  </span>
                  <span>
                    <span className="dot expense" /> 支出
                  </span>
                </div>
              </div>
              <div className="v2-bar-chart">
                {monthSeq.map((m) => {
                  const v = stats.byMonth[m] ?? { income: 0, expense: 0 };
                  return (
                    <div key={m} className="v2-bar-group">
                      <div className="v2-bars">
                        <div
                          className="v2-bar income"
                          style={{
                            height: `${(v.income / maxMonthVal) * 100}%`,
                          }}
                        >
                          {v.income > 0 && (
                            <span className="v2-bar-tip mono">
                              {fmtCompact(v.income)}
                            </span>
                          )}
                        </div>
                        <div
                          className="v2-bar expense"
                          style={{
                            height: `${(v.expense / maxMonthVal) * 100}%`,
                          }}
                        >
                          {v.expense > 0 && (
                            <span className="v2-bar-tip mono">
                              {fmtCompact(v.expense)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="v2-bar-label mono">{m.slice(5)}月</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>支 出 构 成</h3>
                  <div className="mono">EXPENSE BREAKDOWN</div>
                </div>
              </div>
              <div className="v2-donut-wrap">
                <svg viewBox="0 0 120 120" className="v2-donut">
                  <circle
                    cx="60"
                    cy="60"
                    r="44"
                    fill="none"
                    stroke="#EFE4D2"
                    strokeWidth="14"
                  />
                  {(() => {
                    let off = 0;
                    return expenseCats.map((c) => {
                      const frac = c.amount / totalExp;
                      const len = frac * 276.46;
                      const arr = `${Math.max(0, len - 2)} ${276.46 - len + 2}`;
                      const dashOff = -off;
                      off += len;
                      return (
                        <circle
                          key={c.id}
                          cx="60"
                          cy="60"
                          r="44"
                          fill="none"
                          stroke={c.swatch}
                          strokeWidth="14"
                          strokeDasharray={arr}
                          strokeDashoffset={dashOff}
                          transform="rotate(-90 60 60)"
                        />
                      );
                    });
                  })()}
                </svg>
                <div className="v2-donut-center">
                  <div className="mono v2-tag">TOTAL</div>
                  <div
                    className="v2-donut-num mono"
                    data-len={fmtCompact(totalExp).length}
                  >
                    {fmtCompact(totalExp)}
                  </div>
                </div>
              </div>
              <div className="v2-donut-legend">
                {expenseCats.slice(0, 5).map((c) => (
                  <div key={c.id} className="v2-leg-row">
                    <CatGlyph shape={c.shape} color={c.swatch} size={10} />
                    <span className="v2-leg-name">{c.name}</span>
                    <span className="v2-leg-pct">
                      {((c.amount / totalExp) * 100).toFixed(0)}%
                    </span>
                    <span className="v2-leg-amt">
                      {fmtMoney(c.amount, 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Heatmap */}
          <section className="v2-heat-card">
            <div className="v2-card-head">
              <div>
                <h3>每 日 支 出 强 度</h3>
                <div className="mono">42 DAYS · DEEPER = MORE SPENT</div>
              </div>
              <div className="v2-heat-scale mono">
                少
                <span
                  className="v2-heat-cell"
                  style={{ background: "#F5E6CC" }}
                />
                <span
                  className="v2-heat-cell"
                  style={{ background: "#E8B97A" }}
                />
                <span
                  className="v2-heat-cell"
                  style={{ background: "#C6701D" }}
                />
                <span
                  className="v2-heat-cell"
                  style={{ background: "#7C3A0E" }}
                />
                多
              </div>
            </div>
            <div className="v2-heat-grid">
              {heatDays.days.map((d) => {
                const intensity = d.value / heatDays.max;
                const bg = heatColor(intensity);
                return (
                  <div
                    key={d.date}
                    className="v2-heat-cell-big"
                    style={{ background: bg } as CSSProperties}
                    title={`${d.date} · ${fmtMoney(d.value, 0)}`}
                  >
                    <span className="mono">{d.date.slice(8)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Entries */}
          <section className="v2-entries">
            <div className="v2-card-head">
              <div>
                <h3>近 期 账 目</h3>
                <div className="mono">
                  RECENT ENTRIES · {filtered.length}
                </div>
              </div>
              <div className="v2-filters">
                {(
                  [
                    ["all", "全部"],
                    ["expense", "支出"],
                    ["income", "收入"],
                    ["month", "本月"],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    className={entryFilter === k ? "active" : ""}
                    onClick={() => setEntryFilter(k)}
                    type="button"
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="v2-entries-list">
              {filtered.length === 0 && (
                <div className="v2-empty">暂无记录</div>
              )}
              {filtered.slice(0, 12).map((r, i) => {
                const cat = getCat(r.catId);
                const isIn = cat.type === "income";
                return (
                  <div key={r.id} className="v2-entry">
                    <div className="v2-entry-no mono">
                      {String(i + 1).padStart(3, "0")}
                    </div>
                    <div className="v2-entry-date">
                      <div className="d">{r.date.slice(8)}</div>
                      <div className="m">{r.date.slice(5, 7)}月</div>
                    </div>
                    <div className="v2-entry-cat">
                      <CatGlyph
                        shape={cat.shape}
                        color={cat.swatch}
                        size={14}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="v2-entry-name">{cat.name}</div>
                        <div className="v2-entry-note">{r.note || "—"}</div>
                      </div>
                    </div>
                    <div className="v2-entry-tag">
                      {isIn ? "INCOME" : "EXPENSE"}
                    </div>
                    <div
                      className={`v2-entry-amt ${
                        isIn ? "income-c" : "expense-c"
                      }`}
                    >
                      {isIn ? "+" : "−"}
                      {fmtAmount(r.amount)}
                    </div>
                    <div className="v2-entry-actions">
                      <button onClick={() => onEdit(r)} type="button">
                        编辑
                      </button>
                      <button
                        className="danger"
                        onClick={() => onDelete(r)}
                        type="button"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

/* =================================================================
   Stats page
================================================================= */
function BreakdownBars({
  items,
  total,
  emptyText,
}: {
  items: BreakdownItem[];
  total: number;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <div className="v2-empty">{emptyText}</div>;
  }
  return (
    <>
      {items.map((c) => {
        const pct = (c.amount / total) * 100;
        return (
          <div key={c.id} className="v2-stats-bar">
            <div className="v2-stats-bar-head">
              <span>
                <CatGlyph shape={c.shape} color={c.swatch} size={10} />
                {c.name}
              </span>
              <span className="mono">{fmtMoney(c.amount, 0)}</span>
            </div>
            <div className="v2-stats-bar-track">
              <div
                className="v2-stats-bar-fill"
                style={{ width: `${pct}%`, background: c.swatch }}
              />
              <span className="mono v2-stats-pct">{pct.toFixed(1)}%</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

function StatsPage({
  records,
  stats,
  categories,
}: {
  records: RecordItem[];
  stats: Stats;
  categories: Category[];
}) {
  const catsById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const expenseBreakdown = useMemo(
    () => categoryBreakdown(categories, stats.byCat, "expense"),
    [categories, stats.byCat],
  );
  const incomeBreakdown = useMemo(
    () => categoryBreakdown(categories, stats.byCat, "income"),
    [categories, stats.byCat],
  );
  const expenseCats = expenseBreakdown.items;
  const incomeCats = incomeBreakdown.items;
  const totalExp = expenseBreakdown.total;
  const totalInc = incomeBreakdown.total;

  const currentMonthKey = monthKey(new Date());
  const monthSeq = useMemo(
    () => buildMonthSeq(records, new Date(currentMonthKey + "-01")),
    [records, currentMonthKey],
  );
  const monthSeries = useMemo(
    () =>
      monthSeq.map((m) => ({
        m,
        income: stats.byMonth[m]?.income ?? 0,
        expense: stats.byMonth[m]?.expense ?? 0,
      })),
    [monthSeq, stats.byMonth],
  );
  const { maxM, maxNet } = useMemo(() => {
    let max = 1;
    let netMax = 1;
    for (const s of monthSeries) {
      if (s.income > max) max = s.income;
      if (s.expense > max) max = s.expense;
      const absNet = Math.abs(s.income - s.expense);
      if (absNet > netMax) netMax = absNet;
    }
    return { maxM: max, maxNet: netMax };
  }, [monthSeries]);

  const yNet = (net: number) =>
    net >= 0 ? 200 - (net / maxNet) * 120 : 200 + (-net / maxNet) * 70;

  const incomeStats = useMemo(() => {
    let max: RecordItem | null = null;
    let total = 0;
    let count = 0;
    for (const r of records) {
      if (catsById.get(r.catId)?.type !== "income") continue;
      total += r.amount;
      count += 1;
      if (!max || r.amount > max.amount) max = r;
    }
    return { max, mean: count === 0 ? 0 : total / count };
  }, [records, catsById]);

  const { dow, maxDow, peakDow } = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0, 0, 0];
    for (const r of records) {
      if (catsById.get(r.catId)?.type === "expense") {
        buckets[new Date(r.date).getDay()] += r.amount;
      }
    }
    let max = 1;
    let peak = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i] > max) max = buckets[i];
      if (buckets[i] > buckets[peak]) peak = i;
    }
    return { dow: buckets, maxDow: max, peakDow: peak };
  }, [records, catsById]);

  const savingRate = stats.income > 0 ? (stats.balance / stats.income) * 100 : 0;
  const ratio = stats.expense > 0 ? stats.income / stats.expense : 0;

  return (
    <>
      <div className="v2-greet" style={{ paddingBottom: 20 }}>
        <div className="v2-greet-l">
          <div className="v2-greet-time mono">STATS · 统 计 报 告</div>
          <div className="v2-greet-hi" style={{ fontSize: 36 }}>
            财 务 体 检 ·
            <span className="v2-greet-name"> {monthSeq[5].slice(5)} 月</span>
          </div>
          <div className="v2-greet-sub">六个月趋势 · 分类构成 · 周内分布</div>
        </div>
        <div className="v2-greet-r">
          <div className="v2-greet-stat">
            <div className="mono">储蓄率</div>
            <div className="v2-greet-num positive">
              {Math.round(savingRate)}%
            </div>
          </div>
          <div className="v2-greet-stat">
            <div className="mono">收支比</div>
            <div className="v2-greet-num">{ratio.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="v2-body single">
        <main className="v2-main">
          {/* Trend chart */}
          <section className="v2-chart-card">
            <div className="v2-card-head">
              <div>
                <h3>六 个 月 收 支 走 势</h3>
                <div className="mono">
                  {monthSeq[0]} → {monthSeq[5]} · MoM
                </div>
              </div>
              <div className="v2-legend">
                <span>
                  <span className="dot income" /> 收入
                </span>
                <span>
                  <span className="dot expense" /> 支出
                </span>
                <span style={{ marginLeft: 12, color: "var(--v2-terra-deep)" }}>
                  ━ 净结余 · 上正下负
                </span>
              </div>
            </div>
            <div className="v2-stats-trend">
              <svg
                viewBox="0 0 800 290"
                preserveAspectRatio="none"
                style={{ width: "100%", height: 290 }}
              >
                {/* Above-baseline grid (bar area) */}
                {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
                  <line
                    key={i}
                    x1="40"
                    x2="800"
                    y1={20 + p * 180}
                    y2={20 + p * 180}
                    stroke="#C9B690"
                    strokeDasharray="3 4"
                    strokeWidth="0.5"
                  />
                ))}
                {/* Zero baseline */}
                <line
                  x1="40"
                  x2="800"
                  y1="200"
                  y2="200"
                  stroke="#7C3A0E"
                  strokeWidth="1"
                  opacity="0.35"
                />
                {/* Below-baseline grid (negative net area) */}
                <line
                  x1="40"
                  x2="800"
                  y1="245"
                  y2="245"
                  stroke="#C9B690"
                  strokeDasharray="3 4"
                  strokeWidth="0.5"
                />
                {monthSeries.map((s, i) => {
                  const x = 80 + i * 130;
                  const incH = (s.income / maxM) * 180;
                  const expH = (s.expense / maxM) * 180;
                  const incRatio = s.income / maxM;
                  const expRatio = s.expense / maxM;
                  return (
                    <g key={s.m}>
                      <rect
                        x={x - 22}
                        y={200 - incH}
                        width="20"
                        height={incH}
                        fill="#5C7C2C"
                      />
                      <rect
                        x={x + 2}
                        y={200 - expH}
                        width="20"
                        height={expH}
                        fill="#B5532A"
                      />
                      {incRatio > 0.04 && (
                        <text
                          x={x - 12}
                          y={200 - incH - 6}
                          fontSize="10"
                          fill="#5C7C2C"
                          textAnchor="middle"
                          fontFamily="JetBrains Mono"
                        >
                          {fmtCompact(s.income)}
                        </text>
                      )}
                      {expRatio > 0.04 && (
                        <text
                          x={x + 12}
                          y={200 - expH - 6}
                          fontSize="10"
                          fill="#B5532A"
                          textAnchor="middle"
                          fontFamily="JetBrains Mono"
                        >
                          {fmtCompact(s.expense)}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* Net line — signed: positive goes up, negative goes down */}
                <path
                  d={monthSeries
                    .map((s, i) => {
                      const x = 80 + i * 130;
                      const y = yNet(s.income - s.expense);
                      return `${i === 0 ? "M" : "L"}${x},${y}`;
                    })
                    .join(" ")}
                  fill="none"
                  stroke="#7C3A0E"
                  strokeWidth="2"
                />
                {monthSeries.map((s, i) => {
                  const x = 80 + i * 130;
                  const net = s.income - s.expense;
                  const y = yNet(net);
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r="4"
                      fill={netColor(net)}
                      stroke="#7C3A0E"
                      strokeWidth="2"
                    >
                      <title>
                        {s.m} 净结余 {net >= 0 ? "+" : "−"}
                        {fmtCompact(Math.abs(net))}
                      </title>
                    </circle>
                  );
                })}
                {/* Month labels — at the bottom, below negative-net area */}
                {monthSeries.map((s, i) => {
                  const x = 80 + i * 130;
                  return (
                    <text
                      key={s.m}
                      x={x}
                      y="282"
                      fontSize="11"
                      fill="#5C4A33"
                      textAnchor="middle"
                      fontFamily="JetBrains Mono"
                    >
                      {s.m.slice(5)}月
                    </text>
                  );
                })}
              </svg>
            </div>
          </section>

          {/* Two columns */}
          <section className="v2-charts even">
            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>支 出 构 成</h3>
                  <div className="mono">
                    EXPENSE · {expenseCats.length} 类
                  </div>
                </div>
              </div>
              <div className="v2-stats-bars">
                <BreakdownBars
                  items={expenseCats}
                  total={totalExp}
                  emptyText="暂无支出数据"
                />
              </div>
            </div>

            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>收 入 构 成</h3>
                  <div className="mono">INCOME · {incomeCats.length} 类</div>
                </div>
              </div>
              <div className="v2-stats-bars">
                <BreakdownBars
                  items={incomeCats}
                  total={totalInc}
                  emptyText="暂无收入数据"
                />
              </div>
              {incomeCats.length > 0 && (
                <div className="v2-stats-side">
                  <div className="v2-stats-side-row">
                    <span className="mono">最大单笔收入</span>
                    <span>
                      {incomeStats.max
                        ? `${catsById.get(incomeStats.max.catId)?.name ?? "未分类"} · ${fmtMoney(incomeStats.max.amount, 0)}`
                        : "—"}
                    </span>
                  </div>
                  <div className="v2-stats-side-row">
                    <span className="mono">平均单笔收入</span>
                    <span>{fmtMoney(incomeStats.mean, 0)}</span>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Day of week */}
          <section className="v2-chart-card">
            <div className="v2-card-head">
              <div>
                <h3>周 内 支 出 分 布</h3>
                <div className="mono">BY DAY OF WEEK</div>
              </div>
              <div className="mono">周{DOW_LABEL[peakDow]} 支出最高</div>
            </div>
            <div className="v2-dow">
              {dow.map((v, i) => {
                const h = (v / maxDow) * 140;
                return (
                  <div key={i} className="v2-dow-col">
                    <div className="v2-dow-bar-wrap">
                      <span className="mono v2-dow-amt">
                        {fmtMoney(v, 0)}
                      </span>
                      <div className="v2-dow-bar" style={{ height: h }} />
                    </div>
                    <div className="v2-dow-label">周 {DOW_LABEL[i]}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

/* =================================================================
   Categories page
================================================================= */
function CategoriesPage({
  categories,
  stats,
  records,
  onAdd,
  onDelete,
}: {
  categories: Category[];
  stats: Stats;
  records: RecordItem[];
  onAdd: (c: Omit<Category, "id">) => void;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState<CategoryForm>({
    name: "",
    type: "expense",
    shape: "square",
    swatch: PALETTE[0],
  });

  const { exp, inc, countByCat } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of records) {
      counts[r.catId] = (counts[r.catId] || 0) + 1;
    }
    const expense: Category[] = [];
    const income: Category[] = [];
    for (const c of categories) {
      (c.type === "expense" ? expense : income).push(c);
    }
    return { exp: expense, inc: income, countByCat: counts };
  }, [categories, records]);

  function submit() {
    if (!form.name.trim()) return;
    onAdd({
      name: form.name,
      type: form.type,
      shape: form.shape,
      swatch: form.swatch,
    });
    setForm({
      name: "",
      type: form.type,
      shape: "square",
      swatch: PALETTE[0],
    });
  }

  return (
    <>
      <div className="v2-greet" style={{ paddingBottom: 20 }}>
        <div className="v2-greet-l">
          <div className="v2-greet-time mono">CATEGORIES · 分 类 管 理</div>
          <div className="v2-greet-hi" style={{ fontSize: 36 }}>
            账 目 类 别 ·
            <span className="v2-greet-name"> {categories.length} 类</span>
          </div>
          <div className="v2-greet-sub">用色块/形状区分类别 · 自定义无上限</div>
        </div>
        <div className="v2-greet-r">
          <button className="v2-btn-primary" type="button" onClick={submit}>
            + 新增分类
          </button>
        </div>
      </div>

      <div className="v2-body single">
        <main className="v2-main">
          {/* Form */}
          <section className="v2-chart-card">
            <div className="v2-card-head">
              <div>
                <h3>新 增 分 类</h3>
                <div className="mono">CREATE CATEGORY</div>
              </div>
            </div>
            <div className="v2-cat-form">
              <div className="v2-cat-form-field">
                <label>类型</label>
                <div className="v2-cat-type">
                  <button
                    type="button"
                    className={
                      form.type === "expense" ? "active expense" : ""
                    }
                    onClick={() =>
                      setForm((f) => ({ ...f, type: "expense" }))
                    }
                  >
                    支出
                  </button>
                  <button
                    type="button"
                    className={form.type === "income" ? "active income" : ""}
                    onClick={() =>
                      setForm((f) => ({ ...f, type: "income" }))
                    }
                  >
                    收入
                  </button>
                </div>
              </div>
              <div className="v2-cat-form-field">
                <label>名称</label>
                <input
                  className="v2-cat-input"
                  placeholder="例如：办公用品"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </div>
              <div className="v2-cat-form-field">
                <label>形状</label>
                <div className="v2-cat-shapes">
                  {SHAPES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={form.shape === s ? "active" : ""}
                      onClick={() => setForm((f) => ({ ...f, shape: s }))}
                    >
                      <CatGlyph shape={s} color={form.swatch} size={14} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="v2-cat-form-field">
                <label>颜色</label>
                <div className="v2-cat-colors">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`v2-color-sw ${
                        form.swatch === c ? "active" : ""
                      }`}
                      style={{ background: c }}
                      onClick={() => setForm((f) => ({ ...f, swatch: c }))}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="v2-btn-primary v2-cat-submit"
                onClick={submit}
              >
                保 存 分 类
              </button>
            </div>
          </section>

          {/* Lists */}
          <section className="v2-charts even">
            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>支 出 分 类</h3>
                  <div className="mono">{exp.length} 类</div>
                </div>
              </div>
              <CategoryList
                cats={exp}
                stats={stats}
                countByCat={countByCat}
                onDelete={onDelete}
              />
            </div>
            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>收 入 分 类</h3>
                  <div className="mono">{inc.length} 类</div>
                </div>
              </div>
              <CategoryList
                cats={inc}
                stats={stats}
                countByCat={countByCat}
                onDelete={onDelete}
              />
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

function CategoryList({
  cats,
  stats,
  countByCat,
  onDelete,
}: {
  cats: Category[];
  stats: Stats;
  countByCat: Record<string, number>;
  onDelete: (id: string) => void;
}) {
  if (cats.length === 0)
    return <div className="v2-empty">暂无分类</div>;
  return (
    <div className="v2-cat-list-2">
      {cats.map((c) => {
        const amount = stats.byCat[c.id] || 0;
        const count = countByCat[c.id] || 0;
        const isDefault = DEFAULT_CATEGORY_IDS.has(c.id);
        return (
          <div key={c.id} className="v2-cat-card">
            <div className="v2-cat-card-l">
              <CatGlyph shape={c.shape} color={c.swatch} size={20} />
              <div>
                <div className="v2-cat-card-name">
                  {c.name}
                  {isDefault && (
                    <span className="v2-cat-card-meta-tag">默认</span>
                  )}
                </div>
                <div className="v2-cat-card-meta">
                  {count} 条记录 · {fmtMoney(amount, 0)}
                </div>
              </div>
            </div>
            <div className="v2-cat-card-r">
              {!isDefault && (
                <button
                  className="v2-cat-action danger mono"
                  type="button"
                  onClick={() => onDelete(c.id)}
                >
                  删除
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* =================================================================
   Backup page
================================================================= */
function BackupPage({
  records,
  categories,
  status,
  onExport,
  onImport,
  onImportFile,
}: {
  records: RecordItem[];
  categories: Category[];
  status: BackupStatus;
  onExport: () => void;
  onImport: () => void;
  onImportFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const filename = `wangyuan-${today()}.xlsx`;
  const sizeEstimate = Math.max(8, Math.round(records.length * 0.55 + 4));

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onImportFile(file);
  }

  return (
    <>
      <div className="v2-greet" style={{ paddingBottom: 20 }}>
        <div className="v2-greet-l">
          <div className="v2-greet-time mono">BACKUP · 数 据 备 份</div>
          <div className="v2-greet-hi" style={{ fontSize: 36 }}>
            账 本 备 份 与
            <span className="v2-greet-name"> 导 入 / 导 出</span>
          </div>
          <div className="v2-greet-sub">
            数据保存于本机 · 支持 Excel xlsx 格式
          </div>
        </div>
        <div className="v2-greet-r">
          <div className="v2-greet-stat">
            <div className="mono">本机总记录</div>
            <div className="v2-greet-num">{records.length} 笔</div>
          </div>
        </div>
      </div>

      <div className="v2-body two">
        <section className="v2-backup-card export">
          <div className="v2-backup-tag mono">EXPORT</div>
          <h3 className="v2-backup-h">导 出 Excel</h3>
          <p className="v2-backup-desc">
            将所有账目记录、分类、汇总导出为 .xlsx 文件，三个工作表分别保存。可在 Numbers / Excel / WPS 中直接打开。
          </p>
          <div className="v2-backup-stat">
            <div>
              <div className="mono">将导出</div>
              <div className="v2-backup-num">{records.length} 条记录</div>
            </div>
            <div>
              <div className="mono">分类</div>
              <div className="v2-backup-num">{categories.length} 类</div>
            </div>
            <div>
              <div className="mono">文件大小估计</div>
              <div className="v2-backup-num">~ {sizeEstimate} KB</div>
            </div>
          </div>
          <button
            type="button"
            className="v2-btn-primary v2-backup-btn"
            onClick={onExport}
          >
            ↓ 导出 {filename}
          </button>
          {status.message && status.type !== "idle" && (
            <div className={`v2-backup-status ${status.type}`}>
              {status.message}
            </div>
          )}
        </section>

        <section className="v2-backup-card import">
          <div className="v2-backup-tag mono">IMPORT</div>
          <h3 className="v2-backup-h">导 入 Excel</h3>
          <p className="v2-backup-desc">
            从 .xlsx 文件恢复账目。系统会校验日期、金额、分类等字段，并提示是否合并或覆盖现有数据。
          </p>
          <div
            className={`v2-backup-drop ${dragging ? "dragging" : ""}`}
            onClick={onImport}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
          >
            <div className="v2-drop-icon mono">+</div>
            <div className="v2-drop-title">拖 拽 文 件 到 此</div>
            <div className="mono v2-drop-sub">或 点 击 选 择 .xlsx</div>
          </div>
          <div className="v2-backup-warn">
            <div className="v2-warn-stamp">!</div>
            <div>
              <div className="v2-warn-title">导入会覆盖当前数据</div>
              <div className="mono v2-warn-sub">
                建议先导出现有账本作为备份
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

/* =================================================================
   New record modal
================================================================= */
function NewRecordModal({
  form,
  setForm,
  categories,
  isEdit,
  onClose,
  onSave,
}: {
  form: RecordForm;
  setForm: React.Dispatch<React.SetStateAction<RecordForm>>;
  categories: Category[];
  isEdit: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const cats = categories.filter((c) => c.type === form.type);

  function setType(t: CategoryType) {
    const first = categories.find((c) => c.type === t);
    setForm((f) => ({ ...f, type: t, catId: first?.id ?? f.catId }));
  }

  function pad(k: string) {
    setForm((f) => {
      let v = f.amount;
      if (k === "⌫") {
        v = v.slice(0, -1);
      } else if (k === ".") {
        if (!v.includes(".")) v = (v || "0") + ".";
      } else {
        v = (v + k).replace(/^0(\d)/, "$1");
      }
      return { ...f, amount: v };
    });
  }

  const recordNo = useMemo(
    () => `${form.date}-${String(Math.floor(Math.random() * 900) + 100)}`,
    [form.date],
  );

  return (
    <div className="v2-modal-stage" role="dialog" aria-modal="true">
      <div className="v2-modal-bg" onClick={onClose} />
      <div className="v2-modal-card">
        <div className="v2-modal-perf top" />
        <div className="v2-modal-head">
          <div>
            <div className="mono">
              {isEdit ? "EDIT ENTRY" : "NEW ENTRY"} · No. {recordNo}
            </div>
            <h2 className="v2-modal-h">{isEdit ? "编 辑 记 录" : "新 增 记 录"}</h2>
          </div>
          <button
            type="button"
            className="v2-modal-x"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="v2-modal-tabs">
          <button
            type="button"
            className={form.type === "expense" ? "active expense" : ""}
            onClick={() => setType("expense")}
          >
            支 出
          </button>
          <button
            type="button"
            className={form.type === "income" ? "active income" : ""}
            onClick={() => setType("income")}
          >
            收 入
          </button>
        </div>

        <div className="v2-modal-amount">
          <span className="v2-modal-cur">¥</span>
          <input
            className="v2-modal-input"
            value={form.amount}
            placeholder="0.00"
            onChange={(e) =>
              setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") }))
            }
            inputMode="decimal"
          />
          <div className="v2-modal-pad">
            {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"].map(
              (k) => (
                <button
                  key={k}
                  type="button"
                  className="v2-pad-key"
                  onClick={() => pad(k)}
                >
                  {k}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="v2-modal-section">
          <div className="v2-modal-label">分 类</div>
          <div className="v2-modal-cats">
            {cats.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`v2-modal-cat ${form.catId === c.id ? "active" : ""}`}
                onClick={() => setForm((f) => ({ ...f, catId: c.id }))}
              >
                <CatGlyph shape={c.shape} color={c.swatch} size={14} />
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="v2-modal-row">
          <div className="v2-modal-section">
            <div className="v2-modal-label">日 期</div>
            <div className="v2-modal-date">
              <input
                type="date"
                value={form.date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date: e.target.value }))
                }
              />
              <span className="mono">周{weekdayCN(form.date)}</span>
            </div>
          </div>
          <div className="v2-modal-section">
            <div className="v2-modal-label">备 注</div>
            <input
              className="v2-modal-note"
              placeholder="可选 — 例如：嘉实多 95#"
              value={form.note}
              onChange={(e) =>
                setForm((f) => ({ ...f, note: e.target.value }))
              }
            />
          </div>
        </div>

        <div className="v2-modal-rule" />

        <div className="v2-modal-footer">
          <button type="button" className="v2-btn-ghost mono" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="v2-btn-primary"
            onClick={onSave}
            disabled={!form.amount || Number(form.amount) <= 0 || !form.catId}
          >
            {isEdit ? "保 存 修 改" : "保 存 记 录 · ⏎"}
          </button>
        </div>
        <div className="v2-modal-perf bottom" />
      </div>
    </div>
  );
}

/* =================================================================
   Delete confirm modal
================================================================= */
function DeleteConfirmModal({
  record,
  category,
  onCancel,
  onConfirm,
}: {
  record: RecordItem;
  category: Category;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="v2-modal-stage" role="dialog" aria-modal="true">
      <div className="v2-modal-bg" onClick={onCancel} />
      <div className="v2-modal-card v2-confirm-card">
        <div className="v2-modal-perf top" />
        <div className="v2-modal-head">
          <div>
            <div className="mono">CONFIRM DELETE · No. {record.id}</div>
            <h2 className="v2-modal-h">确 认 删 除</h2>
          </div>
          <button
            type="button"
            className="v2-modal-x"
            onClick={onCancel}
            aria-label="取消"
          >
            ×
          </button>
        </div>

        <p
          style={{
            margin: "16px 0 0",
            fontSize: 13,
            color: "var(--v2-ink-soft)",
            lineHeight: 1.7,
          }}
        >
          删除后会立即从本地数据中移除，无法在应用内撤回。
        </p>

        <dl className="v2-confirm-list">
          <dt>分 类</dt>
          <dd>
            <CatGlyph
              shape={category.shape}
              color={category.swatch}
              size={10}
            />{" "}
            {category.name}
          </dd>
          <dt>金 额</dt>
          <dd className="mono">{fmtMoney(record.amount)}</dd>
          <dt>日 期</dt>
          <dd className="mono">
            {record.date} 周{weekdayCN(record.date)}
          </dd>
          {record.note && (
            <>
              <dt>备 注</dt>
              <dd>{record.note}</dd>
            </>
          )}
        </dl>

        <div className="v2-modal-footer">
          <button type="button" className="v2-btn-ghost mono" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="v2-btn-primary" onClick={onConfirm}>
            确 认 删 除
          </button>
        </div>
        <div className="v2-modal-perf bottom" />
      </div>
    </div>
  );
}

export default App;
