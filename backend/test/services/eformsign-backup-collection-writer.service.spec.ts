import { EformsignBackupCollectionWriter } from "application/services/eformsign-backup-collection-writer.service";
import { documentIdSetDigest } from "domain/eformsign-backup/collection-receipt";

const context = { configuredCompanyId: "company-1", trigger: "reconciliation" as const, lockMode: "valkey" as const };
function setup() {
    const repository = {
        begin: jest.fn().mockResolvedValue(undefined),
        append: jest.fn().mockResolvedValue(undefined),
        finish: jest.fn().mockResolvedValue(undefined),
    };
    return { repository, writer: new EformsignBackupCollectionWriter(repository) };
}

describe("EformsignBackupCollectionWriter", () => {
    it("exposes complete only after a successful final commit, persisting a candidate assessment", async () => {
        const { writer, repository } = setup();
        const session = await writer.begin(context);
        for (const documentType of ["01", "03", "04"] as const) {
            for (const pass of [1, 2] as const) {
                await session.page({ documentType, pass, ordinal: 0, startOffset: 0, requestedLimit: 100,
                    returnedCount: 0, totalCount: 0, terminal: true, outcome: "succeeded", failureCode: null });
                await session.scan({ documentType, pass, distinctIdCount: 0, documentIdSetSha256: documentIdSetDigest([]) });
            }
        }
        let commit!: () => void;
        repository.finish.mockImplementationOnce(() => new Promise<void>(resolve => { commit = resolve; }));
        const finishing = session.finish("succeeded");
        await Promise.resolve(); await Promise.resolve();
        expect(repository.finish.mock.calls[0][0].scanSummary.assessment.observedScan).toBe("incomplete");
        commit();
        expect((await finishing).observedScan).toBe("complete");
        expect(repository.append).toHaveBeenCalledTimes(6);
    });

    it("latches persistence failure and never promotes a duplicate finish", async () => {
        const { writer, repository } = setup();
        const session = await writer.begin(context);
        repository.append.mockRejectedValueOnce(new Error("provider secret customer-id"));
        await session.page({ documentType: "01", pass: 1, ordinal: 0, startOffset: 100, requestedLimit: 100,
            returnedCount: null, totalCount: null, terminal: null, outcome: "failed", failureCode: "fetch-failed" });
        expect((await session.finish("succeeded")).observedScan).toBe("incomplete");
        await session.finish("succeeded");
        expect(repository.finish).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(repository.finish.mock.calls)).not.toContain("provider secret");
    });
});

it("latches a rejected final transaction so late guards and repeated finish cannot complete", async () => {
    const { writer, repository } = setup();
    const session = await writer.begin(context);
    let lateGuard!: { isHealthy: () => boolean };
    repository.finish.mockImplementationOnce(async (_run, guard) => {
        lateGuard = guard;
        throw new Error("transaction deadline; failure marker unavailable");
    });
    expect((await session.finish("succeeded")).observedScan).toBe("incomplete");
    expect(lateGuard.isHealthy()).toBe(false);
    await session.finish("succeeded");
    expect(repository.finish).toHaveBeenCalledTimes(1);
});

it("does not fabricate a company or a start acknowledgement when start persistence fails", async () => {
    const { writer, repository } = setup();
    repository.begin.mockRejectedValueOnce(new Error("db unavailable"));
    const session = await writer.begin({ ...context, configuredCompanyId: null });
    expect(repository.begin.mock.calls[0][0].configuredCompanyId).toBeNull();
    expect((await session.finish("failed")).observedScan).toBe("incomplete");
    expect(repository.finish).not.toHaveBeenCalled();
});

it("keeps differing second-pass ID digests incomplete after commit", async () => {
    const { writer } = setup();
    const session = await writer.begin(context);
    for (const documentType of ["01", "03", "04"] as const) for (const pass of [1, 2] as const) {
        await session.page({ documentType, pass, ordinal: 0, startOffset: 0, requestedLimit: 100,
            returnedCount: 1, totalCount: 1, terminal: true, outcome: "succeeded", failureCode: null });
        await session.scan({ documentType, pass, distinctIdCount: 1,
            documentIdSetSha256: documentIdSetDigest([pass === 1 ? "one" : "two"]) });
    }
    expect((await session.finish("succeeded")).reasons).toContain("repeat-set-mismatch");
});

it("guards finalize with the current lease and returns incomplete if it is lost during commit acknowledgement", async () => {
    const { writer, repository } = setup();
    const session = await writer.begin(context);
    let held = true;
    repository.finish.mockImplementationOnce(async (_run, guard) => {
        held = false;
        expect(guard.isHealthy()).toBe(false);
    });
    expect((await session.finish("succeeded", () => held)).observedScan).toBe("incomplete");
});

it("represents unknown failed counts outside the strict 1A evaluator", async () => {
    const { writer } = setup();
    const session = await writer.begin(context);
    await session.page({ documentType: "01", pass: 1, ordinal: 0, startOffset: 0, requestedLimit: 100,
        returnedCount: null, totalCount: null, terminal: null, outcome: "failed", failureCode: "fetch-failed" });
    const assessment = await session.finish("failed");
    expect(assessment.observedScan).toBe("incomplete");
    expect(assessment.reasons).toContain("page-failed");
    expect(assessment.reasons).not.toContain("malformed-receipt");
});

it("retains all observed scan diagnostics after the first page append fails without resuming page writes", async () => {
    const { writer, repository } = setup();
    const session = await writer.begin(context);
    repository.append.mockRejectedValueOnce(new Error("database unavailable"));
    for (const documentType of ["01", "03", "04"] as const) for (const pass of [1, 2] as const) {
        await session.page({ documentType, pass, ordinal: 0, startOffset: 0, requestedLimit: 100,
            returnedCount: 0, totalCount: 0, terminal: true, outcome: "succeeded", failureCode: null });
        await session.scan({ documentType, pass, distinctIdCount: 0, documentIdSetSha256: documentIdSetDigest([]) });
    }
    expect((await session.finish("succeeded")).observedScan).toBe("incomplete");
    expect(repository.append).toHaveBeenCalledTimes(1);
    expect(repository.finish).toHaveBeenCalledTimes(1);
    const saved = repository.finish.mock.calls[0][0];
    expect(saved.outcome).toBe("failed");
    expect(saved.failureCode).toBe("persistence-unhealthy");
    expect(saved.scanSummary.scans).toEqual((["01", "03", "04"] as const).flatMap(documentType =>
        ([1, 2] as const).map(pass => ({ documentType, pass, outcome: "succeeded", distinctIdCount: 0,
            documentIdSetSha256: documentIdSetDigest([]), expectedPageCount: 1, persistedPageCount: 0,
            failureCode: "persistence-unhealthy" }))));
    expect(saved.scanSummary.assessment.observedScan).toBe("incomplete");
});
