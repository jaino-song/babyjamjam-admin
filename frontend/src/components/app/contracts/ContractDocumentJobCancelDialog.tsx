"use client";

import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { eformsignDocumentJobsQueryKeys, useCancelDocumentJob } from "@/hooks/useEformsignDocumentJobs";

interface ContractDocumentJobCancelDialogProps {
  jobId: string;
  open: boolean;
  onClose: () => void;
  onCancelled: () => void;
  onCloseAutoFocus: (event: Event) => void;
  "data-component": string;
}

function isNotCancellable(error: unknown): boolean {
  return isAxiosError<{ code?: string }>(error)
    && error.response?.status === 409 && error.response.data?.code === "JOB_NOT_CANCELLABLE";
}

export function ContractDocumentJobCancelDialog({ jobId, open, onClose, onCancelled, onCloseAutoFocus, "data-component": base }: ContractDocumentJobCancelDialogProps): React.ReactElement {
  const cancel = useCancelDocumentJob();
  const queryClient = useQueryClient();
  const sub = (suffix: string) => `${base}_${suffix}`;
  const approve = () => {
    if (cancel.isPending) return;
    cancel.mutate(jobId, {
      onSuccess: onCancelled,
      onError: error => {
        if (isNotCancellable(error)) void queryClient.invalidateQueries({ queryKey: eformsignDocumentJobsQueryKeys.all });
      },
    });
  };

  return <TwoButtonModal open={open} onOpenChange={open => { if (!open) onClose(); }} data-component={base}
    layer="nested" size="detail" onCloseAutoFocus={onCloseAutoFocus}
    title="이 작업을 취소할까요?" description="취소하면 이 고객의 전자문서 작업이 닫히고 새로 요청할 수 있어요. 아직 보낸 문서는 없어요."
    isDescriptionVisuallyHidden={false} approvalVariant="destructive" approvalLabel="작업 취소" cancelLabel="닫기"
    onApprove={approve} isPending={cancel.isPending}>
    {cancel.isError ? <p role="alert" data-component={sub("body_error")} data-slot="job-cancel-error" className="mb-4 text-sm text-status-danger-fg">
      {isNotCancellable(cancel.error) ? "이 작업은 지금 취소할 수 없어요. 새로고침 후 다시 확인해 주세요." : "작업을 취소하지 못했어요. 잠시 후 다시 시도해 주세요."}
    </p> : null}
  </TwoButtonModal>;
}
