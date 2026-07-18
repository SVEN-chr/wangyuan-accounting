// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {
    throw new Error("browser mode");
  }),
  isTauri: () => false,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.1.7"),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: vi.fn(async () => undefined),
    onCloseRequested: vi.fn(async () => () => undefined),
  }),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(async () => null),
}));

const FALLBACK_STORAGE_KEY = "accounting.file-store-fallback";
const FIRST_RUN_KEY = "accounting.first-run-seeded";

const categories = [
  {
    id: "expense-books",
    name: "购书",
    type: "expense",
    shape: "square",
    swatch: "#B95C3A",
  },
  {
    id: "income-books",
    name: "售书",
    type: "income",
    shape: "circle",
    swatch: "#7A8060",
  },
];

function seedLedger(records: Array<Record<string, unknown>> = []) {
  window.localStorage.setItem(
    FALLBACK_STORAGE_KEY,
    JSON.stringify({ records, categories, openingBalance: 500 }),
  );
  window.localStorage.setItem(FIRST_RUN_KEY, "1");
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 18, 12, 0, 0));
  window.localStorage.clear();
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("账房用户行为基线", () => {
  it("今天的统计使用本地日期且不包含未来账目", async () => {
    seedLedger([
      {
        id: 1,
        catId: "expense-books",
        amount: 100,
        date: "2026-07-18",
        note: "基线购书",
      },
      {
        id: 2,
        catId: "income-books",
        amount: 250,
        date: "2026-07-18",
        note: "基线售书",
      },
      {
        id: 3,
        catId: "income-books",
        amount: 999,
        date: "2026-07-19",
        note: "未来售书",
      },
    ]);

    render(<App />);

    await screen.findByText("基线购书");
    expect(screen.getByText(/今日已记 2 笔/)).toBeTruthy();
    expect(within(screen.getByText("今日支出").parentElement!).getByText("¥100.00")).toBeTruthy();
    expect(within(screen.getByText("本周净流入").parentElement!).getByText("+¥150")).toBeTruthy();
  });

  it("用户可以新增并删除一笔账目", async () => {
    seedLedger();
    render(<App />);

    await screen.findByText("暂无记录");
    fireEvent.click(screen.getByRole("button", { name: "+ 记一笔" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("0.00"), {
      target: { value: "88.5" },
    });
    fireEvent.change(within(dialog).getByPlaceholderText(/可选/), {
      target: { value: "基线新增" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /保 存 记 录/ }));

    const note = await screen.findByText("基线新增");
    const entry = note.closest(".v2-entry");
    expect(entry).not.toBeNull();
    expect(within(entry as HTMLElement).getByText("−88.50")).toBeTruthy();

    fireEvent.click(within(entry as HTMLElement).getByRole("button", { name: "删除" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确 认 删 除" }));

    await waitFor(() => expect(screen.queryByText("基线新增")).toBeNull());
  });

  it("用户可以导入缺少类型列的中文旧表头工作簿", async () => {
    seedLedger();
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
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const file = new File([bytes], "legacy.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);
    await screen.findByText("暂无记录");
    fireEvent.click(screen.getByRole("button", { name: "备份" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    await screen.findByText("已导入 1 条记录、1 个分类");
    fireEvent.click(screen.getByRole("button", { name: "账目" }));
    const note = await screen.findByText("旧表头导入");
    const entry = note.closest(".v2-entry");
    expect(entry).not.toBeNull();
    expect(within(entry as HTMLElement).getByText("−66.00")).toBeTruthy();
  });
});
