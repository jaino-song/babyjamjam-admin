import { parseDocumentJobResendInput } from "./DocumentJobRecoverySummary";

const CONTRACT_DATA = { customerName: "김하늘", fullPrice: "1500000" };

describe("parseDocumentJobResendInput", () => {
  it("rebuilds a creation request from exactly the saved fields", () => {
    expect(
      parseDocumentJobResendInput("create_document", {
        clientId: 7,
        contractData: CONTRACT_DATA,
        supersedeDocumentId: "old-doc",
        requestKey: "never-forwarded",
      }),
    ).toEqual({
      kind: "create",
      request: { clientId: 7, contractData: CONTRACT_DATA, supersedeDocumentId: "old-doc" },
    });
  });

  it("omits supersedeDocumentId when it is absent or null", () => {
    for (const payload of [
      { clientId: 7, contractData: CONTRACT_DATA },
      { clientId: 7, contractData: CONTRACT_DATA, supersedeDocumentId: null },
    ]) {
      const result = parseDocumentJobResendInput("create_document", payload);
      expect(result?.request).not.toHaveProperty("supersedeDocumentId");
    }
  });

  it("rebuilds a finalization request", () => {
    expect(
      parseDocumentJobResendInput("finalize_document", { documentId: "doc-9", prefillEndDate: "2026-11-30" }),
    ).toEqual({ kind: "finalize", request: { documentId: "doc-9", prefillEndDate: "2026-11-30" } });
    expect(parseDocumentJobResendInput("finalize_document", { documentId: "doc-9" })).toEqual({
      kind: "finalize",
      request: { documentId: "doc-9" },
    });
  });

  it.each([
    ["no payload", "create_document", null],
    ["array payload", "create_document", [] as unknown as Record<string, unknown>],
    ["string client id", "create_document", { clientId: "7", contractData: CONTRACT_DATA }],
    ["fractional client id", "create_document", { clientId: 1.5, contractData: CONTRACT_DATA }],
    ["zero client id", "create_document", { clientId: 0, contractData: CONTRACT_DATA }],
    ["missing contract data", "create_document", { clientId: 7 }],
    ["array contract data", "create_document", { clientId: 7, contractData: [] }],
    ["non-string supersede id", "create_document", { clientId: 7, contractData: CONTRACT_DATA, supersedeDocumentId: 3 }],
    ["prefillAmounts on a creation", "create_document", { clientId: 7, contractData: CONTRACT_DATA, prefillAmounts: {} }],
    ["missing document id", "finalize_document", { prefillEndDate: "2026-11-30" }],
    ["empty document id", "finalize_document", { documentId: "" }],
    ["non-string end date", "finalize_document", { documentId: "doc-9", prefillEndDate: 20261130 }],
    ["prefillAmounts on a finalization", "finalize_document", { documentId: "doc-9", prefillAmounts: { fullPrice: "1" } }],
    ["creation payload on a finalization job", "finalize_document", { clientId: 7, contractData: CONTRACT_DATA }],
  ] as const)("fails closed on %s", (_label, jobType, payload) => {
    expect(parseDocumentJobResendInput(jobType, payload as Record<string, unknown> | null)).toBeNull();
  });
});
