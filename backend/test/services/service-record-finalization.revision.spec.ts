import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { setup as initialRecoverySetup, input as initialRecoveryInput } from "../utils/service-record-initial-recovery.fixture";
import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isInitialFinalizationRequestKeyFor } from "application/policies/service-record-initial-finalization.policy";
import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import {
    KOREAN_HOLIDAY_CALENDAR,
    KR_BUILTIN_CALENDAR,
    createKrBusinessDayCalendar,
    type KrBusinessDayCalendar,
} from "domain/utils/business-days";
import { withClientServiceDays } from "domain/utils/client-service-days";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";
import { findManyFrom, matchesWhere } from "../utils/prisma-where-evaluator";

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
            serviceStatus: "active",
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
        createHolidayCalendarStub(), jobService as never,
        editRepository as never,
    );
}

describe("ServiceRecordFinalizationService revised claim and the branch calendar", () => {
    const referenceDate = new Date("2026-09-30T00:00:00.000Z");

    function claimHarness(
        holidayCalendar: ReturnType<typeof createHolidayCalendarStub>,
        record = source(),
        currentExtra: Record<string, unknown> = {},
    ) {
        const tx = {
            service_record_case: {
                findUnique: jest.fn(async (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
                    if (args.select && "branch" in args.select) return { ...record, branch: { name: record.branchName } };
                    return { id: caseId, branchId, clientId, status: "READY_TO_FINALIZE", nextAttemptAt: null, finalizationAttempts: 0, ...currentExtra };
                }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const prisma = {
            $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
        };
        const lifecycle = { recompute: jest.fn().mockResolvedValue(undefined) };
        const service = new ServiceRecordFinalizationService(
            prisma as never,
            lifecycle as never,
            {} as never,
            holidayCalendar,
        );
        const claim = () => (service as unknown as {
            claimFinalizationCase: (id: string, branch: string, reference: Date) => Promise<unknown>;
        }).claimFinalizationCase(caseId, branchId, referenceDate);
        return { claim, prisma, lifecycle, tx };
    }

    it("passes the calendar loaded before the claim transaction to an ineligible source recompute", async () => {
        const holidayCalendar = createHolidayCalendarStub();
        const calendar = createKrBusinessDayCalendar([], { version: "test", supportedYears: [2026] });
        (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(calendar);
        const { claim, prisma, lifecycle, tx } = claimHarness(holidayCalendar, { ...source(), days: [] });

        await expect(claim()).resolves.toMatchObject({ claimed: false, blockedGeneration: true });

        // Claim always opens its owning transaction before returning this result.
        expect((holidayCalendar.forBranch as jest.Mock).mock.invocationCallOrder[0])
            .toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]!);
        expect(lifecycle.recompute).toHaveBeenCalledWith(caseId, tx, calendar);
    });

    it("claims nothing and changes nothing for a tombstoned client, before any recompute or provider job", async () => {
        const { claim, lifecycle, tx } = claimHarness(
            createHolidayCalendarStub(),
            source(),
            { client: { deletedAt: new Date("2026-09-29T00:00:00.000Z") } },
        );

        await expect(claim()).resolves.toEqual({ claimed: false, attempts: 0 });

        expect(tx.service_record_case.updateMany).not.toHaveBeenCalled();
        expect(lifecycle.recompute).not.toHaveBeenCalled();
    });

    it("still reaches freezing for a live client", async () => {
        const { claim } = claimHarness(createHolidayCalendarStub(), source(), { client: { deletedAt: null } });

        await expect(claim()).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_GENERATION_UNAVAILABLE" },
        });
    });

    it("treats a revised source as eligible under the built-in calendar", async () => {
        // Eligible sources proceed to freezing, which needs the job service this harness omits.
        const { claim } = claimHarness(createHolidayCalendarStub());

        await expect(claim()).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_GENERATION_UNAVAILABLE" },
        });
    });

    it.each([
        ["a default client's calendar", undefined],
        ["a Saturday-enabled client's calendar", { allowSaturdayService: true }],
    ])("keeps a source with a persisted Saturday session eligible under %s", async (_label, flags) => {
        // Sat 2026-12-19 is no business day for a default client, but a stored planned date is
        // never re-judged against any calendar: written and approved dates keep their validity.
        const saturday = new Date("2026-12-19T00:00:00.000Z");
        const record = sourceWith({
            startDate: saturday,
            endDate: saturday,
            plannedSessions: source().plannedSessions.map((entry) => ({
                ...entry,
                serviceDate: "2026-12-19",
                originalDate: "2026-12-19",
            })),
            days: source().days.map((day) => ({ ...day, serviceDate: saturday })),
        });
        const holidayCalendar = createHolidayCalendarStub();
        (holidayCalendar.forBranch as jest.Mock).mockImplementation(async () =>
            withClientServiceDays(KR_BUILTIN_CALENDAR, flags));
        const { claim, lifecycle } = claimHarness(holidayCalendar, record);

        // Eligible sources proceed to freezing, which needs the job service this harness omits.
        await expect(claim()).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_GENERATION_UNAVAILABLE" },
        });
        expect(lifecycle.recompute).not.toHaveBeenCalled();
    });

    it("keeps a READY revised source eligible after its planned date becomes a holiday", async () => {
        const holidayCalendar = createHolidayCalendarStub();
        (holidayCalendar.forBranch as jest.Mock).mockImplementation(async () => createKrBusinessDayCalendar(
            [...Object.values(KOREAN_HOLIDAY_CALENDAR).flat(), "2026-09-07"],
            { version: "kr-db-test", supportedYears: Object.keys(KOREAN_HOLIDAY_CALENDAR).map(Number) },
        ));
        const { claim, prisma, lifecycle } = claimHarness(holidayCalendar);

        // Like the built-in case, it reaches freezing (the harness omits the job service).
        await expect(claim()).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_GENERATION_UNAVAILABLE" },
        });

        expect(holidayCalendar.forBranch).toHaveBeenCalledWith(branchId, { fresh: true });
        expect((holidayCalendar.forBranch as jest.Mock).mock.invocationCallOrder[0]!)
            .toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]!);
        expect(lifecycle.recompute).not.toHaveBeenCalled();
    });
});

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
            eformsign_document_job: { findMany: jest.fn().mockResolvedValue([]) },
            service_record_revision: {
                findUnique: jest.fn().mockResolvedValue(revision),
            },
        };
        const service = buildService(jobService);

        await (service as unknown as {
            freezeInitialFinalizationGeneration: (
                tx: unknown,
                source: unknown,
                calendar: KrBusinessDayCalendar,
            ) => Promise<void>;
        }).freezeInitialFinalizationGeneration(tx, source(), KR_BUILTIN_CALENDAR);

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
                freezeInitialFinalizationGeneration: (
                tx: unknown,
                source: unknown,
                calendar: KrBusinessDayCalendar,
            ) => Promise<void>;
            }).freezeInitialFinalizationGeneration(tx, sourceWith(overrides), KR_BUILTIN_CALENDAR);
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

    it("fails closed when the branch calendar made a planned date a holiday", async () => {
        // 2026-09-07 is a business day in the built-in calendar, so the vector validates there.
        const branchCalendar = createKrBusinessDayCalendar(
            [...Object.values(KOREAN_HOLIDAY_CALENDAR).flat(), "2026-09-07"],
            { version: "kr-db-test", supportedYears: Object.keys(KOREAN_HOLIDAY_CALENDAR).map(Number) },
        );
        const jobService = {
            findByRequestKeyInTransaction: jest.fn(),
            enqueueInTransaction: jest.fn(),
        };
        const service = buildService(jobService);
        const freeze = (calendar: KrBusinessDayCalendar) => (service as unknown as {
            freezeInitialFinalizationGeneration: (
                tx: unknown,
                source: unknown,
                calendar: KrBusinessDayCalendar,
            ) => Promise<void>;
        }).freezeInitialFinalizationGeneration({ eformsign_document_job: { findMany: jest.fn().mockResolvedValue([]) },
            service_record_revision: { findUnique: jest.fn() } }, source(), calendar);

        await expect(freeze(branchCalendar)).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_SOURCE_UNAVAILABLE" },
        });
        expect(jobService.enqueueInTransaction).not.toHaveBeenCalled();
    });

    it("rejects an invalid existing job before reading a newer INITIAL state", async () => {
        const jobService = { findByRequestKeyInTransaction: jest.fn().mockResolvedValue({ payload: { generation: "gen1" } }),
            enqueueInTransaction: jest.fn() };
        const findFirst = jest.fn().mockResolvedValue({ generation: "gen2", workflowScope: {
            generationKind: "INITIAL_FINALIZATION", requestKey: `service-record-initial-finalization:${revisionId}`,
        } });
        const service = buildService(jobService);
        const findMany = jest.fn().mockResolvedValue([{
            requestKey: `service-record-initial-finalization:${revisionId}`, payload: { generation: "gen1" },
        }]);
        await expect((service as unknown as { freezeInitialFinalizationGeneration: (tx: unknown, source: unknown,
            calendar: KrBusinessDayCalendar) => Promise<void> }).freezeInitialFinalizationGeneration({
            eformsign_document_job: { findMany },
            service_record_revision_document_state: { findFirst },
        }, source(), KR_BUILTIN_CALENDAR)).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_REVISION_GENERATION_SCOPE_CHANGED" } });
        expect(findMany).toHaveBeenCalledWith({ where: { branchId, clientId, jobType: "create_document", source: "auto_finalize",
            AND: [{ payload: { path: ["revisionId"], equals: revisionId } },
                { payload: { path: ["generationKind"], equals: "INITIAL_FINALIZATION" } }] } });
        expect(findFirst).not.toHaveBeenCalled();
        expect(jobService.findByRequestKeyInTransaction).not.toHaveBeenCalled();
        expect(jobService.enqueueInTransaction).not.toHaveBeenCalled();
    });

    it("refuses a valid fallback job from a generation older than the newest INITIAL state", async () => {
        const requestKey = `service-record-initial-finalization:${revisionId}`;
        const immutablePayload = { caseId }, fingerprint = sha256CanonicalJson(immutablePayload);
        const existing = { requestKey, branchId, clientId, jobType: "create_document", payloadFingerprint: fingerprint,
            payload: { kind: "service_record_revision", generationKind: "INITIAL_FINALIZATION", generation: "gen1",
                revisionId, completeness: "complete", manualReviewRequired: true, documentVersion: 3,
                immutablePayload, payloadFingerprint: fingerprint, snapshotReference: requestKey,
                context: { branchId, clientId, serviceRecordCaseId: caseId, revisionId, businessFingerprint: fingerprint } } };
        const jobs = { findByRequestKeyInTransaction: jest.fn().mockResolvedValue(existing), enqueueInTransaction: jest.fn() };
        const findFirst = jest.fn().mockResolvedValue({ generation: "gen2", workflowScope: {
            generationKind: "INITIAL_FINALIZATION", requestKey,
        } });
        // No enumerated job: exercise the fallback request lookup and its generation fence.
        const tx = { eformsign_document_job: { findMany: jest.fn().mockResolvedValue([]) },
            service_record_revision_document_state: { findFirst } };
        await expect((buildService(jobs) as unknown as { freezeInitialFinalizationGeneration: (tx: unknown, source: unknown,
            calendar: KrBusinessDayCalendar) => Promise<void> }).freezeInitialFinalizationGeneration(tx, source(), KR_BUILTIN_CALENDAR))
            .rejects.toMatchObject({ response: { code: "SERVICE_RECORD_REVISION_GENERATION_SCOPE_CHANGED" } });
        expect(findFirst).toHaveBeenCalledTimes(1);
        expect(jobs.findByRequestKeyInTransaction).toHaveBeenCalledWith(tx, requestKey);
        expect(jobs.enqueueInTransaction).not.toHaveBeenCalled();
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
        const findMany = jest.fn().mockResolvedValue([existing]);
        const findFirst = jest.fn();

        await (service as unknown as {
            freezeInitialFinalizationGeneration: (
                tx: unknown,
                source: unknown,
                calendar: KrBusinessDayCalendar,
            ) => Promise<void>;
        }).freezeInitialFinalizationGeneration({ eformsign_document_job: { findMany },
            service_record_revision_document_state: { findFirst } }, source(), KR_BUILTIN_CALENDAR);

        expect(findMany).toHaveBeenCalledTimes(1);
        expect(findFirst).not.toHaveBeenCalled();
        expect(jobService.findByRequestKeyInTransaction).not.toHaveBeenCalled();
        expect(jobService.enqueueInTransaction).not.toHaveBeenCalled();
    });
});

