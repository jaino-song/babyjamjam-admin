import type { QueryClient } from "@tanstack/react-query";
import { getStatusCategory, type DocumentFilterType } from "@/lib/eformsign/status-codes";
import type {
  EformsignCurrentStatus,
  EformsignDocument,
  EformsignDocumentsResponse,
} from "@/lib/eformsign/types";
import type { EformsignWebhookDocumentUpdate } from "@/lib/eformsign/webhook";

type EformsignQueryKey = readonly unknown[];

type ResponseMode =
  | { kind: "raw" }
  | { kind: "filtered"; filterType: Exclude<DocumentFilterType, null> };

function normalizeFilterScope(value: unknown): Exclude<DocumentFilterType, null> | null {
  if (value === "completed" || value === "in-progress" || value === "expired") {
    return value;
  }
  if (value === "rejected") {
    return "expired";
  }
  return null;
}

function isDocumentsResponse(value: unknown): value is EformsignDocumentsResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as EformsignDocumentsResponse).documents)
  );
}

function getResponseMode(queryKey: EformsignQueryKey): ResponseMode | null {
  const [, scope, maybeFilter] = queryKey;

  if (scope === undefined || scope === "all" || scope === "client-paginated") {
    return { kind: "raw" };
  }

  const directFilter = normalizeFilterScope(scope);
  if (directFilter) {
    return { kind: "filtered", filterType: directFilter };
  }

  if (scope === "documentsByType") {
    const nestedFilter = normalizeFilterScope(maybeFilter);
    if (nestedFilter) {
      return { kind: "filtered", filterType: nestedFilter };
    }
  }

  return null;
}

function sortDocumentsByCreatedDate(documents: readonly EformsignDocument[]): EformsignDocument[] {
  return [...documents].sort((left, right) => right.created_date - left.created_date);
}

function currentStatusEquals(left: EformsignCurrentStatus, right: EformsignCurrentStatus): boolean {
  return (
    left.status_type === right.status_type &&
    left.status_doc_detail === right.status_doc_detail &&
    left.step_type === right.step_type &&
    left.step_index === right.step_index &&
    left.step_name === right.step_name &&
    left.expired_date === right.expired_date
  );
}

export function applyWebhookUpdateToDocument(
  document: EformsignDocument,
  update: EformsignWebhookDocumentUpdate
): EformsignDocument {
  const nextStatus: EformsignCurrentStatus = {
    ...document.current_status,
    ...(update.statusType ? { status_type: update.statusType } : {}),
    ...(update.statusDetail ? { status_doc_detail: update.statusDetail } : {}),
    ...(update.stepType ? { step_type: update.stepType } : {}),
    ...(update.stepIndex ? { step_index: update.stepIndex } : {}),
    ...(update.stepName ? { step_name: update.stepName } : {}),
    ...(update.expiredDate != null ? { expired_date: update.expiredDate } : {}),
  };

  if (currentStatusEquals(document.current_status, nextStatus)) {
    return document;
  }

  return {
    ...document,
    current_status: nextStatus,
    updated_date: Math.max(document.updated_date, update.receivedAt),
  };
}

function mergeDocumentIntoResponse(
  response: EformsignDocumentsResponse,
  document: EformsignDocument,
  mode: ResponseMode
): EformsignDocumentsResponse {
  const currentDocuments = response.documents ?? [];
  const existingIndex = currentDocuments.findIndex((item) => item.id === document.id);
  const matchesFilter =
    mode.kind === "raw" ||
    getStatusCategory(document.current_status?.status_type) === mode.filterType;

  let nextDocuments = currentDocuments;
  let changed = false;

  if (existingIndex >= 0) {
    if (!matchesFilter) {
      nextDocuments = currentDocuments.filter((item) => item.id !== document.id);
      changed = true;
    } else if (currentDocuments[existingIndex] !== document) {
      nextDocuments = currentDocuments.slice();
      nextDocuments[existingIndex] = document;
      changed = true;
    }
  } else if (matchesFilter) {
    nextDocuments = sortDocumentsByCreatedDate([...currentDocuments, document]);
    changed = true;
  }

  if (!changed) {
    return response;
  }

  return {
    ...response,
    documents: nextDocuments,
    total_rows: mode.kind === "filtered" ? nextDocuments.length : response.total_rows,
  };
}

export function findEformsignDocumentInCache(
  queryClient: QueryClient,
  documentId: string
): EformsignDocument | null {
  const detail = queryClient.getQueryData<EformsignDocument>([
    "eformsign-documents",
    "detail",
    documentId,
  ]);

  if (detail) {
    return detail;
  }

  const cachedQueries = queryClient.getQueriesData({
    queryKey: ["eformsign-documents"],
  });

  for (const [, data] of cachedQueries) {
    if (!isDocumentsResponse(data)) {
      continue;
    }

    const matched = data.documents.find((document) => document.id === documentId);
    if (matched) {
      return matched;
    }
  }

  return null;
}

export function applyEformsignDocumentToCaches(
  queryClient: QueryClient,
  document: EformsignDocument
) {
  queryClient.setQueryData<EformsignDocument>(
    ["eformsign-documents", "detail", document.id],
    document
  );

  const cachedQueries = queryClient.getQueriesData({
    queryKey: ["eformsign-documents"],
  });

  for (const [queryKey, data] of cachedQueries) {
    if (
      !Array.isArray(queryKey) ||
      !isDocumentsResponse(data)
    ) {
      continue;
    }

    const mode = getResponseMode(queryKey);
    if (!mode) {
      continue;
    }

    const nextData = mergeDocumentIntoResponse(data, document, mode);

    if (nextData !== data) {
      queryClient.setQueryData(queryKey, nextData);
    }
  }
}
