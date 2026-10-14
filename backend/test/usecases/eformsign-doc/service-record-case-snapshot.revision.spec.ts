import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import type { ServiceRecordRevisionGenerationInput } from "domain/entities/eformsign-document-job.entity";
import { LIST_ONLY_HISTORICAL_MATERNITY_TEMPLATE_IDS } from "application/utils/eformsign-historical-template-policy";

describe("revised service-record snapshot boundary", () => {
    it("fails closed before credentials or provider calls", async () => {
        const withCredentials = jest.fn();
        const createDocument = jest.fn();
        const usecase = new CreateAndSendServiceRecordSnapshotUsecase(
            { createDocument } as never,
            {
                service_record_case: {
                    findUnique: jest.fn().mockResolvedValue({
                        branchId: "branch-1",
                        currentRevisionId: "revision-1",
                    }),
                },
            } as never,
            { withCredentials } as never,
            { get: jest.fn().mockReturnValue("template-5") } as never,
        );

        await expect(usecase.executeCase(
            "branch-1",
            "case-1",
            { branchId: "branch-1", source: "worker" } as never,
        )).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" },
        });
        expect(withCredentials).not.toHaveBeenCalled();
        expect(createDocument).not.toHaveBeenCalled();
    });

    it("keeps the production capability-unverified generation at zero provider calls", async () => {
        const harness = createRevisionHarness();
        const input = makeGenerationInput({});
        const unverifiedInput = { ...input, documentSyncStatus: "capability_unverified" as const };

        await expect(harness.usecase.executeRevision(unverifiedInput, harness.principal)).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" },
        });
        expect(harness.credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(harness.eformsignClient.getTemplateReviewer).not.toHaveBeenCalled();
        expect(harness.eformsignClient.createDocument).not.toHaveBeenCalled();
    });

    it.each([
        ...LIST_ONLY_HISTORICAL_MATERNITY_TEMPLATE_IDS,
        ...LIST_ONLY_HISTORICAL_MATERNITY_TEMPLATE_IDS.map((templateId) => `  ${templateId}  `),
    ])("rejects retired configured revision tiers before state, claim, or provider work: %s", async (templateId) => {
        const harness = createRevisionHarness({ templateId });

        await expect(harness.usecase.executeRevision(makeGenerationInput(), harness.principal))
            .rejects.toThrow("historical list-only");

        expect(harness.prisma.service_record_revision_document_state.findUnique).not.toHaveBeenCalled();
        expect(harness.chunkDelegate.create).not.toHaveBeenCalled();
        expect(harness.chunkDelegate.update).not.toHaveBeenCalled();
        expect(harness.chunkDelegate.updateMany).not.toHaveBeenCalled();
        expect(harness.credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(harness.eformsignClient.getTemplateReviewer).not.toHaveBeenCalled();
        expect(harness.eformsignClient.createDocument).not.toHaveBeenCalled();
        expect(harness.repository.promoteServiceRecordRevisionSnapshot).not.toHaveBeenCalled();
    });

    it("renders only the immutable payload and never rereads live case rows", async () => {
        const harness = createRevisionHarness();
        const input = makeGenerationInput();
        const liveCaseRead = harness.prisma.service_record_case.findUnique;
        liveCaseRead.mockImplementation(() => {
            throw new Error("live case reads are forbidden for revision rendering");
        });

        const result = await harness.usecase.executeRevision(input, harness.principal);

        expect(result).toEqual({ documentIds: ["revision-doc-1"], documentVersion: 3, chunkCount: 1 });
        expect(liveCaseRead).not.toHaveBeenCalled();
        expect(harness.eformsignClient.createDocument).toHaveBeenCalledWith(
            "access-token",
            expect.objectContaining({
                idempotencyKey: "service-record-revision:generation-1:v3:c1",
                prefillFields: expect.arrayContaining([
                    { id: "제공기관 이름", value: "인천점" },
                    { id: "제공인력 이름", value: "제공인력-고정" },
                    { id: "월 1", value: "09" },
                    { id: "일 1", value: "08" },
                    { id: "산모확인서명 1", value: "frozen-signature" },
                ]),
            }),
        );
    });

    it("reuses the same version, chunk row, and document identity on retry", async () => {
        const harness = createRevisionHarness();
        const input = makeGenerationInput();

        await expect(harness.usecase.executeRevision(input, harness.principal)).resolves.toMatchObject({
            documentVersion: 3,
            documentIds: ["revision-doc-1"],
        });
        const firstCreateCount = harness.chunkDelegate.create.mock.calls.length;
        const firstProviderCreateCount = harness.eformsignClient.createDocument.mock.calls.length;

        await expect(harness.usecase.executeRevision(input, harness.principal)).resolves.toEqual({
            documentIds: ["revision-doc-1"],
            documentVersion: 3,
            chunkCount: 1,
        });

        expect(harness.chunkDelegate.create).toHaveBeenCalledTimes(firstCreateCount);
        expect(harness.eformsignClient.createDocument).toHaveBeenCalledTimes(firstProviderCreateCount);
        expect(harness.repository.allocateServiceRecordRevisionDocumentVersion).not.toHaveBeenCalled();
        expect(harness.repository.promoteServiceRecordRevisionSnapshot).toHaveBeenCalledTimes(2);
    });

    it("refuses a stale generation before credentials or provider mutation", async () => {
        const harness = createRevisionHarness();
        const input = makeGenerationInput({ generation: "generation-stale" });

        await expect(harness.usecase.executeRevision(input, harness.principal)).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_GENERATION_SCOPE_CHANGED" },
        });
        expect(harness.credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(harness.eformsignClient.createDocument).not.toHaveBeenCalled();
    });

    it("refuses a state/document version mismatch before credentials or provider mutation", async () => {
        const harness = createRevisionHarness();
        harness.prisma.service_record_revision_document_state.findUnique.mockResolvedValueOnce({
            id: "state-1",
            branchId: "branch-1",
            clientId: 10,
            serviceRecordCaseId: "case-1",
            revisionId: "revision-1",
            operation: "record_snapshot",
            generation: "generation-1",
            immutableInput: makeGenerationInput().immutablePayload,
            inputFingerprint: makeGenerationInput().payloadFingerprint,
            documentVersion: 4,
            status: "pending",
            step: "pending",
            version: 0,
        });

        await expect(harness.usecase.executeRevision(makeGenerationInput(), harness.principal)).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_DOCUMENT_VERSION_SCOPE_CHANGED" },
        });
        expect(harness.credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(harness.eformsignClient.createDocument).not.toHaveBeenCalled();
    });

    it("preserves a completed first chunk when a later chunk fails", async () => {
        const harness = createRevisionHarness({ sessionCount: 21 });
        harness.eformsignClient.createDocument
            .mockResolvedValueOnce({ documentId: "revision-doc-1", status: "pending" })
            .mockRejectedValueOnce(new Error("second chunk failed"));
        const input = makeGenerationInput({ requiredSessionCount: 21, sessionCount: 21 });

        await expect(harness.usecase.executeRevision(input, harness.principal)).rejects.toThrow("second chunk failed");

        const rows = harness.chunkRows();
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            revisionId: input.revisionId,
            snapshotVersion: 3,
            chunkIndex: 1,
            status: "CREATED",
            eformsignDocumentId: "revision-doc-1",
        });
        expect(rows[1]).toMatchObject({
            revisionId: input.revisionId,
            snapshotVersion: 3,
            chunkIndex: 2,
            status: "RECONCILING",
        });
        expect(harness.repository.promoteServiceRecordRevisionSnapshot).not.toHaveBeenCalled();
    });

    it("queries an unknown outcome before any second provider mutation", async () => {
        const harness = createRevisionHarness({ existingChunkStatus: "RECONCILING" });
        const input = makeGenerationInput();

        await expect(harness.usecase.executeRevision(input, harness.principal)).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_SNAPSHOT_RECONCILIATION_PENDING" },
        });
        expect(harness.eformsignClient.findDocumentsByTitle).toHaveBeenCalledTimes(1);
        expect(harness.eformsignClient.createDocument).not.toHaveBeenCalled();
    });

    it("reconciles a CREATED row that lost its remote id before any new create", async () => {
        const harness = createRevisionHarness({ existingChunkStatus: "CREATED" });

        await expect(harness.usecase.executeRevision(makeGenerationInput(), harness.principal)).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_SNAPSHOT_RECONCILIATION_PENDING" },
        });
        expect(harness.eformsignClient.findDocumentsByTitle).toHaveBeenCalledTimes(1);
        expect(harness.eformsignClient.createDocument).not.toHaveBeenCalled();
    });

    it("reconciles an in-flight CLAIMED row before retrying its provider request", async () => {
        const harness = createRevisionHarness({ existingChunkStatus: "CLAIMED" });

        await expect(harness.usecase.executeRevision(makeGenerationInput(), harness.principal)).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_SNAPSHOT_RECONCILIATION_PENDING" },
        });
        expect(harness.eformsignClient.findDocumentsByTitle).toHaveBeenCalledTimes(1);
        expect(harness.eformsignClient.createDocument).not.toHaveBeenCalled();
    });

    it("does not report completion when core rejects pointer promotion as stale", async () => {
        const harness = createRevisionHarness();
        harness.repository.promoteServiceRecordRevisionSnapshot.mockResolvedValue(false);

        await expect(harness.usecase.executeRevision(makeGenerationInput(), harness.principal)).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_POINTER_PROMOTION_STALE" },
        });
        expect(harness.eformsignClient.createDocument).toHaveBeenCalledTimes(1);
    });
});

