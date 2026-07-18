import type {
  Category,
  CategoryType,
  Ledger,
  LedgerEntry,
} from "./ledgerCommands";
import {
  addDaysKey,
  formatCompactAmount,
  monthKey,
  parseDateKey,
} from "./ledgerFormat";

const UNKNOWN_CATEGORY: Category = {
  id: "unknown",
  name: "未分类",
  type: "expense",
  shape: "square",
  swatch: "#999",
};

export type LedgerStats = {
  income: number;
  expense: number;
  balance: number;
  byCat: Record<string, number>;
  byDay: Record<string, number>;
  byMonth: Record<string, { income: number; expense: number }>;
};

export type MonthSeriesItem = {
  key: string;
  income: number;
  expense: number;
};

export type LedgerOverview = {
  today: { expense: number; entryCount: number };
  weekNet: number;
  entryCounts: { income: number; expense: number };
  currentMonth: {
    income: number;
    expense: number;
    net: number;
    balanceWithOpening: number;
  };
  monthOverMonthPercent: number | null;
  monthSeries: MonthSeriesItem[];
  maxMonthValue: number;
  trendNote: string;
};

export type BreakdownItem = Category & { amount: number };

export type LedgerStatistics = {
  breakdowns: Record<
    CategoryType,
    { items: BreakdownItem[]; total: number }
  >;
  monthSeries: MonthSeriesItem[];
  maxMonthValue: number;
  maxNet: number;
  income: { maxEntry: LedgerEntry | null; mean: number };
  expenseByWeekday: {
    values: number[];
    max: number;
    peakIndex: number;
  };
  savingRate: number;
  incomeExpenseRatio: number;
};

export type LedgerEntryFilter = "all" | "expense" | "income" | "month";

export type CategorySummary = {
  expense: Category[];
  income: Category[];
  entryCountByCategory: Record<string, number>;
};

export type LedgerQuery = {
  readonly ledger: Ledger;
  readonly stats: LedgerStats;
  category(id: string): Category;
  entries(filter: LedgerEntryFilter, referenceMonth: string): LedgerEntry[];
  entriesOnDay(day: string): LedgerEntry[];
  categorySummary(): CategorySummary;
  categoryDeletionImpact(
    id: string,
  ): { categoryName: string; affectedEntries: number } | null;
  breakdown(
    type: CategoryType,
  ): { items: BreakdownItem[]; total: number };
  dateBounds(referenceDay: string): { min: string; max: string };
  heatmap(
    endDay: string,
    windowDays: number,
  ): { days: Array<{ date: string; value: number }>; max: number };
  ledgerOverview(referenceDay: string): LedgerOverview;
  statistics(referenceDay: string): LedgerStatistics;
};

function offsetMonthKey(key: string, offset: number): string {
  const [year, month] = key.split("-").map(Number);
  return monthKey(new Date(year, month - 1 + offset, 1));
}

function buildMonthSequence(records: LedgerEntry[], anchor: string): string[] {
  let endMonth = anchor;
  for (const entry of records) {
    const entryMonth = entry.date.slice(0, 7);
    if (entryMonth && entryMonth > endMonth) endMonth = entryMonth;
  }
  return Array.from({ length: 6 }, (_, index) =>
    offsetMonthKey(endMonth, index - 5),
  );
}

function computeStats(
  records: LedgerEntry[],
  categoriesById: ReadonlyMap<string, Category>,
): LedgerStats {
  let income = 0;
  let expense = 0;
  const byCat: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const byMonth: Record<string, { income: number; expense: number }> = {};

  for (const entry of records) {
    const category = categoriesById.get(entry.catId);
    if (!category) continue;
    if (category.type === "income") income += entry.amount;
    else expense += entry.amount;
    byCat[entry.catId] = (byCat[entry.catId] ?? 0) + entry.amount;
    byDay[entry.date] =
      (byDay[entry.date] ?? 0) +
      (category.type === "expense" ? entry.amount : 0);
    const entryMonth = entry.date.slice(0, 7);
    const monthly = (byMonth[entryMonth] ??= { income: 0, expense: 0 });
    monthly[category.type] += entry.amount;
  }

  return {
    income,
    expense,
    balance: income - expense,
    byCat,
    byDay,
    byMonth,
  };
}

function buildMonthSeries(
  records: LedgerEntry[],
  stats: LedgerStats,
  referenceMonth: string,
): MonthSeriesItem[] {
  return buildMonthSequence(records, referenceMonth).map((key) => ({
    key,
    income: stats.byMonth[key]?.income ?? 0,
    expense: stats.byMonth[key]?.expense ?? 0,
  }));
}

