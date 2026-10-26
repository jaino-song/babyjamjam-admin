"use client";

import { isAxiosError } from "axios";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";

import { DocumentJobRecoverySummary, parseDocumentJobResendInput } from "@/components/app/contracts/DocumentJobRecoverySummary";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useDocumentJobs } from "@/features/document-jobs/DocumentJobsProvider";
import {
  clearResendUncertain,
  isResendUncertain,
  markResendUncertain,
} from "@/features/document-jobs/resend-uncertain-storage";
import { useToast } from "@/hooks/use-toast";
import {
  useEnqueueEformsignDocumentCreation,
  useEnqueueEformsignDocumentFinalization,
} from "@/hooks/useEformsignDocumentJobs";
import {
  eformsignApi,
  type ClaimEformsignDocumentJobRecoveryResponse,
  type EformsignDocumentJobRecoveryErrorBody,
} from "@/services/api";

const DEFAULT_DATA_COMPONENT = "desktop_contracts_document-job-recovery";
const RESOLVE_AUTOMATIC_RETRIES = 3;
const DEFAULT_RESOLVE_RETRY_DELAY_MS = 800;

const COPY = {
  forbidden: "이 작업은 관리자 권한이 필요해요. 지점 관리자에게 요청해 주세요.",
  gone: "이미 처리됐거나 찾을 수 없는 작업이에요.",
  expired: "보관 기간(7일)이 지나 저장된 내용이 없어요. 새로 작성해 주세요.",
  unavailable: "작업을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
  existing:
    "같은 고객/계약서의 작업이 이미 처리중 목록에 있어요. 확인한 뒤 처리됨으로 표시해 주세요.",
  resolveFailed: "처리됨으로 표시하지 못했어요. 다시 시도해 주세요.",
  resendRejected: "다시 보내지 못했어요. 잠시 후 다시 시도해 주세요.",
  resendUncertain:
    "전송 여부를 확인하지 못했어요. 처리중 목록에서 이 고객의 작업을 확인한 뒤 다시 시도해 주세요.",
} as const;

type RecoveryFailure =
  | { kind: "claimed"; expiresAt: string | null }
  | { kind: "expired" }
  | { kind: "forbidden" }
  | { kind: "gone" }
  | { kind: "unavailable" };

type ConfirmKind = "resend" | "resolve" | "verify-fresh" | "discard";

function readErrorBody(error: unknown): EformsignDocumentJobRecoveryErrorBody {
  if (!isAxiosError(error)) return {};
  const data: unknown = error.response?.data;
  return typeof data === "object" && data !== null ? (data as EformsignDocumentJobRecoveryErrorBody) : {};
}

function classifyRecoveryError(error: unknown): RecoveryFailure {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  const body = readErrorBody(error);
  if (status === 403) return { kind: "forbidden" };
  if (status === 404) return { kind: "gone" };
  if (status === 410) return { kind: "expired" };
  if (status === 409) {
    if (body.code === "JOB_NOT_RECOVERABLE") return { kind: "gone" };
    return { kind: "claimed", expiresAt: body.expiresAt ?? null };
  }
  return { kind: "unavailable" };
}

/** A failure that may be gone on its own: no answer at all, or a server-side error. */
function isTransientError(error: unknown): boolean {
  if (!isAxiosError(error)) return true;
  const status = error.response?.status;
  return status === undefined || status >= 500;
}

