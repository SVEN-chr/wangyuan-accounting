export type CategoryType = "expense" | "income";
export type CatShape =
  | "square"
  | "circle"
  | "diamond"
  | "triangle"
  | "halfcircle";

export const CATEGORY_SHAPES: readonly CatShape[] = [
  "square",
  "circle",
  "diamond",
  "triangle",
  "halfcircle",
];

export const CATEGORY_SWATCHES = [
  "#B5532A",
  "#7C3A0E",
  "#5C7C2C",
  "#92400E",
  "#9B2226",
  "#3D405B",
  "#264653",
  "#000000",
] as const;

export type Category = {
  id: string;
  name: string;
  type: CategoryType;
  shape: CatShape;
  swatch: string;
};

export type LedgerEntry = {
  id: number;
  catId: string;
  amount: number;
  date: string;
  note?: string;
};

export type Ledger = {
  records: LedgerEntry[];
  categories: Category[];
  openingBalance: number;
};

export const DEFAULT_OPENING_BALANCE = 0;

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "rent", name: "房租", type: "expense", swatch: "#C2410C", shape: "square" },
  { id: "fuel", name: "加油", type: "expense", swatch: "#9A3412", shape: "diamond" },
  { id: "parking", name: "停车费", type: "expense", swatch: "#B45309", shape: "circle" },
  { id: "entertainment", name: "商务招待", type: "expense", swatch: "#92400E", shape: "triangle" },
  { id: "buy-book", name: "收书", type: "expense", swatch: "#78350F", shape: "halfcircle" },
  { id: "sell-book", name: "卖书", type: "income", swatch: "#3F6212", shape: "square" },
  { id: "consult", name: "咨询费", type: "income", swatch: "#4D7C0F", shape: "circle" },
];

export const DEFAULT_CATEGORY_IDS: ReadonlySet<string> = new Set(
  DEFAULT_CATEGORIES.map((category) => category.id),
);

type EntryInput = Omit<LedgerEntry, "id">;
type CategoryInput = Omit<Category, "id">;

export type LedgerCommand =
  | {
      type: "entry.create";
      preferredId: number;
      entry: EntryInput;
    }
  | {
      type: "entry.update";
      id: number;
      entry: EntryInput;
    }
  | { type: "entry.delete"; id: number }
  | {
      type: "category.create";
      preferredId: number;
      category: CategoryInput;
    }
  | { type: "category.delete"; id: string }
  | { type: "opening-balance.set"; value: number }
  | {
      type: "import.replace";
      records: LedgerEntry[];
      categories: Category[];
    };

export type LedgerCommandErrorCode =
  | "invalid-entry"
  | "entry-not-found"
  | "category-not-found"
  | "invalid-category"
  | "duplicate-category"
  | "protected-category"
  | "invalid-opening-balance"
  | "identifier-conflict";

export type LedgerCommandResult =
  | { ok: true; ledger: Ledger }
  | {
      ok: false;
      error: { code: LedgerCommandErrorCode; message: string };
    };

function reject(
  code: LedgerCommandErrorCode,
  message: string,
): LedgerCommandResult {
  return { ok: false, error: { code, message } };
}

function categoryIdentity(category: Pick<Category, "type" | "name">): string {
  return `${category.type}:${category.name.trim()}`;
}

function normalizeEntry(entry: EntryInput): EntryInput {
  const note = entry.note?.trim();
  return {
    catId: entry.catId,
    amount: entry.amount,
    date: entry.date,
    ...(note ? { note } : {}),
  };
}

function validateEntry(
  categories: Category[],
  entry: EntryInput,
): LedgerCommandResult | null {
  if (
    !entry.catId ||
    !entry.date ||
    !Number.isFinite(entry.amount) ||
    entry.amount <= 0
  ) {
    return reject("invalid-entry", "账目必须包含分类、日期和大于零的金额");
  }
  if (!categories.some((category) => category.id === entry.catId)) {
    return reject("category-not-found", `分类 ${entry.catId} 不存在`);
  }
  return null;
}

function findAvailableEntryId(ledger: Ledger, preferredId: number): number {
  const used = new Set(ledger.records.map((entry) => entry.id));
  let id = preferredId;
  while (used.has(id)) id += 1;
  return id;
}

function findAvailableCategoryId(
  ledger: Ledger,
  preferredId: number,
): string {
  const used = new Set(ledger.categories.map((category) => category.id));
  const base = `custom-${preferredId}`;
  let id = base;
  let suffix = 1;
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
}

