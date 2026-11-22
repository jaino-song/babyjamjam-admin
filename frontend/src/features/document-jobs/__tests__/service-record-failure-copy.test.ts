import { readFileSync } from "node:fs";
import path from "node:path";

import { describeFailurePopup, describeJobFailureDetail } from "@/features/document-jobs/failure-popup-copy";
import { makeJob } from "@/features/document-jobs/testing/jobs-test-utils";
import { EFORMSIGN_DOCUMENT_JOB_FAILURE_REASON_CODES, type EformsignDocumentJobFailureReasonCode } from "@/services/eformsign";

const job = makeJob({ documentKind: "service_record", source: "auto_finalize", status: "requires_attention", recoveryKind: null, lastErrorCode: null });

const COPY_CASES = [
  ["PROVIDER_STATE_UNAVAILABLE", "제공기록지 전송 결과를 확인하지 못했어요.",
    "전자문서 작업 목록에서 재시도하거나 취소해 주세요.",
    "전자문서 작업 목록에서 취소하거나 관리자에게 문의해 주세요."],
  ["PRE_SEND_RETRY_EXHAUSTED", "제공기록지 작업을 시작하지 못했어요.",
    "전자문서 작업 목록에서 재시도하거나 취소해 주세요.",
    "전자문서 작업 목록에서 취소하거나 관리자에게 문의해 주세요."],
  ["SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED", "제공기록지 작업을 시작하지 못했어요.",
    "전자문서 작업 목록에서 재시도하거나 취소해 주세요.",
    "제공기록지의 내용과 처리 결과를 확인하고 관리자에게 문의해 주세요."],
  ["SERVICE_RECORD_REVISION_MANUAL_REVIEW_REQUIRED", "제공기록지 작업을 시작하지 못했어요.",
    "전자문서 작업 목록에서 재시도하거나 취소해 주세요.",
    "제공기록지의 내용과 처리 결과를 확인하고 관리자에게 문의해 주세요."],
  ["SERVICE_RECORD_INITIAL_FINALIZATION_STATE_NOT_READY", "제공기록지를 생성할 수 있는 서비스 상태가 아니에요.",
    "서비스 상태를 확인한 뒤 전자문서 작업 목록에서 재시도하거나 취소해 주세요.",
    "서비스 상태를 확인한 뒤 전자문서 작업 목록에서 취소하거나 관리자에게 문의해 주세요."],
  ["SERVICE_RECORD_INITIAL_FINALIZATION_SCOPE_CHANGED", "제공기록지 생성 대상이나 서비스 일정이 변경됐어요.",
    "제공기록지 대상과 일정을 확인한 뒤 전자문서 작업 목록에서 재시도하거나 취소해 주세요.",
    "제공기록지 대상과 일정을 확인한 뒤 전자문서 작업 목록에서 취소하거나 관리자에게 문의해 주세요."],
  ["JOB_TARGET_NOT_OWNED_BY_BRANCH", "제공기록지 작업을 시작하지 못했어요.",
    "전자문서 작업 목록에서 재시도하거나 취소해 주세요.",
    "작업을 만든 지점의 관리자에게 확인을 요청해 주세요."],
  ["RECOVERY_PAYLOAD_EXPIRED", "제공기록지 작업을 시작하지 못했어요.",
    "전자문서 작업 목록에서 재시도하거나 취소해 주세요.",
    "원래 제공기록지와 처리 결과를 확인하고 관리자에게 다시 진행할 방법을 문의해 주세요."],
] as const satisfies ReadonlyArray<readonly [EformsignDocumentJobFailureReasonCode, string, string, string]>;

const AFTER_DISPATCH_NEXT = "이폼사인에서 제공기록지의 문서 상태를 확인한 뒤 전자문서 작업 목록에서 취소해 주세요.";

function expectCopy(failureReasonCode: EformsignDocumentJobFailureReasonCode, retryable: boolean | undefined, progressStep: string | null, reason: string, nextAction: string): void {
  const fixture = { ...job, failureReasonCode, retryable, progressStep, lastErrorCode: "HEADLESS_CREATE_PRE_SEND_FAILURE" };
  expect(describeJobFailureDetail(fixture)).toEqual({ reason, nextAction });
  expect(describeFailurePopup(fixture)).toEqual({
    title: "제공기록지 생성 실패",
    description: `김하늘 님 · ${reason} ${nextAction}`,
    actionLabel: "확인하기",
  });
}

it("keeps the frontend reason list aligned with the backend DTO contract", () => {
  const entity = readFileSync(path.resolve(process.cwd(), "../backend/domain/entities/eformsign-document-job.entity.ts"), "utf8");
  const list = entity.match(/EFORMSIGN_DOCUMENT_JOB_FAILURE_REASON_CODES = (\[[\s\S]*?\]) as const/);
  if (!list) throw new Error("Backend failure-reason list was not found");
  expect(EFORMSIGN_DOCUMENT_JOB_FAILURE_REASON_CODES).toEqual(JSON.parse(list[1].replace(/,\s*\]/, "]")));
});

it("pins literal copy for every frontend failure reason", () => {
  expect(COPY_CASES.map(([code]) => code)).toEqual(EFORMSIGN_DOCUMENT_JOB_FAILURE_REASON_CODES);
});

describe.each(COPY_CASES)("service-record copy for %s", (failureReasonCode, reason, retryNextAction, unavailableNextAction) => {
  it.each([null, "queued", "dispatch_authorized", "creating", "sent", "reconciling"])("suggests retry only when offered, including at %s", progressStep => {
    expectCopy(failureReasonCode, true, progressStep, reason, retryNextAction);
  });

  describe.each([false, undefined])("retryable=%s", retryable => {
    it.each([null, "queued", "client-started", "failed", "future-step"])("uses cancellation/admin copy without dispatch evidence at %s", progressStep => {
      expectCopy(failureReasonCode, retryable, progressStep, reason, unavailableNextAction);
    });

    it.each(["dispatch_authorized", "creating", "sent", "reconciling"])("requires checking eformsign before cancellation at %s", progressStep => {
      expectCopy(failureReasonCode, retryable, progressStep, reason, AFTER_DISPATCH_NEXT);
    });
  });
});

it("keeps PRE_SEND_RETRY_EXHAUSTED in the waiting stage even after dispatch", () => {
  expect(describeJobFailureDetail({ ...job, failureReasonCode: "PRE_SEND_RETRY_EXHAUSTED", progressStep: "sent" })?.reason)
    .toBe("제공기록지 작업을 시작하지 못했어요.");
});

it("uses a safe fallback for future service-record reasons without exposing the raw code", () => {
  const detail = describeJobFailureDetail({ ...job, failureReasonCode: "FUTURE_PRIVATE_REASON" });
  expect(detail).toEqual({ reason: "제공기록지를 생성하지 못했어요.", nextAction: "전자문서 작업 목록에서 취소하거나 관리자에게 문의해 주세요." });
});
