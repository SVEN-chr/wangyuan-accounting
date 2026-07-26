// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLedgerCommand,
  type Ledger,
  type LedgerCommand,
  type LedgerCommandResult,
} from "../../ledgerCommands";
import { createLedgerQuery } from "../../ledgerQueries";
import { BackupFeature } from "./BackupFeature";
import { useBackupStatus } from "./useBackupStatus";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.1.7"),
}));

function BackupFeatureHarness({ initialLedger }: { initialLedger: Ledger }) {
  const [ledger, setLedger] = useState(initialLedger);
  const query = useMemo(() => createLedgerQuery(ledger), [ledger]);
  const backupStatus = useBackupStatus({ type: "idle" });

  function dispatch(command: LedgerCommand): LedgerCommandResult {
    const result = applyLedgerCommand(ledger, command);
    if (result.ok) setLedger(result.ledger);
    return result;
  }

  return (
    <BackupFeature
      active
      query={query}
      dispatch={dispatch}
      backupStatus={backupStatus}
      updateState={{ phase: "idle" }}
      onCheckUpdate={() => undefined}
      onRunUpdate={() => undefined}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 18, 12, 0, 0));
  tauriMocks.invoke.mockReset();
  tauriMocks.invoke.mockRejectedValue(new Error("browser mode"));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("BackupFeature", () => {
  it("桌面备份不可用时仍可从公开界面导出完整账本", async () => {
    const createObjectURL = vi.fn(() => "blob:ledger-workbook");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(
      <BackupFeatureHarness
        initialLedger={{
          records: [
            {
              id: 1,
              catId: "sell-book",
              amount: 320,
              date: "2026-07-18",
              note: "备份售书",
            },
          ],
          categories: [
            {
              id: "sell-book",
              name: "卖书",
              type: "income",
              shape: "circle",
              swatch: "#3F6212",
            },
          ],
          openingBalance: 500,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /↓ 导出/ }));

    expect(
      await screen.findByText(
        "已导出 1 条记录到 wangyuan-2026-07-18.xlsx",
      ),
    ).toBeTruthy();
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:ledger-workbook");
  });
});
