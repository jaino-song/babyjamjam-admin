import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { MESSAGE_AUTOMATION_PARENT_DISABLED_REASON } from "application/services/message-automation-activation.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import {
    SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-record-link-message";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { KOREAN_HOLIDAY_CALENDAR, createKrBusinessDayCalendar } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

describe("AdminServiceRecordService", () => {
    const createPrisma = () => ({
        client: {
            findFirst: jest.fn(),
        },
        service_record_case: {
            findFirst: jest.fn().mockResolvedValue(null),
        },
        employee_schedule: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
        },
        message_trigger_job: {
            findMany: jest.fn(),
        },
        message_log: {
            findMany: jest.fn(),
        },
        eformsign_doc: {
            findMany: jest.fn().mockResolvedValue([]),
        },
    });

    const createLinkService = () => ({
        prepareLink: jest.fn().mockResolvedValue({
            serviceRecordUrl: "https://mobile.test/service-record/efl_prepared",
            preparedLinkToken: "efl_prepared",
            expiresAt: new Date("2026-07-13T01:00:00.000Z"),
        }),
        sendNow: jest.fn().mockResolvedValue({
            scheduledFor: new Date("2026-07-03T01:00:00.000Z"),
            jobId: "job-manual",
        }),
        resetLink: jest.fn().mockResolvedValue({
            serviceRecordUrl: "https://mobile.test/service-record/efl_reset",
            expiresAt: new Date("2026-07-13T01:00:00.000Z"),
        }),
    });
    const createTriggerService = () => ({
        dispatchPendingJobNow: jest.fn().mockResolvedValue({
            id: "job-manual",
            status: "sent",
        }),
    });

    const createSchedule = (id: number, startDate: string) => ({
        id,
        branchId: "branch-1",
        clientId: 100,
        startDate: new Date(startDate),
        endDate: new Date("2026-07-12T00:00:00.000Z"),
        replaced: false,
        primaryEmployee: {
            id: 30 + id,
            name: `제공${id}`,
            phone: `010-0000-000${id}`,
        },
        client: {
            id: 100,
            name: "김산모",
            duration: 5,
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: new Date("2026-07-07T00:00:00.000Z"),
        },
        serviceRecord: null,
        serviceRecordDays: [],
        serviceRecordTokens: [],
    });

    // A stored N is shown as is (the lifecycle ensure path caps it when the
    // period itself changes); only a case with no stored N derives it from the period.
    it.each([
        ["2026-09-03", "2026-09-08", 15, 15],
        ["2026-08-10", "2026-09-03", 15, 15],
        ["2026-09-03", "2026-09-09", 4, 4],
        ["2026-09-03", "2026-09-08", null, 4],
    ])("shows the stored count over the service period %s to %s (stored %s)", async (start, end, stored, expected) => {
        const prisma = createPrisma();
        prisma.service_record_case.findFirst.mockResolvedValue({
            id: "case-1",
            status: "IN_PROGRESS",
            startDate: new Date(start),
            endDate: new Date(end),
            requiredSessionCount: stored,
            completedAt: null,
            finalizationDueAt: new Date("2026-08-10T11:00:00.000Z"),
            finalizedAt: null,
            documentsCompletedAt: null,
            lastError: null,
            momName: null,
            momBirth: null,
            babyName: null,
            babyBirth: null,
            deliveryType: null,
            babyWeight: null,
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            updatedAt: new Date("2026-08-03T00:00:00.000Z"),
            days: [],
        } as never);
        prisma.employee_schedule.findMany.mockResolvedValue([]);

        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService, createHolidayCalendarStub(),
        );

        const overview = await service.getClientOverview("branch-1", 100);

        expect(overview.record?.totalSessions).toBe(expected);
    });

    it("uses four actual days for assignments while preserving the 15-day voucher", async () => {
        const prisma = createPrisma();
        const schedule = createSchedule(1, "2026-09-03");
        schedule.endDate = new Date("2026-09-08");
        Object.assign(schedule.client, {
            startDate: schedule.startDate, endDate: schedule.endDate, duration: 15,
        });
        prisma.employee_schedule.findMany.mockResolvedValue([schedule]);
        prisma.message_trigger_job.findMany.mockResolvedValue([]);
        prisma.message_log.findMany.mockResolvedValue([]);
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService, createHolidayCalendarStub(),
        );
        const overview = await service.getClientOverview("branch-1", 100);
        expect(overview.assignments[0]?.totalSessions).toBe(4);
        expect(schedule.client.duration).toBe(15);
    });

    it("counts overview totals against the branch calendar", async () => {
        const prisma = createPrisma();
        const schedule = createSchedule(1, "2026-09-03");
        schedule.endDate = new Date("2026-09-08");
        Object.assign(schedule.client, {
            startDate: schedule.startDate, endDate: schedule.endDate, duration: 15,
        });
        prisma.employee_schedule.findMany.mockResolvedValue([schedule]);
        prisma.message_trigger_job.findMany.mockResolvedValue([]);
        prisma.message_log.findMany.mockResolvedValue([]);
        prisma.service_record_case.findFirst.mockResolvedValue({
            id: "case-1",
            status: "IN_PROGRESS",
            startDate: new Date("2026-09-03"),
            endDate: new Date("2026-09-08"),
            requiredSessionCount: null,
            completedAt: null,
            finalizationDueAt: null,
            finalizedAt: null,
            documentsCompletedAt: null,
            lastError: null,
            momName: null,
            momBirth: null,
            babyName: null,
            babyBirth: null,
            deliveryType: null,
            babyWeight: null,
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            updatedAt: new Date("2026-08-03T00:00:00.000Z"),
            days: [],
        } as never);
        // The branch also closes Monday 2026-09-07.
        const branchCalendar = createKrBusinessDayCalendar(
            [...KOREAN_HOLIDAY_CALENDAR[2026]!, "2026-09-07"],
            { version: "kr-db-branch-a", supportedYears: [2026] },
        );
        const holidayCalendar = createHolidayCalendarStub();
        (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(branchCalendar);
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService, holidayCalendar,
        );

        const overview = await service.getClientOverview("branch-1", 100);

        expect(holidayCalendar.forBranch).toHaveBeenCalledWith("branch-1");
        expect(overview.record?.totalSessions).toBe(3);
        expect(overview.assignments[0]?.totalSessions).toBe(3);
    });

    it("asserts branch-owned client access before reading the editor overview", async () => {
        const prisma = createPrisma();
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService, createHolidayCalendarStub(),
        );
        prisma.client.findFirst.mockResolvedValue({ id: 100 });
        prisma.service_record_case.findFirst.mockResolvedValue(null);
        prisma.employee_schedule.findMany.mockResolvedValue([]);

        await expect(service.getClientEditor("branch-1", 100)).resolves.toEqual({
            record: null,
            assignments: [],
            scheduleProjection: {
                entries: [],
                blockingReasons: [{
                    code: "EDITOR_PROJECTION_UNAVAILABLE",
                    message: "서비스 예정 회차 근거를 확인할 수 없습니다.",
                }],
            },
        });

        expect(prisma.client.findFirst).toHaveBeenCalledWith({
            where: { id: 100, branchId: "branch-1" },
            select: { id: true },
        });
        expect(prisma.service_record_case.findFirst).toHaveBeenCalled();
        expect(prisma.employee_schedule.findMany).toHaveBeenCalled();
    });

    it("adds the canonical all-session projection to the regular overview for unwritten slots", async () => {
        const prisma = createPrisma();
        const assignmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const source = {
            caseId: "case-1",
            caseVersion: 7,
            formVersion: 3,
            requiredSessionCount: 3,
            startDate: "2026-09-01",
            endDate: "2026-09-03",
            header: {
                momName: null,
                momBirth: null,
                babyName: null,
                babyBirth: null,
                deliveryType: null,
                babyWeight: null,
            },
            sessions: [],
            assignments: [{
                id: assignmentId,
                branchId: "branch-1",
                serviceRecordCaseId: "case-1",
                scheduleId: 55,
                employeeId: 9,
                startDate: "2026-09-01",
                endDate: "2026-09-03",
                replaced: false,
                employeeName: "제공자",
                scheduleStartDate: "2026-09-01",
                scheduleEndDate: "2026-09-03",
                scheduleTerminatedAt: null,
                primaryEmployeeId: 9,
                secondaryEmployeeId: null,
                primaryEmployeeName: "제공자",
            }],
            plannedSessions: ["2026-09-01", "2026-09-02", "2026-09-03"].map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId,
                scheduleId: 55,
                employeeId: 9,
                provenanceVersion: "case-7",
            })),
            client: {
                id: 100,
                branchId: "branch-1",
                name: "김산모",
                duration: 15,
                startDate: "2026-09-01",
                endDate: "2026-09-03",
                serviceStatus: "in_progress",
            },
        };
        prisma.client.findFirst.mockResolvedValue({ id: 100 });
        prisma.service_record_case.findFirst.mockResolvedValue(null);
        prisma.employee_schedule.findMany.mockResolvedValue([]);
        const editRepository = { loadSource: jest.fn().mockResolvedValue(source) };
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService,
            createHolidayCalendarStub(), undefined,
            editRepository as never,
        );

        const overview = await service.getClientOverview("branch-1", 100);

        expect(overview.scheduleProjection?.blockingReasons).toEqual([]);
        expect(overview.scheduleProjection?.entries.map((entry) => entry.serviceDate)).toEqual([
            "2026-09-01", "2026-09-02", "2026-09-03",
        ]);
        expect(overview.scheduleProjection?.entries[2]).toEqual(expect.objectContaining({
            sessionIndex: 3,
            originalDate: "2026-09-03",
            assignmentId,
            scheduleId: 55,
            employeeId: 9,
        }));
        expect(editRepository.loadSource).toHaveBeenCalledWith("branch-1", { clientId: 100 });
    });

    it("keeps unsupported-year legacy cases viewable while blocking the canonical projection", async () => {
        const prisma = createPrisma();
        prisma.client.findFirst.mockResolvedValue({ id: 100 });
        prisma.service_record_case.findFirst.mockResolvedValue({
            id: "case-unsupported",
            status: "IN_PROGRESS",
            startDate: new Date("2028-01-03T00:00:00.000Z"),
            endDate: new Date("2028-01-05T00:00:00.000Z"),
            requiredSessionCount: null,
            completedAt: null,
            finalizationDueAt: null,
            finalizedAt: null,
            documentsCompletedAt: null,
            lastError: null,
            momName: "산모",
            momBirth: null,
            babyName: null,
            babyBirth: null,
            deliveryType: null,
            babyWeight: null,
            createdAt: new Date("2028-01-03T00:00:00.000Z"),
            updatedAt: new Date("2028-01-03T00:00:00.000Z"),
            days: [{
                sessionIndex: 1,
                caseSessionIndex: 1,
                serviceDate: new Date("2028-01-03T00:00:00.000Z"),
                locked: false,
                submittedAt: null,
                updatedAt: new Date("2028-01-03T00:00:00.000Z"),
                answers: {},
                etcService: null,
                notes: null,
                paymentConfirmed: false,
                momApproval: null,
                clientSignature: null,
                clientSignedAt: null,
                employeeId: null,
                employeeNameSnapshot: null,
                formVersion: 1,
            }],
        } as never);
        prisma.employee_schedule.findMany.mockResolvedValue([]);
        const editRepository = {
            loadSource: jest.fn().mockResolvedValue({
                caseId: "case-unsupported",
                caseVersion: 1,
                formVersion: 1,
                requiredSessionCount: null,
                startDate: "2028-01-03",
                endDate: "2028-01-05",
                header: {
                    momName: "산모",
                    momBirth: null,
                    babyName: null,
                    babyBirth: null,
                    deliveryType: null,
                    babyWeight: null,
                },
                sessions: [],
                assignments: [],
                plannedSessions: null,
                client: {
                    id: 100,
                    branchId: "branch-1",
                    name: "김산모",
                    duration: null,
                    startDate: "2028-01-03",
                    endDate: "2028-01-05",
                    serviceStatus: "in_progress",
                },
            }),
        };
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService,
            createHolidayCalendarStub(), undefined,
            editRepository as never,
        );

        const overview = await service.getClientEditor("branch-1", 100);

        expect(overview.record?.totalSessions).toBe(0);
        expect(overview.record?.sessions).toHaveLength(1);
        expect(overview.scheduleProjection?.entries).toEqual([]);
        expect(overview.scheduleProjection?.blockingReasons).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "INVALID_SESSION_COUNT" }),
        ]));
    });

    it("returns not found for a foreign or missing client without reading records or invoking mutations", async () => {
        const prisma = createPrisma();
        const linkService = createLinkService();
        const triggerService = createTriggerService();
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            linkService as unknown as ServiceRecordLinkService,
            triggerService as unknown as MessageTriggerService, createHolidayCalendarStub(),
        );
        prisma.client.findFirst.mockResolvedValue(null);

        const rejection = service.getClientEditor("branch-1", 404);
        await expect(rejection).rejects.toBeInstanceOf(NotFoundException);
        await expect(rejection).rejects.toMatchObject({
            status: 404,
            response: expect.objectContaining({
                code: "RESOURCE_NOT_FOUND",
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            }),
        });

        expect(prisma.client.findFirst).toHaveBeenCalledWith({
            where: { id: 404, branchId: "branch-1" },
            select: { id: true },
        });
        expect(prisma.service_record_case.findFirst).not.toHaveBeenCalled();
        expect(prisma.employee_schedule.findMany).not.toHaveBeenCalled();
        expect(linkService.prepareLink).not.toHaveBeenCalled();
        expect(linkService.sendNow).not.toHaveBeenCalled();
        expect(triggerService.dispatchPendingJobNow).not.toHaveBeenCalled();
    });

    it("only includes stored signature material on the owner/admin editor projection", async () => {
        const prisma = createPrisma();
        const session = {
            sessionIndex: 1,
            caseSessionIndex: 1,
            serviceDate: new Date("2026-07-01T00:00:00.000Z"),
            locked: true,
            submittedAt: new Date("2026-07-01T01:00:00.000Z"),
            updatedAt: new Date("2026-07-01T01:00:00.000Z"),
            answers: {},
            etcService: null,
            notes: null,
            paymentConfirmed: true,
            momApproval: "approved",
            clientSignature: "data:image/png;base64,stored",
            clientSignedAt: new Date("2026-07-01T01:00:00.000Z"),
            employeeId: null,
            employeeNameSnapshot: null,
            formVersion: 1,
        };
        prisma.service_record_case.findFirst.mockResolvedValue({
            id: "case-1",
            status: "COMPLETED",
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: new Date("2026-07-01T00:00:00.000Z"),
            requiredSessionCount: 1,
            completedAt: null,
            finalizationDueAt: null,
            finalizedAt: new Date("2026-07-02T00:00:00.000Z"),
            documentsCompletedAt: null,
            lastError: null,
            momName: null,
            momBirth: null,
            babyName: null,
            babyBirth: null,
            deliveryType: null,
            babyWeight: null,
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
            updatedAt: new Date("2026-07-01T00:00:00.000Z"),
            days: [session],
        } as never);
        prisma.employee_schedule.findMany.mockResolvedValue([]);
        prisma.client.findFirst.mockResolvedValue({ id: 100 });

        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService, createHolidayCalendarStub(),
        );

        const overview = await service.getClientOverview("branch-1", 100);
        expect(overview.record?.sessions[0]).not.toHaveProperty("clientSignature");
        expect(overview.record?.sessions[0]).not.toHaveProperty("clientSignedAt");

        const editor = await service.getClientEditor("branch-1", 100);
        expect(editor.record?.sessions[0]).toEqual(expect.objectContaining({
            clientSignature: "data:image/png;base64,stored",
            clientSignedAt: session.clientSignedAt,
        }));
    });

    it("derives link status for none, scheduled, sent, and failed assignments", async () => {
        const prisma = createPrisma();
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService, createHolidayCalendarStub(),
        );
        prisma.employee_schedule.findMany.mockResolvedValue([
            createSchedule(1, "2026-07-04T00:00:00.000Z"),
            createSchedule(2, "2026-07-03T00:00:00.000Z"),
            createSchedule(3, "2026-07-02T00:00:00.000Z"),
            createSchedule(4, "2026-07-01T00:00:00.000Z"),
        ]);
        prisma.message_trigger_job.findMany.mockResolvedValue([
            {
                id: "job-4",
                branchId: "branch-1",
                employeeScheduleId: 4,
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                status: "sent",
                scheduledFor: new Date("2026-07-01T06:00:00.000Z"),
                createdAt: new Date("2026-06-30T00:00:00.000Z"),
            },
            {
                id: "job-3",
                branchId: "branch-1",
                employeeScheduleId: 3,
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                status: "sent",
                scheduledFor: new Date("2026-07-02T06:00:00.000Z"),
                createdAt: new Date("2026-07-01T00:00:00.000Z"),
            },
            {
                id: "job-2",
                branchId: "branch-1",
                employeeScheduleId: 2,
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                status: "pending",
                scheduledFor: new Date("2026-07-03T06:00:00.000Z"),
                createdAt: new Date("2026-07-02T00:00:00.000Z"),
            },
        ]);
        prisma.message_log.findMany.mockResolvedValue([
            {
                id: 400,
                branchId: "branch-1",
                templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
                triggerJobId: "job-4",
                clientId: 100,
                status: "failed",
                lastAttemptAt: new Date("2026-07-01T06:05:00.000Z"),
                createdAt: new Date("2026-07-01T06:00:00.000Z"),
            },
            {
                id: 300,
                branchId: "branch-1",
                templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
                triggerJobId: "job-3",
                clientId: 100,
                status: "sent",
                lastAttemptAt: new Date("2026-07-02T06:05:00.000Z"),
                createdAt: new Date("2026-07-02T06:00:00.000Z"),
            },
        ]);
        prisma.eformsign_doc.findMany.mockResolvedValue([
            {
                employeeScheduleId: 3,
                documentId: "service-record-doc-3",
                statusType: "050",
                statusDetail: "완료",
                stepName: "제공기록지 서명",
                createdDate: new Date("2026-07-02T07:00:00.000Z"),
                updatedDate: new Date("2026-07-02T07:10:00.000Z"),
                snapshotVersion: null,
                snapshotChunkIndex: null,
            },
            {
                employeeScheduleId: 3,
                documentId: "service-record-doc-3-old",
                statusType: "060",
                statusDetail: "대기",
                stepName: "제공기록지 서명",
                createdDate: new Date("2026-07-01T07:00:00.000Z"),
                updatedDate: new Date("2026-07-01T07:10:00.000Z"),
                snapshotVersion: null,
                snapshotChunkIndex: null,
            },
        ]);

        const overview = await service.getClientOverview("branch-1", 100);
        expect(prisma.employee_schedule.findMany).toHaveBeenCalledWith(expect.objectContaining({
            include: expect.objectContaining({
                serviceRecordTokens: {
                    where: {
                        OR: [
                            { active: true },
                            { revokedAt: { not: null } },
                        ],
                    },
                    orderBy: { createdAt: "desc" },
                },
            }),
        }));
        const statuses = new Map(overview.assignments.map((assignment) => [
            assignment.scheduleId,
            assignment.link.status,
        ]));

        expect(statuses.get(1)).toBe("none");
        expect(statuses.get(2)).toBe("scheduled");
        expect(statuses.get(3)).toBe("sent");
        expect(statuses.get(4)).toBe("failed");
        expect(overview.assignments.find((assignment) => assignment.scheduleId === 2)?.link.scheduledFor).toEqual(
            new Date("2026-07-03T06:00:00.000Z"),
        );
        expect(overview.assignments.find((assignment) => assignment.scheduleId === 3)?.link.lastSentAt).toEqual(
            new Date("2026-07-02T06:05:00.000Z"),
        );
        expect(prisma.eformsign_doc.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                branchId: "branch-1",
                documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
                OR: [{ employeeScheduleId: { in: [1, 2, 3, 4] } }],
            }),
        }));
        expect(overview.assignments.find((assignment) => assignment.scheduleId === 1)?.signatureDoc).toBeNull();
        expect(overview.assignments.find((assignment) => assignment.scheduleId === 3)?.signatureDoc).toEqual({
            documentId: "service-record-doc-3",
            statusType: "050",
            statusDetail: "완료",
            stepName: "제공기록지 서명",
            createdDate: new Date("2026-07-02T07:00:00.000Z"),
            updatedDate: new Date("2026-07-02T07:10:00.000Z"),
            snapshotVersion: null,
            snapshotChunkIndex: null,
            employeeScheduleId: 3,
        });
    });

    describe("link status follows the newest attempt", () => {
        const at = (iso: string) => new Date(`2026-07-0${iso}:00.000Z`);
        const job = (id: string, status: string, updatedAt: Date, extra: Record<string, unknown> = {}) => ({
            id,
            branchId: "branch-1",
            employeeScheduleId: 1,
            ruleId: SERVICE_RECORD_LINK_RULE_ID,
            status,
            scheduledFor: updatedAt,
            createdAt: updatedAt,
            updatedAt,
            ...extra,
        });
        const log = (id: number, triggerJobId: string, status: string, when: Date) => ({
            id,
            branchId: "branch-1",
            templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
            triggerJobId,
            clientId: 100,
            status,
            lastAttemptAt: when,
            createdAt: when,
        });
        const linkFor = async (jobs: unknown[], logs: unknown[]) => {
            const prisma = createPrisma();
            const service = new AdminServiceRecordService(
                prisma as unknown as PrismaService,
                createLinkService() as unknown as ServiceRecordLinkService,
                createTriggerService() as unknown as MessageTriggerService, createHolidayCalendarStub(),
            );
            prisma.employee_schedule.findMany.mockResolvedValue([createSchedule(1, "2026-07-04T00:00:00.000Z")]);
            // Deliberately not sorted newest-first: derivation must not depend on query order.
            prisma.message_trigger_job.findMany.mockResolvedValue(jobs);
            prisma.message_log.findMany.mockResolvedValue(logs);
            const overview = await service.getClientOverview("branch-1", 100);
            return overview.assignments[0]!.link;
        };

        it("shows failed when a newer resend failed after an older success", async () => {
            const link = await linkFor(
                [job("job-old", "sent", at("1T06:00")), job("job-new", "failed", at("3T06:00"))],
                [log(1, "job-old", "sent", at("1T06:00")), log(2, "job-new", "failed", at("3T06:00"))],
            );
            expect(link.status).toBe("failed");
            expect(link.sentCount).toBe(1);
            expect(link.lastSentAt).toEqual(at("1T06:00"));
        });

        it("shows failed for a job that failed during preparation and wrote no log", async () => {
            const link = await linkFor([job("job-1", "failed", at("3T06:00"))], []);
            expect(link.status).toBe("failed");
        });

        it("shows failed for a preparation failure that is newer than an old success", async () => {
            const link = await linkFor(
                [job("job-old", "sent", at("1T06:00")), job("job-new", "failed", at("3T06:00"))],
                [log(1, "job-old", "sent", at("1T06:00"))],
            );
            expect(link.status).toBe("failed");
            expect(link.sentCount).toBe(1);
        });

        it.each(["processing", "dispatching"])("shows sending while the newest job is %s", async (status) => {
            const link = await linkFor(
                [job("job-old", "sent", at("1T06:00")), job("job-new", status, at("3T06:00"))],
                [log(1, "job-old", "sent", at("1T06:00"))],
            );
            expect(link.status).toBe("sending");
            expect(link.scheduledFor).toBeNull();
            expect(link.sentCount).toBe(1);
        });

        it("keeps a retried job scheduled even though its earlier attempt logged a failure", async () => {
            const link = await linkFor(
                [
                    job("job-old", "sent", at("1T06:00")),
                    job("job-retry", "pending", at("3T07:00"), { scheduledFor: at("9T06:00"), createdAt: at("2T06:00") }),
                ],
                [log(1, "job-old", "sent", at("1T06:00")), log(2, "job-retry", "failed", at("3T06:00"))],
            );
            expect(link.status).toBe("scheduled");
            expect(link.scheduledFor).toEqual(at("9T06:00"));
        });

        it("keeps a retried job sending even though its earlier attempt logged a failure", async () => {
            const link = await linkFor(
                [job("job-retry", "dispatching", at("3T07:00"))],
                [log(2, "job-retry", "failed", at("3T06:00"))],
            );
            expect(link.status).toBe("sending");
        });

        it.each([
            ["pending", "scheduled"],
            ["processing", "sending"],
            ["dispatching", "sending"],
        ])(
            "keeps an in-flight %s job as %s even when its own failure log is newer than the job row",
            async (jobStatus, expected) => {
                const link = await linkFor(
                    [job("job-retry", jobStatus, at("3T06:00"), { scheduledFor: at("9T06:00") })],
                    [log(2, "job-retry", "failed", at("3T07:00"))],
                );
                expect(link.status).toBe(expected);
                expect(link.scheduledFor).toEqual(expected === "scheduled" ? at("9T06:00") : null);
            },
        );

        it("orders an unrelated newer failure log chronologically against an in-flight job", async () => {
            const link = await linkFor(
                [job("job-other", "failed", at("2T06:00")), job("job-inflight", "processing", at("3T06:00"))],
                [log(2, "job-other", "failed", at("3T07:00"))],
            );
            expect(link.status).toBe("failed");
        });

        it("orders an unrelated older failure log chronologically against an in-flight job", async () => {
            const link = await linkFor(
                [job("job-other", "failed", at("2T06:00")), job("job-inflight", "processing", at("3T06:00"))],
                [log(2, "job-other", "failed", at("3T05:00"))],
            );
            expect(link.status).toBe("sending");
        });

        it("shows sent when the newest attempt succeeded after an older failure", async () => {
            const link = await linkFor(
                [job("job-old", "failed", at("1T06:00")), job("job-new", "sent", at("3T06:00"))],
                [log(1, "job-old", "failed", at("1T06:00")), log(2, "job-new", "sent", at("3T06:00"))],
            );
            expect(link.status).toBe("sent");
            expect(link.lastSentAt).toEqual(at("3T06:00"));
        });

        it("shows canceled when nothing was ever sent", async () => {
            expect((await linkFor([job("job-1", "canceled", at("3T06:00"))], [])).status).toBe("canceled");
        });

        it("shows canceled when a newer resend was canceled after an older success", async () => {
            const link = await linkFor(
                [
                    job("job-old", "sent", at("1T06:00")),
                    job("job-new", "canceled", at("3T06:00"), { canceledByUser: true }),
                ],
                [log(1, "job-old", "sent", at("1T06:00"))],
            );
            expect(link.status).toBe("canceled");
            expect(link.sentCount).toBe(1);
            expect(link.lastSentAt).toEqual(at("1T06:00"));
        });

        describe("canceled scheduling lease (automation deactivation cleanup)", () => {
            const leaseReason = SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON;
            // Jul 1 lease created (createdAt) -> Jul 4 deactivation cancels it (updatedAt bumped).
            const canceledLease = (extra: Record<string, unknown> = {}) => job(
                "job-lease",
                "canceled",
                at("4T06:00"),
                { createdAt: at("1T06:00"), cancelReason: leaseReason, canceledByUser: false, ...extra },
            );

            it("shows sent when deactivation canceled a never-sent lease after a newer manual success", async () => {
                const link = await linkFor(
                    [canceledLease(), job("job-manual", "sent", at("3T06:00"))],
                    [log(1, "job-manual", "sent", at("3T06:00"))],
                );
                expect(link.status).toBe("sent");
                expect(link.sentCount).toBe(1);
                expect(link.lastSentAt).toEqual(at("3T06:00"));
            });

            it("still shows canceled for a lease cancel with no success after the lease", async () => {
                expect((await linkFor([canceledLease()], [])).status).toBe("canceled");
                const olderSuccess = await linkFor(
                    [job("job-old", "sent", new Date("2026-06-20T06:00:00.000Z")), canceledLease()],
                    [log(1, "job-old", "sent", new Date("2026-06-20T06:00:00.000Z"))],
                );
                expect(olderSuccess.status).toBe("canceled");
            });

            it("does not hide a genuine resend cancellation that shares no lease marker", async () => {
                const link = await linkFor(
                    [
                        job("job-manual", "sent", at("3T06:00")),
                        canceledLease({ cancelReason: MESSAGE_AUTOMATION_PARENT_DISABLED_REASON }),
                    ],
                    [log(1, "job-manual", "sent", at("3T06:00"))],
                );
                expect(link.status).toBe("canceled");
            });
        });

        it("shows sent when a canceled job is older than a later success", async () => {
            const link = await linkFor(
                [job("job-old", "canceled", at("1T06:00")), job("job-new", "sent", at("3T06:00"))],
                [log(1, "job-new", "sent", at("3T06:00"))],
            );
            expect(link.status).toBe("sent");
        });

        it("shows none when there is no job and no log", async () => {
            expect((await linkFor([], [])).status).toBe("none");
        });
    });

    it("attributes phone-missing failure logs only to their own assignment", async () => {
        const prisma = createPrisma();
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService, createHolidayCalendarStub(),
        );
        prisma.employee_schedule.findMany.mockResolvedValue([
            createSchedule(1, "2026-07-04T00:00:00.000Z"),
            createSchedule(2, "2026-07-03T00:00:00.000Z"),
        ]);
        prisma.message_trigger_job.findMany.mockResolvedValue([]);
        prisma.message_log.findMany.mockResolvedValue([
            {
                id: 500,
                branchId: "branch-1",
                templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
                triggerJobId: null,
                clientId: 100,
                status: "failed",
                variables: { scheduleId: "1" },
                lastAttemptAt: null,
                createdAt: new Date("2026-07-01T06:00:00.000Z"),
            },
        ]);

        const overview = await service.getClientOverview("branch-1", 100);
        const statuses = new Map(overview.assignments.map((assignment) => [
            assignment.scheduleId,
            assignment.link.status,
        ]));

        expect(statuses.get(1)).toBe("failed");
        expect(statuses.get(2)).toBe("none");
    });

    it("keeps overview available when service-record signature doc columns are not migrated yet", async () => {
        const prisma = createPrisma();
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService, createHolidayCalendarStub(),
        );
        prisma.employee_schedule.findMany.mockResolvedValue([
            createSchedule(1, "2026-07-04T00:00:00.000Z"),
        ]);
        prisma.message_trigger_job.findMany.mockResolvedValue([]);
        prisma.message_log.findMany.mockResolvedValue([]);
        prisma.eformsign_doc.findMany.mockRejectedValue(
            Object.assign(new Error("[PrismaException] Code: P2022, Field: N/A"), { code: "P2022" }),
        );

        const overview = await service.getClientOverview("branch-1", 100);

        expect(overview.assignments).toHaveLength(1);
        expect(overview.assignments[0]?.signatureDoc).toBeNull();
    });

    it("throws NotFoundException and does not send when schedule belongs to another branch", async () => {
        const prisma = createPrisma();
        const linkService = createLinkService();
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            linkService as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService, createHolidayCalendarStub(),
        );
        prisma.employee_schedule.findFirst.mockResolvedValue(null);

        const rejection = service.sendLinkNow("branch-1", 10);
        await expect(rejection).rejects.toBeInstanceOf(NotFoundException);
        await expect(rejection).rejects.toMatchObject({
            status: 404,
            response: expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }),
        });

        expect(linkService.sendNow).not.toHaveBeenCalled();
    });

    it("prepares a link only after checking that the schedule belongs to the tenant branch", async () => {
        const prisma = createPrisma();
        const linkService = createLinkService();
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            linkService as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService, createHolidayCalendarStub(),
        );
        prisma.employee_schedule.findFirst.mockResolvedValue({ id: 10 });

        const result = await service.prepareLink("branch-1", 10, "01066211878");

        expect(prisma.employee_schedule.findFirst).toHaveBeenCalledWith({
            where: { id: 10, branchId: "branch-1" },
            select: { id: true },
        });
        expect(linkService.prepareLink).toHaveBeenCalledWith(10, "01066211878");
        expect(result.preparedLinkToken).toBe("efl_prepared");
    });

    it("passes the prepared token through the tenant-checked send path", async () => {
        const prisma = createPrisma();
        const linkService = createLinkService();
        const triggerService = createTriggerService();
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            linkService as unknown as ServiceRecordLinkService,
            triggerService as unknown as MessageTriggerService, createHolidayCalendarStub(),
        );
        prisma.employee_schedule.findFirst.mockResolvedValue({ id: 10 });

        await expect(
            service.sendLinkNow("branch-1", 10, "efl_prepared", "01066211878"),
        ).resolves.toEqual({
            ok: true,
            jobId: "job-manual",
            status: "sent",
            scheduledFor: new Date("2026-07-03T01:00:00.000Z"),
        });

        expect(linkService.sendNow).toHaveBeenCalledWith(10, "efl_prepared", "01066211878");
        expect(triggerService.dispatchPendingJobNow).toHaveBeenCalledWith("job-manual", {
            expectedBranchId: "branch-1",
        });
    });

    it("resets a link after tenant validation without dispatching a message", async () => {
        const prisma = createPrisma();
        const linkService = createLinkService();
        const triggerService = createTriggerService();
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            linkService as unknown as ServiceRecordLinkService,
            triggerService as unknown as MessageTriggerService, createHolidayCalendarStub(),
        );
        prisma.employee_schedule.findFirst.mockResolvedValue({ id: 10 });

        await expect(service.resetLink("branch-1", 10)).resolves.toEqual({
            serviceRecordUrl: "https://mobile.test/service-record/efl_reset",
            expiresAt: new Date("2026-07-13T01:00:00.000Z"),
        });

        expect(linkService.resetLink).toHaveBeenCalledWith(10);
        expect(linkService.sendNow).not.toHaveBeenCalled();
        expect(triggerService.dispatchPendingJobNow).not.toHaveBeenCalled();
    });

    it("requires an authenticated admin actor for reissue and emits a redacted security event", async () => {
        const prisma = createPrisma();
        const linkService = createLinkService();
        const securityEventService = { emit: jest.fn() };
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            linkService as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService,
            createHolidayCalendarStub(), securityEventService as never,
        );
        prisma.employee_schedule.findFirst.mockResolvedValue({ id: 10 });

        const rejection = service.resetLink("branch-1", 10);
        await expect(rejection).rejects.toBeInstanceOf(ForbiddenException);
        await expect(rejection).rejects.toMatchObject({
            status: 403,
            response: expect.objectContaining({
                code: "ACCESS_DENIED",
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            }),
        });
        expect(linkService.resetLink).not.toHaveBeenCalled();

        await expect(service.resetLink("branch-1", 10, {
            userId: "admin-1",
            globalRole: "admin",
            branchRole: "admin",
        })).resolves.toEqual({
            serviceRecordUrl: "https://mobile.test/service-record/efl_reset",
            expiresAt: new Date("2026-07-13T01:00:00.000Z"),
        });
        expect(securityEventService.emit).toHaveBeenCalledWith({
            outcome: "link_reissued",
            actorUserId: "admin-1",
            branchId: "branch-1",
            scheduleId: 10,
        });
    });

    describe("revision endpoints bind rejections to the registered problem contract", () => {
        const buildService = (
            prisma: ReturnType<typeof createPrisma>,
            editRepository?: Record<string, jest.Mock>,
        ) => new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService,
            createHolidayCalendarStub(), undefined,
            editRepository as never,
        );

        const expectProblemBody = async (
            rejection: Promise<unknown>,
            status: number,
            code: string,
        ) => {
            await expect(rejection).rejects.toMatchObject({
                status,
                response: expect.objectContaining({
                    code,
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });
        };

        it("returns a registered not-found body when the revision case is missing", async () => {
            const prisma = createPrisma();
            prisma.client.findFirst.mockResolvedValue({ id: 100 });
            const editRepository = { listRevisionHistory: jest.fn().mockResolvedValue(null) };
            const service = buildService(prisma, editRepository);

            await expectProblemBody(
                service.getRevisionHistory("branch-1", 100),
                404,
                "RESOURCE_NOT_FOUND",
            );
            expect(editRepository.listRevisionHistory).toHaveBeenCalledWith("branch-1", 100);
        });

        it("returns a registered conflict body when the edit repository is not bound", async () => {
            const prisma = createPrisma();
            prisma.client.findFirst.mockResolvedValue({ id: 100 });
            const service = buildService(prisma);

            await expectProblemBody(
                service.getRevisionHistory("branch-1", 100),
                409,
                "REQUEST_CONFLICT",
            );
        });

        it("maps a stale retry generation to the registered write-target-changed code", async () => {
            const prisma = createPrisma();
            const editRepository = {
                findRevisionDocumentStateForBranch: jest.fn().mockResolvedValue({
                    generation: "current-generation",
                }),
                retryRevisionDocumentState: jest.fn(),
            };
            const service = buildService(prisma, editRepository);

            await expectProblemBody(
                service.retryRevisionDocument("branch-1", "revision-1", "state-1", "expected-generation", "admin-1"),
                409,
                "SERVICE_RECORD_WRITE_TARGET_CHANGED",
            );
            expect(editRepository.retryRevisionDocumentState).not.toHaveBeenCalled();
        });

        it("maps an invalid retry generation to a registered conflict body", async () => {
            const prisma = createPrisma();
            const editRepository = {
                findRevisionDocumentStateForBranch: jest.fn(),
                retryRevisionDocumentState: jest.fn(),
            };
            const service = buildService(prisma, editRepository);

            await expectProblemBody(
                service.retryRevisionDocument("branch-1", "revision-1", "state-1", "", "admin-1"),
                409,
                "REQUEST_CONFLICT",
            );
            expect(editRepository.findRevisionDocumentStateForBranch).not.toHaveBeenCalled();
        });

        it("maps a lost retry race to a registered conflict body", async () => {
            const prisma = createPrisma();
            const editRepository = {
                findRevisionDocumentStateForBranch: jest.fn().mockResolvedValue({
                    generation: "current-generation",
                }),
                retryRevisionDocumentState: jest.fn().mockResolvedValue(null),
            };
            const service = buildService(prisma, editRepository);

            await expectProblemBody(
                service.retryRevisionDocument("branch-1", "revision-1", "state-1", "current-generation", "admin-1"),
                409,
                "REQUEST_CONFLICT",
            );
        });

        it("returns a registered not-found body when the retry target document is missing", async () => {
            const prisma = createPrisma();
            const editRepository = {
                findRevisionDocumentStateForBranch: jest.fn().mockResolvedValue(null),
                retryRevisionDocumentState: jest.fn(),
            };
            const service = buildService(prisma, editRepository);

            await expectProblemBody(
                service.retryRevisionDocument("branch-1", "revision-1", "state-1", "expected-generation", "admin-1"),
                404,
                "RESOURCE_NOT_FOUND",
            );
            expect(editRepository.retryRevisionDocumentState).not.toHaveBeenCalled();
        });

        it("keeps ConflictException as the rejection type for revision conflicts", async () => {
            const prisma = createPrisma();
            const editRepository = {
                findRevisionDocumentStateForBranch: jest.fn().mockResolvedValue({
                    generation: "current-generation",
                }),
                retryRevisionDocumentState: jest.fn().mockResolvedValue(null),
            };
            const service = buildService(prisma, editRepository);

            await expect(service.retryRevisionDocument(
                "branch-1",
                "revision-1",
                "state-1",
                "current-generation",
                "admin-1",
            )).rejects.toBeInstanceOf(ConflictException);
        });
    });
});
