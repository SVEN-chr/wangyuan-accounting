// @vitest-environment jsdom

import { StrictMode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLedgerSession,
  type LedgerPersistenceAdapter,
} from "./ledgerSession";
import { type Ledger } from "./ledgerCommands";
import {
  useLedgerSession,
  useRuntimeLedgerSession,
} from "./useLedgerSession";

const loadedLedger: Ledger = {
  records: [],
  categories: [
    {
      id: "custom-books",
      name: "古籍",
      type: "expense",
      shape: "diamond",
      swatch: "#123456",
    },
  ],
  openingBalance: 500,
};

function SessionProbe({
  session,
}: {
  session: ReturnType<typeof createLedgerSession>;
}) {
  const { ledger, ready, saveStatus, dispatch, flush } =
    useLedgerSession(session);

  return (
    <>
      <output aria-label="账本状态">
        {ready ? `${ledger.openingBalance}:${saveStatus.type}` : "加载中"}
      </output>
      <button
        type="button"
        onClick={() =>
          dispatch({ type: "opening-balance.set", value: 777 })
        }
      >
        修改期初余额
      </button>
      <button type="button" onClick={() => void flush()}>
        刷新
      </button>
    </>
  );
}

function RuntimeSessionProbe() {
  const { ledger, ready } = useRuntimeLedgerSession({
    seedRecords: [
      {
        id: 101,
        catId: "buy-book",
        amount: 88,
        date: "2026-07-18",
        note: "首次样例",
      },
    ],
  });

  return (
    <output aria-label="运行时账本">
      {ready ? ledger.records[0]?.note : "加载中"}
    </output>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("React 账本会话", () => {
  it("只通过公开会话接口获得账本、派发、就绪、保存状态和刷新", async () => {
    const saved: Ledger[] = [];
    const adapter: LedgerPersistenceAdapter = {
      load: async () => ({
        data: loadedLedger,
        storeExists: true,
        recoveredPending: false,
      }),
      save: async (ledger) => {
        saved.push(ledger);
        return { ok: true };
      },
      finalizeSuccessfulSave: () => ({ ok: true }),
      storeRecovery: () => true,
      syncFallback: () => true,
      hasFirstRunSeeded: () => true,
      markFirstRunSeeded: () => true,
    };
    const session = createLedgerSession({
      adapter,
      debounceMs: 60_000,
    });

    render(
      <StrictMode>
        <SessionProbe session={session} />
      </StrictMode>,
    );

    expect(screen.getByLabelText("账本状态").textContent).toBe("加载中");
    await waitFor(() =>
      expect(screen.getByLabelText("账本状态").textContent).toBe("500:idle"),
    );

    fireEvent.click(screen.getByRole("button", { name: "修改期初余额" }));
    expect(screen.getByLabelText("账本状态").textContent).toBe("777:idle");

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() =>
      expect(screen.getByLabelText("账本状态").textContent).toBe(
        "777:success",
      ),
    );
    expect(saved[saved.length - 1]?.openingBalance).toBe(777);
  });

  it("运行时 hook 隐藏会话启动、清理和存储适配器", async () => {
    render(<RuntimeSessionProbe />);

    expect(screen.getByLabelText("运行时账本").textContent).toBe("加载中");
    await waitFor(() =>
      expect(screen.getByLabelText("运行时账本").textContent).toBe(
        "首次样例",
      ),
    );
  });
});