describe("ServiceRecordFinalizationService backfilled sessions", () => {
    const replacedAssignmentId = "00000000-0000-4000-8000-000000000041";
    const currentAssignmentId = "00000000-0000-4000-8000-000000000042";
    const secondDate = new Date("2026-09-08T00:00:00.000Z");

    /** The stored vector attributes both sessions to the replaced caregiver (schedule 100, employee 11). */
    function backfilledSource(options: {
        vectorOwner?: "replaced" | "current";
        writerReplaced?: boolean;
        /** Stored assignment dates, which are record-only and must not decide who may backfill. */
        replacedDates?: { startDate: Date; endDate: Date };
        writerDates?: { startDate: Date; endDate: Date };
        /** Overrides the backfilling caregiver's schedule id (default 200). */
        writerScheduleId?: number;
        /** A written day with no employee is identified by its schedule alone. */
        firstDayEmployeeId?: number | null;
        writerDayEmployeeId?: number | null;
    } = {}) {
        const writerScheduleId = options.writerScheduleId ?? 200;
        const base = source();
        const vectorOwner = options.vectorOwner === "current"
            ? { assignmentId: currentAssignmentId, scheduleId: writerScheduleId, employeeId: 12 }
            : { assignmentId: replacedAssignmentId, scheduleId: 100, employeeId: 11 };
        const plannedEntry = (sessionIndex: number, serviceDate: string) => ({
            sessionIndex,
            serviceDate,
            originalDate: serviceDate,
            ...vectorOwner,
            provenanceVersion: "revision-1",
        });
        return {
            ...base,
            requiredSessionCount: 2,
            endDate: secondDate,
            plannedSessions: [plannedEntry(1, "2026-09-07"), plannedEntry(2, "2026-09-08")],
            assignments: [
                {
                    id: replacedAssignmentId,
                    scheduleId: 100,
                    employeeId: 11,
                    employeeNameSnapshot: "제공인력",
                    startDate: options.replacedDates?.startDate ?? date,
                    endDate: options.replacedDates?.endDate ?? secondDate,
                    schedule: { replaced: true },
                },
                {
                    id: currentAssignmentId,
                    scheduleId: writerScheduleId,
                    employeeId: 12,
                    employeeNameSnapshot: "신규인력",
                    startDate: options.writerDates?.startDate ?? secondDate,
                    endDate: options.writerDates?.endDate ?? secondDate,
                    schedule: { replaced: options.writerReplaced ?? false },
                },
            ],
            days: [
                {
                    ...base.days[0]!,
                    employeeId: options.firstDayEmployeeId === undefined ? base.days[0]!.employeeId : options.firstDayEmployeeId,
                },
                {
                    ...base.days[0]!,
                    id: "00000000-0000-4000-8000-000000000051",
                    scheduleId: writerScheduleId,
                    caseSessionIndex: 2,
                    sessionIndex: 2,
                    employeeId: options.writerDayEmployeeId === undefined ? 12 : options.writerDayEmployeeId,
                    employeeNameSnapshot: "신규인력",
                    serviceDate: secondDate,
                },
            ],
        };
    }

    async function freeze(record: ReturnType<typeof backfilledSource>) {
        const jobService = {
            findByRequestKeyInTransaction: jest.fn().mockResolvedValue(null),
            enqueueInTransaction: jest.fn().mockResolvedValue({ existing: false, job: { requestKey: "unused" } }),
        };
        const tx = {
            eformsign_document_job: { findMany: jest.fn().mockResolvedValue([]) },
            service_record_revision: {
                findUnique: jest.fn().mockResolvedValue({
                    id: revisionId,
                    revisionNumber: 2,
                    payload: {
                        plannedSessions: [
                            { sessionIndex: 1, originalDate: "2026-09-07" },
                            { sessionIndex: 2, originalDate: "2026-09-08" },
                        ],
                        sessions: [],
                    },
                }),
            },
        };
        await (buildService(jobService) as unknown as {
            freezeInitialFinalizationGeneration: (
                tx: unknown,
                source: unknown,
                calendar: KrBusinessDayCalendar,
            ) => Promise<void>;
        }).freezeInitialFinalizationGeneration(tx, record, KR_BUILTIN_CALENDAR);
        return jobService;
    }

    it("accepts a day the current caregiver backfilled on a slot the vector gives a replaced one", async () => {
        const jobService = await freeze(backfilledSource());
        expect(jobService.enqueueInTransaction).toHaveBeenCalledTimes(1);
    });

    it("accepts a backfill by a caregiver who has itself been replaced since", async () => {
        // A -> B -> C: B backfilled A's slot, then C took over.
        const record = backfilledSource({ writerReplaced: true });
        record.assignments.push({
            id: "00000000-0000-4000-8000-000000000043",
            scheduleId: 300,
            employeeId: 13,
            employeeNameSnapshot: "후임인력",
            startDate: secondDate,
            endDate: secondDate,
            schedule: { replaced: false },
        });
        const jobService = await freeze(record);
        expect(jobService.enqueueInTransaction).toHaveBeenCalledTimes(1);
    });

    it("accepts a backfill when the successor's stored start precedes the replaced caregiver's stored end", async () => {
        // The replaced caregiver was stored [09-08, 09-08] while the successor starts earlier, on 09-07.
        const jobService = await freeze(backfilledSource({
            replacedDates: { startDate: secondDate, endDate: secondDate },
            writerDates: { startDate: date, endDate: new Date("2026-09-30T00:00:00.000Z") },
        }));
        expect(jobService.enqueueInTransaction).toHaveBeenCalledTimes(1);
    });

    const failsClosed = async (record: ReturnType<typeof backfilledSource>) => {
        await expect(freeze(record)).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_SOURCE_UNAVAILABLE" },
        });
    };

    it("accepts a backfilled day with no employee, identifying its writer by schedule order alone", async () => {
        const jobService = await freeze(backfilledSource({ writerDayEmployeeId: null }));
        expect(jobService.enqueueInTransaction).toHaveBeenCalledTimes(1);
    });

    it("accepts the planned owner's own day when it names no employee", async () => {
        const jobService = await freeze(backfilledSource({ firstDayEmployeeId: null }));
        expect(jobService.enqueueInTransaction).toHaveBeenCalledTimes(1);
    });

    it("still fails closed on a backfilled day with no employee when the writer's schedule id is lower", async () => {
        await failsClosed(backfilledSource({ writerDayEmployeeId: null, writerScheduleId: 50 }));
    });

    it("still fails closed on a backfilled day with no employee when its schedule matches more than one assignment", async () => {
        const record = backfilledSource({ writerDayEmployeeId: null });
        record.assignments.push({
            ...record.assignments[1]!,
            id: "00000000-0000-4000-8000-000000000045",
            employeeId: 14,
        });
        await failsClosed(record);
    });

    it("still fails closed on a day with no employee when its schedule is not the planned owner's", async () => {
        // Session 1's day is written under schedule 999, which no assignment owns.
        const record = backfilledSource({ firstDayEmployeeId: null });
        record.days[0] = { ...record.days[0]!, scheduleId: 999 };
        await failsClosed(record);
    });

    it("still fails closed when the vector names the current assignment and the writer is another one", async () => {
        await failsClosed(backfilledSource({ vectorOwner: "current" }));
    });

    it("still fails closed when an earlier caregiver wrote over a later replaced caregiver's slot", async () => {
        // The vector names the (replaced) later assignment for both slots; the earlier one wrote slot 1.
        const record = backfilledSource({ vectorOwner: "current", writerReplaced: true });
        await failsClosed(record);
    });

    it("still fails closed when the writer's schedule id is lower than the replaced vector owner's", async () => {
        // The stored dates alone would have accepted this (writer starts on the owner's end).
        await failsClosed(backfilledSource({ writerScheduleId: 50 }));
    });

    it("still fails closed when the vector's owner was not replaced, even for a later writer", async () => {
        const record = backfilledSource();
        record.assignments[0] = { ...record.assignments[0]!, schedule: { replaced: false } };
        await failsClosed(record);
    });

    it("still fails closed when the writer's schedule and employee match more than one assignment", async () => {
        const record = backfilledSource();
        record.assignments.push({
            ...record.assignments[1]!,
            id: "00000000-0000-4000-8000-000000000044",
        });
        await failsClosed(record);
    });

    it("still fails closed when the backfilled day's date contradicts the vector", async () => {
        const record = backfilledSource();
        record.days[1] = { ...record.days[1]!, serviceDate: new Date("2026-09-09T00:00:00.000Z") };
        await expect(freeze(record)).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_REVISION_SOURCE_UNAVAILABLE" },
        });
    });
});


