import type { EformsignDocumentJobResponse } from "@/services/eformsign";

export interface DocumentJobRecoveryMetadata extends Pick<EformsignDocumentJobResponse, "recoveryPresentation"> {
  jobId: string;
  jobType: string;
  source?: "staff" | "auto_finalize";
  status: string;
  recoveryKind?: "manual_send" | "verify_result" | null;
}

/** Old-server create jobs have unknown generation authority: never guess a fresh-create route. */
export function documentJobRecoveryPresentation(job: DocumentJobRecoveryMetadata | undefined): "iframe" | "legacy" | null {
  if (!job || job.source !== "staff" || (job.status !== "failed" && job.status !== "requires_attention")
    || (job.recoveryKind !== "manual_send" && job.recoveryKind !== "verify_result")) return null;
  if (job.recoveryPresentation === null) return null;
  if (job.jobType === "finalize_document") return job.recoveryPresentation === undefined || job.recoveryPresentation === "legacy" ? "legacy" : null;
  if (job.jobType !== "create_document") return null;
  return job.recoveryPresentation === "iframe" || job.recoveryPresentation === "legacy" ? job.recoveryPresentation : null;
}