function summarizeMonths(
  records: LedgerEntry[],
  stats: LedgerStats,
  referenceMonth: string,
): {
  series: MonthSeriesItem[];
  maxValue: number;
  maxNet: number;
} {
  const series = buildMonthSeries(records, stats, referenceMonth);
  let maxValue = 1;
  let maxNet = 1;
  for (const month of series) {
    maxValue = Math.max(maxValue, month.income, month.expense);
    maxNet = Math.max(maxNet, Math.abs(month.income - month.expense));
  }
  return { series, maxValue, maxNet };
}

function buildCategoryBreakdown(
  categories: Category[],
  byCategory: Record<string, number>,
  type: CategoryType,
): { items: BreakdownItem[]; total: number } {
  const items: BreakdownItem[] = [];
  let total = 0;
  for (const category of categories) {
    if (category.type !== type) continue;
    const amount = byCategory[category.id] ?? 0;
    if (amount <= 0) continue;
    items.push({ ...category, amount });
    total += amount;
  }
  items.sort((left, right) => right.amount - left.amount);
  return { items, total: total || 1 };
}

export function createLedgerQuery(ledger: Ledger): LedgerQuery {
  const categoriesById = new Map(
    ledger.categories.map((category) => [category.id, category]),
  );
  const stats = computeStats(ledger.records, categoriesById);
  const category = (id: string): Category =>
    categoriesById.get(id) ?? UNKNOWN_CATEGORY;
  const sortedEntries = ledger.records
    .slice()
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) || right.id - left.id,
    );
  const breakdown = (type: CategoryType) =>
    buildCategoryBreakdown(ledger.categories, stats.byCat, type);

  return {
    ledger,
    stats,
    category,
    entries(filter, referenceMonth) {
      const predicates: Record<LedgerEntryFilter, (entry: LedgerEntry) => boolean> = {
        all: () => true,
        expense: (entry) => category(entry.catId).type === "expense",
        income: (entry) => category(entry.catId).type === "income",
        month: (entry) => entry.date.startsWith(referenceMonth),
      };
      return sortedEntries.filter(predicates[filter]);
    },
    entriesOnDay(day) {
      return sortedEntries.filter((entry) => entry.date === day);
    },
    categorySummary() {
      const expense: Category[] = [];
      const income: Category[] = [];
      const entryCountByCategory: Record<string, number> = {};
      for (const entry of ledger.records) {
        entryCountByCategory[entry.catId] =
          (entryCountByCategory[entry.catId] ?? 0) + 1;
      }
      for (const ledgerCategory of ledger.categories) {
        (ledgerCategory.type === "expense" ? expense : income).push(
          ledgerCategory,
        );
      }
      return { expense, income, entryCountByCategory };
    },
    categoryDeletionImpact(id) {
      const ledgerCategory = categoriesById.get(id);
      if (!ledgerCategory) return null;
      return {
        categoryName: ledgerCategory.name,
        affectedEntries: ledger.records.filter((entry) => entry.catId === id)
          .length,
      };
    },
    breakdown,
    dateBounds(referenceDay) {
      let min = referenceDay;
      let max = referenceDay;
      for (const entry of ledger.records) {
        if (entry.date < min) min = entry.date;
        if (entry.date > max) max = entry.date;
      }
      return { min, max };
    },
    heatmap(endDay, windowDays) {
      const days: Array<{ date: string; value: number }> = [];
      let max = 1;
      for (let index = windowDays - 1; index >= 0; index -= 1) {
        const key = addDaysKey(endDay, -index);
        const value = stats.byDay[key] ?? 0;
        max = Math.max(max, value);
        days.push({ date: key, value });
      }
      return { days, max };
    },
    ledgerOverview(referenceDay) {
      const referenceMonth = referenceDay.slice(0, 7);
      const weekStart = addDaysKey(referenceDay, -6);
      let todayExpense = 0;
      let todayEntryCount = 0;
      let weekNet = 0;
      let incomeCount = 0;
      let expenseCount = 0;

      for (const entry of ledger.records) {
        const entryCategory = category(entry.catId);
        if (entryCategory.type === "income") incomeCount += 1;
        else expenseCount += 1;
        if (entry.date === referenceDay) {
          todayEntryCount += 1;
          if (entryCategory.type === "expense") todayExpense += entry.amount;
        }
        if (entry.date >= weekStart && entry.date <= referenceDay) {
          weekNet +=
            entryCategory.type === "income" ? entry.amount : -entry.amount;
        }
      }

      const current = stats.byMonth[referenceMonth] ?? {
        income: 0,
        expense: 0,
      };
      const previous = stats.byMonth[offsetMonthKey(referenceMonth, -1)] ?? {
        income: 0,
        expense: 0,
      };
      const currentNet = current.income - current.expense;
      const previousNet = previous.income - previous.expense;
      const hasPrevious = previous.income > 0 || previous.expense > 0;
      const monthSummary = summarizeMonths(
        ledger.records,
        stats,
        referenceMonth,
      );

      const previousNets: number[] = [];
      for (let offset = 1; offset <= 5; offset += 1) {
        const previousMonth = stats.byMonth[
          offsetMonthKey(referenceMonth, -offset)
        ];
        if (
          previousMonth &&
          (previousMonth.income !== 0 || previousMonth.expense !== 0)
        ) {
          previousNets.push(previousMonth.income - previousMonth.expense);
        }
      }
      let trendNote: string;
      if (current.income === 0 && current.expense === 0) {
        trendNote = "本月暂无记录 · 开始记一笔";
      } else if (previousNets.length === 0) {
        trendNote = "本月节余暂无历史可比";
      } else {
        const maxPrevious = Math.max(...previousNets);
        const minPrevious = Math.min(...previousNets);
        if (currentNet > maxPrevious) {
          trendNote = "本月节余创近半年新高";
        } else if (currentNet < minPrevious) {
          trendNote = "本月节余为近半年新低";
        } else if (currentNet >= 0) {
          trendNote = `本月节余 ${formatCompactAmount(currentNet)} · 近半年区间 ${formatCompactAmount(minPrevious)} ~ ${formatCompactAmount(maxPrevious)}`;
        } else {
          trendNote = `本月入不敷出 · 缺口 ${formatCompactAmount(Math.abs(currentNet))}`;
        }
      }

      return {
        today: { expense: todayExpense, entryCount: todayEntryCount },
        weekNet,
        entryCounts: { income: incomeCount, expense: expenseCount },
        currentMonth: {
          ...current,
          net: currentNet,
          balanceWithOpening: ledger.openingBalance + currentNet,
        },
        monthOverMonthPercent:
          hasPrevious && previousNet !== 0
            ? ((currentNet - previousNet) / Math.abs(previousNet)) * 100
            : null,
        monthSeries: monthSummary.series,
        maxMonthValue: monthSummary.maxValue,
        trendNote,
      };
    },
    statistics(referenceDay) {
      const monthSummary = summarizeMonths(
        ledger.records,
        stats,
        referenceDay.slice(0, 7),
      );

      let maxIncomeEntry: LedgerEntry | null = null;
      let incomeTotal = 0;
      let incomeCount = 0;
      const expenseByWeekday = [0, 0, 0, 0, 0, 0, 0];
      for (const entry of ledger.records) {
        const entryCategory = categoriesById.get(entry.catId);
        if (entryCategory?.type === "income") {
          incomeTotal += entry.amount;
          incomeCount += 1;
          if (!maxIncomeEntry || entry.amount > maxIncomeEntry.amount) {
            maxIncomeEntry = entry;
          }
        } else if (entryCategory?.type === "expense") {
          expenseByWeekday[parseDateKey(entry.date).getDay()] += entry.amount;
        }
      }
      let maxWeekdayExpense = 1;
      let peakWeekdayIndex = 0;
      for (let index = 0; index < expenseByWeekday.length; index += 1) {
        maxWeekdayExpense = Math.max(
          maxWeekdayExpense,
          expenseByWeekday[index],
        );
        if (
          expenseByWeekday[index] > expenseByWeekday[peakWeekdayIndex]
        ) {
          peakWeekdayIndex = index;
        }
      }

      return {
        breakdowns: {
          expense: breakdown("expense"),
          income: breakdown("income"),
        },
        monthSeries: monthSummary.series,
        maxMonthValue: monthSummary.maxValue,
        maxNet: monthSummary.maxNet,
        income: {
          maxEntry: maxIncomeEntry,
          mean: incomeCount === 0 ? 0 : incomeTotal / incomeCount,
        },
        expenseByWeekday: {
          values: expenseByWeekday,
          max: maxWeekdayExpense,
          peakIndex: peakWeekdayIndex,
        },
        savingRate:
          stats.income > 0 ? (stats.balance / stats.income) * 100 : 0,
        incomeExpenseRatio:
          stats.expense > 0 ? stats.income / stats.expense : 0,
      };
    },
  };
}
