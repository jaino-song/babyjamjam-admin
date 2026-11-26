"use client";

import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { SERVICE_RECORD_RECOVERY_COPY, serviceRecordMayExist } from "@/features/document-jobs/service-record-recovery-copy";
import { isBranchContextAligned } from "@/features/system-templates/branch-context";
import { eformsignDocumentJobsQueryKeys, useRetryDocumentJob } from "@/hooks/useEformsignDocumentJobs";
import type { EformsignDocumentJobResponse } from "@/services/eformsign";

interface ContractDocumentJobRetryDialogProps extends Partial<Pick<EformsignDocumentJobResponse, "documentKind" | "progressStep" | "progressDetail">> {
  jobId: string;
  isJobOffered: boolean;
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

export function ContractDocumentJobRetryDialog({ jobId, documentKind, progressStep, progressDetail, isJobOffered, branchId, open, onClose, onRetried, onCloseAutoFocus, "data-component": base }: ContractDocumentJobRetryDialogProps): React.ReactElement {
  const retry = useRetryDocumentJob();
  const queryClient = useQueryClient();
  const submissionLocked = useRef(false);
  const noLongerOffered = !isJobOffered && !retry.isPending && !retry.isSuccess;
  const isServiceRecord = documentKind === "service_record";
  const description = isServiceRecord
    ? [SERVICE_RECORD_RECOVERY_COPY.retryDescription, ...(serviceRecordMayExist({ progressStep, progressDetail }) ? [SERVICE_RECORD_RECOVERY_COPY.afterDispatch] : [])].join(" ")
    : "재시도하면 고객에게 계약서 서명 요청이 다시 발송됩니다.";
  const errorCopy = noLongerOffered || isNotRetryable(retry.error)
    ? (isServiceRecord ? SERVICE_RECORD_RECOVERY_COPY.retryUnavailable : "이 작업은 지금 재시도할 수 없어요. 상태를 확인하거나 수동으로 전송해 주세요.")
    : (isServiceRecord ? SERVICE_RECORD_RECOVERY_COPY.retryFailed : "작업을 재시도하지 못했어요. 잠시 후 다시 시도해 주세요.");
  const sub = (suffix: string) => `${base}_${suffix}`;
  const approve = () => {
    if (retry.isPending) return;
    // Read the cookie at approval too: another tab may have switched branches before focus fires.
    if (!isBranchContextAligned(branchId)) { onClose(); return; }
    if (!isJobOffered || submissionLocked.current) return;
    submissionLocked.current = true;
    retry.mutate(jobId, {
      onSuccess: onRetried,
      onError: error => {
        submissionLocked.current = false;
        if (isNotRetryable(error)) void queryClient.invalidateQueries({ queryKey: eformsignDocumentJobsQueryKeys.all });
      },
    });
  };

  return <TwoButtonModal open={open} onOpenChange={open => { if (!open) onClose(); }} data-component={base}
    layer="nested" size="detail" onCloseAutoFocus={onCloseAutoFocus}
    title={isServiceRecord ? SERVICE_RECORD_RECOVERY_COPY.retryTitle : "이 작업을 재시도할까요?"} description={description}
    titleDataComponent={sub("header_title")} descriptionDataComponent={sub("header_description")}
    cancelButtonDataComponent={sub("footer_cancel")} approvalButtonDataComponent={sub("footer_approve")}
    isDescriptionVisuallyHidden={false} approvalVariant="positive" approvalLabel="재시도" cancelLabel="닫기"
    onApprove={approve} isPending={retry.isPending} approvalDisabled={noLongerOffered}>
    {retry.isError || noLongerOffered ? <p role="alert" data-component={sub("body_error")} data-slot="job-retry-error" className="text-sm text-status-danger-fg">
      {errorCopy}
    </p> : null}
  </TwoButtonModal>;
}
