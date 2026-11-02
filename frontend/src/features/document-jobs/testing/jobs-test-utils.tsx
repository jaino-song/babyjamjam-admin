import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { DocumentJobsProvider } from "@/features/document-jobs/DocumentJobsProvider";
import { UserProvider } from "@/providers/UserProvider";
import type {
  EformsignDocumentJobList,
  EformsignDocumentJobResponse,
  EformsignDocumentJobSummary,
} from "@/services/api";

export function makeSummary(overrides: Partial<EformsignDocumentJobSummary> = {}): EformsignDocumentJobSummary {
  const unresolvedJobIds = overrides.unresolvedJobIds ?? [];
  return {
    activeCount: 0,
    requiresAttentionCount: 0,
    failedCount: unresolvedJobIds.length,
    unresolvedCount: unresolvedJobIds.length,
    unresolvedJobIds,
    ...overrides,
  };
}

export function makeJob(overrides: Partial<EformsignDocumentJobResponse> = {}): EformsignDocumentJobResponse {
  return {
    jobId: "job-1",
    jobType: "create_document",
    source: "staff",
    status: "failed",
    clientId: 1,
    documentId: null,
    progressStep: null,
    attempts: 1,
    nextAttemptAt: "2026-10-20T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    clientName: "김하늘",
    recoveryKind: "manual_send",
    lastErrorCode: null,
    ...overrides,
  };
}

export function makeJobList(overrides: Partial<EformsignDocumentJobList> = {}): EformsignDocumentJobList {
  return { active: [], requiresAttention: [], recent: [], ...overrides };
}

export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

export function JobsTestWrapper({
  queryClient,
  userId = "user-1",
  children,
}: {
  queryClient: QueryClient;
  userId?: string;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider user={{ id: userId, name: "테스터" }}>
        <DocumentJobsProvider>{children}</DocumentJobsProvider>
      </UserProvider>
    </QueryClientProvider>
  );
}

export function setBranchCookie(branchId: string | null) {
  document.cookie = branchId
    ? `selected_branch_id=${branchId}; path=/`
    : "selected_branch_id=; Max-Age=0; path=/";
}
