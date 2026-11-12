import { documentJobRecoveryPresentation, type DocumentJobRecoveryMetadata } from "./recovery-presentation";

const job: DocumentJobRecoveryMetadata = {
  jobId: "job-1", jobType: "create_document", source: "staff", status: "requires_attention",
  recoveryKind: "verify_result", recoveryPresentation: "iframe",
};

describe("documentJobRecoveryPresentation", () => {
  it.each(["failed", "requires_attention"])("routes bound create and unbound create/finalize in %s", status => {
    expect(documentJobRecoveryPresentation({ ...job, status })).toBe("iframe");
    expect(documentJobRecoveryPresentation({ ...job, status, recoveryPresentation: "legacy" })).toBe("legacy");
    expect(documentJobRecoveryPresentation({ ...job, status, jobType: "finalize_document", recoveryPresentation: "legacy" })).toBe("legacy");
  });
  it("allows old-server finalize only; create generation is unknown", () => {
    expect(documentJobRecoveryPresentation({ ...job, jobType: "finalize_document", recoveryPresentation: undefined })).toBe("legacy");
    expect(documentJobRecoveryPresentation({ ...job, recoveryPresentation: undefined })).toBeNull();
  });
  it.each([
    undefined,
    { ...job, recoveryKind: null, recoveryPresentation: null },
    { ...job, recoveryPresentation: null },
    { ...job, jobType: "finalize_document", recoveryPresentation: "iframe" },
    { ...job, jobType: "unknown" },
    { ...job, status: "queued" },
    { ...job, status: "processing" },
    { ...job, status: "completed" },
    { ...job, source: "auto_finalize" },
    { ...job, source: undefined },
  ] as const)("keeps unsupported, pending and superseded metadata safe: %j", metadata => {
    expect(documentJobRecoveryPresentation(metadata)).toBeNull();
  });
});
