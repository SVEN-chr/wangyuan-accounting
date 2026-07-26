import { type UpdateState } from "../updateController";

export function formatUpdatePercent(
  state: UpdateState,
  fallback: string,
): string {
  if (!state.total || state.total <= 0) return fallback;
  return `${Math.round(((state.downloaded ?? 0) / state.total) * 100)}%`;
}
