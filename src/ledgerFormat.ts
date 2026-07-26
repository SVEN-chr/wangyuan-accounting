const DAY_OF_WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function validLocalDateKey(
  year: number,
  month: number,
  day: number,
): string {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? dateKey(date)
    : "";
}

export function addDaysKey(key: string, delta: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + delta);
  return dateKey(date);
}

export function clampDateKey(key: string, min: string, max: string): string {
  return key < min ? min : key > max ? max : key;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function weekdayCN(date: Date | string): string {
  const localDate = typeof date === "string" ? parseDateKey(date) : date;
  return DAY_OF_WEEK_LABELS[localDate.getDay()];
}

export function formatAmount(value: number, decimals = 2): string {
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatMoney(value: number, decimals = 2): string {
  return `¥${formatAmount(value, decimals)}`;
}

export function splitMoney(value: number): [string, string] {
  const sign = value < 0 ? "-" : "";
  const [integer, decimals] = Math.abs(value).toFixed(2).split(".");
  return [
    `${sign}${Number(integer).toLocaleString("zh-CN")}`,
    `.${decimals}`,
  ];
}

export function formatCompactAmount(value: number): string {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (absolute >= 999_950) {
    return `${sign}${(absolute / 1_000_000).toFixed(1)}M`;
  }
  if (absolute >= 1_000) {
    return `${sign}${(absolute / 1_000).toFixed(1)}K`;
  }
  return `${sign}${absolute.toFixed(0)}`;
}
