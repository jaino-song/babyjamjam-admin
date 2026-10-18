import { createHash } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { EformsignBackupExportService } from "application/services/eformsign-backup-export.service";
import {
    EXPORT_ARTIFACT_MAX_BYTES,
    EXPORT_POLICY_REVISION,
    EXPORT_SCOPE_REVISION,
    ExportError,
    encodeExportCursor,
    exportRequestHash,
    type ExportErrorCode,
    type ExportPrincipal,
} from "domain/eformsign-backup/export";
import type { SbEformsignBackupExportRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export.repository";

const COMPANY = "company-1";
const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY = "a".repeat(64);
const KEY = "key-1";
const principal: ExportPrincipal = { credentialId: "cred-1", principalId: "worker-1", companyIds: [COMPANY] };
const body = { companyId: COMPANY, scopeRevision: EXPORT_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION };
const BYTES = Buffer.from("%PDF-1.4 synthetic");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const HOUR = 3_600_000;

type Repo = { [K in keyof SbEformsignBackupExportRepository]: jest.Mock };
const FUTURE = () => new Date(Date.now() + HOUR);
const PAST = () => new Date(Date.now() - HOUR);

function snapshotRecord(overrides: Record<string, unknown> = {}) {
    return {
        id: SNAPSHOT_ID, principalId: principal.principalId, companyId: COMPANY,
        scopeRevision: EXPORT_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION,
        idempotencyKey: KEY, requestHash: exportRequestHash(body), status: "ready",
        counts: { total: 1, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0, included: 1 },
        failureCode: null, createdAt: new Date(), readyAt: new Date(), expiresAt: FUTURE(), ...overrides,
    };
}

function doc(overrides: Record<string, unknown> = {}) {
    return {
        documentId: "D001", documentKind: "contract", statusType: "003", templateId: null,
        permanentPurgeRequestedAt: null, voidedAt: null, detailPayloadIsNull: false, ...overrides,
    };
}

function setup(configured: string | null = COMPANY) {
    const repository = {
        readSourceForSnapshot: jest.fn(),
        findSnapshotByIdempotency: jest.fn().mockResolvedValue(null),
        findSnapshot: jest.fn().mockResolvedValue(snapshotRecord()),
        createReadySnapshot: jest.fn(),
        recordFailedSnapshot: jest.fn(),
        listCandidates: jest.fn(),
        findCandidateArtifact: jest.fn().mockResolvedValue({ documentId: "D001", fileType: "document", sha256: SHA, byteSize: BYTES.length }),
        readArtifactForDownload: jest.fn(),
    } as Repo;
    const config = { get: jest.fn((key: string) => (key === "EFORMSIGN_COMPANY_ID" ? configured ?? undefined : undefined)) };
    const service = new EformsignBackupExportService(repository as never, config as unknown as ConfigService);
    return { repository, config, service };
}

async function codeOf(promise: Promise<unknown>): Promise<ExportError> {
    const error = await promise.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ExportError);
    return error as ExportError;
}
async function expectCode(promise: Promise<unknown>, code: ExportErrorCode): Promise<ExportError> {
    const error = await codeOf(promise);
    expect(error.code).toBe(code);
    return error;
}

