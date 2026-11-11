import type { EformsignDocumentJobResponse } from "@/services/eformsign";

export function documentJobOperationLabel(
  job: Pick<EformsignDocumentJobResponse, "documentKind" | "displayOperation">,
): string {
  if (job.documentKind === "service_contract") {
    if (job.displayOperation === "generate") return "서비스 계약서 생성";
    if (job.displayOperation === "review") return "서비스 계약서 검토";
  }
  if (job.documentKind === "service_record") {
    if (job.displayOperation === "generate") return "제공기록지 생성";
    if (job.displayOperation === "review") return "제공기록지 검토";
  }
  return "작업 유형 확인 필요";
}

type DocumentJobStatusView = {
  label: string;
  variant: "neutral" | "info" | "warning" | "success" | "danger";
};

const STATUS_COPY = {
  queued: { label: "대기", variant: "neutral" },
  processing: { label: "처리 중", variant: "info" },
  reconciling: { label: "확인 중", variant: "warning" },
  completed: { label: "완료", variant: "success" },
  failed: { label: "처리 실패", variant: "danger" },
  requires_attention: { label: "처리 실패", variant: "danger" },
} as const;

export function documentJobStatus(status: string): DocumentJobStatusView {
  if (Object.prototype.hasOwnProperty.call(STATUS_COPY, status)) {
    return { ...STATUS_COPY[status as keyof typeof STATUS_COPY] };
  }
  return { label: "상태 확인 필요", variant: "neutral" };
}