type RevisionHarnessOptions = {
    existingChunkStatus?: string;
    sessionCount?: number;
    templateId?: string;
};

type HarnessRow = {
    id: string;
    status: string;
    attempts: number;
    claimedAt: Date | null;
    createAttemptedAt: Date | null;
    eformsignDocumentId: string | null;
    revisionId?: string;
    snapshotVersion?: number;
    chunkIndex?: number;
    chunkCount?: number;
    firstSessionIndex?: number;
    lastSessionIndex?: number;
    employeeNameSnapshot?: string;
    sourceHash?: string;
    assignmentId?: string | null;
    [key: string]: unknown;
};

type HarnessDoc = { documentId: string; snapshotChunkIndex: number | null };

type HarnessPrisma = {
    service_record_case: { findUnique: jest.Mock };
    service_record_revision_document_state: { findUnique: jest.Mock };
    service_record_snapshot_chunk: {
        findMany: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
        updateMany: jest.Mock;
    };
    eformsign_doc: { findMany: jest.Mock; upsert: jest.Mock };
    $transaction: jest.Mock;
};

type HarnessRevisionRepository = {
    allocateServiceRecordRevisionDocumentVersion: jest.Mock;
    promoteServiceRecordRevisionSnapshot: jest.Mock;
};

function makeGenerationInput(overrides: Partial<{
    generation: string;
    requiredSessionCount: number;
    sessionCount: number;
}> = {}): ServiceRecordRevisionGenerationInput {
    const sessionCount = overrides.sessionCount ?? overrides.requiredSessionCount ?? 1;
    const generation = overrides.generation ?? "generation-1";
    const immutablePayload = {
        kind: "service_record_revision_input",
        generation,
        branchId: "branch-1",
        caseId: "case-1",
        clientId: 10,
        revisionId: "revision-1",
        revisionNumber: 1,
        formVersion: 2,
        requiredSessionCount: sessionCount,
        providerName: "인천점",
        header: {
            momName: "산모",
            momBirth: "900101",
            babyName: "아기",
            babyBirth: "260701",
            deliveryType: "자연분만",
            babyWeight: "3.2",
        },
        client: { id: 10, name: "고객" },
        plannedSessions: Array.from({ length: sessionCount }, (_, index) => ({
            sessionIndex: index + 1,
            serviceDate: `2026-09-${String(index + 8).padStart(2, "0")}`,
        })),
        sessions: Array.from({ length: sessionCount }, (_, index) => ({
            sourceRowId: `day-${index + 1}`,
            sessionIndex: index + 1,
            serviceDate: `2026-09-${String(index + 8).padStart(2, "0")}`,
            scheduleId: 100,
            employeeId: 12,
            employeeNameSnapshot: "제공인력-고정",
            formVersion: 2,
            assignmentId: "assignment-1",
            answers: {},
            etcService: null,
            notes: index === 0 ? "frozen-note" : null,
            paymentConfirmed: true,
            momApproval: "approved",
            clientSignature: index === 0 ? "frozen-signature" : `frozen-signature-${index + 1}`,
            clientSignedAt: "2026-09-08T03:00:00.000Z",
            submittedAt: "2026-09-08T04:00:00.000Z",
            locked: true,
        })),
        assignments: [{
            assignmentId: "assignment-1",
            scheduleId: 100,
            employeeId: 12,
            employeeNameSnapshot: "제공인력-고정",
            startDate: "2026-09-08",
            endDate: `2026-09-${String(indexedEndDate(sessionCount)).padStart(2, "0")}`,
        }],
        completeness: "complete",
    };
    const payloadFingerprint = sha256CanonicalJson(immutablePayload);
    return {
        branchId: "branch-1",
        clientId: 10,
        serviceRecordCaseId: "case-1",
        revisionId: "revision-1",
        revisionNumber: 1,
        businessFingerprint: payloadFingerprint,
        plannedSessionCount: sessionCount,
        plannedSessionDates: immutablePayload.plannedSessions,
        documentSyncStatus: "pending",
        lifecycleStatus: "DOCUMENTS_CREATED",
        formVersion: 2,
        generationKind: "REVISION_SNAPSHOT",
        documentStateId: "state-1",
        documentVersion: 3,
        snapshotReference: "service-record-revision:case-1:draft-1",
        generation,
        immutablePayload,
        payloadFingerprint,
        completeness: "complete",
    };
}

