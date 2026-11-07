import { projectManualBackupMilestone } from "domain/eformsign-backup/manual-backup-milestone";

const project = (kind: "contract" | "record", statusType: string, extra = {}) =>
    projectManualBackupMilestone({ kind, statusType, stepType: "", stepIndex: "", voidedAt: null, ...extra });

describe("manual backup positive current milestone", () => {
    it.each([
        ["001", "created", "created"], ["002", "created", "created"], ["003", "completed", "completed"],
        ["050", "completed", "completed"], ["072", "reviewed", "reviewed"], ["062", "signed", "completed"],
        ["030", "sent", "sent"], ["060", "sent", "sent"], ["063", "sent", "sent"],
        ["034", "opened", "sent"], ["064", "opened", "sent"], ["070", "signed", "sent"], ["071", "signed", "sent"],
    ])("projects literal %s separately for each kind", (status, contract, record) => {
        expect(project("contract", status)).toEqual({ kind: "contract", currentMilestone: contract, reasonCodes: status === "071" ? ["reviewer-rejected"] : [] });
        expect(project("record", status)).toEqual({ kind: "record", currentMilestone: record, reasonCodes: status === "071" ? ["reviewer-rejected"] : [] });
    });
    it.each(["011", "021", "031", "040", "042", "045", "047", "049", "061", "080", "090", "099", "012", "022", "032", "092", "010", "020", "041", "043", "unknown", "", "000"])("does not invent a stage for %s even on staff step", status => {
        for (const kind of ["contract", "record"] as const) expect(project(kind, status, { stepType: "06", stepIndex: "3" }))
            .toEqual({ kind, currentMilestone: null, reasonCodes: ["stage-unverified"] });
    });
    it.each(["001", "003", "062", "071", "072", "unknown"])("voiding overrides positive and exception status %s", status => {
        for (const kind of ["contract", "record"] as const) expect(project(kind, status, { voidedAt: new Date("2026-11-01") }))
            .toEqual({ kind, currentMilestone: null, reasonCodes: ["voided", "stage-unverified"] });
    });
    it.each(["060", "034", "064"])("recognizes customer finished evidence at staff step for %s", status => {
        for (const extra of [{ stepType: "06" }, { stepType: "6" }, { stepIndex: "3" }]) {
            expect(project("contract", status, extra).currentMilestone).toBe("signed");
            expect(project("record", status, extra).currentMilestone).toBe("sent");
        }
    });
    it.each([
        [" doc_complete ", "completed"], ["3", "completed"], [" 2 ", "created"],
        ["DOC_REQUEST_REVIEWER", "signed"], ["doc_reject_reviewer", "signed"],
        ["doc_accept_reviewer", "reviewed"], ["doc_accept_participant", "signed"],
        ["doc_open_participant", "opened"], ["doc_request_participant", "sent"], ["doc_rerequest_participant", "sent"],
    ])("normalizes legacy %s", (status, expected) => { expect(project("contract", status).currentMilestone).toBe(expected); });
    it("returns one current milestone without a reached-stage history", () => {
        expect(Object.keys(project("contract", "072")).sort()).toEqual(["currentMilestone", "kind", "reasonCodes"]);
        expect(project("contract", "071")).toEqual({ kind: "contract", currentMilestone: "signed", reasonCodes: ["reviewer-rejected"] });
        expect(project("record", "doc_accept_participant").currentMilestone).toBe("completed");
    });
});
