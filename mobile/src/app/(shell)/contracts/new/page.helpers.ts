import {
  normalizeApiError,
  type NormalizedApiError,
  type ProblemDetails,
  type ProblemError,
  type ProblemOutcome,
} from "@babyjamjam/shared";

type ValidationTarget = {
  selector: string;
  step: number;
};

export interface ContractSubmissionAlert {
  title: string;
  message: string;
  outcome: ProblemOutcome;
  requestId?: string;
  operationId?: string;
  errors?: ProblemError[];
  problem?: ProblemDetails;
  locked: boolean;
  verified: boolean;
}

const CONTRACT_VALIDATION_TARGETS: Readonly<Record<string, ValidationTarget>> = Object.freeze({
  name: { selector: "#contract-create-client-name", step: 0 },
  clientName: { selector: "#contract-create-client-name", step: 0 },
  customerName: { selector: "#contract-create-client-name", step: 0 },
  phone: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_card_phone-input\"]", step: 0 },
  clientPhone: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_card_phone-input\"]", step: 0 },
  customerContact: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_card_phone-input\"]", step: 0 },
  birthday: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_card_birthday-input\"]", step: 0 },
  customerDOB: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_card_birthday-input\"]", step: 0 },
  birthDate: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_card_birthday-input\"]", step: 0 },
  address: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_card_address-input\"]", step: 0 },
  customerAddress: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_card_address-input\"]", step: 0 },
  area: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_area-card_area-select\"]", step: 0 },
  areaId: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_area-card_area-select\"]", step: 0 },
  employeeId: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-autocomplete-field_primary-autocomplete_input\"]", step: 1 },
  primaryEmployeeId: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-autocomplete-field_primary-autocomplete_input\"]", step: 1 },
  caretaker1Name: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-autocomplete-field_primary-autocomplete_input\"]", step: 1 },
  employeePhone: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-phone-input\"]", step: 1 },
  caretaker1Contact: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-phone-input\"]", step: 1 },
  employee2Id: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-autocomplete-field_secondary-autocomplete_input\"]", step: 1 },
  secondaryEmployeeId: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-autocomplete-field_secondary-autocomplete_input\"]", step: 1 },
  employee2Phone: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-phone-input\"]", step: 1 },
  secondaryEmployeePhone: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-phone-input\"]", step: 1 },
  voucherYear: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_year-select\"]", step: 2 },
  year: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_year-select\"]", step: 2 },
  voucherType: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_type-select\"]", step: 2 },
  type: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_type-select\"]", step: 2 },
  voucherDuration: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_duration-select\"]", step: 2 },
  duration: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_duration-select\"]", step: 2 },
  days: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_duration-select\"]", step: 2 },
  fullPrice: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_price-card_full-price-input\"]", step: 2 },
  grant: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_price-card_grant-input\"]", step: 2 },
  actualPrice: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_price-card_actual-price-input\"]", step: 2 },
  startDate: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_period-card_start-date-input\"]", step: 3 },
  endDate: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_period-card_end-date-input\"]", step: 3 },
  paymentDate: { selector: "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_payment-card_payment-date-input\"]", step: 3 },
});

export const CONTRACT_OUTCOME_COPY: Readonly<Record<ProblemOutcome, { title: string; message: string }>> = Object.freeze({
  NOT_APPLIED: {
    title: "계약서를 생성하지 못했어요",
    message: "계약서 생성 요청이 적용되지 않았어요. 입력 내용을 확인해 주세요.",
  },
  FAILED: {
    title: "계약서 생성을 처리하지 못했어요",
    message: "계약서 생성 요청이 처리되지 않았어요. 입력 내용을 확인해 주세요.",
  },
  PARTIALLY_APPLIED: {
    title: "계약서 생성 결과가 일부만 확인됐어요",
    message: "일부 처리 결과만 확인되어 새 계약서를 다시 만들지 말고 계약 목록에서 상태를 확인해 주세요.",
  },
  UNKNOWN: {
    title: "계약서 생성 결과를 확인할 수 없어요",
    message: "계약서 생성 결과를 확인할 수 없어 새 계약서를 다시 만들지 말고 계약 목록에서 상태를 확인해 주세요.",
  },
});

