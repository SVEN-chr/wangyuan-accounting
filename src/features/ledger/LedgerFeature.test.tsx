// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLedgerCommand,
  type Ledger,
  type LedgerCommand,
  type LedgerCommandResult,
} from "../../ledgerCommands";
import { createLedgerQuery } from "../../ledgerQueries";
import { LedgerFeature } from "./LedgerFeature";

const categories = [
  {
    id: "expense-books",
    name: "购书",
    type: "expense" as const,
    shape: "square" as const,
    swatch: "#B95C3A",
  },
  {
    id: "income-books",
    name: "售书",
    type: "income" as const,
    shape: "circle" as const,
    swatch: "#7A8060",
  },
];

function LedgerFeatureHarness({
  initialLedger,
  canToggleActive = false,
}: {
  initialLedger: Ledger;
  canToggleActive?: boolean;
}) {
  const [ledger, setLedger] = useState(initialLedger);
  const [active, setActive] = useState(true);
  const query = useMemo(() => createLedgerQuery(ledger), [ledger]);

  function dispatch(command: LedgerCommand): LedgerCommandResult {
    const result = applyLedgerCommand(ledger, command);
    if (result.ok) setLedger(result.ledger);
    return result;
  }

  return (
    <>
      {canToggleActive && (
        <button type="button" onClick={() => setActive((value) => !value)}>
          切换页面
        </button>
      )}
      <LedgerFeature
        active={active}
        query={query}
        dispatch={dispatch}
        addOpen={false}
        onAddClose={() => undefined}
      />
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 18, 12, 0, 0));
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (handle: number) =>
    window.clearTimeout(handle),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LedgerFeature", () => {
  it("删除第二页唯一账目后安全回到仍存在的第一页", () => {
    const initialLedger: Ledger = {
      records: Array.from({ length: 13 }, (_, index) => ({
        id: index + 1,
        catId: "expense-books",
        amount: index + 1,
        date: "2026-07-18",
        note: `分页账目 ${index + 1}`,
      })),
      categories,
      openingBalance: 0,
    };
    render(<LedgerFeatureHarness initialLedger={initialLedger} />);

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("第 2 / 2 页 · 共 13 笔")).toBeTruthy();

    const lastEntry = screen.getByText("分页账目 1").closest(".v2-entry");
    expect(lastEntry).not.toBeNull();
    fireEvent.click(
      within(lastEntry as HTMLElement).getByRole("button", { name: "删除" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "确 认 删 除",
      }),
    );

    expect(screen.queryByText("分页账目 1")).toBeNull();
    expect(screen.getByText("分页账目 13")).toBeTruthy();
    expect(screen.queryByText(/第 \d+ \/ \d+ 页/)).toBeNull();
  });

  it("筛选与热力单日视图都从集中查询结果切换账目", () => {
    const initialLedger: Ledger = {
      records: [
        {
          id: 1,
          catId: "expense-books",
          amount: 80,
          date: "2026-07-18",
          note: "今日购书",
        },
        {
          id: 2,
          catId: "income-books",
          amount: 200,
          date: "2026-07-17",
          note: "昨日售书",
        },
      ],
      categories,
      openingBalance: 0,
    };
    render(<LedgerFeatureHarness initialLedger={initialLedger} />);

    fireEvent.click(screen.getByRole("button", { name: "支出" }));
    expect(screen.getByText("今日购书")).toBeTruthy();
    expect(screen.queryByText("昨日售书")).toBeNull();

    fireEvent.click(screen.getByTitle("2026-07-18 · ¥80"));
    expect(screen.getByRole("heading", { name: "当 日 账 目" })).toBeTruthy();
    expect(screen.getByText("今日购书")).toBeTruthy();
    expect(screen.queryByText("昨日售书")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "× 返回全部" }));
    expect(screen.getByRole("heading", { name: "近 期 账 目" })).toBeTruthy();
    expect(screen.getByText("今日购书")).toBeTruthy();
    expect(screen.queryByText("昨日售书")).toBeNull();
  });

  it("离开账本页面再返回时保留账目筛选", () => {
    const initialLedger: Ledger = {
      records: [
        {
          id: 1,
          catId: "expense-books",
          amount: 80,
          date: "2026-07-18",
          note: "筛选支出",
        },
        {
          id: 2,
          catId: "income-books",
          amount: 200,
          date: "2026-07-18",
          note: "筛选收入",
        },
      ],
      categories,
      openingBalance: 0,
    };
    render(
      <LedgerFeatureHarness
        initialLedger={initialLedger}
        canToggleActive
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "收入" }));
    expect(screen.getByText("筛选收入")).toBeTruthy();
    expect(screen.queryByText("筛选支出")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "切换页面" }));
    expect(screen.queryByText("筛选收入")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "切换页面" }));

    expect(screen.getByText("筛选收入")).toBeTruthy();
    expect(screen.queryByText("筛选支出")).toBeNull();
    expect(
      screen.getByRole("button", { name: "收入" }).className,
    ).toContain("active");
  });

  it("四十二日窗口能到达未来账目边界并回到今天", () => {
    const initialLedger: Ledger = {
      records: [
        {
          id: 1,
          catId: "expense-books",
          amount: 80,
          date: "2026-06-01",
          note: "历史购书",
        },
        {
          id: 2,
          catId: "income-books",
          amount: 200,
          date: "2026-09-15",
          note: "未来售书",
        },
      ],
      categories,
      openingBalance: 0,
    };
    render(<LedgerFeatureHarness initialLedger={initialLedger} />);

    const dateInput =
      document.querySelector<HTMLInputElement>(".v2-heat-date");
    expect(dateInput).not.toBeNull();
    expect(dateInput?.min).toBe("2026-06-01");
    expect(dateInput?.max).toBe("2026-09-15");
    expect(dateInput?.value).toBe("2026-07-18");

    fireEvent.click(screen.getByRole("button", { name: "下一段" }));
    expect(dateInput?.value).toBe("2026-08-29");
    fireEvent.click(screen.getByRole("button", { name: "下一段" }));
    expect(dateInput?.value).toBe("2026-09-15");
    expect(
      (screen.getByRole("button", { name: "下一段" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "回到今天" }));
    expect(dateInput?.value).toBe("2026-07-18");
  });
});
