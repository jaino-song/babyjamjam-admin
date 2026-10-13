import { ReconcileCompletedMirroredEformsignDocUsecase } from "application/usecases/eformsign-doc/reconcile-completed-mirrored-eformsign-doc.usecase";
import { SyncClientEndDateUsecase } from "application/usecases/eformsign-doc/sync-client-end-date.usecase";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { createHolidayCalendarStub } from "../../utils/holiday-calendar.stub";

const detail = {
    id: "doc-1",
    document_number: "DOC-1",
    template: { id: "contract-template", name: "계약서" },
    document_name: "산모신생아 건강관리 계약서",
    creator: { recipient_type: "01", id: "staff@example.com", name: "담당자" },
    created_date: Date.parse("2026-07-30T00:00:00.000Z"),
    updated_date: Date.parse("2026-07-30T01:00:00.000Z"),
    current_status: {
        status_type: "050",
        step_type: "06",
        step_index: "3",
        step_name: "완료",
        step_recipients: [],
        step_group: 3,
    },
    fields: [],
} as EformsignApiDocumentResponse;

function readyState(overrides: Record<string, unknown> = {}) {
    const detailSourceUpdatedDate = new Date("2026-07-30T01:00:00.000Z");
    const detailSyncedAt = new Date("2026-07-30T01:01:00.000Z");
    return {
        branchId: "branch-1",
        detailPayload: detail,
        detailSourceUpdatedDate,
        detailSyncedAt,
        syncStatus: "ready",
        permanentPurgeRequestedAt: null,
        files: ["document", "audit_trail"].map((fileType) => ({
            fileType,
            sourceUpdatedDate: detailSourceUpdatedDate,
        })),
        ...overrides,
    };
}