function validateImportedLedger(
  records: LedgerEntry[],
  categories: Category[],
): LedgerCommandResult | null {
  const categoryIds = new Set<string>();
  const categoryKeys = new Set<string>();
  for (const category of categories) {
    if (!category.name) {
      return reject("invalid-category", "分类名称不能为空");
    }
    const key = categoryIdentity(category);
    if (categoryKeys.has(key)) {
      return reject(
        "duplicate-category",
        `同一收支类型下已存在分类「${category.name}」`,
      );
    }
    if (categoryIds.has(category.id)) {
      return reject("identifier-conflict", `分类标识符 ${category.id} 重复`);
    }
    categoryKeys.add(key);
    categoryIds.add(category.id);
  }

  const recordIds = new Set<number>();
  for (const entry of records) {
    const validationError = validateEntry(categories, entry);
    if (validationError) return validationError;
    if (recordIds.has(entry.id)) {
      return reject("identifier-conflict", `账目标识符 ${entry.id} 重复`);
    }
    recordIds.add(entry.id);
  }
  return null;
}

export function applyLedgerCommand(
  ledger: Ledger,
  command: LedgerCommand,
): LedgerCommandResult {
  switch (command.type) {
    case "entry.create": {
      const validationError = validateEntry(ledger.categories, command.entry);
      if (validationError) return validationError;
      const id = findAvailableEntryId(ledger, command.preferredId);
      return {
        ok: true,
        ledger: {
          ...ledger,
          records: [
            ...ledger.records,
            { id, ...normalizeEntry(command.entry) },
          ],
        },
      };
    }
    case "entry.update": {
      if (!ledger.records.some((entry) => entry.id === command.id)) {
        return reject("entry-not-found", `账目 ${command.id} 不存在`);
      }
      const validationError = validateEntry(ledger.categories, command.entry);
      if (validationError) return validationError;
      const updated = normalizeEntry(command.entry);
      return {
        ok: true,
        ledger: {
          ...ledger,
          records: ledger.records.map((entry) =>
            entry.id === command.id ? { id: entry.id, ...updated } : entry,
          ),
        },
      };
    }
    case "entry.delete": {
      if (!ledger.records.some((entry) => entry.id === command.id)) {
        return reject("entry-not-found", `账目 ${command.id} 不存在`);
      }
      return {
        ok: true,
        ledger: {
          ...ledger,
          records: ledger.records.filter((entry) => entry.id !== command.id),
        },
      };
    }
    case "category.create": {
      const name = command.category.name.trim();
      if (!name) return reject("invalid-category", "分类名称不能为空");
      if (
        ledger.categories.some(
          (category) =>
            categoryIdentity(category) ===
            categoryIdentity({ ...command.category, name }),
        )
      ) {
        return reject(
          "duplicate-category",
          `同一收支类型下已存在分类「${name}」`,
        );
      }
      const id = findAvailableCategoryId(ledger, command.preferredId);
      return {
        ok: true,
        ledger: {
          ...ledger,
          categories: [
            ...ledger.categories,
            { ...command.category, id, name },
          ],
        },
      };
    }
    case "category.delete": {
      if (DEFAULT_CATEGORY_IDS.has(command.id)) {
        return reject("protected-category", "默认分类不能删除");
      }
      if (!ledger.categories.some((category) => category.id === command.id)) {
        return reject("category-not-found", `分类 ${command.id} 不存在`);
      }
      return {
        ok: true,
        ledger: {
          ...ledger,
          categories: ledger.categories.filter(
            (category) => category.id !== command.id,
          ),
          records: ledger.records.filter(
            (entry) => entry.catId !== command.id,
          ),
        },
      };
    }
    case "opening-balance.set":
      if (!Number.isFinite(command.value)) {
        return reject("invalid-opening-balance", "期初余额必须是有限数字");
      }
      return {
        ok: true,
        ledger: { ...ledger, openingBalance: command.value },
      };
    case "import.replace": {
      const categories =
        command.categories.length > 0
          ? command.categories.map((category) => ({
              ...category,
              name: category.name.trim(),
            }))
          : DEFAULT_CATEGORIES.map((category) => ({ ...category }));
      const validationError = validateImportedLedger(
        command.records,
        categories,
      );
      if (validationError) return validationError;
      return {
        ok: true,
        ledger: {
          records: command.records,
          categories,
          openingBalance: ledger.openingBalance,
        },
      };
    }
  }
}
