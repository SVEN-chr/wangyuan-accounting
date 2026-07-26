// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyLedgerCommand,
  type Ledger,
  type LedgerCommand,
  type LedgerCommandResult,
} from "../../ledgerCommands";
import { createLedgerQuery } from "../../ledgerQueries";
import { CategoriesFeature } from "./CategoriesFeature";

function CategoriesFeatureHarness({ initialLedger }: { initialLedger: Ledger }) {
  const [ledger, setLedger] = useState(initialLedger);
  const query = useMemo(() => createLedgerQuery(ledger), [ledger]);

  function dispatch(command: LedgerCommand): LedgerCommandResult {
    const result = applyLedgerCommand(ledger, command);
    if (result.ok) setLedger(result.ledger);
    return result;
  }

  return <CategoriesFeature query={query} dispatch={dispatch} />;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CategoriesFeature", () => {
  it("按收支类型分组展示分类及其关联账目数量", () => {
    render(
      <CategoriesFeatureHarness
        initialLedger={{
          records: [
            {
              id: 1,
              catId: "custom-rare-books",
              amount: 36,
              date: "2026-07-18",
            },
            {
              id: 2,
              catId: "sell-book",
              amount: 200,
              date: "2026-07-18",
            },
          ],
          categories: [
            {
              id: "custom-rare-books",
              name: "古籍",
              type: "expense",
              shape: "diamond",
              swatch: "#123456",
            },
            {
              id: "sell-book",
              name: "卖书",
              type: "income",
              shape: "circle",
              swatch: "#3F6212",
            },
          ],
          openingBalance: 0,
        }}
      />,
    );

    const expenseSection = screen
      .getByRole("heading", { name: "支 出 分 类" })
      .closest(".v2-chart-card");
    const incomeSection = screen
      .getByRole("heading", { name: "收 入 分 类" })
      .closest(".v2-chart-card");
    expect(expenseSection).not.toBeNull();
    expect(incomeSection).not.toBeNull();
    expect(within(expenseSection as HTMLElement).getByText("古籍")).toBeTruthy();
    expect(
      within(expenseSection as HTMLElement).getByText("1 条记录 · ¥36"),
    ).toBeTruthy();
    expect(within(expenseSection as HTMLElement).queryByText("卖书")).toBeNull();
    expect(within(incomeSection as HTMLElement).getByText("卖书")).toBeTruthy();
    expect(
      within(incomeSection as HTMLElement).getByText("1 条记录 · ¥200"),
    ).toBeTruthy();
    expect(within(incomeSection as HTMLElement).queryByText("古籍")).toBeNull();
  });

  it("拒绝同类型同名分类并允许收入与支出分类同名", () => {
    render(
      <CategoriesFeatureHarness
        initialLedger={{
          records: [],
          categories: [
            {
              id: "custom-expense-books",
              name: "古籍",
              type: "expense",
              shape: "diamond",
              swatch: "#123456",
            },
          ],
          openingBalance: 0,
        }}
      />,
    );

    const nameInput = screen.getByPlaceholderText("例如：办公用品");
    fireEvent.change(nameInput, { target: { value: " 古籍 " } });
    fireEvent.click(screen.getByRole("button", { name: "保 存 分 类" }));

    expect(screen.getAllByText("古籍")).toHaveLength(1);
    expect((nameInput as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "收入" }));
    fireEvent.change(nameInput, { target: { value: "古籍" } });
    fireEvent.click(screen.getByRole("button", { name: "保 存 分 类" }));

    expect(screen.getAllByText("古籍")).toHaveLength(2);
  });

  it("默认分类不可删除且自定义分类删除前展示级联影响", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    render(
      <CategoriesFeatureHarness
        initialLedger={{
          records: [
            {
              id: 1,
              catId: "custom-rare-books",
              amount: 36,
              date: "2026-07-18",
            },
          ],
          categories: [
            {
              id: "rent",
              name: "房租",
              type: "expense",
              shape: "square",
              swatch: "#C2410C",
            },
            {
              id: "custom-rare-books",
              name: "古籍",
              type: "expense",
              shape: "diamond",
              swatch: "#123456",
            },
          ],
          openingBalance: 0,
        }}
      />,
    );

    const defaultCard = screen.getByText("房租").closest(".v2-cat-card");
    const customCard = screen.getByText("古籍").closest(".v2-cat-card");
    expect(defaultCard).not.toBeNull();
    expect(customCard).not.toBeNull();
    expect(
      within(defaultCard as HTMLElement).queryByRole("button", {
        name: "删除",
      }),
    ).toBeNull();

    fireEvent.click(
      within(customCard as HTMLElement).getByRole("button", { name: "删除" }),
    );
    expect(confirm).toHaveBeenCalledWith(
      "删除分类「古籍」会同时永久删除 1 条关联账目。此操作无法撤销，确认继续吗？",
    );
    expect(screen.getByText("古籍")).toBeTruthy();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(
      within(customCard as HTMLElement).getByRole("button", { name: "删除" }),
    );
    expect(screen.queryByText("古籍")).toBeNull();
  });
});
