import type { SaveResult } from "./ledgerSession";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "uptodate"
  | "error";

export type UpdateState = {
  phase: UpdatePhase;
  version?: string;
  notes?: string;
  downloaded?: number;
  total?: number;
  error?: string;
};

export type UpdateDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export type PendingUpdate = {
  version: string;
  body?: string;
  downloadAndInstall(
    onEvent?: (event: UpdateDownloadEvent) => void,
  ): Promise<void>;
};

export type UpdateControllerAdapters = {
  check(options: { timeout: number }): Promise<PendingUpdate | null>;
  flushLedger(): Promise<SaveResult | null>;
  isDesktop(): boolean | Promise<boolean>;
  relaunch(): Promise<void>;
};

type UpdateListener = (state: UpdateState) => void;

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

export function createUpdateController(adapters: UpdateControllerAdapters) {
  let state: UpdateState = { phase: "idle" };
  let checkInFlight = false;
  let installing = false;
  let manualPending = false;
  let pendingUpdate: PendingUpdate | null = null;
  const listeners = new Set<UpdateListener>();

  function publish(nextState: UpdateState) {
    state = nextState;
    listeners.forEach((listener) => listener(state));
  }

  return {
    getState: () => state,
    subscribe(listener: UpdateListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async check(manual: boolean) {
      if (installing) return;
      if (checkInFlight) {
        if (manual) {
          manualPending = true;
          publish({ phase: "checking" });
        }
        return;
      }
      checkInFlight = true;
      if (manual) publish({ phase: "checking" });
      try {
        const update = await adapters.check({ timeout: 20_000 });
        const asManual = manual || manualPending;
        pendingUpdate = update;
        publish(
          update
            ? {
                phase: "available",
                version: update.version,
                notes: update.body || undefined,
              }
            : asManual
              ? { phase: "uptodate" }
              : { phase: "idle" },
        );
      } catch (error) {
        pendingUpdate = null;
        const asManual = manual || manualPending;
        if (asManual) {
          let desktop = false;
          try {
            desktop = await adapters.isDesktop();
          } catch {
            // If runtime detection is unavailable, preserve the browser-safe
            // presentation instead of leaking a second adapter failure.
          }
          publish({
            phase: "error",
            error: desktop
              ? describeError(error)
              : "仅桌面端支持检查更新",
          });
        } else {
          publish({ phase: "idle" });
        }
      } finally {
        checkInFlight = false;
        manualPending = false;
      }
    },
    async install() {
      const update = pendingUpdate;
      if (!update || installing) return;
      installing = true;
      try {
        const saveResult = await adapters.flushLedger();
        if (saveResult && !saveResult.ok && !saveResult.recoverySaved) {
          throw new Error(`更新已取消：${saveResult.error}`);
        }

        let total = 0;
        let downloaded = 0;
        const publishProgress = () =>
          publish({
            phase: "downloading",
            version: update.version,
            downloaded,
            total,
          });
        publishProgress();
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              total = event.data.contentLength ?? 0;
              break;
            case "Progress":
              downloaded += event.data.chunkLength;
              break;
            case "Finished":
              downloaded = total;
              break;
          }
          publishProgress();
        });
        await adapters.relaunch();
      } catch (error) {
        installing = false;
        publish({
          phase: "error",
          version: update.version,
          error: describeError(error),
        });
      }
    },
    dismiss() {
      publish({ phase: "idle" });
    },
  };
}

export type UpdateController = ReturnType<typeof createUpdateController>;

export function createRuntimeUpdateController({
  flushLedger,
}: {
  flushLedger: UpdateControllerAdapters["flushLedger"];
}): UpdateController {
  return createUpdateController({
    async check(options) {
      const { check } = await import("@tauri-apps/plugin-updater");
      return (await check(options)) as PendingUpdate | null;
    },
    flushLedger,
    async isDesktop() {
      const { isTauri } = await import("@tauri-apps/api/core");
      return isTauri();
    },
    async relaunch() {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  });
}