describe("ReconcileCompletedMirroredEformsignDocUsecase", () => {
    const linkMirroredDocumentByPhoneUsecase = {
        execute: jest.fn(),
    };
    const syncClientEndDateUsecase = {
        executeFromDocument: jest.fn(),
    };
    const mirrorRepository = {
        findState: jest.fn(),
    };
    const serviceRecordLifecycle = {
        syncEndDateFromContract: jest.fn(),
        syncEndDateFromMirroredContract: jest.fn(),
        completeServiceRecordSnapshotIfReady: jest.fn(),
    };

    let usecase: ReconcileCompletedMirroredEformsignDocUsecase;

    beforeEach(() => {
        usecase = new ReconcileCompletedMirroredEformsignDocUsecase(
            linkMirroredDocumentByPhoneUsecase as never,
            syncClientEndDateUsecase as never,
            mirrorRepository as never,
            serviceRecordLifecycle as never,
        );
        linkMirroredDocumentByPhoneUsecase.execute.mockResolvedValue("linked");
        mirrorRepository.findState.mockResolvedValue(readyState());
        serviceRecordLifecycle.syncEndDateFromMirroredContract.mockResolvedValue(true);
        serviceRecordLifecycle.completeServiceRecordSnapshotIfReady.mockResolvedValue(true);
        syncClientEndDateUsecase.executeFromDocument.mockImplementation(
            async (
                _branchId: string,
                _documentId: string,
                _detail: EformsignApiDocumentResponse,
                options: { persist?: (target: { clientId: number; endDate: Date }) => Promise<void> },
            ) => options.persist?.({
                clientId: 71,
                endDate: new Date("2026-08-14T00:00:00.000Z"),
            }),
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("uses the current ready mirror detail and fences lifecycle persistence to that exact version", async () => {
        const staleDetail = { ...detail, fields: [{ id: "계약 종료 일", value: "01", type: "text" }] };
        await usecase.execute({ documentId: "doc-1", detail: staleDetail });

        expect(linkMirroredDocumentByPhoneUsecase.execute).toHaveBeenCalledWith(
            "doc-1",
            undefined,
            {
                detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
                detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
            },
        );
        expect(syncClientEndDateUsecase.executeFromDocument).toHaveBeenCalledWith(
            "branch-1",
            "doc-1",
            detail,
            expect.objectContaining({ persist: expect.any(Function) }),
        );
        expect(serviceRecordLifecycle.syncEndDateFromMirroredContract).toHaveBeenCalledWith({
            branchId: "branch-1",
            clientId: 71,
            endDate: new Date("2026-08-14T00:00:00.000Z"),
            documentId: "doc-1",
            detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
            detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
        });
    });

    it("uses the current-contract fence for the legacy no-mirror-version fallback", async () => {
        const fencedSync = jest.fn().mockResolvedValue(true);
        (serviceRecordLifecycle as {
            syncEndDateFromCurrentContract?: typeof fencedSync;
        }).syncEndDateFromCurrentContract = fencedSync;

        try {
            await usecase.syncLinkedContract({
                branchId: "branch-1",
                documentId: "doc-1",
                detail,
            });

            expect(fencedSync).toHaveBeenCalledWith({
                branchId: "branch-1",
                clientId: 71,
                endDate: new Date("2026-08-14T00:00:00.000Z"),
                documentId: "doc-1",
            });
            expect(serviceRecordLifecycle.syncEndDateFromContract).not.toHaveBeenCalled();
        } finally {
            delete (serviceRecordLifecycle as {
                syncEndDateFromCurrentContract?: unknown;
            }).syncEndDateFromCurrentContract;
        }
    });

    it("forwards automation suppression while retaining local persistence", async () => {
        await usecase.execute({
            documentId: "doc-1",
            detail,
            options: { suppressOutboundAutomation: true },
        });

        expect(linkMirroredDocumentByPhoneUsecase.execute).toHaveBeenCalledWith(
            "doc-1",
            { suppressOutboundAutomation: true },
            {
                detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
                detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
            },
        );
        expect(syncClientEndDateUsecase.executeFromDocument).toHaveBeenCalledTimes(1);
        expect(serviceRecordLifecycle.syncEndDateFromMirroredContract).toHaveBeenCalledTimes(1);
    });

    it("re-reads and persists against the latest ready mirror generation after linking", async () => {
        const initialState = readyState();
        const latestDetail = {
            ...detail,
            current_status: { ...detail.current_status, status_type: "072" },
        };
        const latestState = readyState({
            detailPayload: latestDetail,
            detailSourceUpdatedDate: new Date("2026-07-30T01:02:00.000Z"),
            detailSyncedAt: new Date("2026-07-30T01:03:00.000Z"),
            files: ["document", "audit_trail"].map((fileType) => ({
                fileType,
                sourceUpdatedDate: new Date("2026-07-30T01:02:00.000Z"),
            })),
        });
        mirrorRepository.findState
            .mockResolvedValueOnce(initialState)
            .mockResolvedValueOnce(latestState);

        await usecase.execute({ documentId: "doc-1", detail });

        expect(linkMirroredDocumentByPhoneUsecase.execute).toHaveBeenCalledWith(
            "doc-1",
            undefined,
            {
                detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
                detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
            },
        );
        expect(syncClientEndDateUsecase.executeFromDocument).toHaveBeenCalledWith(
            "branch-1",
            "doc-1",
            latestDetail,
            expect.objectContaining({ persist: expect.any(Function) }),
        );
        expect(serviceRecordLifecycle.syncEndDateFromMirroredContract).toHaveBeenCalledWith(
            expect.objectContaining({
                detailSourceUpdatedDate: new Date("2026-07-30T01:02:00.000Z"),
                detailSyncedAt: new Date("2026-07-30T01:03:00.000Z"),
            }),
        );
    });

    it("passes needs_confirmation through without linking or completing a snapshot", async () => {
        linkMirroredDocumentByPhoneUsecase.execute.mockResolvedValue("needs_confirmation");
        const validDetail = {
            ...detail,
            fields: [
                { id: "계약 종료 년도", value: "2026", type: "text" },
                { id: "계약 종료 월", value: "08", type: "text" },
                { id: "계약 종료 일", value: "14", type: "text" },
            ],
        };
        mirrorRepository.findState.mockResolvedValue(readyState({ detailPayload: validDetail }));
        const documentRepository = { findByDocumentId: jest.fn().mockResolvedValue({ clientId: null }) };
        const clientRepository = { findById: jest.fn(), update: jest.fn() };
        const holidayCalendar = { forBranch: jest.fn() };
        const realSync = new SyncClientEndDateUsecase(
            {} as never,
            documentRepository as never,
            clientRepository as never,
            holidayCalendar as never,
        );
        usecase = new ReconcileCompletedMirroredEformsignDocUsecase(
            linkMirroredDocumentByPhoneUsecase as never,
            realSync,
            mirrorRepository as never,
            serviceRecordLifecycle as never,
        );

        await expect(usecase.execute({
            documentId: "doc-1", detail: validDetail, throwOnCompletionReconciliationError: true,
        })).resolves.toBe("needs_confirmation");

        expect(linkMirroredDocumentByPhoneUsecase.execute).toHaveBeenCalledTimes(1);
        expect(documentRepository.findByDocumentId).toHaveBeenCalledWith("branch-1", "doc-1");
        expect(clientRepository.findById).not.toHaveBeenCalled();
        expect(clientRepository.update).not.toHaveBeenCalled();
        expect(holidayCalendar.forBranch).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.syncEndDateFromMirroredContract).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.completeServiceRecordSnapshotIfReady).not.toHaveBeenCalled();
    });

    describe("final completion of an already linked contract (real end-date usecase)", () => {
        const completedDetail = {
            ...detail,
            fields: [
                { id: "계약 종료 년도", value: "2026", type: "text" },
                { id: "계약 종료 월", value: "08", type: "text" },
                { id: "계약 종료 일", value: "14", type: "text" },
            ],
        } as EformsignApiDocumentResponse;

        const linkedDocument = (voidedAt: Date | null) => EformsignDocEntity.reconstitute({
            id: 11,
            documentId: "doc-1",
            createdDate: new Date("2026-07-30T00:00:00.000Z"),
            updatedDate: new Date("2026-07-30T01:00:00.000Z"),
            statusType: "050",
            statusDetail: "완료",
            stepType: "06",
            stepIndex: "3",
            stepName: "완료",
            stepRecipientType: "01",
            stepRecipientName: "직원",
            stepRecipientSms: "01012345678",
            expiredDate: new Date("2026-09-01T00:00:00.000Z"),
            expired: false,
            clientId: 71,
            voidedAt,
        });

        const buildReconciler = (voidedAt: Date | null) => {
            linkMirroredDocumentByPhoneUsecase.execute.mockResolvedValue("linked");
            mirrorRepository.findState.mockResolvedValue(readyState({ detailPayload: completedDetail }));
            const documentRepository = { findByDocumentId: jest.fn().mockResolvedValue(linkedDocument(voidedAt)) };
            const clientRepository = {
                findById: jest.fn().mockResolvedValue({ id: 71, update: jest.fn() }),
                update: jest.fn(),
            };
            const realSync = new SyncClientEndDateUsecase(
                {} as never,
                documentRepository as never,
                clientRepository as never,
                createHolidayCalendarStub(),
            );
            return {
                documentRepository,
                clientRepository,
                reconciler: new ReconcileCompletedMirroredEformsignDocUsecase(
                    linkMirroredDocumentByPhoneUsecase as never,
                    realSync,
                    mirrorRepository as never,
                    serviceRecordLifecycle as never,
                ),
            };
        };

        it("persists no end date for a voided (파기) document, while still returning the link result", async () => {
            const { reconciler, documentRepository, clientRepository } =
                buildReconciler(new Date("2026-10-01T00:00:00.000Z"));

            await expect(reconciler.execute({
                documentId: "doc-1",
                detail: completedDetail,
                throwOnCompletionReconciliationError: true,
            })).resolves.toBe("linked");

            expect(documentRepository.findByDocumentId).toHaveBeenCalledWith("branch-1", "doc-1");
            expect(clientRepository.findById).not.toHaveBeenCalled();
            expect(clientRepository.update).not.toHaveBeenCalled();
            expect(serviceRecordLifecycle.syncEndDateFromMirroredContract).not.toHaveBeenCalled();
            expect(serviceRecordLifecycle.syncEndDateFromContract).not.toHaveBeenCalled();
        });

        it("persists the end date for a non-voided document (control)", async () => {
            const { reconciler, clientRepository } = buildReconciler(null);

            await expect(reconciler.execute({
                documentId: "doc-1",
                detail: completedDetail,
                throwOnCompletionReconciliationError: true,
            })).resolves.toBe("linked");

            expect(clientRepository.findById).toHaveBeenCalledWith("branch-1", 71);
            expect(serviceRecordLifecycle.syncEndDateFromMirroredContract).toHaveBeenCalledWith(
                expect.objectContaining({
                    branchId: "branch-1",
                    clientId: 71,
                    endDate: new Date("2026-08-14T00:00:00.000Z"),
                    documentId: "doc-1",
                }),
            );
        });
    });

    it("stops all completion effects when the atomic link fence loses", async () => {
        linkMirroredDocumentByPhoneUsecase.execute.mockResolvedValue("mirror_not_ready");

        await expect(usecase.execute({ documentId: "doc-1", detail }))
            .resolves.toBe("mirror_not_ready");

        expect(mirrorRepository.findState).toHaveBeenCalledTimes(1);
        expect(syncClientEndDateUsecase.executeFromDocument).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.syncEndDateFromMirroredContract).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.completeServiceRecordSnapshotIfReady).not.toHaveBeenCalled();
    });

    it("does not sync when the mirror is not ready at its current version", async () => {
        mirrorRepository.findState.mockResolvedValue(readyState({
            syncStatus: "partial",
        }));

        await usecase.execute({ documentId: "doc-1", detail });

        expect(syncClientEndDateUsecase.executeFromDocument).not.toHaveBeenCalled();
    });

    it("does not link or trigger durable completion effects when the current mirror is not ready", async () => {
        mirrorRepository.findState.mockResolvedValue(readyState({
            syncStatus: "partial",
        }));

        await expect(usecase.execute({ documentId: "doc-1", detail })).resolves.toBe(
            "mirror_not_ready",
        );

        expect(linkMirroredDocumentByPhoneUsecase.execute).not.toHaveBeenCalled();
        expect(syncClientEndDateUsecase.executeFromDocument).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.syncEndDateFromMirroredContract).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.completeServiceRecordSnapshotIfReady).not.toHaveBeenCalled();
    });

    it("does not link or trigger completion effects after permanent purge is requested", async () => {
        mirrorRepository.findState.mockResolvedValue(readyState({
            permanentPurgeRequestedAt: new Date("2026-07-30T01:02:00.000Z"),
        }));

        await expect(usecase.execute({ documentId: "doc-1", detail }))
            .resolves.toBe("mirror_not_ready");

        expect(linkMirroredDocumentByPhoneUsecase.execute).not.toHaveBeenCalled();
        expect(syncClientEndDateUsecase.executeFromDocument).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.syncEndDateFromMirroredContract).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.completeServiceRecordSnapshotIfReady).not.toHaveBeenCalled();
    });

    it("recovers a 062 service-record completion without touching contract end dates", async () => {
        linkMirroredDocumentByPhoneUsecase.execute.mockResolvedValue("skipped");
        mirrorRepository.findState.mockResolvedValue(readyState({
            detailPayload: {
                ...detail,
                current_status: { ...detail.current_status, status_type: "062" },
            },
        }));

        await usecase.execute({ documentId: "doc-1", detail });

        expect(serviceRecordLifecycle.completeServiceRecordSnapshotIfReady)
            .toHaveBeenCalledWith({
                branchId: "branch-1",
                documentId: "doc-1",
                mirrorVersion: {
                    detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
                    detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
                },
            });
        expect(syncClientEndDateUsecase.executeFromDocument).not.toHaveBeenCalled();
    });

    it("defers a service-record lifecycle transition when the completion claim has not run", async () => {
        linkMirroredDocumentByPhoneUsecase.execute.mockResolvedValue("skipped");

        await expect(usecase.execute({
            documentId: "doc-1",
            detail,
            deferServiceRecordLifecycle: true,
        })).resolves.toBe("skipped");

        expect(serviceRecordLifecycle.completeServiceRecordSnapshotIfReady)
            .not.toHaveBeenCalled();
    });

    it("reconciles a service-record lifecycle against the ready mirror generation after status projection", async () => {
        await expect(usecase.reconcileServiceRecordSnapshotCompletion("doc-1"))
            .resolves.toBe(true);

        expect(serviceRecordLifecycle.completeServiceRecordSnapshotIfReady)
            .toHaveBeenCalledWith({
                branchId: "branch-1",
                documentId: "doc-1",
                mirrorVersion: {
                    detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
                    detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
                },
        });
    });

    it("reports no change when a ready service-record lifecycle is already complete", async () => {
        serviceRecordLifecycle.completeServiceRecordSnapshotIfReady.mockResolvedValue(false);

        await expect(usecase.reconcileServiceRecordSnapshotCompletion("doc-1"))
            .resolves.toBe(false);

        expect(serviceRecordLifecycle.completeServiceRecordSnapshotIfReady)
            .toHaveBeenCalledWith({
                branchId: "branch-1",
                documentId: "doc-1",
                mirrorVersion: {
                    detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
                    detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
                },
            });
    });

    it("leaves service-record lifecycle completion retryable when its mirror is no longer ready", async () => {
        mirrorRepository.findState.mockResolvedValue(readyState({ syncStatus: "partial" }));

        await expect(usecase.reconcileServiceRecordSnapshotCompletion("doc-1"))
            .resolves.toBeNull();

        expect(serviceRecordLifecycle.completeServiceRecordSnapshotIfReady).not.toHaveBeenCalled();
    });

    it("does not treat contract 062 as a final completion", async () => {
        mirrorRepository.findState.mockResolvedValue(readyState({
            detailPayload: {
                ...detail,
                current_status: { ...detail.current_status, status_type: "062" },
            },
        }));

        await usecase.execute({ documentId: "doc-1", detail });

        expect(syncClientEndDateUsecase.executeFromDocument).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.completeServiceRecordSnapshotIfReady).not.toHaveBeenCalled();
    });

    it("does not sync an unassigned completion after link reconciliation cannot resolve a branch", async () => {
        mirrorRepository.findState.mockResolvedValue(readyState({ branchId: null }));

        await usecase.execute({ documentId: "doc-1", detail });

        expect(syncClientEndDateUsecase.executeFromDocument).not.toHaveBeenCalled();
    });

    it("rethrows a transient lifecycle persistence failure for strict completion reconciliation", async () => {
        const lifecycleError = new Error("lifecycle database unavailable");
        syncClientEndDateUsecase.executeFromDocument.mockRejectedValueOnce(lifecycleError);

        await expect(usecase.execute({
            documentId: "doc-1",
            detail,
            throwOnCompletionReconciliationError: true,
        })).rejects.toThrow(lifecycleError);

        expect(syncClientEndDateUsecase.executeFromDocument).toHaveBeenCalledWith(
            "branch-1",
            "doc-1",
            detail,
            expect.objectContaining({
                persist: expect.any(Function),
                throwOnError: true,
            }),
        );
    });

    it("rethrows when strict contract persistence loses its mirror generation fence", async () => {
        serviceRecordLifecycle.syncEndDateFromMirroredContract.mockResolvedValue(false);

        await expect(usecase.execute({
            documentId: "doc-1",
            detail,
            throwOnCompletionReconciliationError: true,
        })).rejects.toThrow(/generation changed/i);
    });
});
