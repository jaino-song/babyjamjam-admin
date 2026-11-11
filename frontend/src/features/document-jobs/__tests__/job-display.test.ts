import type { ContractDocumentJob } from "@/components/app/contracts/ContractDocumentJobsPopover";
import type { EformsignDocumentJobResponse } from "@/services/eformsign";
import { documentJobOperationLabel, documentJobStatus } from "../job-display";

type Projection = Pick<EformsignDocumentJobResponse, "documentKind" | "displayOperation">;

describe("documentJobOperationLabel", () => {
  it.each([
    ["service_contract", "generate", "서비스 계약서 생성"],
    ["service_contract", "review", "서비스 계약서 검토"],
    ["service_record", "generate", "제공기록지 생성"],
  ] as const)("formats %s/%s from the safe projection", (documentKind, displayOperation, expected) => {
    expect(documentJobOperationLabel({ documentKind, displayOperation })).toBe(expected);
  });

  it("supports the reserved record-review formatter vocabulary without inventing a producer job", () => {
    expect(documentJobOperationLabel({ documentKind: "service_record", displayOperation: "review" })).toBe("제공기록지 검토");
  });

  it.each([
    {}, { documentKind: "service_contract" }, { displayOperation: "generate" },
    { documentKind: "unknown", displayOperation: "generate" },
    { documentKind: "service_record", displayOperation: "unknown" },
    { documentKind: "future_document", displayOperation: "generate" },
    { documentKind: "service_contract", displayOperation: "future_operation" },
    { documentKind: null, displayOperation: "review" },
    { documentKind: "service_record", displayOperation: null },
    { documentKind: "generate", displayOperation: "service_contract" },
  ])("uses unknown copy for missing, future or mismatched projection %j", (projection) => {
    expect(documentJobOperationLabel(projection as unknown as Projection)).toBe("작업 유형 확인 필요");
  });

  it.each([
    { jobType: "create_document", source: "staff", title: "서비스 계약서 생성" },
    { jobType: "finalize_document", source: "auto_finalize", title: "검토완료" },
  ])("never infers projection from misleading legacy metadata %j", (metadata) => {
    const missing = { ...metadata, documentKind: undefined, displayOperation: undefined };
    expect(documentJobOperationLabel(missing)).toBe("작업 유형 확인 필요");
    const projected = { ...metadata, documentKind: "service_record", displayOperation: "generate" } as const;
    expect(documentJobOperationLabel(projected)).toBe("제공기록지 생성");
  });
});

describe("documentJobStatus", () => {
  it.each([
    ["queued", "대기", "neutral"], ["processing", "처리중", "info"],
    ["reconciling", "확인 중", "warning"], ["completed", "완료", "success"],
    ["failed", "처리 실패", "danger"], ["requires_attention", "처리 실패", "danger"],
  ] as const)("maps %s to the fixed label and variant", (status, label, variant) => {
    expect(documentJobStatus(status)).toEqual({ label, variant });
  });

  it.each(["", "future_status", "manual_resolved", "toString", "constructor", "__proto__"])("keeps unknown status %s neutral", (status) => {
    expect(documentJobStatus(status)).toEqual({ label: "상태 확인 필요", variant: "neutral" });
  });

  it("does not let callers mutate subsequent status results", () => {
    const view = documentJobStatus("completed");
    view.label = "changed";
    expect(documentJobStatus("completed")).toEqual({ label: "완료", variant: "success" });
  });
});

it("keeps legacy jobs assignable and accepts the additive service DTO projection", () => {
  const legacy: ContractDocumentJob = { jobId: "legacy", jobType: "future_job_type", status: "future_status" };
  expect(documentJobOperationLabel(legacy)).toBe("작업 유형 확인 필요");
  const response: EformsignDocumentJobResponse = {
    jobId: "contract-1", jobType: "create_document", source: "staff", status: "queued",
    documentKind: "service_contract", displayOperation: "generate", failureReasonCode: "PRE_SEND_RETRY_EXHAUSTED",
    clientId: null, clientName: null, documentId: null, progressStep: null, attempts: 0,
    nextAttemptAt: "2026-11-04T00:00:00Z", startedAt: null, completedAt: null,
    createdAt: "2026-11-04T00:00:00Z", updatedAt: "2026-11-04T00:00:00Z", recoveryKind: null, lastErrorCode: null,
  };
  const compatible: ContractDocumentJob = response;
  expect(documentJobOperationLabel(compatible)).toBe("서비스 계약서 생성");
  expect(compatible.failureReasonCode).toBe("PRE_SEND_RETRY_EXHAUSTED");
  // @ts-expect-error Only the safe service DTO failure vocabulary is accepted.
  void ({ ...legacy, failureReasonCode: "RAW_PROVIDER_ERROR" } satisfies ContractDocumentJob);
});
