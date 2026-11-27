import { Prisma } from "@prisma/client";

import {
    initialFinalizationGenerationRequestKey,
    initialFinalizationRequestKey,
    isInitialFinalizationJobIdentity,
    isInitialFinalizationRequestKeyFor,
    isInitialFinalizationWorkflowScopeForRevision,
} from "application/policies/service-record-initial-finalization.policy";
import { initialFinalizationRequestKeyForSql } from "infrastructure/database/utils/service-record-initial-recovery-sql";

const revisionId = "revision-1";
const generation = "00000000-0000-4000-8000-000000000021";
const legacyKey = "service-record-initial-finalization:revision-1";

describe("INITIAL finalization request keys", () => {
    it("accepts the legacy key", () => {
        expect(isInitialFinalizationRequestKeyFor(revisionId, legacyKey)).toBe(true);
    });

    it("accepts the generation key", () => {
        const key = initialFinalizationGenerationRequestKey(revisionId, generation);
        expect(key).toBe(`${legacyKey}:${generation}`);
        expect(isInitialFinalizationRequestKeyFor(revisionId, key)).toBe(true);
    });

    it.each([
        "service-record-initial-finalization:revision-10",
        `service-record-initial-finalization:revision-10:${generation}`,
    ])("rejects another revision's key %p", (key) => {
        expect(isInitialFinalizationRequestKeyFor(revisionId, key)).toBe(false);
    });

    it.each(["", "extra", `${generation}\n`, `${generation}:extra`, `:${generation}`])(
        "rejects the malformed generation suffix %p",
        (suffix) => {
            expect(isInitialFinalizationRequestKeyFor(revisionId, `${legacyKey}:${suffix}`)).toBe(false);
            expect(() => initialFinalizationGenerationRequestKey(revisionId, suffix)).toThrow(RangeError);
        },
    );

    it("fits the request_key VARCHAR(255) limit", () => {
        const prefixLength = initialFinalizationRequestKey("").length;
        const longestRevisionId = "r".repeat(255 - prefixLength - 1 - generation.length);
        const key = initialFinalizationGenerationRequestKey(longestRevisionId, generation);
        expect(key).toHaveLength(255);
        expect(isInitialFinalizationRequestKeyFor(longestRevisionId, key)).toBe(true);
        const tooLongRevisionId = `${longestRevisionId}r`;
        expect(() => initialFinalizationGenerationRequestKey(tooLongRevisionId, generation)).toThrow(RangeError);
        expect(isInitialFinalizationRequestKeyFor(tooLongRevisionId, `${initialFinalizationRequestKey(tooLongRevisionId)}:${generation}`)).toBe(false);
    });

    it("classifies a generation key while retaining the job's exact snapshot reference binding", () => {
        const requestKey = initialFinalizationGenerationRequestKey(revisionId, generation);
        const job = {
            jobType: "create_document", source: "auto_finalize", documentId: null, requestKey,
            payload: {
                kind: "service_record_revision", generationKind: "INITIAL_FINALIZATION",
                revisionId, generation, context: { revisionId }, snapshotReference: requestKey,
            },
        };
        const scope = { generationKind: "INITIAL_FINALIZATION", requestKey };
        expect(isInitialFinalizationWorkflowScopeForRevision(scope, revisionId)).toBe(true);
        expect(isInitialFinalizationJobIdentity(job)).toBe(true);
        expect(isInitialFinalizationJobIdentity({ ...job, payload: { ...job.payload, snapshotReference: legacyKey } })).toBe(false);
    });

    it("binds values in the SQL predicate", () => {
        const key = initialFinalizationGenerationRequestKey(revisionId, generation);
        const sql = initialFinalizationRequestKeyForSql(Prisma.sql`${revisionId}`, Prisma.sql`${key}`);
        expect(new Set(sql.values)).toEqual(new Set([revisionId, key]));
        expect(sql.text).not.toContain(revisionId);
        expect(sql.text).not.toContain(key);
    });
});
