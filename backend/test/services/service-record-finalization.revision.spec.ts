import { ConflictException } from "@nestjs/common";
import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";

const branchId = "00000000-0000-4000-8000-000000000010";
const caseId = "00000000-0000-4000-8000-000000000020";
const clientId = 7;
const revisionId = "00000000-0000-4000-8000-000000000030";
const stateId = "00000000-0000-4000-8000-000000000070";
const date = new Date("2026-09-07T00:00:00.000Z");

function source() {
    return {
        id: caseId,
        branchId,
        branchName: "테스트 지점",
        clientId,
        status: "READY_TO_FINALIZE",
        nextAttemptAt: null,
        finalizationAttempts: 0,
        formVersion: 3,
        requiredSessionCount: 1,
        startDate: date,
        endDate: date,
        plannedSessions: [{
            sessionIndex: 1,
            serviceDate: "2026-09-07",
            originalDate: "2026-09-07",
            assignmentId: "00000000-0000-4000-8000-000000000040",
            scheduleId: 100,
            employeeId: 11,
            provenanceVersion: "revision-1",
        }],
        currentRevisionId: revisionId,
        currentUsableRevisionId: null,
        currentUsableDocumentVersion: null,
        momName: "산모",
        momBirth: "900101",
        babyName: "아기",
        babyBirth: "260701",
        deliveryType: "자연분만",
        babyWeight: "3.2",
        completedAt: null,
        finalizationDueAt: new Date("2026-09-07T11:00:00.000Z"),
        finalizationStartedAt: null,
        finalizedAt: null,
        documentsCompletedAt: null,
        client: {
            id: clientId,
            name: "고객",
            duration: 15,
            startDate: date,
            endDate: date,
            serviceStatus: "in_progress",
        },
        assignments: [{
            id: "00000000-0000-4000-8000-000000000040",
            scheduleId: 100,
            employeeId: 11,
            employeeNameSnapshot: "제공인력",
            startDate: date,
            endDate: date,
        }],
        days: [{
            id: "00000000-0000-4000-8000-000000000050",
            scheduleId: 100,
            caseSessionIndex: 1,
            sessionIndex: 1,
            employeeId: 11,
            employeeNameSnapshot: "제공인력",
            formVersion: 3,
            serviceDate: date,
            answers: { checked: true },
            etcService: null,
            notes: "signed",
            paymentConfirmed: true,
            momApproval: "approved",
            clientSignature: "signature-bytes",
            clientSignedAt: new Date("2026-09-07T07:59:00.000Z"),
            locked: true,
            submittedAt: new Date("2026-09-07T08:00:00.000Z"),
        }],
    };
}

function sourceWith(overrides: Record<string, unknown>) {
    return { ...source(), ...overrides };
}

function buildService(jobService: Record<string, jest.Mock>) {
    const editRepository = {
        createRevisionDocumentStateInTransaction: jest.fn().mockResolvedValue({
            id: stateId,
            documentVersion: 3,
        }),
        allocateServiceRecordRevisionDocumentVersionInTransaction: jest.fn().mockResolvedValue(3),
    };
    return new ServiceRecordFinalizationService(
        {} as never,
        {} as never,
        {} as never,
        jobService as never,
        editRepository as never,
    );
}

