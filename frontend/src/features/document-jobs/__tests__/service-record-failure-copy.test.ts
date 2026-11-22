import { readFileSync } from "node:fs";
import path from "node:path";

import { describeFailurePopup, describeJobFailureDetail } from "@/features/document-jobs/failure-popup-copy";
import { makeJob } from "@/features/document-jobs/testing/jobs-test-utils";
import { EFORMSIGN_DOCUMENT_JOB_FAILURE_REASON_CODES } from "@/services/eformsign";

const job = makeJob({ documentKind: "service_record", source: "auto_finalize", status: "requires_attention", recoveryKind: null, lastErrorCode: null });

it("keeps the frontend reason list aligned with the backend DTO contract", () => {
  const entity = readFileSync(path.resolve(process.cwd(), "../backend/domain/entities/eformsign-document-job.entity.ts"), "utf8");
  const list = entity.match(/EFORMSIGN_DOCUMENT_JOB_FAILURE_REASON_CODES = (\[[\s\S]*?\]) as const/);
  if (!list) throw new Error("Backend failure-reason list was not found");
  expect(EFORMSIGN_DOCUMENT_JOB_FAILURE_REASON_CODES).toEqual(JSON.parse(list[1].replace(/,\s*\]/, "]")));
});

it.each(EFORMSIGN_DOCUMENT_JOB_FAILURE_REASON_CODES)("uses safe service-record reason/next-action copy for %s independently of progress", failureReasonCode => {
  const before = describeJobFailureDetail({ ...job, failureReasonCode, progressStep: "queued" });
  const after = describeJobFailureDetail({ ...job, failureReasonCode, progressStep: "sent", lastErrorCode: "HEADLESS_CREATE_PRE_SEND_FAILURE" });
  expect(before).toEqual(after);
  expect(before?.reason).toContain("제공기록지");
  expect(before?.nextAction).toBeTruthy();
  expect(before?.actionKind).toBeUndefined();
  const popup = describeFailurePopup({ ...job, failureReasonCode });
  expect(popup.title).toBe("제공기록지 생성 실패");
  expect(popup.description).toContain(before?.reason);
  expect(popup.description).toContain(before?.nextAction);
  expect(popup.description).not.toMatch(/계약서|수동 전송/);
});

it("keeps PRE_SEND_RETRY_EXHAUSTED in the waiting stage even after dispatch", () => {
  expect(describeJobFailureDetail({ ...job, failureReasonCode: "PRE_SEND_RETRY_EXHAUSTED", progressStep: "sent" })?.reason)
    .toBe("제공기록지 작업을 시작하지 못했어요.");
});

it("uses a safe fallback for future service-record reasons without exposing the raw code", () => {
  const detail = describeJobFailureDetail({ ...job, failureReasonCode: "FUTURE_PRIVATE_REASON" });
  expect(detail).toEqual({ reason: "제공기록지를 생성하지 못했어요.", nextAction: "전자문서 작업 목록에서 재시도하거나 취소해 주세요." });
});
