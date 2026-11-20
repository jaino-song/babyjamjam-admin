"use client";

import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { isBranchContextAligned } from "@/features/system-templates/branch-context";
import { eformsignDocumentJobsQueryKeys, useRetryDocumentJob } from "@/hooks/useEformsignDocumentJobs";

interface ContractDocumentJobRetryDialogProps {
  jobId: string;
  branchId: string | null;
  open: boolean;
  onClose: () => void;
  onRetried: () => void;
  onCloseAutoFocus: (event: Event) => void;
  "data-component": string;
}

function isNotRetryable(error: unknown): boolean {
  return isAxiosError<{ code?: string }>(error)
    && error.response?.status === 409 && error.response.data?.code === "JOB_NOT_RETRYABLE";
}

export function ContractDocumentJobRetryDialog({ jobId, branchId, open, onClose, onRetried, onCloseAutoFocus, "data-component": base }: ContractDocumentJobRetryDialogProps): React.ReactElement {
  const retry = useRetryDocumentJob();
  const queryClient = useQueryClient();
  const sub = (suffix: string) => `${base}_${suffix}`;
  const approve = () => {
    if (retry.isPending) return;
    // Read the cookie at approval too: another tab may have switched branches before focus fires.
    if (!isBranchContextAligned(branchId)) { onClose(); return; }
    retry.mutate(jobId, {
      onSuccess: onRetried,
      onError: error => {
        if (isNotRetryable(error)) void queryClient.invalidateQueries({ queryKey: eformsignDocumentJobsQueryKeys.all });
      },
    });
  };

  return <TwoButtonModal open={open} onOpenChange={open => { if (!open) onClose(); }} data-component={base}
    layer="nested" size="detail" onCloseAutoFocus={onCloseAutoFocus}
    title="이 작업을 재시도할까요?" description="재시도하면 고객에게 계약서 서명 요청이 다시 발송됩니다."
    isDescriptionVisuallyHidden={false} approvalVariant="positive" approvalLabel="재시도" cancelLabel="닫기"
    onApprove={approve} isPending={retry.isPending}>
    {retry.isError ? <p role="alert" data-component={sub("body_error")} data-slot="job-retry-error" className="mb-4 text-sm text-status-danger-fg">
      {isNotRetryable(retry.error) ? "이 작업은 지금 재시도할 수 없어요. 상태를 확인하거나 수동으로 전송해 주세요." : "작업을 재시도하지 못했어요. 잠시 후 다시 시도해 주세요."}
    </p> : null}
  </TwoButtonModal>;
}
