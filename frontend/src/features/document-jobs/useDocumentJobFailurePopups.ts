"use client";

import { useEffect, useMemo, useState } from "react";

import type { EformsignDocumentJobSummary } from "@/services/api";

import {
  failureSeenStorageKey,
  readSeenFailureIds,
  writeSeenFailureIds,
} from "./failure-seen-storage";

export const MAX_VISIBLE_FAILURE_POPUPS = 3;

export type FailurePopupEntry =
  | { key: string; kind: "session"; count: number }
  | { key: string; kind: "job"; jobId: string };

interface PopupState {
  /** sessionStorage key of the user+branch this state belongs to; null while either is unknown. */
  scope: string | null;
  /** The summary object the state was last derived from. */
  summary: EformsignDocumentJobSummary | undefined;
  /** False until the first summary of this scope has been seen. */
  initialized: boolean;
  /** Ids already announced, pruned to the ones the server still lists. */
  seen: ReadonlySet<string>;
  popups: readonly FailurePopupEntry[];
  nextKey: number;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

function reduceSummary(
  state: PopupState,
  scope: string | null,
  summary: EformsignDocumentJobSummary | undefined,
): PopupState {
  let base = state;
  if (state.scope !== scope) {
    base = {
      scope,
      summary: undefined,
      initialized: false,
      seen: scope ? readSeenFailureIds(scope) : EMPTY_SET,
      popups: [],
      nextKey: state.nextKey,
    };
  }
  if (!scope || !summary) return { ...base, summary };

  const ids = summary.unresolvedJobIds ?? [];
  const unseen = ids.filter((id) => !base.seen.has(id));
  let nextKey = base.nextKey;
  const additions: FailurePopupEntry[] = [];

  if (!base.initialized) {
    if (unseen.length > 0) {
      additions.push({
        key: `session-${nextKey++}`,
        kind: "session",
        count: summary.unresolvedCount ?? ids.length,
      });
    }
  } else {
    for (const jobId of unseen) {
      additions.push({ key: `job-${nextKey++}`, kind: "job", jobId });
    }
  }

  // Keep only ids the server still lists, so the stored set cannot grow without bound,
  // and drop popups of jobs that are no longer unresolved (acting on them leads nowhere).
  const currentIds = new Set(ids);
  const kept = base.popups.filter((entry) => entry.kind === "session" || currentIds.has(entry.jobId));

  return {
    scope,
    summary,
    initialized: true,
    seen: currentIds,
    popups: [...kept, ...additions],
    nextKey,
  };
}

interface UseDocumentJobFailurePopupsOptions {
  summary: EformsignDocumentJobSummary | undefined;
  userId: string | null;
  branchId: string | null;
}

/**
 * Decides which failure popups exist. It looks only at the summary's
 * `unresolvedJobIds` (not the paginated list) and remembers, per user and branch
 * and per browser session, which ids it has already announced.
 *
 * - First summary of a page load with ids this session has not seen: ONE popup
 *   summarising them, instead of a burst of per-job popups.
 * - Any id that shows up later: one popup for that job.
 * - A popup stays until closed, except that a job the server no longer lists as
 *   unresolved (someone resolved it elsewhere) drops its popup.
 *
 * The state is derived while rendering, from the summary and the scope, so a
 * branch or user change can never show one render of the previous scope's popups.
 */
export function useDocumentJobFailurePopups({
  summary,
  userId,
  branchId,
}: UseDocumentJobFailurePopupsOptions) {
  const scope = userId && branchId ? failureSeenStorageKey(userId, branchId) : null;
  const [state, setState] = useState<PopupState>({
    scope: null,
    summary: undefined,
    initialized: false,
    seen: EMPTY_SET,
    popups: [],
    nextKey: 0,
  });

  let current = state;
  if (state.scope !== scope || state.summary !== summary) {
    current = reduceSummary(state, scope, summary);
    setState(current);
  }

  useEffect(() => {
    if (current.scope && current.initialized) writeSeenFailureIds(current.scope, current.seen);
  }, [current.scope, current.initialized, current.seen]);

  const dismiss = (key: string) => {
    setState((prev) => ({ ...prev, popups: prev.popups.filter((entry) => entry.key !== key) }));
  };

  /** Drop every popup that is only represented by the "N건 더 보기" collapse. */
  const dismissHidden = () => {
    setState((prev) => ({ ...prev, popups: prev.popups.slice(0, MAX_VISIBLE_FAILURE_POPUPS) }));
  };

  const { popups } = current;
  const visible = useMemo(() => popups.slice(0, MAX_VISIBLE_FAILURE_POPUPS), [popups]);
  const hiddenCount = Math.max(0, popups.length - MAX_VISIBLE_FAILURE_POPUPS);
  const jobIds = useMemo(
    () => popups.flatMap((entry) => (entry.kind === "job" ? [entry.jobId] : [])),
    [popups],
  );

  return { visible, hiddenCount, jobIds, dismiss, dismissHidden };
}
