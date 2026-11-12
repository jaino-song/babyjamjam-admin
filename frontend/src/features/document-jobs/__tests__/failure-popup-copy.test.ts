import * as React from "react";
import { render, screen } from "@testing-library/react";

import { ContractDocumentJobDetail } from "@/components/app/contracts/ContractDocumentJobDetail";
import type { ContractDocumentJob } from "@/components/app/contracts/ContractDocumentJobsPopover";
import { describeFailurePopup, describeJobFailureDetail } from "@/features/document-jobs/failure-popup-copy";
import { makeJob } from "@/features/document-jobs/testing/jobs-test-utils";
import { api } from '@/lib/api/client';

jest.mock('@/lib/api/client', () => ({ api: { post: jest.fn() } }));

describe("describeFailurePopup", () => {
  it("tells staff to review the saved input before starting a new create (no promise of an in-place edit)", () => {
    expect(describeFailurePopup(makeJob({ jobType: "create_document", recoveryKind: "manual_send" }))).toEqual({
      title: "계약서 자동 전송 실패",
      description: "김하늘 님 · 계약서를 자동으로 보내지 못했어요. 저장된 내용을 확인하고 새로 작성할 수 있어요.",
      actionLabel: "확인하기",
    });
  });

  it("sends a failed finalization back to the contract instead of offering a manual redo", () => {
    expect(describeFailurePopup(makeJob({ jobType: "finalize_document", recoveryKind: "manual_send" }))).toEqual({
      title: "검토완료 자동 처리 실패",
      description: "김하늘 님 · 검토완료를 자동으로 처리하지 못했어요. 계약서에서 다시 처리해 주세요.",
      actionLabel: "직접 처리하기",
    });
  });
});

const FAILURE_JOB: ContractDocumentJob = {
  jobId: "failure-job", jobType: "create_document", status: "failed", source: "staff",
  recoveryKind: "manual_send", documentKind: "service_contract", displayOperation: "generate",
};
const GENERIC_REASON = "작업을 시작하지 못했어요.";
const GENERIC_NEXT = "문서의 처리 상태를 확인하고 관리자에게 문의해 주세요.";
const MANUAL_NEXT = "저장된 내용과 수신 정보를 확인한 후 수동 전송을 진행해 주세요.";
const VERIFY_NEXT = "문서의 실제 처리 결과를 먼저 확인해 주세요. 확인 전에는 다시 전송하지 마세요.";
const OCCUPIED_REASON = "담당자가 이 작업을 직접 처리하고 있습니다.";
const OCCUPIED_NEXT = "처리가 끝날 때까지 기다린 뒤 상태를 다시 확인해 주세요.";

describe("describeJobFailureDetail", () => {
  it.each([
    ["PROVIDER_STATE_UNAVAILABLE", "전송 결과를 확인하지 못했어요.", GENERIC_NEXT],
    ["PRE_SEND_RETRY_EXHAUSTED", "작업을 시작하지 못했어요.", GENERIC_NEXT],
    ["SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED", "작업을 시작하지 못했어요.", "제공기록지의 내용과 처리 결과를 확인하고 관리자에게 문의해 주세요."],
    ["SERVICE_RECORD_REVISION_MANUAL_REVIEW_REQUIRED", "작업을 시작하지 못했어요.", "제공기록지의 내용과 처리 결과를 확인하고 관리자에게 문의해 주세요."],
    ["JOB_TARGET_NOT_OWNED_BY_BRANCH", "작업을 시작하지 못했어요.", "작업을 만든 지점의 관리자에게 확인을 요청해 주세요."],
    ["RECOVERY_PAYLOAD_EXPIRED", "작업을 시작하지 못했어요.", "원래 문서와 처리 결과를 확인하고 관리자에게 다시 진행할 방법을 문의해 주세요."],
  ])("uses literal safe copy for %s without granting an action", (failureReasonCode, reason, nextAction) => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB, recoveryKind: null, failureReasonCode })).toEqual({ reason, nextAction });
  });

  it.each([undefined, null, "UNKNOWN_PRIVATE_CODE", "toString", "__proto__"])("fails closed for unknown reason %s", (failureReasonCode) => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB, recoveryKind: null, failureReasonCode })).toEqual({ reason: GENERIC_REASON, nextAction: GENERIC_NEXT });
  });

  it.each([
    ["failed", "manual_send", MANUAL_NEXT, "수동 전송"],
    ["requires_attention", "verify_result", VERIFY_NEXT, "결과 확인"],
  ] as const)("preserves the server recovery kind for %s", (status, recoveryKind, nextAction, actionLabel) => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB, status, recoveryKind })).toEqual({
      reason: GENERIC_REASON, nextAction, actionKind: recoveryKind, actionLabel,
    });
  });

  it.each([undefined, "staff"] as const)("retains existing optional-source semantics for %s", (source) => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB, source })?.actionKind).toBe("manual_send");
  });

  it("uses only recoveryKind for actions even when provider reason suggests another operation", () => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB, failureReasonCode: "PROVIDER_STATE_UNAVAILABLE" })).toEqual({
      reason: "전송 결과를 확인하지 못했어요.", nextAction: MANUAL_NEXT,
      actionKind: "manual_send", actionLabel: "수동 전송",
    });
    expect(describeJobFailureDetail({ ...FAILURE_JOB, failureReasonCode: "JOB_TARGET_NOT_OWNED_BY_BRANCH" })?.actionKind).toBe("manual_send");
  });

  it.each(["manual_send", "verify_result", null] as const)("rejects auto-finalize action authority for %s", (recoveryKind) => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB, source: "auto_finalize", recoveryKind })).toEqual({ reason: GENERIC_REASON, nextAction: GENERIC_NEXT });
  });

  it("never falls back to a manual action for an unknown recovery kind", () => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB,
      // @ts-expect-error Simulate an unsupported future server kind at runtime.
      recoveryKind: "unsupported",
    })).toEqual({ reason: GENERIC_REASON, nextAction: GENERIC_NEXT });
  });

  it.each(["queued", "processing", "reconciling", "completed", "new_status"])("leaves no stale guidance for normal status %s", (status) => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB, status, failureReasonCode: "PRE_SEND_RETRY_EXHAUSTED" })).toBeNull();
  });

  it("leaves completed manual resolution alone", () => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB, status: "completed", progressStep: "manual_resolved" })).toBeNull();
  });

  it.each(["manual_in_progress", "manual_in_progress:claim-123"])("shows neutral occupancy without actions for %s regardless of status", (progressStep) => {
    for (const status of ["failed", "requires_attention", "completed"]) {
      expect(describeJobFailureDetail({ ...FAILURE_JOB, status, progressStep })).toEqual({ reason: OCCUPIED_REASON, nextAction: OCCUPIED_NEXT });
    }
  });

  it("does not treat a similar but different step as a manual claim", () => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB, progressStep: "manual_in_progress_evil" })?.actionKind).toBe("manual_send");
  });
});