describe("ServiceRecordFinalizationService revised generation", () => {
    it("freezes a complete current source once with signatures and provenance", async () => {
        const jobService = {
            findByRequestKeyInTransaction: jest.fn().mockResolvedValue(null),
            enqueueInTransaction: jest.fn().mockResolvedValue({
                existing: false,
                job: { requestKey: "unused" },
            }),
        };
        const revision = {
            id: revisionId,
            revisionNumber: 2,
            payload: {
                plannedSessions: [{ sessionIndex: 1, originalDate: "2026-09-07" }],
                sessions: [],
            },
        };
        const tx = {
            service_record_revision: {
                findUnique: jest.fn().mockResolvedValue(revision),
            },
        };
        const service = buildService(jobService);

        await (service as unknown as {
            freezeInitialFinalizationGeneration: (tx: unknown, source: unknown) => Promise<void>;
        }).freezeInitialFinalizationGeneration(tx, source());

        const [, input] = jobService.enqueueInTransaction.mock.calls[0]!;
        expect(input).toMatchObject({
            branchId,
            clientId,
            jobType: "create_document",
            source: "auto_finalize",
            requestKey: `service-record-initial-finalization:${revisionId}`,
            payloadFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        });
        expect(input.payload).toMatchObject({
            kind: "service_record_revision",
            generationKind: "INITIAL_FINALIZATION",
            revisionId,
            revisionNumber: 2,
            completeness: "complete",
            manualReviewRequired: true,
            documentVersion: 3,
            documentStateId: stateId,
            context: {
                branchId,
                clientId,
                serviceRecordCaseId: caseId,
                revisionId,
                documentSyncStatus: "capability_unverified",
            },
            immutablePayload: {
                sessions: [{
                    clientSignature: "signature-bytes",
                    employeeNameSnapshot: "제공인력",
                    originalDate: "2026-09-07",
                    submittedAt: "2026-09-07T08:00:00.000Z",
                }],
            },
        });
        expect(input.payloadFingerprint).toBe(sha256CanonicalJson(input.payload.immutablePayload));
    });

    it.each([
        ["absent vector", { plannedSessions: null }],
        ["malformed vector", { plannedSessions: [{ sessionIndex: 1, serviceDate: "2026-09-07" }] }],
        ["current row mismatch", {
            plannedSessions: [{
                sessionIndex: 1,
                serviceDate: "2026-09-08",
                originalDate: "2026-09-07",
                assignmentId: "00000000-0000-4000-8000-000000000040",
                scheduleId: 100,
                employeeId: 11,
                provenanceVersion: "revision-1",
            }],
        }],
    ])("fails closed for a %s", async (_label, overrides) => {
        const jobService = {
            findByRequestKeyInTransaction: jest.fn(),
            enqueueInTransaction: jest.fn(),
        };
        const service = buildService(jobService);
        const tx = {
            service_record_revision: {
                findUnique: jest.fn(),
            },
        };

        try {
            await (service as unknown as {
                freezeInitialFinalizationGeneration: (tx: unknown, source: unknown) => Promise<void>;
            }).freezeInitialFinalizationGeneration(tx, sourceWith(overrides));
            throw new Error("Expected revised source validation to fail");
        } catch (error) {
            expect(error).toBeInstanceOf(ConflictException);
            expect((error as ConflictException).getResponse()).toEqual({
                code: "SERVICE_RECORD_REVISION_SOURCE_UNAVAILABLE",
            });
        }
        expect(jobService.findByRequestKeyInTransaction).not.toHaveBeenCalled();
        expect(jobService.enqueueInTransaction).not.toHaveBeenCalled();
    });

    it("reuses an existing request payload without rebuilding it", async () => {
        const immutablePayload = { caseId };
        const frozenFingerprint = sha256CanonicalJson(immutablePayload);
        const frozenPayload = {
            kind: "service_record_revision",
            generationKind: "INITIAL_FINALIZATION",
            generation: "00000000-0000-4000-8000-000000000060",
            revisionId,
            completeness: "complete",
            manualReviewRequired: true,
            documentVersion: 3,
            payloadFingerprint: frozenFingerprint,
            snapshotReference: `service-record-initial-finalization:${revisionId}`,
            immutablePayload,
            context: {
                branchId,
                clientId,
                serviceRecordCaseId: caseId,
                revisionId,
                businessFingerprint: frozenFingerprint,
            },
        };
        const existing = {
            requestKey: `service-record-initial-finalization:${revisionId}`,
            branchId,
            clientId,
            jobType: "create_document",
            payloadFingerprint: frozenFingerprint,
            payload: frozenPayload,
        };
        const jobService = {
            findByRequestKeyInTransaction: jest.fn().mockResolvedValue(existing),
            enqueueInTransaction: jest.fn(),
        };
        const service = buildService(jobService);

        await (service as unknown as {
            freezeInitialFinalizationGeneration: (tx: unknown, source: unknown) => Promise<void>;
        }).freezeInitialFinalizationGeneration({}, source());

        expect(jobService.enqueueInTransaction).not.toHaveBeenCalled();
    });
});
