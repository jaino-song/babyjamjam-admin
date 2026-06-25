import { foldContractStats } from "@/lib/eformsign/status-codes";

// Pins the StatsBar bucket semantics currently in contracts/page.tsx:516-557.
// foldContractStats reads the raw signals the /api/documents/status-counts
// endpoint returns (status_type + the current step's recipient_type list)
// instead of iterating full eformsign doc objects.
describe("foldContractStats", () => {
  it("excludes completed and cancelled from all buckets", () => {
    expect(
      foldContractStats([
        { status_type: "003", step_recipient_types: [] }, // doc_complete → completed
        { status_type: "042", step_recipient_types: [] }, // doc_revoke → expired category but not 080
      ]),
    ).toEqual({ reviewNeeded: 0, sendRequired: 0, drafting: 0, expired: 0 });
  });

  it("counts only doc_expired (080) as expired", () => {
    expect(foldContractStats([{ status_type: "080", step_recipient_types: [] }]).expired).toBe(1);
    // 011 (doc_reject_approval) is in the expired category but is NOT 080 → counted nowhere
    expect(foldContractStats([{ status_type: "011", step_recipient_types: [] }]).expired).toBe(0);
  });

  it("counts draft (001) as drafting, before the reviewNeeded split", () => {
    expect(foldContractStats([{ status_type: "001", step_recipient_types: ["01"] }])).toEqual({
      reviewNeeded: 0,
      sendRequired: 0,
      drafting: 1,
      expired: 0,
    });
  });

  it("splits in-progress into reviewNeeded (all recipients internal) vs sendRequired", () => {
    expect(foldContractStats([{ status_type: "060", step_recipient_types: ["01"] }]).reviewNeeded).toBe(1);
    expect(foldContractStats([{ status_type: "060", step_recipient_types: ["02"] }]).sendRequired).toBe(1);
    // mixed recipients → not all internal → sendRequired
    expect(foldContractStats([{ status_type: "060", step_recipient_types: ["01", "02"] }]).sendRequired).toBe(1);
    // empty recipients → not reviewNeeded (matches mapDocStatusLabel: length > 0 required)
    expect(foldContractStats([{ status_type: "060", step_recipient_types: [] }]).sendRequired).toBe(1);
  });

  it("normalizes named status codes (reuses normalizeStatusCode)", () => {
    expect(foldContractStats([{ status_type: "doc_complete", step_recipient_types: [] }])).toEqual({
      reviewNeeded: 0,
      sendRequired: 0,
      drafting: 0,
      expired: 0,
    });
    expect(
      foldContractStats([{ status_type: "doc_request_participant", step_recipient_types: ["02"] }]).sendRequired,
    ).toBe(1);
  });

  it("tallies a mixed batch", () => {
    expect(
      foldContractStats([
        { status_type: "003", step_recipient_types: [] }, // completed → none
        { status_type: "080", step_recipient_types: [] }, // expired
        { status_type: "001", step_recipient_types: ["01"] }, // drafting (001 wins over recipients)
        { status_type: "060", step_recipient_types: ["01"] }, // reviewNeeded
        { status_type: "060", step_recipient_types: ["02"] }, // sendRequired
      ]),
    ).toEqual({ reviewNeeded: 1, sendRequired: 1, drafting: 1, expired: 1 });
  });
});
