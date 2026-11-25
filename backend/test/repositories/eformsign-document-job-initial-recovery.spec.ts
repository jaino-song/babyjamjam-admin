import "reflect-metadata";
import { toEformsignDocumentJobResponse } from "interface/dto/eformsign-document-job.dto";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";
import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { INITIAL_FINALIZATION_CANCELLABLE_STATE_STATUSES, initialFinalizationCancellableSql } from "infrastructure/database/utils/service-record-initial-recovery-sql";
import { setup, input } from "../utils/service-record-initial-recovery.fixture";
import * as dispatchPolicy from "application/policies/service-record-revision-state.policy";
const { branchId, jobId } = input;

describe("staff INITIAL recovery", () => {
    let log: jest.SpyInstance;
    beforeEach(() => { log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined); });
    afterEach(() => log.mockRestore());
    it.each(["SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED", "PRE_SEND_RETRY_EXHAUSTED"])("retries %s in one bounded transaction", async code => {
        const f = setup({ lastErrorCode: code });
        expect(await f.repo.retry(input)).toEqual({ kind: "retried", jobId, status: "queued" });
        expect(f.job.createdByUserId).toBeNull();
        expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20000 });
        expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: "retry", jobId, userId: input.userId }));
        const locks = f.queries.filter(q => q.text.includes("FOR UPDATE")).map(q => q.text);
        expect(locks[0]).toContain('FROM "client"');
        expect(locks.findIndex(q => q.includes('FROM "service_record_case"'))).toBeLessThan(locks.findIndex(q => q.includes('FROM "eformsign_document_job"')));
        expect(await f.repo.retry(input)).toEqual({ kind: "not_retryable" });
    });
    it.each(["dispatch_authorized", "creating", "sent", "reconciling", "cancelled"])("refuses retry with %s evidence", async progressStep => {
        const f = setup({ progressStep });
        expect(await f.repo.retry(input)).toEqual({ kind: "not_retryable" });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    });
    it.each([{ lastErrorCode: "UNRELATED" }, { lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH" }, { leaseToken: jobId },
        { status: "queued" }, { source: "staff" }, { requestKey: "service-record-not-initial" }])("refuses retry for %j", async change => {
        const f = setup(change);
        expect(await f.repo.retry(input)).toEqual({ kind: "not_retryable" });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    });
    it("refuses cross-branch reads before locks", async () => {
        const f = setup({ branchId: jobId });
        expect(await f.repo.retry(input)).toEqual({ kind: "not_found" });
        expect(await f.repo.cancel(input)).toEqual({ kind: "not_found" });
        expect(f.queries).toEqual([]);
    });
    it("refuses a branch-owned INITIAL job with malformed context as not_retryable", async () => {
        const f = setup();
        f.job.payload.context = { ...f.job.payload.context, formVersion: 0 };
        expect(await f.repo.retry(input)).toEqual({ kind: "not_retryable" });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
        expect(f.queries.some(q => q.text.includes("FOR UPDATE"))).toBe(false);
    });
    it("refuses retry and cancel for null planned date entries without writes", async () => {
        const f = setup();
        f.job.payload.context = { ...f.job.payload.context, plannedSessionDates: [null] } as never;
        expect(await f.repo.retry(input)).toEqual({ kind: "not_retryable" });
        expect(await f.repo.cancel(input)).toMatchObject({ kind: "not_cancellable" });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
        expect(f.queries.some(q => q.text.includes("FOR UPDATE"))).toBe(false);
    });
    it.each(["queued", "processing", "reconciling"])("refuses cancel for %s", async status => {
        const f = setup({ status });
        expect(await f.repo.cancel(input)).toMatchObject({ kind: "not_cancellable" });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    });
    it("refuses a leased stopped job", async () => {
        const f = setup({ leaseToken: jobId });
        expect(await f.repo.cancel(input)).toMatchObject({ kind: "not_cancellable" });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    });
    it.each(["cancelled", "post-dispatch"])("replays %s cancellation without locks", async marker => {
        const f = setup(marker === "cancelled" ? { progressStep: marker } : { progressStep: "sent", lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH" });
        expect(await f.repo.cancel(input)).toEqual({ kind: "already_cancelled" });
        expect(f.queries).toEqual([]);
    });
    it.each(["pending", "capability_unverified"])("pre-dispatch cancellation keeps payload and fails %s state", async status => {
        const f = setup({}, { status });
        expect(await f.repo.cancel(input)).toEqual({ kind: "cancelled" });
        const writes = f.queries.filter(q => q.text.includes("UPDATE" ) && !q.text.includes("FOR UPDATE"));
        expect(writes).toHaveLength(2);
        expect(writes.map(q => q.text).join("\n")).toContain("active_key = NULL");
        expect(writes.map(q => q.text).join("\n")).not.toMatch(/payload\s*=/);
        expect(writes.map(q => q.text).join("\n")).toContain("status = 'failed'");
        expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: "cancel", jobId, userId: input.userId }));
    });
    it.each(["dispatch_authorized", "creating", "sent"])("post-dispatch cancellation preserves %s evidence and blocks state retry", async progressStep => {
        const f = setup({ progressStep }, { status: "processing" });
        expect(await f.repo.cancel(input)).toEqual({ kind: "cancelled" });
        const writes = f.queries.filter(q => q.text.includes("UPDATE") && !q.text.includes("FOR UPDATE"));
        expect(writes.map(q => q.text).join("\n")).toContain("manual_review");
        expect(writes.map(q => q.text).join("\n")).toContain("unknown");
        const jobWrite = writes.find(q => q.text.includes('UPDATE "eformsign_document_job"'))!;
        expect(jobWrite.text).not.toMatch(/(?:payload|active_key|progress_step|progress_detail)\s*=/);
        expect(jobWrite.values).toContain("JOB_CANCELLED_AFTER_DISPATCH");
    });
    it.each(["completed", "not_required", "superseded", "failed", "manual_review", "unknown",
        "waiting_for_completion", "waiting_for_signature", "unrecognized"])("refuses cancellation without writes for %s revision state", async status => {
        const f = setup({ progressStep: "sent" }, { status });
        const beforeJob = structuredClone(f.job), beforeState = structuredClone(f.state);
        expect(await f.repo.cancel(input)).toMatchObject({ kind: "not_cancellable" });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
        expect(f.job).toEqual(beforeJob);
        expect(f.state).toEqual(beforeState);
    });
    it("binds listing cancellation to unresolved revision statuses", () => {
        const sql = initialFinalizationCancellableSql();
        expect(sql.text).toContain("s.status IN ('capability_unverified', 'pending', 'processing')");
        expect(INITIAL_FINALIZATION_CANCELLABLE_STATE_STATUSES).toEqual(["capability_unverified", "pending", "processing"]);
        expect(sql.values).toEqual([]);
    });
    it("matches the UUID state lookup's case-insensitivity without casting malformed JSON", async () => {
        const stateId = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
        const f = setup({}, { id: stateId });
        f.job.payload.documentStateId = stateId.toUpperCase();
        expect(await f.repo.retry(input)).toMatchObject({ kind: "retried" });
        expect(f.queries.find(sql => sql.text.includes('FROM "service_record_revision_document_state"'))?.values)
            .toContain(stateId.toUpperCase());
        const sql = initialFinalizationCancellableSql();
        expect(sql.text).toContain("lower(j.payload->>'documentStateId') = s.id::text");
        expect(sql.text).not.toContain("(j.payload->>'documentStateId')::uuid");
        expect(sql.text).toContain("to_jsonb(s.revision_id::text) = j.payload->'revisionId'");
        expect(sql.text).toContain("to_jsonb(s.service_record_case_id::text) = j.payload->'context'->'serviceRecordCaseId'");
    });
    it.each(["generation", "revisionId"])("preserves a later state with changed %s", async field => {
        const f = setup({ progressStep: "sent" }, { status: "processing", [field]: jobId });
        const before = structuredClone(f.state);
        expect(await f.repo.cancel(input)).toMatchObject({ kind: "not_cancellable" });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
        expect(f.state).toEqual(before);
    });
    it.each(["generation", "revisionId"])("keeps a job with changed state %s in requiresAttention without recovery actions", async field => {
        const f = setup({ progressStep: "sent" }, { status: "processing", [field]: jobId });
        const beforeJob = structuredClone(f.job), beforeState = structuredClone(f.state);
        let attentionQuery: Prisma.Sql | undefined;
        const query = jest.fn(async (sql: Prisma.Sql) => {
            if (sql.text.includes("AS cancellable") && !sql.text.includes("false AS cancellable")) {
                attentionQuery = sql;
                return [{ ...f.raw(), cancellable: false, retryable: false }];
            }
            return [];
        });
        const repo = new SbEformsignDocumentJobRepository({ ...f.prisma, $queryRaw: query } as never);

        const list = await repo.listForBranch(branchId, new Date(0));

        expect(list.requiresAttention.find(job => job.id === jobId)).toMatchObject({ retryable: false, cancellable: false });
        // The historical exclusion must prove the state's original identity before
        // checking its owner/newest generation. A moved state is still reportable.
        const historicalExclusion = attentionQuery!.text.split("AND NOT ").at(-1)!;
        expect(historicalExclusion).toContain("to_jsonb(s.revision_id::text) = j.payload->'revisionId'");
        expect(historicalExclusion).toContain("to_jsonb(s.service_record_case_id::text) = j.payload->'context'->'serviceRecordCaseId'");
        expect(historicalExclusion).toContain("to_jsonb(s.generation) = j.payload->'generation'");
        expect(await f.repo.cancel(input)).toMatchObject({ kind: "not_cancellable" });
        expect(await f.repo.retry(input)).toEqual({ kind: "not_retryable" });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
        expect(f.job).toEqual(beforeJob);
        expect(f.state).toEqual(beforeState);
    });
    it.each(["pending", "capability_unverified"])("history and admin retry refuse a cancelled %s generation", async status => {
        const f = setup({}, { status });
        expect(await f.repo.cancel(input)).toEqual({ kind: "cancelled" });
        const read = f.tx.$queryRaw.getMockImplementation()!;
        f.tx.$queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
            if (sql.text.includes('FROM "service_record_case"')) return [{ caseId: f.state.serviceRecordCaseId,
                caseVersion: 1, currentRevisionId: f.state.revisionId, currentUsableRevisionId: null }];
            if (sql.text.includes('FROM "service_record_revision"')) return [{ id: f.state.revisionId,
                revisionNumber: 1, confirmedAt: new Date() }];
            return read(sql);
        });
        const repo = new ServiceRecordEditRepository(f.prisma as never);
        const history = await repo.listRevisionHistory(branchId, f.state.clientId);
        expect(history?.revisions[0]?.documents[0]).toMatchObject({ status: "failed", canRetry: false });
        expect(f.state).toMatchObject({ status: "failed", step: "unknown" });
        const before = structuredClone(f.state);
        f.tx.$executeRaw.mockClear();
        expect(await repo.retryRevisionDocumentState({ branchId, clientId: f.state.clientId,
            revisionId: f.state.revisionId, stateId: f.state.id, expectedGeneration: f.state.generation,
        })).toMatchObject({ status: "failed", step: "unknown" });
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
        expect(f.state).toEqual(before);
    });
    it.each(["preparing", "sent"])("cancel then admin retry cannot requeue %s INITIAL generation", async progressStep => {
        const f = setup({ progressStep });
        expect(await f.repo.cancel(input)).toEqual({ kind: "cancelled" });
        const beforeJob = structuredClone(f.job), beforeState = structuredClone(f.state);
        const result = new ServiceRecordEditRepository(f.prisma as never).retryRevisionDocumentState({
            branchId, clientId: f.state.clientId, revisionId: f.state.revisionId, stateId: f.state.id,
            expectedGeneration: f.state.generation,
        });
        if (progressStep === "preparing") await expect(result).resolves.toMatchObject({ status: "failed", step: "unknown" });
        else await expect(result).resolves.toMatchObject({ status: "manual_review", step: "unknown" });
        expect(f.job).toEqual(beforeJob); expect(f.state).toEqual(beforeState);
    });
    it.each(["SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED", "PRE_SEND_RETRY_EXHAUSTED"])("listing uses verifier-backed retry flags for %s and no flags on other buckets", async lastErrorCode => {
        const f = setup({ lastErrorCode });
        const query = jest.fn().mockImplementation(f.tx.$queryRaw).mockResolvedValueOnce([]).mockResolvedValueOnce([f.raw()]).mockResolvedValueOnce([{ ...f.raw(), status: "queued", cancellable: false, retryable: false }])
            .mockResolvedValueOnce([{ ...f.raw(), cancellable: true, retryable: false }])
            .mockResolvedValueOnce([{ ...f.raw(), status: "completed", cancellable: false, retryable: false }]);
        const repo = new SbEformsignDocumentJobRepository({ ...f.prisma, $queryRaw: query } as never);
        const listed = await repo.listForBranch(branchId, new Date(0));
        expect(listed.requiresAttention[0]).toMatchObject({ retryable: true, cancellable: true });
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
        expect(f.queries.every(sql => !sql.text.includes("FOR UPDATE"))).toBe(true);
        expect(toEformsignDocumentJobResponse(listed.requiresAttention[0]!)).toMatchObject({
            retryable: true, cancellable: true, recoveryKind: null, recoveryPresentation: null, lastErrorCode: null,
        });
        expect(listed.active[0]).toMatchObject({ retryable: false, cancellable: false });
        expect(listed.recent[0]).toMatchObject({ retryable: false, cancellable: false });
        f.state.status = "processing";
        query.mockResolvedValueOnce([]).mockResolvedValueOnce([f.raw()]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...f.raw(), cancellable: true, retryable: false }]).mockResolvedValueOnce([]);
        expect((await repo.listForBranch(branchId, new Date(0))).requiresAttention[0]).toMatchObject({ retryable: false, cancellable: true });
    });
    it("treats preparing with processing state as post-dispatch cancellation", async () => {
        const f = setup({ progressStep: "preparing" }, { status: "processing" });
        const before = structuredClone(f.job);
        expect(await f.repo.cancel(input)).toEqual({ kind: "cancelled" });
        expect(f.job).toEqual({ ...before, status: "failed", lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH" });
        expect(f.state).toMatchObject({ status: "manual_review", step: "unknown", lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH" });
        expect(f.job.activeKey).toBe(before.activeKey);
    });
    it.each(["invalid", "branch", "client"])("listing refuses flags for %s INITIAL context without opening a transaction", async variant => {
        const f = setup();
        const context = { ...f.job.payload.context, ...(variant === "invalid" ? { formVersion: 0 }
            : variant === "branch" ? { branchId: jobId } : { clientId: 8 }) };
        const query = jest.fn().mockResolvedValue([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ ...f.raw(), payload: { ...f.job.payload, context }, cancellable: true, retryable: true }])
            .mockResolvedValueOnce([]);
        const repo = new SbEformsignDocumentJobRepository({ ...f.prisma, $queryRaw: query } as never);
        expect((await repo.listForBranch(branchId, new Date(0))).requiresAttention[0])
            .toMatchObject({ retryable: false, cancellable: false });
        expect(query).toHaveBeenCalledTimes(7);
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
    });
    it("summary counts only context-valid actionable INITIAL rows and merges contract ids in time order", async () => {
        const f = setup();
        const initial = { ...f.raw(), completed_at: new Date("2026-01-02"), created_at: new Date("2026-01-01") };
        const query = jest.fn().mockResolvedValue([]).mockResolvedValueOnce([{ active_count: 0, attention_count: 4, failed_count: 1, unresolved_count: 1 }])
            .mockResolvedValueOnce([{ id: "contract", completed_at: new Date("2026-01-01"), created_at: new Date("2026-01-01") }])
            .mockResolvedValueOnce([initial, { ...initial, id: "invalid", payload: { ...f.job.payload,
                context: { ...f.job.payload.context, formVersion: 0 } } }]);
        const repo = new SbEformsignDocumentJobRepository({ ...f.prisma, $queryRaw: query } as never);
        expect(await repo.getSummary(branchId)).toMatchObject({ requiresAttentionCount: 4, unresolvedCount: 2, unresolvedJobIds: [jobId, "contract"] });
        const initialSql = query.mock.calls[2]![0] as Prisma.Sql;
        expect(initialSql.text).toContain(initialFinalizationCancellableSql().text);
        expect(initialSql.values).toContain(branchId);
        expect(initialSql.text).not.toContain("LIMIT");
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
    });
    it.each(["malformed JSON", "validator exception"])("keeps an older INITIAL row report-only for %s while returning valid list and summary rows", async failure => {
        const f = setup({ progressStep: "sent" });
        const valid = [100, 101].map(id => ({ ...f.raw(),
            id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
            completed_at: new Date("2026-02-01"), created_at: new Date("2026-02-01"),
            cancellable: true, retryable: false }));
        const invalid = { ...f.raw(), id: "00000000-0000-4000-8000-000000000099",
            completed_at: new Date("2026-01-01"), created_at: new Date("2026-01-01"),
            payload: { ...f.job.payload, context: { ...f.job.payload.context, plannedSessionDates: [null] } },
            cancellable: true, retryable: true };
        const validate = dispatchPolicy.isValidServiceRecordDispatchContext;
        const spy = jest.spyOn(dispatchPolicy, "isValidServiceRecordDispatchContext").mockImplementation(context => {
            if (failure === "validator exception" && context === invalid.payload.context) throw new Error("validation failed");
            return validate(context);
        });
        let attentionQuery: Prisma.Sql | undefined;
        const query = jest.fn(async (sql: Prisma.Sql) => {
            if (sql.text.includes("AS active_count")) return [{ unresolved_count: 0 }];
            if (sql.text.includes("SELECT id, completed_at")) return [];
            if (sql.text.includes("SELECT j.id, j.completed_at")) return [invalid, ...valid];
            if (sql.text.includes("AS cancellable") && !sql.text.includes("false AS cancellable")) {
                attentionQuery = sql;
                return [...valid, invalid];
            }
            return [];
        });
        const repo = new SbEformsignDocumentJobRepository({ ...f.prisma, $queryRaw: query } as never);
        try {
            expect(await repo.getSummary(branchId)).toMatchObject({ unresolvedCount: 2, unresolvedJobIds: valid.map(row => row.id) });
            const list = await repo.listForBranch(branchId, new Date(0));
            expect(list.requiresAttention.map(row => row.id)).toEqual([...valid.map(row => row.id), invalid.id]);
            expect(list.requiresAttention.slice(0, 2).every(row => row.cancellable)).toBe(true);
            expect(list.requiresAttention[2]).toMatchObject({ id: invalid.id, cancellable: false, retryable: false });
            expect(attentionQuery?.values).toEqual([branchId, "superseded", ...valid.map(row => row.id), 50]);
            expect(f.prisma.$transaction).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });
    it.each([1, 51])("reserves the list's first slots for the same capped popup ids with %s actionable INITIAL rows", async count => {
        const f = setup({ progressStep: "sent" });
        const old = new Date("2026-01-01");
        const initial = Array.from({ length: count }, (_, index) => ({ ...f.raw(),
            id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
            completed_at: old, created_at: old, cancellable: true, retryable: false }));
        const invalid = { ...initial[0], id: "00000000-0000-4000-8000-000000000099",
            payload: { ...f.job.payload, context: { ...f.job.payload.context, formVersion: 0 } } };
        const reportOnly = Array.from({ length: 51 }, (_, index) => ({ ...f.raw(),
            id: `00000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`,
            completed_at: new Date("2026-02-01"), created_at: new Date("2026-02-01"),
            payload: invalid.payload, cancellable: false, retryable: false }));
        const contract = { ...f.raw(), id: "00000000-0000-4000-8000-000000000090",
            source: "staff", request_key: "contract-recovery", payload: null, completed_at: old, created_at: old, cancellable: true };
        const expectedIds = [contract.id, ...initial.map(row => row.id)].slice(0, 50);
        let attentionQuery: Prisma.Sql | undefined;
        const query = jest.fn(async (sql: Prisma.Sql) => {
            if (sql.text.includes("AS active_count")) return [{ unresolved_count: 1 }];
            if (sql.text.includes("SELECT id, completed_at")) return [contract];
            if (sql.text.includes("SELECT j.id, j.completed_at")) return [...initial, invalid];
            if (sql.text.includes("AS cancellable") && !sql.text.includes("false AS cancellable")) {
                attentionQuery = sql;
                return [...[contract, ...initial].filter(row => expectedIds.includes(row.id)), ...reportOnly].slice(0, 50);
            }
            return [];
        });
        const repo = new SbEformsignDocumentJobRepository({ ...f.prisma, $queryRaw: query } as never);
        const summary = await repo.getSummary(branchId);
        const list = await repo.listForBranch(branchId, new Date(0), 1);
        expect(summary).toMatchObject({ unresolvedCount: count + 1, unresolvedJobIds: expectedIds });
        expect(list.requiresAttention).toHaveLength(50);
        expect(list.requiresAttention.slice(0, expectedIds.length).map(row => row.id)).toEqual(expectedIds);
        expect(attentionQuery?.text).toMatch(/ORDER BY array_position\(ARRAY\[[\s\S]+?\], j\.id\) ASC NULLS LAST,\s+j\.completed_at DESC NULLS LAST, j\.created_at DESC, j\.id ASC/);
        expect(attentionQuery?.values).toEqual([branchId, "superseded", ...expectedIds, 50]);
        // No context-invalid INITIAL row can consume one of the reserved slots.
        expect(attentionQuery?.values).not.toContain(invalid.id);
        expect(query.mock.calls.filter(([sql]) => sql.text.includes("SELECT id, completed_at"))
            .every(([sql]) => sql.values.at(-1) === 50)).toBe(true);
    });
    it("rolls back state requeue when the job CAS loses", async () => {
        const f = setup(), beforeState = structuredClone(f.state);
        const read = f.tx.$queryRaw.getMockImplementation()!;
        f.tx.$queryRaw.mockImplementation(async sql => sql.text.includes('UPDATE "eformsign_document_job"') ? [] : read(sql));
        expect(await f.repo.retry(input)).toEqual({ kind: "not_retryable" });
        expect(f.state).toEqual(beforeState);
        expect(f.job.status).toBe("failed");
    });
    it("rolls back the revision state when cancellation loses its job CAS", async () => {
        const f = setup(), before = structuredClone(f.state);
        const execute = f.tx.$executeRaw.getMockImplementation()!;
        f.tx.$executeRaw.mockImplementation(async sql => sql.text.includes('UPDATE "eformsign_document_job"') ? 0 : execute(sql));
        expect(await f.repo.cancel(input)).toMatchObject({ kind: "not_cancellable" });
        expect(f.state).toEqual(before);
    });
    it("preserves progress-detail send evidence even if the step is still preparing", async () => {
        const f = setup({ progressDetail: "creating" });
        expect(await f.repo.retry(input)).toEqual({ kind: "not_retryable" });
        expect(await f.repo.cancel(input)).toEqual({ kind: "cancelled" });
        expect(f.job).toMatchObject({ progressStep: "preparing", progressDetail: "creating", lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH" });
        expect(f.state).toMatchObject({ status: "manual_review", step: "unknown" });
    });

});
