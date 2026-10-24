"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { DocumentJobFailurePopupStack } from "@/components/app/ui/DocumentJobFailurePopupStack";
import { useActiveBranchId } from "@/features/system-templates/branch-context";
import {
  useEformsignDocumentJobs,
  useEformsignDocumentJobsSummary,
  type EformsignDocumentJobList,
  type EformsignDocumentJobSummary,
} from "@/hooks/useEformsignDocumentJobs";
import { useInitialUser } from "@/providers/UserProvider";

import { describeFailurePopup, recoverJobHref } from "./failure-popup-copy";
import { useDetailsFetchWindow } from "./useDetailsFetchWindow";
import { useDocumentJobFailurePopups } from "./useDocumentJobFailurePopups";

const CONTRACTS_PATH = "/contracts";

export interface DocumentJobsContextValue {
  summary: EformsignDocumentJobSummary | undefined;
  summaryError: unknown;
  isSummaryLoading: boolean;
  isSummaryFetching: boolean;
  refetchSummary: () => void;
  jobs: EformsignDocumentJobList | undefined;
  jobsError: unknown;
  isJobsLoading: boolean;
  refetchJobs: () => void;
  /** activeCount + unresolvedCount, the number on every "전자문서 처리중" card. */
  total: number;
  unresolvedCount: number;
  isPopoverOpen: boolean;
  setPopoverOpen: (open: boolean) => void;
  /** Opens the jobs list on the page's card, or on /contracts when no card is mounted. */
  openJobsList: () => void;
  registerCard: (id: string) => () => void;
  /** The one registered card that owns the popover when several are mounted. */
  primaryCardId: string | null;
}

const noop = () => {};

/** What components get outside a provider (isolated tests, service-record admin): nothing, quietly. */
const INERT_VALUE: DocumentJobsContextValue = {
  summary: undefined,
  summaryError: null,
  isSummaryLoading: false,
  isSummaryFetching: false,
  refetchSummary: noop,
  jobs: undefined,
  jobsError: null,
  isJobsLoading: false,
  refetchJobs: noop,
  total: 0,
  unresolvedCount: 0,
  isPopoverOpen: false,
  setPopoverOpen: noop,
  openJobsList: noop,
  registerCard: () => noop,
  primaryCardId: null,
};

const DocumentJobsContext = createContext<DocumentJobsContextValue>(INERT_VALUE);

export function useDocumentJobs(): DocumentJobsContextValue {
  return useContext(DocumentJobsContext);
}

