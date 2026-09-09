import { getUserErrorMessage } from "@babyjamjam/shared";
import {
  normalizeApiError,
  type NormalizedApiError,
  type ProblemDetails,
  type ProblemError,
  type ProblemOutcome,
} from "@babyjamjam/shared/errors/problem-details";
import type { EformsignDocumentOption } from "@babyjamjam/shared/types/eformsign";

export type ContractMutationOperation = "delete" | "finalize" | "receipt";

export type ContractOperationRecordState = "in-flight" | "retryable" | "blocked";

export interface ContractMutationPresentation {
  operation: ContractMutationOperation;
  resourceId: string;
  outcome: ProblemOutcome;
  message: string;
  retryAllowed: boolean;
  requestId?: string;
  status?: number;
  problem?: ProblemDetails;
  errors?: readonly ProblemError[];
}

export interface ContractOperationRecord {
  operation: ContractMutationOperation;
  resourceId: string;
  state: ContractOperationRecordState;
  presentation?: ContractMutationPresentation;
}

export type ContractOperationGuardState = ReadonlyMap<string, ContractOperationRecord>;

export const CONTRACT_FINALIZE_END_DATE_INPUT_ID =
  "mobile_contracts_finalize-dialog_end-date-field_input";

export type FinalizeHeadlessResult =
  | { kind: "success" }
  | { kind: "iframe" }
  | { kind: "unknown" };

export type ReceiptLinkResult =
  | {
      kind: "success";
      jobId: string;
      scheduledFor: string;
      clientName: string;
    }
  | { kind: "unknown" };

type ReadRefreshCallback = () => unknown | Promise<unknown>;

function operationKey(operation: ContractMutationOperation, resourceId: string): string {
  return `${operation}:${resourceId}`;
}

