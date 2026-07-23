import { useEffect, useRef, useState } from "react";
import {
  createRuntimeUpdateController,
  type UpdateController,
  type UpdateState,
} from "./updateController";
import type { SaveResult } from "./ledgerSession";

export type UpdateControl = {
  state: UpdateState;
  check(manual: boolean): Promise<void>;
  install(): Promise<void>;
  dismiss(): void;
};

export function useUpdateController(
  controller: UpdateController,
  checkOnMount = false,
): UpdateControl {
  const [state, setState] = useState<UpdateState>(() =>
    controller.getState(),
  );

  useEffect(() => controller.subscribe(setState), [controller]);

  useEffect(() => {
    if (checkOnMount) void controller.check(false);
  }, [checkOnMount, controller]);

  return {
    state,
    check: controller.check,
    install: controller.install,
    dismiss: controller.dismiss,
  };
}

export function useRuntimeUpdateController({
  flushLedger,
}: {
  flushLedger(): Promise<SaveResult | null>;
}): UpdateControl {
  const flushLedgerRef = useRef(flushLedger);
  flushLedgerRef.current = flushLedger;

  const controllerRef = useRef<UpdateController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createRuntimeUpdateController({
      flushLedger: () => flushLedgerRef.current(),
    });
  }

  return useUpdateController(controllerRef.current, true);
}