it("releases a pre-deploy INITIAL after rejection and freezes one INITIAL for the confirmed revision", async () => {
    const rejectionCode = "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED";
    const oldRequestKey = `service-record-initial-finalization:${revisionId}`;
    const activeKey = `service-record-initial-finalization:${caseId}`;
    const record = { ...source(), status: "FINALIZATION_FAILED", finalizationDueAt: null, lastError: rejectionCode };
    const oldState = {
        id: stateId, branchId, clientId, revisionId, operation: "record_snapshot",
        generation: "old-generation", status: "failed", step: "failed", documentVersion: 3, lastErrorCode: rejectionCode,
        workflowScope: { generationKind: "INITIAL_FINALIZATION", requestKey: oldRequestKey },
    };
    const oldJob = {
        branchId, clientId, jobType: "create_document", source: "auto_finalize", requestKey: oldRequestKey,
        status: "requires_attention", activeKey, leaseToken: null, documentId: null,
        payload: { revisionId, generationKind: "INITIAL_FINALIZATION", generation: oldState.generation, context: { serviceRecordCaseId: caseId } },
    };
    const jobs: Array<Record<string, unknown>> = [oldJob];
    const newRevisionId = "00000000-0000-4000-8000-000000000031";
    const draftId = "00000000-0000-4000-8000-000000000080";
    const day = "2026-09-07";
    let revision: (Prisma.service_record_revisionUncheckedCreateInput & { id: string }) | null = null;
    const tx = {
        $queryRaw: jest.fn(async ({ text }: Prisma.Sql) => {
            if (text.includes('FROM "service_record_revision_document_state"')) return [oldState];
            if (text.includes('FROM "service_record_snapshot_chunk"')) return [
                { documentId: "doc-1", chunkIndex: 1, chunkCount: 2 },
                { documentId: "doc-2", chunkIndex: 2, chunkCount: 2 },
            ];
            if (text.includes('FROM "eformsign_doc" AS doc')) return ["doc-1", "doc-2"].map(documentId => ({
                documentId, statusType: "011", voided: false, purgePending: false, tombstoneEvaluated: false,
            }));
            if (text.includes('SELECT status, lease_token')) return [oldJob];
            if (text.includes('FROM "client"')) return [{ id: clientId }];
            if (text.includes('FROM "service_record_case"') || text.includes("FROM service_record_case")) return [record];
            return [];
        }),
        $executeRaw: jest.fn(async ({ text, values }: Prisma.Sql) => {
            expect(text).toContain("SET active_key = NULL, status = 'failed'");
            expect(values).toEqual([branchId, clientId, caseId, revisionId, oldState.generation]);
            Object.assign(oldJob, { status: "failed", activeKey: null });
            return 1;
        }),
        service_record_case: {
            findUnique: jest.fn(async () => ({ ...record, branch: { name: record.branchName } })),
            findMany: jest.fn(async ({ where }: { where: Prisma.service_record_caseWhereInput }) =>
                where.snapshotChunks && matchesWhere(record, { OR: where.OR }) ? [record] : []),
            update: jest.fn(async ({ data }: { data: Prisma.service_record_caseUpdateInput }) => {
                Object.assign(record, data);
                return { version: 2 };
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        service_record_revision: {
            findFirst: jest.fn().mockResolvedValue({ revisionNumber: 1 }),
            create: jest.fn(async ({ data }: { data: Prisma.service_record_revisionUncheckedCreateInput }) => {
                revision = { ...data, id: newRevisionId };
                return revision;
            }),
            findUnique: jest.fn(async () => revision),
        },
        service_record_edit_draft: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        service_record_token: { updateMany: jest.fn() },
        client: { updateMany: jest.fn() },
        eformsign_document_job: { findMany: findManyFrom(jobs) },
    };
    const prisma = { ...tx, $transaction: async (run: (db: typeof tx) => Promise<unknown>) => run(tx) };
    const repository = new ServiceRecordEditRepository(prisma as never);
    const editorReads = repository as unknown as { findDraftByIdWithClient: jest.Mock; loadSourceWithClient: jest.Mock };
    jest.spyOn(editorReads, "findDraftByIdWithClient").mockResolvedValue({ status: "ACTIVE", draftVersion: 1, serviceRecordCaseId: caseId });
    const editorSource = {
        caseId, caseVersion: 1, client: { id: clientId, startDate: day, endDate: day },
        caseLifecycle: { status: record.status }, assignments: record.assignments,
    };
    jest.spyOn(editorReads, "loadSourceWithClient").mockResolvedValue(editorSource);
    jest.spyOn(repository, "createRevisionDocumentStateInTransaction").mockResolvedValue({ id: "new-state" } as never);
    jest.spyOn(repository, "allocateServiceRecordRevisionDocumentVersionInTransaction").mockResolvedValue(1);
    const enqueueInTransaction = jest.fn(async (_tx, input: Record<string, unknown>) => {
        expect(jobs.some(job => job["activeKey"] === input["activeKey"])).toBe(false);
        const job = { ...input, id: "new-job", status: "queued" };
        jobs.push(job);
        return { existing: false, job };
    });
    const queue = { enqueueInTransaction, findByRequestKeyInTransaction: jest.fn().mockResolvedValue(null) };
    const snapshot = { executeCase: jest.fn() };
    const finalizer = new ServiceRecordFinalizationService(prisma as never, {} as never, snapshot as never,
        createHolidayCalendarStub(), queue as never, repository);

    const confirmed = await repository.confirmDraft({
        branchId, draftId, expectedDraftVersion: 1, previewId: `srp_${"a".repeat(64)}`,
        idempotencyKey: "00000000-0000-4000-8000-000000000081", requestFingerprint: "b".repeat(64), actorUserId: "admin",
        prepare: () => ({
            status: "confirmed", sourceFingerprint: "a".repeat(64), caseId, clientId, formVersion: record.formVersion,
            requiredSessionCount: record.requiredSessionCount, startDate: day, endDate: day, header: record,
            plannedSessions: record.plannedSessions, sessions: [], newSessions: [], assignments: [],
            revision: { branchId, serviceRecordCaseId: caseId, actorUserId: "admin", formVersionAtConfirm: record.formVersion,
                payload: { plannedSessions: record.plannedSessions }, plannedSessions: record.plannedSessions, provenance: {} },
            documentStatus: "waiting_for_completion", dispatchContext: null, documentJob: null,
        }),
    });
    expect(confirmed).toMatchObject({ revisionId: newRevisionId, revisionNumber: 2 });
    expect(oldJob).toMatchObject({ status: "failed", activeKey: null, requestKey: oldRequestKey });
    expect(record).toMatchObject({ currentRevisionId: newRevisionId, nextAttemptAt: expect.any(Date) });

    const referenceDate = new Date();
    await expect(finalizer.processDueCases(referenceDate)).resolves.toBe(0);
    await expect(finalizer.processDueCases(referenceDate)).resolves.toBe(0);
    expect(snapshot.executeCase).not.toHaveBeenCalled();
    expect(enqueueInTransaction).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(2);
    expect(jobs[1]).toMatchObject({ activeKey, status: "queued", payload: { revisionId: newRevisionId, generationKind: "INITIAL_FINALIZATION" } });
    expect(isInitialFinalizationRequestKeyFor(newRevisionId, jobs[1]?.["requestKey"])).toBe(true);
});

describe("cancelled INITIAL generation scheduler replay", () => {
    it.each(["preparing", "sent"])("retains %s generation through repeated processDueCases runs without claiming or enqueueing", async progressStep => {
        const f = initialRecoverySetup({ progressStep });
        expect(await f.repo.cancel(initialRecoveryInput)).toEqual({ kind: "cancelled" });
        const retained = structuredClone(f.job);
        const record = source();
        const caseDelegate = {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            findMany: jest.fn(async (args: { where: { snapshotChunks?: unknown } }) => args.where.snapshotChunks ? [record] : []),
            findUnique: jest.fn(async (args: { select: Record<string, unknown> }) => "branch" in args.select
                ? { ...record, branch: { name: record.branchName } } : record),
        };
        const findMany = jest.fn(async () => [f.job]);
        const tx = { ...f.tx, service_record_case: caseDelegate,
            eformsign_document_job: { ...f.tx.eformsign_document_job, findMany } };
        const prisma = { service_record_case: caseDelegate,
            $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
        const jobs = { findByRequestKeyInTransaction: jest.fn(async () => f.job), enqueueInTransaction: jest.fn() };
        const edit = { createRevisionDocumentStateInTransaction: jest.fn(async () => ({ ...f.state })),
            allocateServiceRecordRevisionDocumentVersionInTransaction: jest.fn() };
        const lifecycle = { recompute: jest.fn() }, snapshot = { executeCase: jest.fn() };
        const service = new ServiceRecordFinalizationService(prisma as never, lifecycle as never, snapshot as never,
            createHolidayCalendarStub(), jobs as never, edit as never);
        const claims = jest.spyOn(service as unknown as {
            claimFinalizationCase: (...args: unknown[]) => Promise<unknown>;
        }, "claimFinalizationCase");
        await expect(service.processDueCases(new Date("2026-09-30"))).resolves.toBe(0);
        await expect(service.processDueCases(new Date("2026-09-30"))).resolves.toBe(0);
        expect(claims).toHaveBeenCalledTimes(2);
        for (const result of claims.mock.results) {
            await expect(result.value).resolves.toMatchObject({ claimed: false, blockedGeneration: true });
        }
        expect(findMany).toHaveBeenCalledTimes(2);
        expect(jobs.findByRequestKeyInTransaction).not.toHaveBeenCalled();
        expect(jobs.enqueueInTransaction).not.toHaveBeenCalled();
        expect(edit.allocateServiceRecordRevisionDocumentVersionInTransaction).not.toHaveBeenCalled();
        expect(snapshot.executeCase).not.toHaveBeenCalled();
        expect(caseDelegate.updateMany.mock.calls).toHaveLength(2); // stale recovery only; no FINALIZING claim
        expect(f.job).toEqual(retained);
        expect(f.state.status).toBe(progressStep === "preparing" ? "failed" : "manual_review");
    });
});

describe("U3b INITIAL state regeneration", () => {
    const gen1 = "00000000-0000-4000-8000-000000000061";
    const request = { revisionId, documentStateId: stateId, expectedGeneration: gen1 };
    function regenerationHarness() {
        const record = sourceWith({ status: "FINALIZATION_FAILED" });
        const states: Array<Record<string, unknown>> = [{ id: stateId, branchId, clientId, serviceRecordCaseId: caseId,
            revisionId, operation: "record_snapshot", generation: gen1, documentVersion: 3, status: "failed",
            lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED", step: "failed", version: 1,
            workflowScope: { generationKind: "INITIAL_FINALIZATION", requestKey: `service-record-initial-finalization:${revisionId}` } }];
        const oldInput = { old: true }, oldFingerprint = sha256CanonicalJson(oldInput);
        const jobs: Array<Record<string, unknown>> = [{ id: "old-job", branchId, clientId, documentId: "old-document",
            jobType: "create_document", source: "auto_finalize", status: "completed", leaseToken: null, activeKey: null,
            requestKey: `service-record-initial-finalization:${revisionId}`, payloadFingerprint: oldFingerprint,
            payload: { kind: "service_record_revision", generationKind: "INITIAL_FINALIZATION", generation: gen1, revisionId,
                context: { branchId, clientId, serviceRecordCaseId: caseId, revisionId, businessFingerprint: oldFingerprint },
                immutablePayload: oldInput, payloadFingerprint: oldFingerprint, completeness: "complete", manualReviewRequired: true,
                documentVersion: 3, snapshotReference: `service-record-initial-finalization:${revisionId}`, documentStateId: stateId } }];
        const documents = [{ documentId: "old-document", statusType: "049", purgePending: false, voided: false, tombstoneEvaluated: true }];
        const tx = {
            service_record_case: {
                findUnique: jest.fn(async () => ({ ...record, branch: { name: record.branchName } })),
                updateMany: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    Object.assign(record, { status: args.data["status"], nextAttemptAt: args.data["nextAttemptAt"] });
                    return { count: 1 };
                }),
            },
            service_record_revision: { findUnique: jest.fn(async () => ({ id: revisionId, revisionNumber: 1,
                payload: { plannedSessions: [{ sessionIndex: 1, originalDate: "2026-09-07" }] } })) },
            service_record_revision_document_state: { findFirst: jest.fn(async () => states.at(-1)) },
            eformsign_document_job: { findMany: jest.fn(async () => structuredClone(jobs)) },
            $queryRaw: jest.fn(async (sql: { text: string }) => {
                if (sql.text.includes('FROM "service_record_revision_document_state"')) return [states.at(-1)];
                if (sql.text.includes('FROM "service_record_snapshot_chunk"')) return [{ documentId: "old-document", chunkIndex: 1, chunkCount: 1 }];
                if (sql.text.includes('FROM "eformsign_doc"')) return documents;
                if (sql.text.includes('FROM "eformsign_document_job"')) return jobs;
                if (sql.text.includes('FROM "service_record_case"')) return [{ ...record }];
                if (sql.text.includes('FROM "client"')) return [{ id: clientId }];
                return [];
            }),
            $executeRaw: jest.fn(async () => {
                for (const job of jobs) if (job["status"] === "requires_attention" || job["status"] === "failed") {
                    Object.assign(job, { activeKey: null, status: "failed" });
                }
                return 1;
            }),
        };
        const edit = {
            findRevisionDocumentStateForBranch: jest.fn(async (branch: string, revision: string, id: string) =>
                branch === branchId && revision === revisionId ? structuredClone(states.find(state => state["id"] === id) ?? null) : null),
            createRevisionDocumentStateInTransaction: jest.fn(async (_: unknown, input: Record<string, unknown>) => {
                const state = { ...input, id: "new-state", version: 1 };
                states.push(state);
                return structuredClone(state);
            }),
            allocateServiceRecordRevisionDocumentVersionInTransaction: jest.fn(async () => {
                states.at(-1)!["documentVersion"] = 4;
                return 4;
            }),
        };
        let collide = false;
        const queue = {
            findByRequestKeyInTransaction: jest.fn(async (_: unknown, key: string) => jobs.find(job => job["requestKey"] === key)),
            enqueueInTransaction: jest.fn(async (_: unknown, input: Record<string, unknown>) => {
                if (collide) return { existing: true, job: jobs[0] };
                const job = { ...input, id: "new-job", status: "queued", leaseToken: null };
                jobs.push(job);
                return { existing: false, job };
            }),
        };
        const prisma = { $transaction: jest.fn(async (run: (db: typeof tx) => Promise<unknown>) => {
            const before = structuredClone({ states, jobs, record });
            try { return await run(tx); }
            catch (error) {
                states.splice(0, states.length, ...before.states);
                jobs.splice(0, jobs.length, ...before.jobs);
                Object.assign(record, before.record);
                throw error;
            }
        }) };
        const service = new ServiceRecordFinalizationService(prisma as never, {} as never, {} as never,
            createHolidayCalendarStub(), queue as never, edit as never);
        return { service, states, jobs, tx, record, documents, edit, queue, collision: () => { collide = true; } };
    }

    it("rebuilds gen2 from the current freeze source, allocates v4, and leaves the case failed", async () => {
        const f = regenerationHarness();
        f.record.days[0]!.notes = "fresh-notes";
        const result = await f.service.regenerateInitialFinalization(branchId, request);
        expect(result).toMatchObject({ state: { id: "new-state", documentVersion: 4,
            workflowScope: { regeneratedFromGeneration: gen1 } }, jobId: "new-job", status: "queued" });
        expect(result.state.generation).not.toBe(gen1);
        expect(f.jobs[1]).toMatchObject({ requestKey: `service-record-initial-finalization:${revisionId}:${result.state.generation}`,
            activeKey: `service-record-initial-finalization:${caseId}`, payload: { documentVersion: 4,
                immutablePayload: { sessions: [expect.objectContaining({ notes: "fresh-notes" })] } } });
        expect(f.record).toMatchObject({ status: "FINALIZATION_FAILED", nextAttemptAt: null });
        expect(f.edit.allocateServiceRecordRevisionDocumentVersionInTransaction).toHaveBeenCalledTimes(1);
    });
    it("admin INITIAL retry uses the same regeneration operation and returns the new generation", async () => {
        const f = regenerationHarness();
        const admin = new AdminServiceRecordService({} as never, {} as never, {} as never, createHolidayCalendarStub(),
            undefined, f.edit as never, undefined, f.service);
        const result = await admin.retryRevisionDocument(branchId, revisionId, stateId, gen1, "actor");
        expect(result).toMatchObject({ id: "new-state", operation: "record_snapshot", status: "capability_unverified", canRetry: false });
        expect(result.generation).not.toBe(gen1);
        expect(f.queue.enqueueInTransaction).toHaveBeenCalledTimes(1);
    });
    it("admin INITIAL retry returns the readiness conflict for a live sibling", async () => {
        const f = regenerationHarness(); f.documents[0]!.statusType = "070";
        const admin = new AdminServiceRecordService({} as never, {} as never, {} as never, createHolidayCalendarStub(),
            undefined, f.edit as never, undefined, f.service);
        await expect(admin.retryRevisionDocument(branchId, revisionId, stateId, gen1, "actor")).rejects.toMatchObject({ status: 409,
            response: { code: "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS" } });
    });
    it("a double replay returns the same state and job without allocating again", async () => {
        const f = regenerationHarness();
        const first = await f.service.regenerateInitialFinalization(branchId, request);
        expect(await f.service.regenerateInitialFinalization(branchId, request)).toMatchObject({ state: { generation: first.state.generation }, jobId: first.jobId });
        expect(await f.service.regenerateInitialFinalization(branchId, request)).toMatchObject({ state: { generation: first.state.generation }, jobId: first.jobId });
        expect(f.queue.enqueueInTransaction).toHaveBeenCalledTimes(1);
    });
    it("refuses an inaccessible branch before looking up readiness or writing", async () => {
        const f = regenerationHarness();
        await expect(f.service.regenerateInitialFinalization("other-branch", request)).rejects.toMatchObject({ status: 404,
            response: { code: "RESOURCE_NOT_FOUND" } });
        expect(f.tx.$queryRaw).not.toHaveBeenCalled();
        expect(f.queue.enqueueInTransaction).not.toHaveBeenCalled();
    });
    it("rejects a stale current revision", async () => {
        const f = regenerationHarness();
        f.record.currentRevisionId = "other-revision";
        await expect(f.service.regenerateInitialFinalization(branchId, request)).rejects.toMatchObject({ status: 409,
            response: { code: "SERVICE_RECORD_INITIAL_REVISION_CHANGED" } });
        expect(f.states).toHaveLength(1);
    });
    it("rejects non-newest state requests that are not a replay", async () => {
        const f = regenerationHarness();
        f.states.push({ ...f.states[0], id: "newest", generation: "other" });
        await expect(f.service.regenerateInitialFinalization(branchId, request)).rejects.toMatchObject({ status: 409,
            response: { code: "SERVICE_RECORD_INITIAL_GENERATION_CHANGED" } });
        expect(f.queue.enqueueInTransaction).not.toHaveBeenCalled();
    });
    it("returns the stable regeneration conflict for an internal state failure", async () => {
        const f = regenerationHarness();
        Object.assign(f.states[0]!, { status: "manual_review", lastErrorCode: "JOB_CANCELLED_AFTER_DISPATCH" });
        await expect(f.service.regenerateInitialFinalization(branchId, request)).rejects.toMatchObject({
            status: 409, response: { code: "SERVICE_RECORD_INITIAL_STATE_NOT_READY" },
        });
        expect(f.queue.enqueueInTransaction).not.toHaveBeenCalled();
    });
    it.each([["070", "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS"], ["003", "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED"]])(
        "rejects sibling status %s with its readiness code", async (statusType, code) => {
            const f = regenerationHarness(); f.documents[0]!.statusType = statusType!;
            await expect(f.service.regenerateInitialFinalization(branchId, request)).rejects.toMatchObject({ status: 409, response: { code } });
            expect(f.states).toHaveLength(1);
        });
    it("rolls back new state, allocation, and lazy key release on an existing enqueue result", async () => {
        const f = regenerationHarness();
        Object.assign(f.jobs[0]!, { status: "requires_attention", activeKey: `service-record-initial-finalization:${caseId}` });
        const before = structuredClone({ states: f.states, jobs: f.jobs, record: f.record });
        f.collision();
        await expect(f.service.regenerateInitialFinalization(branchId, request)).rejects.toMatchObject({ status: 409,
            response: { code: "SERVICE_RECORD_INITIAL_ACTIVE_KEY_CONFLICT" } });
        expect({ states: f.states, jobs: f.jobs, record: f.record }).toEqual(before);
    });
    it("maps a global key conflict to 409 and rolls back lazy release", async () => {
        const f = regenerationHarness();
        Object.assign(f.jobs[0]!, { status: "requires_attention", activeKey: `service-record-initial-finalization:${caseId}` });
        const before = structuredClone({ states: f.states, jobs: f.jobs });
        f.queue.enqueueInTransaction.mockRejectedValueOnce(new Error("EFORMSIGN_DOCUMENT_JOB_KEY_CONFLICT"));
        await expect(f.service.regenerateInitialFinalization(branchId, request)).rejects.toMatchObject({ status: 409,
            response: { code: "SERVICE_RECORD_INITIAL_ACTIVE_KEY_CONFLICT" } });
        expect({ states: f.states, jobs: f.jobs }).toEqual(before);
    });
    it("scheduler after regeneration checks each generation against its own key and creates no job", async () => {
        const f = regenerationHarness();
        await f.service.regenerateInitialFinalization(branchId, request);
        const finalizer = f.service as unknown as { freezeInitialFinalizationGeneration: (tx: unknown, record: unknown, calendar: KrBusinessDayCalendar) => Promise<void> };
        await expect(finalizer.freezeInitialFinalizationGeneration(f.tx, f.record, KR_BUILTIN_CALENDAR)).resolves.toBeUndefined();
        expect(f.jobs).toHaveLength(2);
        expect(f.queue.enqueueInTransaction).toHaveBeenCalledTimes(1);
    });
});