const HEADLESS_UNSAFE_FALLBACK_REASONS = new Set([
  "remote_unconfirmed",
  "dispatch_uncertain_manual_reconciliation_required",
  "operation_lock_lost",
  "local_persist_failed",
  "provider_success_without_document_id",
  "send_outcome_unknown",
  "provider_timeout",
  "ambiguous",
  "operation_in_progress",
  "operation_lock_unavailable",
  "manual_check",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSafeClientId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isHeadlessSuccessResponse(value: unknown): value is { ok: true; documentId: string; durationMs: number } {
  if (!isRecord(value) || value.ok !== true) return false;
  return typeof value.documentId === "string"
    && value.documentId.trim().length > 0
    && typeof value.durationMs === "number"
    && Number.isFinite(value.durationMs)
    && value.durationMs >= 0;
}

export function isValidIframeSuccessResponse(value: unknown): value is { document_id: string } {
  return isRecord(value)
    && typeof value.document_id === "string"
    && value.document_id.trim().length > 0;
}

function getPointerField(pointer: string): string | null {
  const raw = pointer.split("/").pop();
  if (!raw) return null;
  return raw.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function focusContractValidationErrors(
  errors: readonly ProblemError[] | undefined,
  setStep: (step: number) => void,
): string | null {
  if (typeof document === "undefined") return null;
  for (const error of errors ?? []) {
    const field = getPointerField(error.pointer);
    if (!field) continue;
    const target = CONTRACT_VALIDATION_TARGETS[field];
    if (!target) continue;
    setStep(target.step);
    const element = document.querySelector<HTMLElement>(target.selector);
    if (element) {
      element.focus({ preventScroll: true });
      return field;
    }
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        document.querySelector<HTMLElement>(target.selector)?.focus({ preventScroll: true });
      }, 0);
    }
    return field;
  }
  return null;
}

export function buildContractSubmissionAlert(
  error: unknown,
  fallbackOutcome: ProblemOutcome = "UNKNOWN",
): ContractSubmissionAlert {
  const normalized: NormalizedApiError = normalizeApiError(error, {
    operation: "mutation",
    locale: "ko-KR",
  });
  const outcome = normalized.problem?.outcome
    ?? (normalized.problem && normalized.problem.status >= 400 && normalized.problem.status < 500
      ? "NOT_APPLIED"
      : fallbackOutcome);
  const copy = CONTRACT_OUTCOME_COPY[outcome];
  const problem = normalized.problem;
  const verified = normalized.verified && problem !== undefined;
  return {
    title: verified ? problem.title : copy.title,
    message: verified ? normalized.message : copy.message,
    outcome,
    ...(verified && problem.requestId ? { requestId: problem.requestId } : {}),
    ...(verified && problem.operationId ? { operationId: problem.operationId } : {}),
    ...(verified && problem.errors ? { errors: problem.errors } : {}),
    ...(verified ? { problem } : {}),
    locked: outcome === "UNKNOWN" || outcome === "PARTIALLY_APPLIED",
    verified,
  };
}

export function canUseContractIframeFallback(input: {
  fallbackHint: unknown;
  failedStep?: unknown;
  reason: unknown;
}): boolean {
  // `fallbackHint: "iframe"` is an explicit server-owned safety decision:
  // the headless operation has not crossed the provider send boundary. Do not
  // reconstruct that decision from a client-side progress step, which may be
  // absent for a pre-provider failure or evolve with the server state machine.
  if (input.fallbackHint !== "iframe") return false;
  if (typeof input.reason === "string" && HEADLESS_UNSAFE_FALLBACK_REASONS.has(input.reason)) return false;
  return true;
}