describe("EformsignBackupExportService", () => {
    describe("construction", () => {
        it("depends only on the export repository and ConfigService (no mirror, provider or event service)", () => {
            const params = Reflect.getMetadata("design:paramtypes", EformsignBackupExportService) as Array<{ name: string }>;
            expect(params.map(p => p.name)).toEqual(["SbEformsignBackupExportRepository", "ConfigService"]);
        });
    });

    describe("createSnapshot", () => {
        it("configured company missing or blank -> EXPORT_UNAVAILABLE before any repository call", async () => {
            for (const configured of [null, "", "   "]) {
                const { service, repository } = setup(configured);
                await expectCode(service.createSnapshot(principal, body, KEY), "EXPORT_UNAVAILABLE");
                expect(repository.findSnapshotByIdempotency).not.toHaveBeenCalled();
                expect(repository.readSourceForSnapshot).not.toHaveBeenCalled();
            }
        });

        it("configured company failing assertIdentifier -> EXPORT_UNAVAILABLE with reasonCode company-id-invalid", async () => {
            const { service } = setup("bad company!");
            const error = await expectCode(service.createSnapshot({ ...principal, companyIds: ["bad company!"] },
                { ...body, companyId: "bad company!" }, KEY), "EXPORT_UNAVAILABLE");
            expect(error.reasonCode).toBe("company-id-invalid");
        });

        it("configured company is trimmed", async () => {
            const { service, repository } = setup(`  ${COMPANY}  `);
            repository.findSnapshotByIdempotency.mockResolvedValue(snapshotRecord());
            await expect(service.createSnapshot(principal, body, KEY)).resolves.toMatchObject({ snapshotId: SNAPSHOT_ID });
        });

        it("requested company outside the allowlist or different from the configured one -> NOT_FOUND", async () => {
            const { service, repository } = setup();
            await expectCode(service.createSnapshot({ ...principal, companyIds: ["other"] }, body, KEY), "NOT_FOUND");
            await expectCode(service.createSnapshot(principal, { ...body, companyId: "other" }, KEY), "NOT_FOUND");
            await expectCode(service.createSnapshot({ ...principal, companyIds: ["other"] }, { ...body, companyId: "other" }, KEY), "NOT_FOUND");
            expect(repository.findSnapshotByIdempotency).not.toHaveBeenCalled();
        });

        it("unsupported revisions -> UNSUPPORTED_REVISION before the idempotency lookup", async () => {
            const { service, repository } = setup();
            await expectCode(service.createSnapshot(principal, { ...body, scopeRevision: "old" }, KEY), "UNSUPPORTED_REVISION");
            await expectCode(service.createSnapshot(principal, { ...body, policyRevision: "old" }, KEY), "UNSUPPORTED_REVISION");
            expect(repository.findSnapshotByIdempotency).not.toHaveBeenCalled();
        });

        it("a malformed idempotency key -> INVALID_REQUEST (idempotency-key)", async () => {
            const { service } = setup();
            for (const key of ["", "a b", "x".repeat(129)]) {
                const error = await expectCode(service.createSnapshot(principal, body, key), "INVALID_REQUEST");
                expect(error.reasonCode).toBe("idempotency-key");
            }
        });

        it("replay with the same hash returns the existing snapshot without creating", async () => {
            const { service, repository } = setup();
            repository.findSnapshotByIdempotency.mockResolvedValue(snapshotRecord());
            const view = await service.createSnapshot(principal, body, KEY);
            expect(view).toMatchObject({ snapshotId: SNAPSHOT_ID, status: "ready", companyId: COMPANY,
                coverage: { status: "unverified", reasonCode: "collection-receipt-unavailable" }, backupComplete: false });
            expect(repository.findSnapshotByIdempotency).toHaveBeenCalledWith(principal.principalId, KEY);
            expect(repository.readSourceForSnapshot).not.toHaveBeenCalled();
            expect(repository.createReadySnapshot).not.toHaveBeenCalled();
        });

        it("replay with a different hash -> IDEMPOTENCY_CONFLICT, even when the stored snapshot expired", async () => {
            const { service, repository } = setup();
            repository.findSnapshotByIdempotency.mockResolvedValue(snapshotRecord({ requestHash: "f".repeat(64), expiresAt: PAST() }));
            await expectCode(service.createSnapshot(principal, body, KEY), "IDEMPOTENCY_CONFLICT");
        });

        it("replay of an expired snapshot -> SNAPSHOT_EXPIRED and no new snapshot", async () => {
            const { service, repository } = setup();
            repository.findSnapshotByIdempotency.mockResolvedValue(snapshotRecord({ expiresAt: PAST() }));
            await expectCode(service.createSnapshot(principal, body, KEY), "SNAPSHOT_EXPIRED");
            expect(repository.createReadySnapshot).not.toHaveBeenCalled();
        });

        it("replay of a failed snapshot returns its failed representation", async () => {
            const { service, repository } = setup();
            repository.findSnapshotByIdempotency.mockResolvedValue(snapshotRecord({
                status: "failed", counts: null, failureCode: "snapshot-compute-failed", readyAt: null, expiresAt: null }));
            const view = await service.createSnapshot(principal, body, KEY);
            expect(view.status).toBe("failed");
            expect(view.counts).toEqual({ total: 0, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0, included: 0 });
            expect(view.readyAt).toBeNull();
            expect(view.expiresAt).toBeNull();
        });

        describe("fresh creation", () => {
            const files = [
                { documentId: "D001", fileType: "document", sha256: SHA, byteSize: 10 },
                { documentId: "D001", fileType: "audit_trail", sha256: "b".repeat(64), byteSize: 11 },
                { documentId: "D004", fileType: "document", sha256: "c".repeat(64), byteSize: 12 },
            ];
            const docs = [
                doc({ documentId: "D004" }),
                doc({ documentId: "D001" }),
                doc({ documentId: "D005", documentKind: null }),
                doc({ documentId: "Z9", statusType: "060" }),
                doc({ documentId: "a1", statusType: "doc_complete", voidedAt: new Date() }),
                doc({ documentId: "D007", permanentPurgeRequestedAt: new Date() }),
            ];

            it("orders ordinals by documentId in code-unit order, counts, and persists once as ready", async () => {
                const { service, repository } = setup();
                repository.readSourceForSnapshot.mockResolvedValue({ docs, files });
                repository.createReadySnapshot.mockImplementation(async (input: { counts: unknown }) =>
                    snapshotRecord({ counts: input.counts }));
                const view = await service.createSnapshot(principal, body, KEY);

                expect(repository.createReadySnapshot).toHaveBeenCalledTimes(1);
                expect(repository.recordFailedSnapshot).not.toHaveBeenCalled();
                const input = repository.createReadySnapshot.mock.calls[0]![0] as {
                    principalId: string; companyId: string; scopeRevision: string; policyRevision: string;
                    idempotencyKey: string; requestHash: string; counts: Record<string, number>;
                    candidates: Array<{ ordinal: number; documentId: string; classification: string; reasons: string[];
                        statusType: string; artifacts: Array<{ fileType: string }> }>;
                };
                expect(input).toMatchObject({ principalId: "worker-1", companyId: COMPANY, scopeRevision: EXPORT_SCOPE_REVISION,
                    policyRevision: EXPORT_POLICY_REVISION, idempotencyKey: KEY, requestHash: exportRequestHash(body) });
                // "Z9" < "a1" in code-unit order (uppercase first); localeCompare would reverse them.
                expect(input.candidates.map(c => [c.ordinal, c.documentId])).toEqual([
                    [1, "D001"], [2, "D004"], [3, "D005"], [4, "D007"], [5, "Z9"], [6, "a1"]]);
                expect(input.candidates.map(c => c.classification)).toEqual([
                    "included", "included", "unknown_template", "inaccessible", "excluded_by_policy", "included"]);
                expect(input.counts).toEqual({ total: 6, inaccessible: 1, unknownTemplate: 1, policyPending: 0, excludedByPolicy: 1, included: 3 });
                const byId = Object.fromEntries(input.candidates.map(c => [c.documentId, c]));
                expect(byId["D001"]!.artifacts.map(a => a.fileType)).toEqual(["document", "audit_trail"]);
                expect(byId["D004"]!.artifacts.map(a => a.fileType)).toEqual(["document"]);
                expect(byId["D004"]!.reasons).toEqual(["artifact-missing-at-snapshot:audit_trail"]);
                expect(byId["a1"]!.statusType).toBe("003");
                expect(byId["a1"]!.reasons).toEqual(expect.arrayContaining(["voided"]));
                expect(byId["Z9"]!.artifacts).toEqual([]);
                expect(view.status).toBe("ready");
            });

            it("a race loser (createReadySnapshot returns the winner) with a different hash -> IDEMPOTENCY_CONFLICT", async () => {
                const { service, repository } = setup();
                repository.readSourceForSnapshot.mockResolvedValue({ docs: [], files: [] });
                repository.createReadySnapshot.mockResolvedValue(snapshotRecord({ requestHash: "f".repeat(64) }));
                await expectCode(service.createSnapshot(principal, body, KEY), "IDEMPOTENCY_CONFLICT");
            });

            it("a race loser with the same hash converges on the winner's snapshot", async () => {
                const { service, repository } = setup();
                repository.readSourceForSnapshot.mockResolvedValue({ docs: [], files: [] });
                repository.createReadySnapshot.mockResolvedValue(snapshotRecord());
                await expect(service.createSnapshot(principal, body, KEY)).resolves.toMatchObject({ snapshotId: SNAPSHOT_ID });
            });

            it("a race winner that already expired is not served: SNAPSHOT_EXPIRED", async () => {
                const { service, repository } = setup();
                repository.readSourceForSnapshot.mockResolvedValue({ docs: [], files: [] });
                repository.createReadySnapshot.mockResolvedValue(snapshotRecord({ expiresAt: PAST() }));
                await expectCode(service.createSnapshot(principal, body, KEY), "SNAPSHOT_EXPIRED");
            });

            it.each([
                ["source read", (r: Repo) => r.readSourceForSnapshot.mockRejectedValue(new Error("boom"))],
                ["write transaction", (r: Repo) => {
                    r.readSourceForSnapshot.mockResolvedValue({ docs: [], files: [] });
                    r.createReadySnapshot.mockRejectedValue(new Error("boom"));
                }],
                ["classification (corrupt file sha)", (r: Repo) => r.readSourceForSnapshot.mockResolvedValue({
                    docs: [doc()], files: [{ documentId: "D001", fileType: "document", sha256: "NOT-HEX", byteSize: 1 }] })],
            ])("a %s failure records a failed snapshot and returns its representation", async (_label, arrange) => {
                const { service, repository } = setup();
                arrange(repository);
                repository.recordFailedSnapshot.mockResolvedValue(snapshotRecord({
                    status: "failed", counts: null, failureCode: "snapshot-failed", readyAt: null, expiresAt: null }));
                const view = await service.createSnapshot(principal, body, KEY);
                expect(view.status).toBe("failed");
                expect(repository.recordFailedSnapshot).toHaveBeenCalledTimes(1);
                const input = repository.recordFailedSnapshot.mock.calls[0]![0] as Record<string, unknown>;
                expect(input).toMatchObject({ principalId: "worker-1", companyId: COMPANY, idempotencyKey: KEY,
                    requestHash: exportRequestHash(body) });
                expect(typeof input["failureCode"]).toBe("string");
                expect(String(input["failureCode"]).length).toBeLessThanOrEqual(40);
                expect(JSON.stringify(input)).not.toContain("boom");
            });

            it("a failed record that lost the idempotency race with a different hash -> IDEMPOTENCY_CONFLICT", async () => {
                const { service, repository } = setup();
                repository.readSourceForSnapshot.mockRejectedValue(new Error("boom"));
                repository.recordFailedSnapshot.mockResolvedValue(snapshotRecord({ requestHash: "f".repeat(64) }));
                await expectCode(service.createSnapshot(principal, body, KEY), "IDEMPOTENCY_CONFLICT");
            });
        });
    });

    describe("getSnapshot", () => {
        it("a non-uuid id -> NOT_FOUND without any query", async () => {
            const { service, repository } = setup();
            await expectCode(service.getSnapshot(principal, "not-a-uuid"), "NOT_FOUND");
            expect(repository.findSnapshot).not.toHaveBeenCalled();
        });

        it("configured company missing -> EXPORT_UNAVAILABLE", async () => {
            const { service } = setup(null);
            await expectCode(service.getSnapshot(principal, SNAPSHOT_ID), "EXPORT_UNAVAILABLE");
        });

        it("missing snapshot, other principal and company mismatches share one NOT_FOUND body", async () => {
            const { service, repository } = setup();
            const errors: ExportError[] = [];
            repository.findSnapshot.mockResolvedValueOnce(null);
            errors.push(await expectCode(service.getSnapshot(principal, SNAPSHOT_ID), "NOT_FOUND"));
            repository.findSnapshot.mockResolvedValueOnce(snapshotRecord({ principalId: "someone-else" }));
            errors.push(await expectCode(service.getSnapshot(principal, SNAPSHOT_ID), "NOT_FOUND"));
            repository.findSnapshot.mockResolvedValueOnce(snapshotRecord({ companyId: "other" }));
            errors.push(await expectCode(service.getSnapshot(principal, SNAPSHOT_ID), "NOT_FOUND"));
            errors.push(await expectCode(service.getSnapshot({ ...principal, companyIds: ["other"] }, SNAPSHOT_ID), "NOT_FOUND"));
            for (const error of errors) {
                expect({ code: error.code, reasonCode: error.reasonCode, retryAfterSeconds: error.retryAfterSeconds })
                    .toEqual({ code: "NOT_FOUND", reasonCode: undefined, retryAfterSeconds: undefined });
            }
        });

        it("ownership is checked before expiry: a foreign expired snapshot is NOT_FOUND, an own one SNAPSHOT_EXPIRED", async () => {
            const { service, repository } = setup();
            repository.findSnapshot.mockResolvedValueOnce(snapshotRecord({ principalId: "someone-else", expiresAt: PAST() }));
            await expectCode(service.getSnapshot(principal, SNAPSHOT_ID), "NOT_FOUND");
            repository.findSnapshot.mockResolvedValueOnce(snapshotRecord({ expiresAt: PAST() }));
            await expectCode(service.getSnapshot(principal, SNAPSHOT_ID), "SNAPSHOT_EXPIRED");
        });

        it("a snapshot of another company is NOT_FOUND even when the principal may use that company: only the configured company counts", async () => {
            const bodyOf = (error: ExportError) => ({ code: error.code, reasonCode: error.reasonCode, retryAfterSeconds: error.retryAfterSeconds });
            const twoCompanies: ExportPrincipal = { ...principal, companyIds: [COMPANY, "other"] };
            const { service, repository } = setup();
            repository.findSnapshot.mockResolvedValue(null);
            const unknownBody = bodyOf(await expectCode(service.getSnapshot(twoCompanies, SNAPSHOT_ID), "NOT_FOUND"));

            repository.findSnapshot.mockResolvedValue(snapshotRecord({ companyId: "other" }));
            repository.findCandidateArtifact.mockResolvedValue({ documentId: "D001", fileType: "document", sha256: SHA, byteSize: BYTES.length });
            const errors = [
                await expectCode(service.getSnapshot(twoCompanies, SNAPSHOT_ID), "NOT_FOUND"),
                await expectCode(service.listCandidates(twoCompanies, SNAPSHOT_ID), "NOT_FOUND"),
                await expectCode(service.readArtifact(twoCompanies, SNAPSHOT_ID, IDENTITY), "NOT_FOUND"),
            ];
            for (const error of errors) expect(bodyOf(error)).toEqual(unknownBody);
            expect(repository.listCandidates).not.toHaveBeenCalled();
            expect(repository.readArtifactForDownload).not.toHaveBeenCalled();
        });

        it("returns the view for ready, building and failed snapshots", async () => {
            const { service, repository } = setup();
            const ready = await service.getSnapshot(principal, SNAPSHOT_ID);
            expect(ready).toMatchObject({ snapshotId: SNAPSHOT_ID, status: "ready", scopeRevision: EXPORT_SCOPE_REVISION,
                policyRevision: EXPORT_POLICY_REVISION, counts: { total: 1, included: 1 }, backupComplete: false });
            expect(typeof ready.createdAt).toBe("string");
            expect(typeof ready.readyAt).toBe("string");
            expect(typeof ready.expiresAt).toBe("string");
            repository.findSnapshot.mockResolvedValueOnce(snapshotRecord({ status: "building", counts: null, readyAt: null, expiresAt: null }));
            await expect(service.getSnapshot(principal, SNAPSHOT_ID)).resolves.toMatchObject({ status: "building" });
        });
    });

    describe("listCandidates", () => {
        const candidate = (ordinal: number) => ({
            ordinal, documentId: `D${ordinal}`, classification: "excluded_by_policy", reasons: ["incomplete-no-file"],
            statusType: "060", documentKind: "contract", metadataRevision: "e".repeat(64), artifacts: [],
        });

        it("non-uuid id -> NOT_FOUND; bad limit/cursor -> 400 codes from the domain", async () => {
            const { service, repository } = setup();
            await expectCode(service.listCandidates(principal, "nope"), "NOT_FOUND");
            await expectCode(service.listCandidates(principal, SNAPSHOT_ID, undefined, "0"), "INVALID_REQUEST");
            await expectCode(service.listCandidates(principal, SNAPSHOT_ID, "garbage"), "INVALID_CURSOR");
            const other = encodeExportCursor({ snapshotId: "22222222-2222-4222-8222-222222222222", lastOrdinal: 1, limit: 10 });
            await expectCode(service.listCandidates(principal, SNAPSHOT_ID, other), "CURSOR_PARAMETER_MISMATCH");
            const own = encodeExportCursor({ snapshotId: SNAPSHOT_ID, lastOrdinal: 1, limit: 10 });
            await expectCode(service.listCandidates(principal, SNAPSHOT_ID, own, "11"), "CURSOR_PARAMETER_MISMATCH");
            expect(repository.listCandidates).not.toHaveBeenCalled();
        });

        it("access (404) before expiry (410) before status (409)", async () => {
            const { service, repository } = setup();
            repository.findSnapshot.mockResolvedValueOnce(snapshotRecord({ principalId: "x", status: "failed", expiresAt: PAST() }));
            await expectCode(service.listCandidates(principal, SNAPSHOT_ID), "NOT_FOUND");
            repository.findSnapshot.mockResolvedValueOnce(snapshotRecord({ status: "building", counts: null, expiresAt: PAST() }));
            await expectCode(service.listCandidates(principal, SNAPSHOT_ID), "SNAPSHOT_EXPIRED");
            repository.findSnapshot.mockResolvedValueOnce(snapshotRecord({ status: "building", counts: null, readyAt: null, expiresAt: null }));
            const notReady = await expectCode(service.listCandidates(principal, SNAPSHOT_ID), "SNAPSHOT_NOT_READY");
            expect(notReady.code).toBe("SNAPSHOT_NOT_READY");
            repository.findSnapshot.mockResolvedValueOnce(snapshotRecord({ status: "failed", counts: null, readyAt: null, expiresAt: null }));
            await expectCode(service.listCandidates(principal, SNAPSHOT_ID), "SNAPSHOT_FAILED");
            expect(repository.listCandidates).not.toHaveBeenCalled();
        });

        it("first page: default limit 100, nextCursor encodes the last ordinal and the effective limit", async () => {
            const { service, repository } = setup();
            repository.listCandidates.mockResolvedValue({ items: [candidate(1), candidate(2)], hasMore: true });
            const page = await service.listCandidates(principal, SNAPSHOT_ID, undefined, "2");
            expect(repository.listCandidates).toHaveBeenCalledWith(SNAPSHOT_ID, 0, 2);
            expect(page.items.map(i => i.ordinal)).toEqual([1, 2]);
            expect(page.nextCursor).toBe(encodeExportCursor({ snapshotId: SNAPSHOT_ID, lastOrdinal: 2, limit: 2 }));
            expect(page.snapshotId).toBe(SNAPSHOT_ID);

            repository.listCandidates.mockClear();
            await service.listCandidates(principal, SNAPSHOT_ID);
            expect(repository.listCandidates).toHaveBeenCalledWith(SNAPSHOT_ID, 0, 100);
        });

        it("a cursor without limit reuses the cursor's limit; the last page has nextCursor null", async () => {
            const { service, repository } = setup();
            repository.listCandidates.mockResolvedValue({ items: [candidate(3)], hasMore: false });
            const cursor = encodeExportCursor({ snapshotId: SNAPSHOT_ID, lastOrdinal: 2, limit: 2 });
            const page = await service.listCandidates(principal, SNAPSHOT_ID, cursor);
            expect(repository.listCandidates).toHaveBeenCalledWith(SNAPSHOT_ID, 2, 2);
            expect(page.nextCursor).toBeNull();
            expect(page.items).toHaveLength(1);
        });

        it("an empty page returns no cursor", async () => {
            const { service, repository } = setup();
            repository.listCandidates.mockResolvedValue({ items: [], hasMore: false });
            await expect(service.listCandidates(principal, SNAPSHOT_ID)).resolves.toMatchObject({ items: [], nextCursor: null });
        });
    });

    describe("readArtifact", () => {
        const docRow = { permanentPurgeRequestedAt: null, statusType: "003", syncStatus: "ready" };
        const fileRow = { sha256: SHA, byteSize: BYTES.length, contentType: "application/pdf" };

        function arrangeServe(repository: Repo) {
            repository.readArtifactForDownload.mockImplementation(async (_doc: string, _type: string, opts: { withContent: boolean }) => ({
                doc: docRow, file: opts.withContent ? { ...fileRow, content: BYTES } : fileRow,
            }));
        }

        it("serves the exact bytes with the snapshot's sha and artifact identity", async () => {
            const { service, repository } = setup();
            arrangeServe(repository);
            const view = await service.readArtifact(principal, SNAPSHOT_ID, IDENTITY);
            expect(view.bytes.equals(BYTES)).toBe(true);
            expect(view).toMatchObject({ contentType: "application/pdf", byteSize: BYTES.length, sha256: SHA, artifactIdentity: IDENTITY });
            expect(repository.findCandidateArtifact).toHaveBeenCalledWith(SNAPSHOT_ID, IDENTITY);
            // metadata first, bytes second
            expect(repository.readArtifactForDownload.mock.calls.map(c => (c[2] as { withContent: boolean }).withContent)).toEqual([false, true]);
        });

        it("defaults contentType to application/pdf when the row has none", async () => {
            const { service, repository } = setup();
            repository.readArtifactForDownload.mockImplementation(async (_d: string, _t: string, opts: { withContent: boolean }) => ({
                doc: docRow, file: opts.withContent ? { ...fileRow, contentType: "", content: BYTES } : { ...fileRow, contentType: "" } }));
            await expect(service.readArtifact(principal, SNAPSHOT_ID, IDENTITY)).resolves.toMatchObject({ contentType: "application/pdf" });
        });

        it("non-uuid snapshot id or a non-64-lowercase-hex identity -> NOT_FOUND with no query at all", async () => {
            const { service, repository } = setup();
            await expectCode(service.readArtifact(principal, "nope", IDENTITY), "NOT_FOUND");
            for (const identity of ["a".repeat(63), "A".repeat(64), "g".repeat(64), ""]) {
                await expectCode(service.readArtifact(principal, SNAPSHOT_ID, identity), "NOT_FOUND");
            }
            expect(repository.findSnapshot).not.toHaveBeenCalled();
            expect(repository.findCandidateArtifact).not.toHaveBeenCalled();
        });

        it("configured company missing -> EXPORT_UNAVAILABLE", async () => {
            const { service } = setup(null);
            await expectCode(service.readArtifact(principal, SNAPSHOT_ID, IDENTITY), "EXPORT_UNAVAILABLE");
        });

        it("check order: snapshot access, identity in snapshot, expiry, then concurrency slot", async () => {
            const { service, repository } = setup();
            repository.findSnapshot.mockResolvedValueOnce(snapshotRecord({ principalId: "x" }));
            await expectCode(service.readArtifact(principal, SNAPSHOT_ID, IDENTITY), "NOT_FOUND");
            expect(repository.findCandidateArtifact).not.toHaveBeenCalled();

            repository.findCandidateArtifact.mockResolvedValueOnce(null);
            repository.findSnapshot.mockResolvedValueOnce(snapshotRecord({ expiresAt: PAST() }));
            await expectCode(service.readArtifact(principal, SNAPSHOT_ID, IDENTITY), "NOT_FOUND"); // §3.5 #2 precedes #3

            repository.findSnapshot.mockResolvedValueOnce(snapshotRecord({ expiresAt: PAST() }));
            await expectCode(service.readArtifact(principal, SNAPSHOT_ID, IDENTITY), "SNAPSHOT_EXPIRED");
            expect(repository.readArtifactForDownload).not.toHaveBeenCalled();
        });

        const decisionCases: Array<[string, { doc: unknown; file: unknown }, ExportErrorCode, number | undefined]> = [
            ["doc row gone (#4)", { doc: null, file: null }, "SOURCE_REMOVED", undefined],
            ["purge requested (#4)", { doc: { ...docRow, permanentPurgeRequestedAt: new Date() }, file: fileRow }, "SOURCE_REMOVED", undefined],
            ["049 without file (#4)", { doc: { ...docRow, statusType: "doc_delete" }, file: null }, "SOURCE_REMOVED", undefined],
            ["no file, syncing (#5)", { doc: { ...docRow, syncStatus: "syncing" }, file: null }, "ARTIFACT_PENDING", 60],
            ["no file, ready (#6)", { doc: docRow, file: null }, "MIRROR_MISSING", undefined],
            ["sha changed (#7)", { doc: docRow, file: { ...fileRow, sha256: "d".repeat(64) } }, "VERSION_CHANGED", undefined],
            ["too large (#8)", { doc: docRow, file: { ...fileRow, byteSize: EXPORT_ARTIFACT_MAX_BYTES + 1 } }, "ARTIFACT_TOO_LARGE", undefined],
        ];
        it.each(decisionCases)("%s -> %s", async (_label, result, code, retryAfter) => {
            const { service, repository } = setup();
            repository.readArtifactForDownload.mockResolvedValue(result);
            const error = await expectCode(service.readArtifact(principal, SNAPSHOT_ID, IDENTITY), code);
            expect(error.retryAfterSeconds).toBe(retryAfter);
            // metadata only: bytes are never requested once the decision says no
            expect(repository.readArtifactForDownload).toHaveBeenCalledTimes(1);
            expect((repository.readArtifactForDownload.mock.calls[0]![2] as { withContent: boolean }).withContent).toBe(false);
        });

        it("a change between the metadata read and the bytes read is decided on the second read (VERSION_CHANGED)", async () => {
            const { service, repository } = setup();
            repository.readArtifactForDownload
                .mockResolvedValueOnce({ doc: docRow, file: fileRow })
                .mockResolvedValueOnce({ doc: docRow, file: { ...fileRow, sha256: "d".repeat(64), content: BYTES } });
            await expectCode(service.readArtifact(principal, SNAPSHOT_ID, IDENTITY), "VERSION_CHANGED");
        });

        it("bytes whose sha or length differ from the stored value -> CONSISTENCY_CONFLICT (#9)", async () => {
            const { service, repository } = setup();
            for (const tampered of [Buffer.from("%PDF-1.4 SYNTHETIC"), Buffer.from("short")]) {
                repository.readArtifactForDownload.mockImplementation(async (_d: string, _t: string, opts: { withContent: boolean }) => ({
                    doc: docRow, file: opts.withContent ? { ...fileRow, content: tampered } : fileRow }));
                await expectCode(service.readArtifact(principal, SNAPSHOT_ID, IDENTITY), "CONSISTENCY_CONFLICT");
            }
        });

        describe("concurrency limit", () => {
            function gate() {
                let open!: () => void;
                const opened = new Promise<void>(resolve => { open = resolve; });
                return { opened, open };
            }

            it("a third concurrent read -> RATE_LIMITED(5s) before any file read; slots are released afterwards", async () => {
                const { service, repository } = setup();
                const g = gate();
                repository.readArtifactForDownload.mockImplementation(async (_d: string, _t: string, opts: { withContent: boolean }) => {
                    await g.opened;
                    return { doc: docRow, file: opts.withContent ? { ...fileRow, content: BYTES } : fileRow };
                });
                const first = service.readArtifact(principal, SNAPSHOT_ID, IDENTITY);
                const second = service.readArtifact(principal, SNAPSHOT_ID, IDENTITY);
                await new Promise(resolve => setImmediate(resolve));
                const readsBefore = repository.readArtifactForDownload.mock.calls.length;
                const third = await expectCode(service.readArtifact(principal, SNAPSHOT_ID, IDENTITY), "RATE_LIMITED");
                expect(third.retryAfterSeconds).toBe(5);
                expect(repository.readArtifactForDownload.mock.calls.length).toBe(readsBefore);
                g.open();
                await Promise.all([first, second]);
                await expect(service.readArtifact(principal, SNAPSHOT_ID, IDENTITY)).resolves.toMatchObject({ artifactIdentity: IDENTITY });
            });

            it("the slot is released when the read throws", async () => {
                const { service, repository } = setup();
                repository.readArtifactForDownload.mockRejectedValue(new Error("db down"));
                for (let i = 0; i < 5; i++) {
                    const error = await service.readArtifact(principal, SNAPSHOT_ID, IDENTITY).then(() => null, (e: unknown) => e as Error);
                    expect(error?.message).toBe("db down"); // never RATE_LIMITED
                }
            });

            it("the slot is released on decision errors and consistency conflicts", async () => {
                const { service, repository } = setup();
                repository.readArtifactForDownload.mockResolvedValue({ doc: null, file: null });
                for (let i = 0; i < 5; i++) await expectCode(service.readArtifact(principal, SNAPSHOT_ID, IDENTITY), "SOURCE_REMOVED");
            });
        });
    });
});
