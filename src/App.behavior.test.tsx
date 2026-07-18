// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as XLSX from "xlsx";
import App from "./App";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));
type CloseHandler = (event: { preventDefault: () => void }) => Promise<void>;
const windowMocks = vi.hoisted(() => ({
  close: vi.fn(),
  closeHandler: null as CloseHandler | null,
  onCloseRequested: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
  isTauri: tauriMocks.isTauri,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.1.7"),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: windowMocks.close,
    onCloseRequested: windowMocks.onCloseRequested,
  }),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(async () => null),
}));

const FALLBACK_STORAGE_KEY = "accounting.file-store-fallback";
const FIRST_RUN_KEY = "accounting.first-run-seeded";
const PENDING_SAVE_KEY = "accounting.pending-save";

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

function seedLedger(
  records: Array<Record<string, unknown>> = [],
  ledgerCategories: Array<Record<string, unknown>> = categories,
  openingBalance = 500,
) {
  window.localStorage.setItem(
    FALLBACK_STORAGE_KEY,
    JSON.stringify({ records, categories: ledgerCategories, openingBalance }),
  );
  window.localStorage.setItem(FIRST_RUN_KEY, "1");
}

beforeEach(() => {
  tauriMocks.invoke.mockReset();
  tauriMocks.invoke.mockRejectedValue(new Error("browser mode"));
  tauriMocks.isTauri.mockReset();
  tauriMocks.isTauri.mockReturnValue(false);
  windowMocks.close.mockReset();
  windowMocks.close.mockResolvedValue(undefined);
  windowMocks.closeHandler = null;
  windowMocks.onCloseRequested.mockReset();
  windowMocks.onCloseRequested.mockImplementation(
    async (handler: CloseHandler) => {
      windowMocks.closeHandler = handler;
      return () => undefined;
    },
  );
  vi.stubEnv("TZ", "Asia/Shanghai");
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 18, 0, 30, 0));
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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("账本用户行为基线", () => {
  it("今天的统计使用本地日期且不包含未来账目", async () => {
    expect(new Date().toISOString()).toBe("2026-07-17T16:30:00.000Z");
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
        date: "2026-08-19",
        note: "未来售书",
      },
    ]);

    render(<App />);

    await screen.findByText("基线购书");
    expect(screen.getByText(/今日已记 2 笔/)).toBeTruthy();
    expect(within(screen.getByText("今日支出").parentElement!).getByText("¥100.00")).toBeTruthy();
    expect(within(screen.getByText("本周净流入").parentElement!).getByText("+¥150")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      screen.getByText("本月结余 · NET BALANCE").closest("article")?.textContent,
    ).toContain("¥150.00");

    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    expect(screen.getByText(/07 月/, { selector: ".v2-greet-name" })).toBeTruthy();
  });

  it("用户可以新增、编辑并删除一笔账目", async () => {
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

    fireEvent.click(within(entry as HTMLElement).getByRole("button", { name: "编辑" }));
    const editDialog = screen.getByRole("dialog");
    fireEvent.change(within(editDialog).getByPlaceholderText("0.00"), {
      target: { value: "125" },
    });
    fireEvent.change(within(editDialog).getByPlaceholderText(/可选/), {
      target: { value: "基线编辑" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: /保 存 修 改/ }));

    await waitFor(() => expect(screen.queryByText("基线新增")).toBeNull());
    const editedNote = await screen.findByText("基线编辑");
    const editedEntry = editedNote.closest(".v2-entry");
    expect(editedEntry).not.toBeNull();
    expect(within(editedEntry as HTMLElement).getByText("−125.00")).toBeTruthy();

    fireEvent.click(within(editedEntry as HTMLElement).getByRole("button", { name: "删除" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确 认 删 除" }));

    await waitFor(() => expect(screen.queryByText("基线编辑")).toBeNull());
  });

  it("期初余额编辑会在关闭前同步刷新本地副本", async () => {
    seedLedger();
    render(<App />);

    await screen.findByText("暂无记录");
    fireEvent.click(screen.getByTitle("点击编辑期初余额"));
    const input = document.querySelector<HTMLInputElement>(".v2-rec-edit");
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, { target: { value: "777" } });
    fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });

    expect(
      within(screen.getByTitle("点击编辑期初余额")).getByText("777.00"),
    ).toBeTruthy();
    expect(
      JSON.parse(window.localStorage.getItem(FALLBACK_STORAGE_KEY)!).openingBalance,
    ).toBe(500);

    window.dispatchEvent(new Event("beforeunload"));
    expect(
      JSON.parse(window.localStorage.getItem(FALLBACK_STORAGE_KEY)!).openingBalance,
    ).toBe(777);
  });

  it("同名同类型分类不会重复，删除自定义分类会级联删除账目", async () => {
    const customCategory = {
      id: "custom-rare-books",
      name: "古籍",
      type: "expense",
      shape: "diamond",
      swatch: "#123456",
    };
    seedLedger(
      [
        {
          id: 10,
          catId: customCategory.id,
          amount: 36,
          date: "2026-07-18",
          note: "待级联账目",
        },
      ],
      [customCategory],
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    await screen.findByText("待级联账目");
    fireEvent.click(screen.getByRole("button", { name: "分类" }));
    fireEvent.change(screen.getByPlaceholderText("例如：办公用品"), {
      target: { value: "古籍" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保 存 分 类" }));
    expect(screen.getAllByText("古籍")).toHaveLength(1);

    const categoryCard = screen.getByText("古籍").closest(".v2-cat-card");
    expect(categoryCard).not.toBeNull();
    fireEvent.click(
      within(categoryCard as HTMLElement).getByRole("button", { name: "删除" }),
    );
    expect(confirm).toHaveBeenCalledWith(
      "删除分类「古籍」会同时永久删除 1 条关联账目。此操作无法撤销，确认继续吗？",
    );

    await waitFor(() => expect(screen.queryByText("古籍")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "账目" }));
    expect(await screen.findByText("暂无记录")).toBeTruthy();
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

  it("英文表头导入会去重同名同类型分类且保留期初余额", async () => {
    seedLedger([], categories, 888);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          id: 21,
          date: "2026-07-18",
          type: "expense",
          category: "Imported Books",
          amount: 45,
          note: "English headers",
        },
      ]),
      "Records",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        { id: "english-books", name: "Imported Books", type: "expense" },
        { id: "duplicate-books", name: "Imported Books", type: "expense" },
      ]),
      "分类",
    );
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const file = new File([bytes], "english.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);
    await screen.findByText("暂无记录");
    fireEvent.click(screen.getByRole("button", { name: "备份" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    await screen.findByText("已导入 1 条记录、1 个分类");
    fireEvent.click(screen.getByRole("button", { name: "分类" }));
    expect(screen.getAllByText("Imported Books")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "账目" }));
    expect(await screen.findByText("English headers")).toBeTruthy();
    expect(
      within(screen.getByTitle("点击编辑期初余额")).getByText("888.00"),
    ).toBeTruthy();
  });

  it("导出的三张工作表可以重新导入且不会用汇总覆盖期初余额", async () => {
    seedLedger([
      {
        id: 31,
        catId: "income-books",
        amount: 320,
        date: "2026-07-18",
        note: "往返售书",
      },
    ]);
    let exportedBytes: number[] = [];
    tauriMocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "load_accounting_store") throw new Error("browser mode");
      if (command === "save_excel_backup") {
        exportedBytes = (args as { bytes: number[] }).bytes;
        return "D:/backup/wangyuan-2026-07-18.xlsx";
      }
      throw new Error(`unexpected command: ${command}`);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    await screen.findByText("往返售书");
    fireEvent.click(screen.getByRole("button", { name: "备份" }));
    fireEvent.click(screen.getByRole("button", { name: /↓ 导出/ }));
    await screen.findByText(/已导出 1 条记录到/);

    const exportedWorkbook = XLSX.read(new Uint8Array(exportedBytes), {
      type: "array",
    });
    expect(exportedWorkbook.SheetNames).toEqual(["收支记录", "分类", "汇总"]);

    fireEvent.click(screen.getByRole("button", { name: "账目" }));
    fireEvent.click(screen.getByTitle("点击编辑期初余额"));
    const balanceInput = document.querySelector<HTMLInputElement>(".v2-rec-edit");
    fireEvent.change(balanceInput as HTMLInputElement, { target: { value: "999" } });
    fireEvent.keyDown(balanceInput as HTMLInputElement, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "备份" }));

    const roundTripFile = new File(
      [new Uint8Array(exportedBytes)],
      "round-trip.xlsx",
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    );
    const importInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(importInput as HTMLInputElement, {
      target: { files: [roundTripFile] },
    });
    await screen.findByText("已导入 1 条记录、2 个分类");

    fireEvent.click(screen.getByRole("button", { name: "账目" }));
    expect(await screen.findByText("往返售书")).toBeTruthy();
    expect(
      within(screen.getByTitle("点击编辑期初余额")).getByText("999.00"),
    ).toBeTruthy();
  });

  it("冷启动优先恢复 pending 副本并在写盘成功后清除标记", async () => {
    const diskData = {
      records: [
        {
          id: 41,
          catId: "expense-books",
          amount: 10,
          date: "2026-07-18",
          note: "磁盘旧账",
        },
      ],
      categories,
      openingBalance: 500,
    };
    const pendingData = {
      ...diskData,
      records: [
        {
          id: 42,
          catId: "expense-books",
          amount: 20,
          date: "2026-07-18",
          note: "待恢复新账",
        },
      ],
    };
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(pendingData));
    window.localStorage.setItem(PENDING_SAVE_KEY, "1");
    window.localStorage.setItem(FIRST_RUN_KEY, "1");
    let savedPayload = "";
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "load_accounting_store") return JSON.stringify(diskData);
      if (command === "save_accounting_store") {
        savedPayload = (args as { payload: string }).payload;
        return undefined;
      }
      throw new Error(`unexpected command: ${command}`);
    });

    render(<App />);

    expect(await screen.findByText("待恢复新账")).toBeTruthy();
    expect(screen.queryByText("磁盘旧账")).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    await waitFor(() => expect(savedPayload).not.toBe(""));
    expect(JSON.parse(savedPayload).records[0].note).toBe("待恢复新账");
    expect(window.localStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
  });

  it("桌面关窗会刷新尚未防抖写盘的最新编辑再关闭窗口", async () => {
    const diskData = { records: [], categories, openingBalance: 500 };
    let savedPayload = "";
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "load_accounting_store") return JSON.stringify(diskData);
      if (command === "save_accounting_store") {
        savedPayload = (args as { payload: string }).payload;
        return undefined;
      }
      throw new Error(`unexpected command: ${command}`);
    });
    render(<App />);

    await screen.findByText("暂无记录");
    await waitFor(() => expect(windowMocks.closeHandler).not.toBeNull());
    fireEvent.click(screen.getByTitle("点击编辑期初余额"));
    const balanceInput = document.querySelector<HTMLInputElement>(".v2-rec-edit");
    fireEvent.change(balanceInput as HTMLInputElement, { target: { value: "654" } });
    fireEvent.keyDown(balanceInput as HTMLInputElement, { key: "Enter" });
    expect(savedPayload).toBe("");

    const preventDefault = vi.fn();
    await windowMocks.closeHandler!({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(JSON.parse(savedPayload).openingBalance).toBe(654);
    expect(windowMocks.close).toHaveBeenCalledOnce();
  });
});