function recordStateFor(presentation: ContractMutationPresentation): ContractOperationRecordState {
  return presentation.retryAllowed && presentation.outcome === "NOT_APPLIED"
    ? "retryable"
    : "blocked";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function responseData(error: unknown): unknown {
  if (!isRecord(error)) return error;
  const response = error.response;
  if (isRecord(response) && Object.prototype.hasOwnProperty.call(response, "data")) {
    return response.data;
  }
  return error;
}

function claimsProblemDetails(error: unknown): boolean {
  const payload = responseData(error);
  return isRecord(payload)
    && (Object.prototype.hasOwnProperty.call(payload, "type")
      || Object.prototype.hasOwnProperty.call(payload, "requestId"));
}

function isKnownLegacyClientStatus(normalized: NormalizedApiError, error: unknown): boolean {
  return !normalized.verified
    && !claimsProblemDetails(error)
    && normalized.status !== undefined
    && normalized.status >= 400
    && normalized.status < 500;
}

/**
 * Begin/settle are pure transitions so the page can perform the duplicate
 * request check synchronously before React state has rendered a new frame.
 */
export function beginContractOperation(
  state: ContractOperationGuardState,
  operation: ContractMutationOperation,
  resourceId: string,
): { accepted: boolean; state: ContractOperationGuardState } {
  const key = operationKey(operation, resourceId);
  const existing = state.get(key);
  if (existing?.state === "in-flight" || existing?.state === "blocked") {
    return { accepted: false, state };
  }

  const next = new Map(state);
  next.set(key, { operation, resourceId, state: "in-flight" });
  return { accepted: true, state: next };
}

export function settleContractOperation(
  state: ContractOperationGuardState,
  presentation: ContractMutationPresentation,
): ContractOperationGuardState {
  const next = new Map(state);
  next.set(operationKey(presentation.operation, presentation.resourceId), {
    operation: presentation.operation,
    resourceId: presentation.resourceId,
    state: recordStateFor(presentation),
    presentation,
  });
  return next;
}

export function completeContractOperation(
  state: ContractOperationGuardState,
  operation: ContractMutationOperation,
  resourceId: string,
): ContractOperationGuardState {
  const key = operationKey(operation, resourceId);
  if (!state.has(key)) return state;
  const next = new Map(state);
  next.delete(key);
  return next;
}

/** User-cancelled iframe handoff; this is not a provider outcome. */
export function cancelContractOperation(
  state: ContractOperationGuardState,
  operation: ContractMutationOperation,
  resourceId: string,
): ContractOperationGuardState {
  const key = operationKey(operation, resourceId);
  const existing = state.get(key);
  if (!existing || existing.state !== "in-flight") return state;
  const next = new Map(state);
  next.delete(key);
  return next;
}

export function getContractOperationRecord(
  state: ContractOperationGuardState,
  operation: ContractMutationOperation,
  resourceId: string,
): ContractOperationRecord | undefined {
  return state.get(operationKey(operation, resourceId));
}

export function normalizeContractMutationError(
  error: unknown,
  operation: ContractMutationOperation,
  resourceId: string,
): ContractMutationPresentation {
  const normalized = normalizeApiError(error, {
    locale: "ko-KR",
    operation: "mutation",
  });
  const legacyKnown4xx = isKnownLegacyClientStatus(normalized, error);
  const outcome: ProblemOutcome = normalized.verified
    ? normalized.outcome ?? "UNKNOWN"
    : legacyKnown4xx
      ? "NOT_APPLIED"
      : "UNKNOWN";
  const retryAllowed = normalized.verified
    ? outcome === "NOT_APPLIED"
    : legacyKnown4xx;

  return {
    operation,
    resourceId,
    outcome,
    retryAllowed,
    message: legacyKnown4xx ? getUserErrorMessage(error, normalized.message) : normalized.message,
    requestId: normalized.problem?.requestId,
    status: normalized.status,
    problem: normalized.problem,
    errors: normalized.problem?.errors,
  };
}

export function createUnknownContractMutationPresentation(
  operation: ContractMutationOperation,
  resourceId: string,
): ContractMutationPresentation {
  return normalizeContractMutationError(undefined, operation, resourceId);
}

function hasFiniteDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** A truthy `ok` is not sufficient; finalization needs a typed completion. */
export function parseFinalizeHeadlessResult(value: unknown): FinalizeHeadlessResult {
  if (!isRecord(value) || typeof value.ok !== "boolean" || !hasFiniteDuration(value.durationMs)) {
    return { kind: "unknown" };
  }
  if (value.ok === true) {
    return value.completed === true ? { kind: "success" } : { kind: "unknown" };
  }
  return value.fallbackHint === "iframe" ? { kind: "iframe" } : { kind: "unknown" };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseReceiptLinkResult(value: unknown): ReceiptLinkResult {
  if (!isRecord(value)
    || !nonEmptyString(value.jobId)
    || !nonEmptyString(value.scheduledFor)
    || !nonEmptyString(value.clientName)) {
    return { kind: "unknown" };
  }
  return {
    kind: "success",
    jobId: value.jobId,
    scheduledFor: value.scheduledFor,
    clientName: value.clientName,
  };
}

export function isEformsignStaffDocumentOption(value: unknown): value is EformsignDocumentOption {
  if (!isRecord(value) || !isRecord(value.company) || !isRecord(value.mode)) return false;
  return nonEmptyString(value.company.id)
    && (value.mode.type === "01" || value.mode.type === "02" || value.mode.type === "03");
}

function isDeleteFailure(value: unknown): boolean {
  return isRecord(value)
    && nonEmptyString(value.document_id)
    && nonEmptyString(value.code)
    && nonEmptyString(value.message);
}

/** Only a response explicitly listing the target in success_result is success. */
export function isContractDeleteResponseConfirmed(value: unknown, resourceId: string): boolean {
  if (!isRecord(value) || !isRecord(value.result)) return false;
  const successResult = value.result.success_result;
  const failResult = value.result.fail_result;
  if (!Array.isArray(successResult) || !successResult.every(nonEmptyString)) return false;
  if (!Array.isArray(failResult) || !failResult.every(isDeleteFailure)) return false;
  if (failResult.some((failure) => failure.document_id === resourceId)) return false;
  return successResult.includes(resourceId);
}

/**
 * Read-only refreshes are deliberately callback-based.  They cannot clear a
 * guard record and do not have access to any mutation client.
 */
export function refreshContractMutationStatus(callbacks: readonly ReadRefreshCallback[]): void {
  callbacks.forEach((callback) => {
    try {
      void Promise.resolve(callback()).catch(() => undefined);
    } catch {
      // A status refresh is best effort and must never unlock or replay a mutation.
    }
  });
}

export function getContractMutationFieldId(
  operation: ContractMutationOperation,
  error: ProblemError,
): string | undefined {
  if (operation !== "finalize") return undefined;
  const pointer = typeof error.pointer === "string" ? error.pointer.trim() : "";
  if (["/endDate", "/end_date", "/serviceEndDate", "/service_end_date", "/prefillEndDate"]
    .includes(pointer)) {
    return CONTRACT_FINALIZE_END_DATE_INPUT_ID;
  }
  return undefined;
}

export function resolveFinalizeDateInput(
  currentDocumentId: string | undefined,
  nextDocumentId: string,
  currentValue: string,
  initialValue: string,
): string {
  return currentDocumentId === nextDocumentId ? currentValue : initialValue;
}