export function DocumentJobsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useInitialUser();
  const userId = user?.id ?? null;
  const branchId = useActiveBranchId();
  const isAuthenticated = userId !== null;

  const [isPopoverOpen, setPopoverOpenState] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [cardIds, setCardIds] = useState<readonly string[]>([]);
  const cardIdsRef = useRef<string[]>([]);

  // A popover left open must not follow the user to the next page. Adjusting state
  // while rendering (rather than in an effect) lets the new page's card register
  // afterwards and open it again when openJobsList() navigated here on purpose.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setPopoverOpenState(false);
    if (!pathname?.startsWith(CONTRACTS_PATH)) setPendingOpen(false);
  }

  const summaryQuery = useEformsignDocumentJobsSummary(isAuthenticated);
  const summary = summaryQuery.data;
  const failureStack = useDocumentJobFailurePopups({ summary, userId, branchId });

  // Popups need the list to learn what kind of failure each job is. Fetch it only
  // until each popup has found its job (or the list answered twice without it), so an
  // unattended popup never keeps the 3-second list poll alive. `detailsWanted` is
  // state, adjusted during render, because the answer depends on the very query it
  // switches on.
  const [detailsWanted, setDetailsWanted] = useState(false);
  const jobsQuery = useEformsignDocumentJobs({
    isAuthenticated,
    isPopoverOpen: isPopoverOpen || detailsWanted,
    fetchWhenActive: false,
  });
  const jobs = jobsQuery.data;
  const pendingDetailIds = failureStack.jobIds.filter(
    (id) => !jobs?.requiresAttention.some((job) => job.jobId === id),
  );
  const wantsDetails = useDetailsFetchWindow(
    pendingDetailIds,
    Math.max(jobsQuery.dataUpdatedAt, jobsQuery.errorUpdatedAt),
  );
  if (wantsDetails !== detailsWanted) setDetailsWanted(wantsDetails);

  const setPopoverOpen = useCallback((open: boolean) => setPopoverOpenState(open), []);

  const registerCard = useCallback((id: string) => {
    cardIdsRef.current = [...cardIdsRef.current, id];
    setCardIds(cardIdsRef.current);
    return () => {
      cardIdsRef.current = cardIdsRef.current.filter((existing) => existing !== id);
      setCardIds(cardIdsRef.current);
      if (cardIdsRef.current.length === 0) setPopoverOpenState(false);
    };
  }, []);

  const openJobsList = useCallback(() => {
    if (cardIdsRef.current.length > 0) {
      setPopoverOpenState(true);
      return;
    }
    if (!pathname?.startsWith(CONTRACTS_PATH)) setPendingOpen(true);
    router.push(CONTRACTS_PATH);
  }, [pathname, router]);

  // openJobsList() navigated here because no card was mounted; open the list as soon as
  // this page's card registers.
  if (pendingOpen && cardIds.length > 0) {
    setPendingOpen(false);
    setPopoverOpenState(true);
  }

  const { refetch: refetchSummaryQuery } = summaryQuery;
  const { refetch: refetchJobsQuery } = jobsQuery;
  const refetchSummary = useCallback(() => void refetchSummaryQuery(), [refetchSummaryQuery]);
  const refetchJobs = useCallback(() => void refetchJobsQuery(), [refetchJobsQuery]);

  // activeCount covers every job type while unresolvedCount is contract-only; summing them
  // is the intended operator formula, not an accident of mixing scopes.
  const unresolvedCount = summary?.unresolvedCount ?? 0;
  const total = (summary?.activeCount ?? 0) + unresolvedCount;

  const value = useMemo<DocumentJobsContextValue>(
    () => ({
      summary,
      summaryError: summaryQuery.error,
      isSummaryLoading: summaryQuery.isLoading,
      isSummaryFetching: summaryQuery.isFetching,
      refetchSummary,
      jobs,
      jobsError: jobsQuery.error,
      isJobsLoading: jobsQuery.isLoading,
      refetchJobs,
      total,
      unresolvedCount,
      isPopoverOpen,
      setPopoverOpen,
      openJobsList,
      registerCard,
      primaryCardId: cardIds[0] ?? null,
    }),
    [
      summary,
      summaryQuery.error,
      summaryQuery.isLoading,
      summaryQuery.isFetching,
      refetchSummary,
      jobs,
      jobsQuery.error,
      jobsQuery.isLoading,
      refetchJobs,
      total,
      unresolvedCount,
      isPopoverOpen,
      setPopoverOpen,
      openJobsList,
      registerCard,
      cardIds,
    ],
  );

  const { visible, hiddenCount, dismiss, dismissHidden } = failureStack;
  const items = visible.map((entry) => {
    if (entry.kind === "session") {
      return {
        key: entry.key,
        title: `확인이 필요한 전자문서 ${entry.count}건`,
        description: "처리하지 못한 전자문서가 있어요. 목록에서 확인해 주세요.",
        actionLabel: "목록 보기",
        onAction: () => {
          dismiss(entry.key);
          openJobsList();
        },
        onClose: () => dismiss(entry.key),
      };
    }
    const job = jobs?.requiresAttention.find((candidate) => candidate.jobId === entry.jobId);
    const copy = describeFailurePopup(job);
    return {
      key: entry.key,
      title: copy.title,
      description: copy.description,
      actionLabel: copy.actionLabel,
      onAction: () => {
        dismiss(entry.key);
        router.push(recoverJobHref(entry.jobId));
      },
      onClose: () => dismiss(entry.key),
    };
  });

  return (
    <DocumentJobsContext.Provider value={value}>
      {children}
      <DocumentJobFailurePopupStack
        data-component="desktop_shell_document-job-failures"
        items={items}
        overflow={
          hiddenCount > 0
            ? {
                title: `실패 ${hiddenCount}건 더 보기`,
                description: "확인이 필요한 전자문서가 더 있어요.",
                actionLabel: "목록 보기",
                onAction: () => {
                  dismissHidden();
                  openJobsList();
                },
                onClose: dismissHidden,
              }
            : null
        }
      />
    </DocumentJobsContext.Provider>
  );
}