describe("ContractDocumentJobDetail failure guidance", () => {
  it.each([
    ["failed", "manual_send", "수동 전송", MANUAL_NEXT],
    ["requires_attention", "verify_result", "결과 확인", VERIFY_NEXT],
  ] as const)("renders safe %s guidance between progress and work info with a safe %s recovery link", (status, recoveryKind, actionLabel, nextAction) => {
    const { container } = render(React.createElement(ContractDocumentJobDetail, {
      job: { ...FAILURE_JOB, status, recoveryKind }, "data-component": "desktop_contracts_jobs_detail",
    }));
    expect(screen.getByText(GENERIC_REASON)).toBeInTheDocument();
    expect(screen.queryByText(nextAction)).not.toBeInTheDocument();
    const action = screen.getByRole("link", { name: actionLabel });
    expect(action).not.toHaveAttribute('disabled');
    expect(action).toHaveAttribute('href', '/contracts?recoverJobId=failure-job');
    expect(screen.queryByText(/화면은 아직 연결되지 않았습니다/)).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(container.querySelector("iframe")).toBeNull();
    const root = container.querySelector('[data-slot="job-detail-body"]')!;
    expect(Array.from(root.children).map(element => element.getAttribute("data-slot"))).toEqual(["job-progress-section", "job-info-card"]);
    expect(root.querySelector('[data-slot="progress-action"]')).toContainElement(action);
    expect(root.querySelector('[data-slot="job-info-card"]')).toHaveTextContent(GENERIC_REASON);
    expect(action).toHaveAttribute("data-component", "desktop_contracts_jobs_detail_progress_action_button");
    expect(action).toHaveClass("w-full");

  });

  it.each([null, "auto_finalize", "manual_in_progress:claim-123"])("offers no action for ineligible or occupied work %s", (condition) => {
    const job = { ...FAILURE_JOB, recoveryKind: condition === null ? null : FAILURE_JOB.recoveryKind,
      source: condition === "auto_finalize" ? "auto_finalize" as const : "staff" as const,
      progressStep: condition?.startsWith("manual_in_progress") ? condition : undefined };
    const { container } = render(React.createElement(ContractDocumentJobDetail, { job }));
    expect(container.querySelector('[data-slot="job-info-card"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="job-failure-action"]')).toBeNull();
    expect(container.querySelector('[data-slot="job-failure-notice"]')).toBeNull();
    expect(container.querySelector("[data-component]")).toBeNull();
    if (condition?.startsWith("manual_in_progress")) {
      expect(screen.getByText(OCCUPIED_REASON)).toBeInTheDocument();
      expect(screen.queryByText(OCCUPIED_NEXT)).not.toBeInTheDocument();
    }
  });

  it("clears all failure content on a normal rerender and never displays raw provider or contact data", () => {
    const job = { ...FAILURE_JOB, failureReasonCode: "PRE_SEND_RETRY_EXHAUSTED" as const,
      lastErrorCode: "private-provider-error", payload: { phone: "010-0000-0000" }, clientName: "비공개 고객" };
    const { container, rerender } = render(React.createElement(ContractDocumentJobDetail, { job }));
    expect(screen.getByText("작업을 시작하지 못했어요.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/PRE_SEND_RETRY_EXHAUSTED|private-provider-error|010-0000-0000|비공개 고객/);
    rerender(React.createElement(ContractDocumentJobDetail, { job: { ...job, status: "completed", progressStep: "manual_resolved" } }));
    expect(container.querySelector('[data-slot="job-failure-guidance"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "수동 전송" })).not.toBeInTheDocument();
    expect(screen.queryByText("수동 전송 화면은 아직 연결되지 않았습니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "작업 정보" })).toBeInTheDocument();
  });
});

describe("describeJobFailureDetail nextAction priority", () => {
  it.each([
    ["JOB_TARGET_NOT_OWNED_BY_BRANCH", "failed", "manual_send", "작업을 시작하지 못했어요.",
      "작업을 만든 지점의 관리자에게 확인을 요청해 주세요.", "수동 전송"],
    ["JOB_TARGET_NOT_OWNED_BY_BRANCH", "requires_attention", "verify_result", "작업을 시작하지 못했어요.",
      "작업을 만든 지점의 관리자에게 확인을 요청해 주세요.", "결과 확인"],
    ["RECOVERY_PAYLOAD_EXPIRED", "failed", "manual_send", "작업을 시작하지 못했어요.",
      "원래 문서와 처리 결과를 확인하고 관리자에게 다시 진행할 방법을 문의해 주세요.", "수동 전송"],
    ["RECOVERY_PAYLOAD_EXPIRED", "requires_attention", "verify_result", "작업을 시작하지 못했어요.",
      "원래 문서와 처리 결과를 확인하고 관리자에게 다시 진행할 방법을 문의해 주세요.", "결과 확인"],
    ["SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED", "failed", "manual_send", "작업을 시작하지 못했어요.",
      "제공기록지의 내용과 처리 결과를 확인하고 관리자에게 문의해 주세요.", "수동 전송"],
    ["SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED", "requires_attention", "verify_result", "작업을 시작하지 못했어요.",
      "제공기록지의 내용과 처리 결과를 확인하고 관리자에게 문의해 주세요.", "결과 확인"],
    ["SERVICE_RECORD_REVISION_MANUAL_REVIEW_REQUIRED", "failed", "manual_send", "작업을 시작하지 못했어요.",
      "제공기록지의 내용과 처리 결과를 확인하고 관리자에게 문의해 주세요.", "수동 전송"],
    ["SERVICE_RECORD_REVISION_MANUAL_REVIEW_REQUIRED", "requires_attention", "verify_result", "작업을 시작하지 못했어요.",
      "제공기록지의 내용과 처리 결과를 확인하고 관리자에게 문의해 주세요.", "결과 확인"],
  ] as const)("keeps reason-specific nextAction for %s with %s/%s", (failureReasonCode, status, recoveryKind, reason, nextAction, actionLabel) => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB, source: "staff", status, recoveryKind, failureReasonCode })).toEqual({
      reason, nextAction, actionKind: recoveryKind, actionLabel,
    });
  });
});

describe('stage failure reasons', () => {
  it.each([
    ['MISSING_JOB_PAYLOAD', '작업을 시작하지 못했어요.'],
    ['HEADLESS_EXECUTION_FAILURE', '전송을 준비하지 못했어요.'],
    ['HEADLESS_CREATE_PRE_SEND_FAILURE', '이폼사인에서 문서를 작성하지 못했어요.'],
    ['PROVIDER_TERMINAL_FAILURE', '이폼사인에 전송하지 못했어요.'],
    ['PROVIDER_STATE_UNAVAILABLE', '전송 결과를 확인하지 못했어요.'],
  ])('maps %s to its stopped stage', (lastErrorCode, reason) => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB, lastErrorCode })?.reason).toBe(reason);
  });
  it('uses progressDetail for exhausted pre-send retries, with raw-step fallback', () => {
    expect(describeJobFailureDetail({ ...FAILURE_JOB, lastErrorCode: 'PRE_SEND_RETRY_EXHAUSTED', progressStep: 'dispatch_authorized', progressDetail: 'info-inserted' })?.reason).toBe('이폼사인에서 문서를 작성하지 못했어요.');
    expect(describeJobFailureDetail({ ...FAILURE_JOB, progressStep: 'reconciling', progressDetail: 'unknown' })?.reason).toBe('전송 결과를 확인하지 못했어요.');
  });
});