function describeFailure(failure: RecoveryFailure): string {
  switch (failure.kind) {
    case "claimed": {
      const until = failure.expiresAt ? dayjs(failure.expiresAt) : null;
      return until?.isValid()
        ? `다른 곳에서 처리 중이에요. ${until.format("HH:mm")} 이후 다시 시도해 주세요.`
        : "다른 곳에서 처리 중이에요. 잠시 후 다시 시도해 주세요.";
    }
    case "expired":
      return COPY.expired;
    case "forbidden":
      return COPY.forbidden;
    case "gone":
      return COPY.gone;
    default:
      return COPY.unavailable;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DocumentJobRecoveryDialogProps {
  jobId: string;
  /** A contract form is open or its send is still on screen: starting fresh would discard it. */
  hasCreationInProgress: boolean;
  /** Discards any form in progress and opens an empty creation form. */
  onStartFresh: () => void;
  onViewDocument: (documentId: string) => void;
  onClose: () => void;
  /** Pause between automatic resolve retries; tests pass 0. */
  resolveRetryDelayMs?: number;
  "data-component"?: string;
}

/**
 * Recovery for one failed document job, opened from /contracts?recoverJobId=.
 *
 * A job that definitely sent nothing (manual_send) can be resent from its saved input through the
 * job queue; one whose outcome is unknown (verify_result) is never resent. Every resend uses the
 * deterministic request key `resend:<jobId>`, so a repeated click, a second tab or another manager
 * lands on the same server job instead of a second send.
 */
export function DocumentJobRecoveryDialog({
  jobId,
  hasCreationInProgress,
  onStartFresh,
  onViewDocument,
  onClose,
  resolveRetryDelayMs = DEFAULT_RESOLVE_RETRY_DELAY_MS,
  "data-component": dataComponent = DEFAULT_DATA_COMPONENT,
}: DocumentJobRecoveryDialogProps) {
  const { toast } = useToast();
  const { refetchSummary, refetchJobs } = useDocumentJobs();
  const enqueueCreation = useEnqueueEformsignDocumentCreation();
  const enqueueFinalization = useEnqueueEformsignDocumentFinalization();
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;

  const [claim, setClaim] = useState<ClaimEformsignDocumentJobRecoveryResponse | null>(null);
  const [failure, setFailure] = useState<RecoveryFailure | null>(null);
  const [isClaiming, setIsClaiming] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The resend was accepted but the old job is not resolved yet: only resolving is left to do.
  const [resendAccepted, setResendAccepted] = useState(false);
  // The server already had a job under this key or for this client/document: never resolve it for staff.
  const [existingJob, setExistingJob] = useState(false);
  // The last resolve ended without an answer (network/5xx/other): offer it again, never a resend.
  const [resolveFailed, setResolveFailed] = useState(false);
  // A resend enqueue ended without a definite answer, so the first send may have been accepted. Once set it
  // is never cleared here: starting a fresh contract then needs the same "nothing was sent" confirmation as
  // verify_result. The marker also lives in localStorage so closing and reopening the dialog cannot lose it;
  // it fails closed when storage cannot be read.
  const [resendUncertain, setResendUncertain] = useState(() => isResendUncertain(jobId));

  const busyRef = useRef(false);
  const claimStartedRef = useRef(false);

  const refreshProvider = () => {
    refetchSummary();
    refetchJobs();
  };

  const loadClaim = async () => {
    setIsClaiming(true);
    setFailure(null);
    try {
      const result = await eformsignApi.claimDocumentJobRecovery(jobId);
      setClaim(result);
    } catch (error) {
      const next = classifyRecoveryError(error);
      setFailure(next);
      if (next.kind === "gone") refreshProvider();
    } finally {
      setIsClaiming(false);
    }
  };

  // The claim is requested once per opened job; StrictMode's second effect run is skipped.
  useEffect(() => {
    if (claimStartedRef.current) return;
    claimStartedRef.current = true;
    void loadClaim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The server's own id is the canonical one; it may spell the URL's id differently, so check it once known.
  const canonicalJobId = claim?.job.jobId || null;
  useEffect(() => {
    if (canonicalJobId && isResendUncertain(canonicalJobId)) setResendUncertain(true);
  }, [canonicalJobId]);

  const recoveryKind = claim?.recoveryKind ?? null;
  const job = claim?.job ?? null;
  const resendInput = useMemo(
    () => (claim && recoveryKind === "manual_send" ? parseDocumentJobResendInput(claim.job.jobType, claim.payload) : null),
    [claim, recoveryKind],
  );
  // A claim that is not a recoverable job, or a saved input that cannot be trusted, ends like an expired one.
  const effectiveFailure: RecoveryFailure | null =
    failure
    ?? (claim && recoveryKind === null ? { kind: "gone" } : null)
    ?? (claim && recoveryKind === "manual_send" && !resendInput ? { kind: "expired" } : null);

  /** Marks the old job resolved; retries only network errors and 5xx, never anything that could resend. */
  const resolveJob = async (): Promise<boolean> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await eformsignApi.resolveDocumentJob(jobId);
        // The job is no longer recoverable, so there is nothing left to be uncertain about.
        clearResendUncertain(jobId);
        if (canonicalJobId) clearResendUncertain(canonicalJobId);
        refreshProvider();
        return true;
      } catch (error) {
        if (isTransientError(error) && attempt < RESOLVE_AUTOMATIC_RETRIES) {
          await delay(resolveRetryDelayMs * (attempt + 1));
          continue;
        }
        const next = classifyRecoveryError(error);
        if (next.kind === "unavailable") {
          setResolveFailed(true);
          setNotice(COPY.resolveFailed);
        } else {
          // 404 / 409: the list is stale about this job, whoever changed it.
          if (next.kind === "gone" || next.kind === "claimed") refreshProvider();
          setNotice(describeFailure(next));
        }
        return false;
      }
    }
  };

  const runExclusive = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    setNotice(null);
    setResolveFailed(false);
    try {
      await action();
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  const handleResolveOnly = (successToast: string) =>
    runExclusive(async () => {
      if (await resolveJob()) {
        toast({ variant: "success", description: successToast });
        onClose();
      }
    });

  const handleResend = () =>
    runExclusive(async () => {
      if (!claim || !resendInput) return;

      // Re-check right before sending: the claim may have expired or been taken over meanwhile.
      try {
        await eformsignApi.claimDocumentJobRecovery(jobId);
      } catch (error) {
        const next = classifyRecoveryError(error);
        if (next.kind === "unavailable") {
          setNotice(COPY.resendRejected);
        } else {
          setFailure(next);
          if (next.kind === "gone") refreshProvider();
        }
        return;
      }

      // The URL may spell the same UUID in either case; the server's own id is the canonical one, and lower-casing
      // keeps the key identical for every spelling so the idempotency key can never fork.
      const canonicalId = (claim.job.jobId || jobId).toLowerCase();
      const requestKey = `resend:${canonicalId}`;
      let existing: boolean;
      try {
        const accepted =
          resendInput.kind === "create"
            ? await enqueueCreation.mutateAsync({ ...resendInput.request, requestKey })
            : await enqueueFinalization.mutateAsync({ ...resendInput.request, requestKey });
        existing = accepted.existing;
      } catch (error) {
        const status = isAxiosError(error) ? error.response?.status : undefined;
        // Only a 4xx is a definite rejection; a network error, timeout or any 5xx may still have been accepted.
        if (status === undefined || status >= 500) {
          markResendUncertain(canonicalId);
          setResendUncertain(true);
        }
        if (status === 403) setNotice(COPY.forbidden);
        else if (status !== undefined && ((status >= 400 && status < 500) || status === 503)) setNotice(COPY.resendRejected);
        else setNotice(COPY.resendUncertain);
        return;
      }

      if (existing) {
        // The response does not say whose job this is, so staff decide whether the old one is done.
        setExistingJob(true);
        setNotice(COPY.existing);
        return;
      }

      setResendAccepted(true);
      if (await resolveJob()) {
        toast({ variant: "success", description: "다시 보내기를 시작했어요" });
        onClose();
      }
    });

  const startFresh = () => {
    onStartFresh();
    onClose();
  };

  const proceedFresh = () => {
    if (hasCreationInProgress) setConfirm("discard");
    else startFresh();
  };

  const requestFresh = () => {
    if (resendUncertain) setConfirm("verify-fresh");
    else proceedFresh();
  };

  const handleConfirm = () => {
    const kind = confirm;
    setConfirm(null);
    if (kind === "resend") void handleResend();
    else if (kind === "resolve") void handleResolveOnly("처리됨으로 표시했어요");
    else if (kind === "verify-fresh") proceedFresh();
    else if (kind === "discard") startFresh();
  };

  const handleRetryClaim = () => {
    void loadClaim();
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open && !isBusy) onClose();
  };

  const confirmCopy: Record<ConfirmKind, { title: string; description: string; approvalLabel: string; destructive?: boolean }> = {
    resend: {
      title: "다시 보낼까요?",
      description: "저장된 내용으로 계약서를 다시 보낼까요? 결과는 처리중 목록에서 확인할 수 있어요.",
      approvalLabel: "다시 보내기",
    },
    resolve: {
      title: "처리됨으로 표시할까요?",
      description: "이 작업을 목록에서 정리해요. 계약서를 다시 보내지는 않아요.",
      approvalLabel: "처리됨으로 표시",
    },
    "verify-fresh": {
      title: "새로 작성할까요?",
      description: "eformsign에서 이 계약서가 전송되지 않은 것을 확인했나요?",
      approvalLabel: "확인했어요",
    },
    discard: {
      title: "작성 중인 내용이 있어요",
      description: "작성 중인 계약서를 버리고 새로 작성할까요?",
      approvalLabel: "버리고 새로 작성",
      destructive: true,
    },
  };

  const renderBody = () => {
    if (isClaiming) {
      return (
        <div
          data-component={sub("loading")}
          role="status"
          aria-label="작업 불러오는 중"
          className="flex min-h-24 items-center justify-center"
        >
          <Spinner size="sm" />
        </div>
      );
    }

    if (effectiveFailure) {
      return (
        <p data-component={sub("failure")} className="text-[calc(14px*var(--glint-ui-scale,1))] text-v3-text">
          {describeFailure(effectiveFailure)}
        </p>
      );
    }

    if (job && recoveryKind === "verify_result") {
      return (
        <p data-component={sub("verify-result")} className="text-[calc(14px*var(--glint-ui-scale,1))] text-v3-text">
          자동 처리 중 응답이 끊겨 eformsign에 전송됐는지 확인하지 못했어요. 중복 전송을 막기 위해 다시 보내지 않아요.
        </p>
      );
    }

    if (job && resendInput) {
      return (
        <div data-component={sub("manual-send")} className="space-y-3">
          <p className="text-[calc(14px*var(--glint-ui-scale,1))] text-v3-text">
            자동 처리에 실패했어요. 저장된 내용으로 다시 보낼 수 있어요.
          </p>
          <DocumentJobRecoverySummary data-component={sub("summary")} job={job} input={resendInput} />
        </div>
      );
    }

    return null;
  };

  const renderFooter = () => {
    if (isClaiming) return null;

    if (effectiveFailure) {
      const canStartFresh = effectiveFailure.kind === "expired";
      return (
        <>
          <Button type="button" variant="neutral" size="sm" data-component={sub("close")} disabled={isBusy} onClick={onClose}>
            닫기
          </Button>
          {effectiveFailure.kind === "unavailable" ? (
            <Button type="button" size="sm" data-component={sub("retry-claim")} onClick={handleRetryClaim}>
              다시 시도
            </Button>
          ) : null}
          {canStartFresh ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-component={sub("resolve")}
                disabled={isBusy}
                onClick={() => void handleResolveOnly("목록에서 닫았어요")}
              >
                {isBusy ? "처리 중…" : resolveFailed ? "처리됨 표시 다시 시도" : "목록에서 닫기"}
              </Button>
              <Button type="button" size="sm" data-component={sub("start-fresh")} disabled={isBusy} onClick={requestFresh}>
                새로 작성
              </Button>
            </>
          ) : null}
        </>
      );
    }

    const resolveLabel = resolveFailed ? "처리됨 표시 다시 시도" : "처리됨으로 표시";

    if (recoveryKind === "verify_result") {
      return (
        <>
          {job?.documentId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-component={sub("view-document")}
              disabled={isBusy}
              onClick={() => {
                onViewDocument(job.documentId as string);
                onClose();
              }}
            >
              계약서 보기
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" data-component={sub("start-fresh")} disabled={isBusy} onClick={() => setConfirm("verify-fresh")}>
            새로 작성
          </Button>
          <Button type="button" size="sm" data-component={sub("resolve")} disabled={isBusy} onClick={() => setConfirm("resolve")}>
            {resolveLabel}
          </Button>
        </>
      );
    }

    return (
      <>
        {!resendAccepted ? (
          <Button type="button" variant="outline" size="sm" data-component={sub("start-fresh")} disabled={isBusy} onClick={requestFresh}>
            새로 작성
          </Button>
        ) : null}
        <Button
          type="button"
          variant={resendAccepted || existingJob ? "positive" : "outline"}
          size="sm"
          data-component={sub("resolve")}
          disabled={isBusy}
          onClick={() => (resendAccepted ? void handleResolveOnly("다시 보내기를 시작했어요") : setConfirm("resolve"))}
        >
          {resolveLabel}
        </Button>
        {!resendAccepted && !existingJob ? (
          <Button type="button" size="sm" data-component={sub("resend")} disabled={isBusy} onClick={() => setConfirm("resend")}>
            저장된 내용으로 다시 보내기
          </Button>
        ) : null}
      </>
    );
  };

  const confirmView = confirm ? confirmCopy[confirm] : null;
  const title = recoveryKind === "verify_result" && !effectiveFailure ? "전자문서 결과 확인 필요" : "전자문서 작업 복구";

  return (
    <>
      <Dialog open onOpenChange={handleDialogOpenChange}>
        <FormDialogShell
          data-component={dataComponent}
          title={title}
          description="실패한 전자문서 작업을 복구합니다."
          size="compact"
          showCloseButton={!isBusy}
          footer={renderFooter()}
        >
          <div data-component={sub("body")} className="space-y-3">
            {renderBody()}
            {notice ? (
              <Alert variant="destructive" data-component={sub("notice")}>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </FormDialogShell>
      </Dialog>
      <TwoButtonModal
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        data-component={sub("confirm")}
        size="detail"
        title={confirmView?.title ?? ""}
        description={confirmView?.description ?? ""}
        isDescriptionVisuallyHidden={false}
        approvalLabel={confirmView?.approvalLabel ?? "확인"}
        approvalVariant={confirmView?.destructive ? "destructive" : "positive"}
        onApprove={handleConfirm}
      />
    </>
  );
}
