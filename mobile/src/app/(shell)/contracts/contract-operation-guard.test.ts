import { createProblemDetails } from "@babyjamjam/shared/errors/problem-details";

import {
  beginContractOperation,
  cancelContractOperation,
  completeContractOperation,
  createUnknownContractMutationPresentation,
  getContractOperationRecord,
  getContractMutationFieldId,
  isContractDeleteResponseConfirmed,
  isEformsignStaffDocumentOption,
  normalizeContractMutationError,
  parseFinalizeHeadlessResult,
  parseReceiptLinkResult,
  readHeadlessOutcome,
  refreshContractMutationStatus,
  resolveFinalizeDateInput,
  settleContractOperation,
  type ContractOperationGuardState,
} from "./contract-operation-guard";

describe("contract operation guard", () => {
  const started = (state: ContractOperationGuardState, operation: "delete" | "finalize" | "receipt", resourceId: string) =>
    beginContractOperation(state, operation, resourceId).state;

  it("allows one in-flight operation and keeps uncertain outcomes blocked per resource", () => {
    let state = new Map() as ContractOperationGuardState;
    const first = beginContractOperation(state, "finalize", "doc-1");

    expect(first.accepted).toBe(true);
    state = first.state;
    expect(beginContractOperation(state, "finalize", "doc-1").accepted).toBe(false);
    expect(beginContractOperation(state, "finalize", "doc-2").accepted).toBe(true);

    const presentation = createUnknownContractMutationPresentation("finalize", "doc-1");
    state = settleContractOperation(state, presentation);
    expect(getContractOperationRecord(state, "finalize", "doc-1")?.state).toBe("blocked");
    expect(beginContractOperation(state, "finalize", "doc-1").accepted).toBe(false);
    expect(beginContractOperation(state, "receipt", "doc-1").accepted).toBe(true);
    expect(beginContractOperation(state, "finalize", "doc-2").accepted).toBe(true);
  });

  it("would call an in-flight mutation only once, even when the action is double-clicked", () => {
    let state = new Map() as ContractOperationGuardState;
    const mutate = jest.fn();
    const attempt = () => {
      const result = beginContractOperation(state, "receipt", "doc-1");
      state = result.state;
      if (result.accepted) mutate();
    };

    attempt();
    attempt();

    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("preserves a retryable NOT_APPLIED record while allowing a corrected attempt", () => {
    let state = started(new Map() as ContractOperationGuardState, "delete", "doc-1");
    const problem = createProblemDetails({
      code: "REQUEST_INVALID",
      requestId: "req-not-applied",
      outcome: "NOT_APPLIED",
    });
    const presentation = normalizeContractMutationError(
      { response: { status: 400, data: problem } },
      "delete",
      "doc-1",
    );

    state = settleContractOperation(state, presentation);
    expect(getContractOperationRecord(state, "delete", "doc-1")?.state).toBe("retryable");
    expect(getContractOperationRecord(state, "delete", "doc-1")?.presentation?.requestId).toBe(
      "req-not-applied",
    );
    expect(beginContractOperation(state, "delete", "doc-1").accepted).toBe(true);
  });

  it("keeps a verified PARTIALLY_APPLIED problem blocked", () => {
    const problem = createProblemDetails({
      code: "REQUEST_CONFLICT",
      requestId: "req-partial",
      outcome: "PARTIALLY_APPLIED",
    });
    const presentation = normalizeContractMutationError(
      { response: { status: 409, data: problem } },
      "delete",
      "doc-1",
    );
    const state = settleContractOperation(
      started(new Map() as ContractOperationGuardState, "delete", "doc-1"),
      presentation,
    );

    expect(presentation.outcome).toBe("PARTIALLY_APPLIED");
    expect(getContractOperationRecord(state, "delete", "doc-1")?.state).toBe("blocked");
    expect(beginContractOperation(state, "delete", "doc-1").accepted).toBe(false);
  });

  it("treats transport, missing, and malformed mutation responses as UNKNOWN", () => {
    const transport = normalizeContractMutationError(new Error("network detail"), "receipt", "doc-1");
    const missing = createUnknownContractMutationPresentation("delete", "doc-1");

    expect(transport.outcome).toBe("UNKNOWN");
    expect(transport.retryAllowed).toBe(false);
    expect(transport.message).not.toContain("network detail");
    expect(missing.outcome).toBe("UNKNOWN");
    expect(parseFinalizeHeadlessResult({ ok: true } as unknown)).toEqual({ kind: "unknown" });
    expect(parseFinalizeHeadlessResult({ ok: true, completed: false, durationMs: 20 })).toEqual({
      kind: "unknown",
    });
    expect(parseReceiptLinkResult({ ok: true })).toEqual({ kind: "unknown" });
    expect(isEformsignStaffDocumentOption({ company: {}, mode: { type: "02" } })).toBe(false);
    expect(isContractDeleteResponseConfirmed({ result: { success_result: ["doc-1"], fail_result: [{}] } }, "doc-1")).toBe(
      false,
    );
  });

  it("keeps an edited date when the same document is closed and reopened, but resets for another document", () => {
    expect(resolveFinalizeDateInput("doc-1", "doc-1", "260909", "250101")).toBe("260909");
    expect(resolveFinalizeDateInput(undefined, "doc-1", "", "250101")).toBe("250101");
    expect(resolveFinalizeDateInput("doc-1", "doc-2", "260909", "250101")).toBe("250101");
  });

  it("does not infer replay permission from a provider reason or an unconfirmed delete result", () => {
    expect(parseReceiptLinkResult({
      jobId: "job-1",
      scheduledFor: "2026-09-09T12:00:00.000Z",
      clientName: "김산모",
    })).toEqual({
      kind: "success",
      jobId: "job-1",
      scheduledFor: "2026-09-09T12:00:00.000Z",
      clientName: "김산모",
    });
    expect(parseFinalizeHeadlessResult({ ok: true, completed: true, durationMs: 10 })).toEqual({
      kind: "success",
    });
    expect(parseFinalizeHeadlessResult({ ok: false, durationMs: 10, fallbackHint: "iframe" })).toEqual({
      kind: "iframe",
    });
    expect(parseFinalizeHeadlessResult({
      ok: false,
      durationMs: 10,
      reason: "provider_workflow_incomplete",
      fallbackHint: "manual_check",
    })).toEqual({ kind: "unknown" });
    expect(isContractDeleteResponseConfirmed({
      code: 200,
      message: "partial",
      status: 200,
      result: {
        success_result: [],
        fail_result: [{ document_id: "doc-1", code: "provider_unknown", message: "unknown" }],
      },
    }, "doc-1")).toBe(false);
    expect(isContractDeleteResponseConfirmed({
      code: 0,
      message: "stubbed",
      status: 200,
      result: { success_result: ["doc-1"], fail_result: [] },
    }, "doc-1")).toBe(true);
    expect(isContractDeleteResponseConfirmed({
      code: 0,
      message: "contradictory",
      status: 200,
      result: {
        success_result: ["doc-1"],
        fail_result: [{ document_id: "doc-1", code: "provider_unknown", message: "unknown" }],
      },
    }, "doc-1")).toBe(false);
    expect(isEformsignStaffDocumentOption({
      company: { id: "company-1" },
      mode: { type: "02" },
    })).toBe(true);
  });

  it("confirms a locally purged terminal document even when the provider reports a failure", () => {
    const response = {
      result: {
        success_result: [],
        fail_result: [{
          document_id: "doc-1",
          code: "4000164",
          message: "document is already terminal",
        }],
      },
      unresolved_document_ids: [],
    };

    expect(isContractDeleteResponseConfirmed(response, "doc-1")).toBe(true);
    expect(isContractDeleteResponseConfirmed({
      ...response,
      unresolved_document_ids: ["doc-1"],
    }, "doc-1")).toBe(false);
  });

  it("keeps unverified legacy 4xx outcomes unknown without exposing raw details", () => {
    const normalized = normalizeContractMutationError(
      { response: { status: 422, data: { message: ["endDate must be a valid ISO 8601 date string"] } } },
      "finalize",
      "doc-1",
    );

    expect(normalized.outcome).toBe("UNKNOWN");
    expect(normalized.retryAllowed).toBe(false);
    expect(normalized.message).not.toContain("ISO 8601");
  });

  it("maps only the allow-listed finalize date pointer to the real input", () => {
    expect(getContractMutationFieldId("finalize", {
      pointer: "/endDate",
      code: "INVALID_FORMAT",
      detail: "입력 형식이 올바르지 않아요.",
    })).toBe("mobile_contracts_finalize-dialog_end-date-field_input");
    expect(getContractMutationFieldId("finalize", {
      pointer: "/providerReason",
      code: "INVALID_VALUE",
      detail: "허용되지 않는 값이에요.",
    })).toBeUndefined();
  });

  it("runs only supplied read refresh callbacks and leaves the guard untouched", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const rejectedRefresh = jest.fn().mockRejectedValue(new Error("read failed"));
    const throwingRefresh = jest.fn(() => {
      throw new Error("read failed synchronously");
    });
    const mutation = jest.fn();
    const state = started(new Map() as ContractOperationGuardState, "receipt", "doc-1");

    expect(() => refreshContractMutationStatus([refresh, rejectedRefresh, throwingRefresh])).not.toThrow();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(rejectedRefresh).toHaveBeenCalledTimes(1);
    expect(throwingRefresh).toHaveBeenCalledTimes(1);
    expect(mutation).not.toHaveBeenCalled();
    expect(getContractOperationRecord(state, "receipt", "doc-1")?.state).toBe("in-flight");
  });

  it("blocks an in-flight operation when its iframe closes without confirmation", () => {
    const state = started(new Map() as ContractOperationGuardState, "finalize", "doc-1");
    const closed = cancelContractOperation(state, "finalize", "doc-1");
    expect(getContractOperationRecord(closed, "finalize", "doc-1")?.presentation?.outcome).toBe("UNKNOWN");
    expect(beginContractOperation(closed, "finalize", "doc-1").accepted).toBe(false);
  });

  it("does not let a close or read refresh unlock an uncertain operation", () => {
    const startedState = started(new Map() as ContractOperationGuardState, "finalize", "doc-1");
    const blockedState = settleContractOperation(
      startedState,
      createUnknownContractMutationPresentation("finalize", "doc-1"),
    );
    const afterClose = cancelContractOperation(blockedState, "finalize", "doc-1");

    refreshContractMutationStatus([jest.fn()]);

    expect(afterClose).toBe(blockedState);
    expect(getContractOperationRecord(afterClose, "finalize", "doc-1")?.state).toBe("blocked");
  });

  it("removes a confirmed operation after success while preserving other resources", () => {
    let state = started(new Map() as ContractOperationGuardState, "delete", "doc-1");
    state = started(state, "delete", "doc-2");
    state = completeContractOperation(state, "delete", "doc-1");

    expect(getContractOperationRecord(state, "delete", "doc-1")).toBeUndefined();
    expect(getContractOperationRecord(state, "delete", "doc-2")?.state).toBe("in-flight");
  });
});

// BJJ-319 5-4c: the additive envelope `outcome` (5-4a/5-4b) becomes the primary
// classification wherever the headless response carries it; the legacy
// reason/fallbackHint branches stay as the fallback for envelopes without it.
describe("headless envelope outcome classification", () => {
  it("reads only registered outcomes and treats every other shape as absent", () => {
    expect(readHeadlessOutcome("NOT_APPLIED")).toBe("NOT_APPLIED");
    expect(readHeadlessOutcome("FAILED")).toBe("FAILED");
    expect(readHeadlessOutcome("PARTIALLY_APPLIED")).toBe("PARTIALLY_APPLIED");
    expect(readHeadlessOutcome("UNKNOWN")).toBe("UNKNOWN");
    expect(readHeadlessOutcome(undefined)).toBeNull();
    expect(readHeadlessOutcome(null)).toBeNull();
    // A legacy reason token is not an outcome and must not be promoted.
    expect(readHeadlessOutcome("remote_unconfirmed")).toBeNull();
    expect(readHeadlessOutcome(42)).toBeNull();
    expect(readHeadlessOutcome({ outcome: "UNKNOWN" })).toBeNull();
  });

  it("keeps an UNKNOWN finalize verdict locked even when a stale hint offers the iframe", () => {
    expect(parseFinalizeHeadlessResult({
      ok: false,
      reason: "dispatch_uncertain_manual_reconciliation_required",
      fallbackHint: "iframe",
      outcome: "UNKNOWN",
      durationMs: 1200,
    })).toEqual({ kind: "unknown" });
  });

  it("keeps the legacy fallbackHint decision when the finalize envelope carries no outcome", () => {
    expect(parseFinalizeHeadlessResult({ ok: false, fallbackHint: "iframe", durationMs: 10 })).toEqual({
      kind: "iframe",
    });
  });

  it("keeps NOT_APPLIED and FAILED finalize envelopes on the existing fallbackHint branches", () => {
    // 5-4b maps iframe-capable pre-send failures to NOT_APPLIED — unchanged path.
    expect(parseFinalizeHeadlessResult({
      ok: false,
      fallbackHint: "iframe",
      outcome: "NOT_APPLIED",
      durationMs: 10,
    })).toEqual({ kind: "iframe" });
    expect(parseFinalizeHeadlessResult({
      ok: false,
      fallbackHint: "manual_check",
      outcome: "NOT_APPLIED",
      durationMs: 10,
    })).toEqual({ kind: "unknown" });
    // Terminal failures (FAILED) keep the manual-check handling.
    expect(parseFinalizeHeadlessResult({
      ok: false,
      fallbackHint: "manual_check",
      outcome: "FAILED",
      durationMs: 10,
    })).toEqual({ kind: "unknown" });
  });
});
