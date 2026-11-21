import "reflect-metadata";
import { toEformsignDocumentJobResponse } from "interface/dto/eformsign-document-job.dto";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";
import { Logger } from "@nestjs/common";
import { setup, input } from "../utils/service-record-initial-recovery.fixture";
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
    it.each(["preparing", "sent"])("cancel then admin retry cannot requeue %s INITIAL generation", async progressStep => {
        const f = setup({ progressStep });
        expect(await f.repo.cancel(input)).toEqual({ kind: "cancelled" });
        const beforeJob = structuredClone(f.job), beforeState = structuredClone(f.state);
        const result = new ServiceRecordEditRepository(f.prisma as never).retryRevisionDocumentState({
            branchId, clientId: f.state.clientId, revisionId: f.state.revisionId, stateId: f.state.id,
            expectedGeneration: f.state.generation,
        });
        if (progressStep === "preparing") await expect(result).rejects.toThrow("Revision snapshot retry scope is unavailable");
        else await expect(result).resolves.toMatchObject({ status: "manual_review", step: "unknown" });
        expect(f.job).toEqual(beforeJob); expect(f.state).toEqual(beforeState);
    });
    it.each(["SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED", "PRE_SEND_RETRY_EXHAUSTED"])("listing uses verifier-backed retry flags for %s and no flags on other buckets", async lastErrorCode => {
        const f = setup({ lastErrorCode });
        const query = jest.fn().mockResolvedValueOnce([{ ...f.raw(), status: "queued", cancellable: false, retryable: false }])
            .mockResolvedValueOnce([{ ...f.raw(), cancellable: true, retryable: false }])
            .mockResolvedValueOnce([{ ...f.raw(), status: "completed", cancellable: false, retryable: false }]);
        const repo = new SbEformsignDocumentJobRepository({ ...f.prisma, $queryRaw: query } as never);
        const listed = await repo.listForBranch(branchId, new Date(0));
        expect(listed.requiresAttention[0]).toMatchObject({ retryable: true, cancellable: true });
        expect(toEformsignDocumentJobResponse(listed.requiresAttention[0]!)).toMatchObject({
            retryable: true, cancellable: true, recoveryKind: null, recoveryPresentation: null, lastErrorCode: null,
        });
        expect(listed.active[0]).toMatchObject({ retryable: false, cancellable: false });
        expect(listed.recent[0]).toMatchObject({ retryable: false, cancellable: false });
        f.state.status = "processing";
        query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...f.raw(), cancellable: true, retryable: false }]).mockResolvedValueOnce([]);
        expect((await repo.listForBranch(branchId, new Date(0))).requiresAttention[0]).toMatchObject({ retryable: false, cancellable: true });
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
