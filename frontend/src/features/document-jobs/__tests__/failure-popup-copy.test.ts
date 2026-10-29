import { describeFailurePopup } from "@/features/document-jobs/failure-popup-copy";
import { makeJob } from "@/features/document-jobs/testing/jobs-test-utils";

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