function indexedEndDate(sessionCount: number): number {
    return 7 + sessionCount;
}

function createRevisionHarness(options: RevisionHarnessOptions = {}) {
    const rows: HarnessRow[] = [];
    const docs: HarnessDoc[] = [];
    const stateInput = makeGenerationInput({ sessionCount: options.sessionCount ?? 1 });
    const findManyChunks = jest.fn().mockImplementation(() => rows.map((row) => ({ ...row })));
    const chunkDelegate = {
        findMany: findManyChunks,
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            const row: HarnessRow = {
                id: `chunk-${rows.length + 1}`,
                status: "PENDING",
                attempts: 0,
                claimedAt: null,
                createAttemptedAt: null,
                eformsignDocumentId: null,
                ...data,
            };
            rows.push(row);
            return Promise.resolve(row);
        }),
        update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const row = rows.find((candidate) => candidate.id === where.id);
            if (row) Object.assign(row, data);
            return Promise.resolve(row);
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const row = rows.find((candidate) => candidate.id === where.id);
            if (!row) return Promise.resolve({ count: 0 });
            Object.assign(row, data);
            return Promise.resolve({ count: 1 });
        }),
    };
    if (options.existingChunkStatus) {
        rows.push({
            id: "chunk-existing",
            revisionId: "revision-1",
            snapshotVersion: 3,
            chunkIndex: 1,
            chunkCount: 1,
            firstSessionIndex: 1,
            lastSessionIndex: 1,
            employeeNameSnapshot: "제공인력-고정",
            sourceHash: stateInput.payloadFingerprint,
            status: options.existingChunkStatus,
            attempts: 1,
            claimedAt: null,
            createAttemptedAt: new Date(),
            eformsignDocumentId: null,
        });
    }

    const prisma: HarnessPrisma = {
        service_record_case: { findUnique: jest.fn() },
        service_record_revision_document_state: {
            findUnique: jest.fn().mockResolvedValue({
                id: "state-1",
                branchId: "branch-1",
                clientId: 10,
                serviceRecordCaseId: "case-1",
                revisionId: "revision-1",
                operation: "record_snapshot",
                generation: "generation-1",
                immutableInput: stateInput.immutablePayload,
                inputFingerprint: stateInput.payloadFingerprint,
                documentVersion: 3,
                status: "pending",
                step: "pending",
                version: 0,
            }),
        },
        service_record_snapshot_chunk: chunkDelegate,
        eformsign_doc: {
            findMany: jest.fn().mockImplementation(() => Promise.resolve(docs.map((doc) => ({ ...doc })))),
            upsert: jest.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => {
                docs.push({
                    documentId: String(create["documentId"]),
                    snapshotChunkIndex: typeof create["snapshotChunkIndex"] === "number"
                        ? create["snapshotChunkIndex"]
                        : null,
                });
                return Promise.resolve({ id: docs.length });
            }),
        },
        $transaction: jest.fn(async (callback: (tx: HarnessPrisma) => Promise<unknown>) => callback(prisma)),
    };
    const repository: HarnessRevisionRepository = {
        allocateServiceRecordRevisionDocumentVersion: jest.fn().mockResolvedValue(3),
        promoteServiceRecordRevisionSnapshot: jest.fn().mockResolvedValue(true),
    };
    const eformsignClient = {
        getTemplateReviewer: jest.fn().mockResolvedValue({ name: "검토자", id: "reviewer@example.com" }),
        createDocument: jest.fn().mockResolvedValue({ documentId: "revision-doc-1", status: "pending" }),
        findDocumentsByTitle: jest.fn().mockResolvedValue([]),
    };
    const credentialBoundary = {
        withCredentials: jest.fn(async (
            _principal: unknown,
            _capability: unknown,
            operation: (credentials: { accessToken: string; refreshToken: string }) => Promise<unknown>,
        ) => operation({ accessToken: "access-token", refreshToken: "refresh-token" })),
    };
    const usecase = new CreateAndSendServiceRecordSnapshotUsecase(
        eformsignClient as never,
        prisma as never,
        credentialBoundary as never,
        {
            get: jest.fn((key: string) => {
                if (options.templateId !== undefined) {
                    return key === "EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"
                        ? options.templateId
                        : undefined;
                }
                return "template-5";
            }),
        } as never,
        repository as never,
    );
    return {
        usecase,
        prisma,
        repository,
        principal: { branchId: "branch-1", globalRole: "owner" },
        eformsignClient,
        credentialBoundary,
        chunkDelegate,
        chunkRows: () => rows,
    };
}

