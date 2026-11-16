import {
    initialFinalizationRequestKey,
    isInitialFinalizationJobIdentity,
    isInitialFinalizationWorkflowScope,
} from "application/policies/service-record-initial-finalization.policy";

const requestKey = "service-record-initial-finalization:revision-1";
const identity = {
    jobType: "create_document", source: "auto_finalize", documentId: null, requestKey,
    payload: {
        kind: "service_record_revision", generationKind: "INITIAL_FINALIZATION",
        revisionId: "revision-1", context: { revisionId: "revision-1" }, snapshotReference: requestKey,
    },
};

describe("initial finalization identity", () => {
    it("accepts only the complete initial identity", () => {
        expect(initialFinalizationRequestKey("revision-1")).toBe(requestKey);
        expect(isInitialFinalizationJobIdentity(identity)).toBe(true);
    });
    it.each([
        { jobType: "finalize_document" }, { source: "staff" }, { documentId: "doc-1" },
        { documentId: undefined }, { requestKey: `${requestKey}:extra` }, { payload: null },
        ...[
            { kind: "operations" }, { generationKind: "REVISION_SNAPSHOT" },
            { revisionId: "revision-2" }, { revisionId: "" }, { context: {} },
            { context: { revisionId: "revision-2" } }, { snapshotReference: "other" },
        ].map((payload) => ({ payload: { ...identity.payload, ...payload } })),
    ])("rejects an altered identity %#", (change) => {
        expect(isInitialFinalizationJobIdentity({ ...identity, ...change })).toBe(false);
    });
    it("requires both workflow discriminators", () => {
        expect(isInitialFinalizationWorkflowScope({ generationKind: "INITIAL_FINALIZATION", requestKey }, requestKey)).toBe(true);
        for (const scope of [null, {}, { requestKey }, { generationKind: "REVISION_SNAPSHOT", requestKey },
            { generationKind: "INITIAL_FINALIZATION", requestKey: "other" }]) {
            expect(isInitialFinalizationWorkflowScope(scope, requestKey)).toBe(false);
        }
    });
});
