"use client";

import { useState } from "react";

/** A popup waits for at most this many list responses before it settles for generic copy. */
export const MAX_DETAIL_ROUNDS = 2;

interface WindowState {
  ids: readonly string[];
  lastCounted: number;
  rounds: number;
}

/**
 * Whether the job list should still be fetched on behalf of popups whose job it has
 * not yet delivered. It opens when there is a pending id and closes again as soon as
 * every pending job has been found (`pendingIds` empties) or the list has answered
 * MAX_DETAIL_ROUNDS times since without it, so an unattended popup never keeps the
 * 3-second list poll alive. A new pending id restarts the count.
 *
 * `listUpdatedAt` is the list query's latest data/error timestamp; each new value
 * is one answer.
 */
export function useDetailsFetchWindow(pendingIds: readonly string[], listUpdatedAt: number): boolean {
  const [state, setState] = useState<WindowState | null>(null);

  let current = state;
  if (pendingIds.length === 0) {
    current = null;
  } else if (state === null || pendingIds.some((id) => !state.ids.includes(id))) {
    current = { ids: pendingIds, lastCounted: listUpdatedAt, rounds: 0 };
  } else if (listUpdatedAt > state.lastCounted) {
    current = { ...state, lastCounted: listUpdatedAt, rounds: state.rounds + 1 };
  }
  if (current !== state) setState(current);

  return pendingIds.length > 0 && (current?.rounds ?? 0) < MAX_DETAIL_ROUNDS;
}
