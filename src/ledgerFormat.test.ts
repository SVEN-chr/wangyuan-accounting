import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDaysKey,
  dateKey,
  formatAmount,
  formatCompactAmount,
  formatMoney,
  monthKey,
  parseDateKey,
  splitMoney,
  validLocalDateKey,
  weekdayCN,
} from "./ledgerFormat";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("账本日期接口", () => {
  it("按本地时区解释日期键并正确跨月移动", () => {
    vi.stubEnv("TZ", "Asia/Shanghai");
    const localDate = parseDateKey("2026-07-18");

    expect([
      localDate.getFullYear(),
      localDate.getMonth() + 1,
      localDate.getDate(),
      localDate.getHours(),
    ]).toEqual([2026, 7, 18, 0]);
    expect(dateKey(new Date("2026-07-17T16:30:00.000Z"))).toBe("2026-07-18");
    expect(dateKey(new Date(2026, 6, 18, 0, 30))).toBe("2026-07-18");
    expect(monthKey(localDate)).toBe("2026-07");
    expect(addDaysKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayCN("2026-07-18")).toBe("六");
  });

  it("拒绝会自动滚入下个月的非法日期", () => {
    expect(validLocalDateKey(2026, 2, 31)).toBe("");
    expect(validLocalDateKey(2026, 2, 28)).toBe("2026-02-28");
  });
});

describe("账本金额接口", () => {
  it("统一格式化零值、负数和紧凑大金额", () => {
    expect(formatAmount(0)).toBe("0.00");
    expect(formatMoney(12345.6)).toBe("¥12,345.60");
    expect(splitMoney(-0.5)).toEqual(["-0", ".50"]);
    expect(formatCompactAmount(999_949)).toBe("999.9K");
    expect(formatCompactAmount(999_950)).toBe("1.0M");
    expect(formatCompactAmount(-1_250)).toBe("−1.3K");
  });
});