describe("revised snapshot of a case whose current caregiver backfilled sessions", () => {
    const ASSIGNMENT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
    const ASSIGNMENT_B = "bbbbbbbb-0000-4000-8000-00000000000b";
    const dates = [
        "2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08",
        "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16",
        "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
    ];
    const caregivers = {
        A: { assignmentId: ASSIGNMENT_A, scheduleId: 701, employeeId: 31, name: "공혜순" },
        B: { assignmentId: ASSIGNMENT_B, scheduleId: 702, employeeId: 32, name: "임선녀" },
    };

    /**
     * Shaped like the finalization freeze: day rows carry their writer's schedule, employee and name
     * but no assignment id, while the stored planned vector gives sessions 1-7 to A and 8-15 to B.
     */
    function backfilledInput(writerOf: (sessionIndex: number) => "A" | "B"): ServiceRecordRevisionGenerationInput {
        const base = makeGenerationInput({ sessionCount: dates.length });
        const sessions = dates.map((serviceDate, offset) => {
            const writer = caregivers[writerOf(offset + 1)];
            return {
                sourceRowId: `day-${offset + 1}`,
                sessionIndex: offset + 1,
                serviceDate,
                scheduleId: writer.scheduleId,
                employeeId: writer.employeeId,
                employeeNameSnapshot: writer.name,
                formVersion: 2,
                answers: {},
                etcService: null,
                notes: null,
                paymentConfirmed: true,
                momApproval: "approved",
                clientSignature: `signature-${offset + 1}`,
                clientSignedAt: "2026-10-01T03:00:00.000Z",
                submittedAt: "2026-10-01T04:00:00.000Z",
                locked: true,
            };
        });
        const plannedSessions = dates.map((serviceDate, offset) => {
            const owner = caregivers[offset < 7 ? "A" : "B"];
            return {
                sessionIndex: offset + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: owner.assignmentId,
                scheduleId: owner.scheduleId,
                employeeId: owner.employeeId,
                provenanceVersion: "case-7",
            };
        });
        const immutablePayload = {
            ...base.immutablePayload,
            requiredSessionCount: dates.length,
            sessions,
            plannedSessions,
            assignments: Object.values(caregivers).map((caregiver) => ({
                assignmentId: caregiver.assignmentId,
                scheduleId: caregiver.scheduleId,
                employeeId: caregiver.employeeId,
                employeeNameSnapshot: caregiver.name,
                startDate: "2026-10-01",
                endDate: "2026-10-23",
            })),
        };
        const payloadFingerprint = sha256CanonicalJson(immutablePayload);
        return {
            ...base,
            plannedSessionCount: dates.length,
            plannedSessionDates: dates.map((serviceDate, offset) => ({ sessionIndex: offset + 1, serviceDate })),
            immutablePayload,
            payloadFingerprint,
            businessFingerprint: payloadFingerprint,
        };
    }

    function chunksFor(input: ServiceRecordRevisionGenerationInput) {
        const harness = createRevisionHarness();
        const internals = harness.usecase as unknown as {
            buildFrozenRevisionSource: (input: ServiceRecordRevisionGenerationInput) => { record: unknown };
            buildRevisionChunks: (
                record: unknown,
                tiers: number[],
                templateIdByTier: Map<number, string>,
                persistedLayout: unknown[],
                input: ServiceRecordRevisionGenerationInput,
                documentVersion: number,
            ) => Array<{
                assignmentId: string | null;
                employeeName: string;
                firstSessionIndex: number;
                lastSessionIndex: number;
            }>;
        };
        const { record } = internals.buildFrozenRevisionSource(input);
        return internals.buildRevisionChunks(
            record,
            [5, 15],
            new Map([[5, "template-5"], [15, "template-15"]]),
            [],
            input,
            3,
        );
    }

    it("attributes the sessions the current caregiver backfilled to that caregiver", () => {
        const chunks = chunksFor(backfilledInput((sessionIndex) => (sessionIndex === 1 ? "A" : "B")));
        expect(chunks.map((chunk) => ({
            assignmentId: chunk.assignmentId,
            employeeName: chunk.employeeName,
            firstSessionIndex: chunk.firstSessionIndex,
            lastSessionIndex: chunk.lastSessionIndex,
        }))).toEqual([
            { assignmentId: ASSIGNMENT_A, employeeName: "공혜순", firstSessionIndex: 1, lastSessionIndex: 1 },
            { assignmentId: ASSIGNMENT_B, employeeName: "임선녀", firstSessionIndex: 2, lastSessionIndex: 15 },
        ]);
    });

    it("keeps the planned split when each caregiver wrote only their own sessions", () => {
        const chunks = chunksFor(backfilledInput((sessionIndex) => (sessionIndex <= 7 ? "A" : "B")));
        expect(chunks.map((chunk) => [chunk.assignmentId, chunk.firstSessionIndex, chunk.lastSessionIndex])).toEqual([
            [ASSIGNMENT_A, 1, 7],
            [ASSIGNMENT_B, 8, 15],
        ]);
    });
});
