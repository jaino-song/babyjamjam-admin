"use client";

import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { SERVICE_RECORD_RECOVERY_COPY, serviceRecordMayExist } from "@/features/document-jobs/service-record-recovery-copy";
import { isBranchContextAligned } from "@/features/system-templates/branch-context";
import { eformsignDocumentJobsQueryKeys, useCancelDocumentJob } from "@/hooks/useEformsignDocumentJobs";
import type { EformsignDocumentJobResponse } from "@/services/eformsign";

interface ContractDocumentJobCancelDialogProps extends Partial<Pick<EformsignDocumentJobResponse, "documentKind" | "progressStep" | "progressDetail">> {
  jobId: string;
  isJobOffered: boolean;
  branchId: string | null;
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

export function ContractDocumentJobCancelDialog({ jobId, documentKind, progressStep, progressDetail, isJobOffered, branchId, open, onClose, onCancelled, onCloseAutoFocus, "data-component": base }: ContractDocumentJobCancelDialogProps): React.ReactElement {
  const cancel = useCancelDocumentJob();
  const queryClient = useQueryClient();
  const submissionLocked = useRef(false);
  const noLongerOffered = !isJobOffered && !cancel.isPending && !cancel.isSuccess;
  const isServiceRecord = documentKind === "service_record";
  const description = isServiceRecord
    ? `${SERVICE_RECORD_RECOVERY_COPY.cancelDescription} ${serviceRecordMayExist({ progressStep, progressDetail }) ? SERVICE_RECORD_RECOVERY_COPY.afterDispatch : SERVICE_RECORD_RECOVERY_COPY.beforeDispatch}`
    : "취소하면 이 고객의 전자문서 작업이 닫히고 새로 요청할 수 있어요. 아직 보낸 문서는 없어요.";
  const errorCopy = noLongerOffered || isNotCancellable(cancel.error)
    ? (isServiceRecord ? SERVICE_RECORD_RECOVERY_COPY.cancelUnavailable : "이 작업은 지금 취소할 수 없어요. 새로고침 후 다시 확인해 주세요.")
    : (isServiceRecord ? SERVICE_RECORD_RECOVERY_COPY.cancelFailed : "작업을 취소하지 못했어요. 잠시 후 다시 시도해 주세요.");
  const sub = (suffix: string) => `${base}_${suffix}`;
  const approve = () => {
    if (cancel.isPending) return;
    // Read the cookie at approval too: another tab may have switched branches before focus fires.
    if (!isBranchContextAligned(branchId)) { onClose(); return; }
    if (!isJobOffered || submissionLocked.current) return;
    submissionLocked.current = true;
    cancel.mutate(jobId, {
      onSuccess: onCancelled,
      onError: error => {
        submissionLocked.current = false;
        if (isNotCancellable(error)) void queryClient.invalidateQueries({ queryKey: eformsignDocumentJobsQueryKeys.all });
      },
    });
  };

  return <TwoButtonModal open={open} onOpenChange={open => { if (!open) onClose(); }} data-component={base}
    layer="nested" size="detail" onCloseAutoFocus={onCloseAutoFocus}
    title={isServiceRecord ? SERVICE_RECORD_RECOVERY_COPY.cancelTitle : "이 작업을 취소할까요?"} description={description}
    titleDataComponent={sub("header_title")} descriptionDataComponent={sub("header_description")}
    cancelButtonDataComponent={sub("footer_cancel")} approvalButtonDataComponent={sub("footer_approve")}
    isDescriptionVisuallyHidden={false} approvalVariant="destructive" approvalLabel="작업 취소" cancelLabel="닫기"
    onApprove={approve} isPending={cancel.isPending} approvalDisabled={noLongerOffered}>
    {cancel.isError || noLongerOffered ? <p role="alert" data-component={sub("body_error")} data-slot="job-cancel-error" className="text-sm text-status-danger-fg">
      {errorCopy}
    </p> : null}
  </TwoButtonModal>;
}
