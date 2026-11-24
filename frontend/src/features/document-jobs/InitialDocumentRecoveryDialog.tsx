"use client";

import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { serviceRecordKeys } from "@/features/service-records/hooks/keys";
import { isBranchContextAligned } from "@/features/system-templates/branch-context";
import { eformsignDocumentJobsQueryKeys } from "@/hooks/useEformsignDocumentJobs";
import { initialDocumentTarget, type InitialDocumentAction } from "@/lib/eformsign/initial-document-recovery-contract";
import { eformsignApi } from "@/services/eformsign";

import {
  INITIAL_DOCUMENT_RECOVERY_COPY as copy,
  initialRegenerationConflictCopy,
  noProviderDocumentConflictCopy,
} from "./service-record-recovery-copy";

interface InitialDocumentRecoveryDialogProps {
  action: InitialDocumentAction;
  audience: "staff" | "admin";
  branchId: string | null;
  open: boolean;
  isOffered: boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  "data-component": string;
}

export function InitialDocumentRecoveryDialog({
  action, audience, branchId, open, isOffered, onClose, onCloseAutoFocus, "data-component": base,
}: InitialDocumentRecoveryDialogProps) {
  const queryClient = useQueryClient();
  const locked = useRef(false);
  const confirmation = action.kind === "confirm-no-provider-document" ? action.target : null;
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: eformsignDocumentJobsQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: serviceRecordKeys.all }),
  ]);
  const mutation = useMutation({
    networkMode: "always",
    retry: false,
    mutationFn: async () => {
      const target = initialDocumentTarget(action.target);
      if (audience === "admin") {
        if (confirmation) await serviceRecordsApi.confirmInitialNoProviderDocument(target);
        else await serviceRecordsApi.retryRevisionDocument(target);
      } else if (confirmation) {
        await eformsignApi.confirmInitialNoProviderDocument(target);
      } else {
        await eformsignApi.regenerateInitialDocument(target);
      }
    },
    onSuccess: refresh,
    onError: () => { void refresh(); },
  });
  const response = isAxiosError<{ reason?: unknown }>(mutation.error) ? mutation.error.response : undefined;
  const status = response?.status;
  const reason = response?.data?.reason;
  const conflictCopy = status === 409
    ? (confirmation ? noProviderDocumentConflictCopy(reason) : initialRegenerationConflictCopy(reason))
    : null;
  const rejected = status !== undefined && status >= 400 && status < 500;
  const error = mutation.isError
    ? conflictCopy ?? (rejected ? copy.notApplied : copy.failed)
    : !isOffered && !mutation.isPending && !mutation.isSuccess ? copy.unavailable : null;
  const approve = () => {
    if (!isBranchContextAligned(branchId)) { onClose(); return; }
    if (!isOffered || locked.current) return;
    locked.current = true;
    mutation.mutate(undefined, {
      onSuccess: onClose,
      onError: () => { locked.current = false; },
    });
  };
  const sub = (part: string) => `${base}_${part}`;

  return <TwoButtonModal
    open={open}
    onOpenChange={next => { if (!next) onClose(); }}
    onCloseAutoFocus={onCloseAutoFocus}
    data-component={base}
    sourceComponent="InitialDocumentRecoveryDialog"
    layer="nested"
    size="detail"
    title={confirmation ? copy.confirmTitle : copy.regenerateTitle}
    description={confirmation ? copy.confirmDescription : copy.regenerateDescription}
    titleDataComponent={sub("header_title")}
    descriptionDataComponent={sub("header_description")}
    cancelButtonDataComponent={sub("footer_cancel")}
    approvalButtonDataComponent={sub("footer_approve")}
    approvalLabel={confirmation ? copy.confirmLabel : copy.regenerateLabel}
    cancelLabel="닫기"
    isDescriptionVisuallyHidden={false}
    isPending={mutation.isPending}
    approvalDisabled={!isOffered}
    onApprove={approve}
  >
    {confirmation && <>
      <p data-component={sub("body_suffix")} data-slot="provider-title-suffix">접미사 {confirmation.suffix}</p>
      <p data-component={sub("body_ordinals")} data-slot="unlinked-chunk-ordinals">
        {confirmation.unlinkedChunkOrdinals.length > 0
          ? `연결되지 않은 문서 조각 ${confirmation.unlinkedChunkOrdinals.join(", ")}`
          : copy.confirmEmptyOrdinals}
      </p>
    </>}
    {error && <p role="alert" data-component={sub("body_error")} data-slot="initial-document-recovery-error" className="text-sm text-status-danger-fg">
      {error}
    </p>}
  </TwoButtonModal>;
}
