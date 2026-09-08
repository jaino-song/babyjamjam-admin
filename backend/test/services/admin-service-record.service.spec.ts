import { NotFoundException } from "@nestjs/common";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import {
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-record-link-message";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { PrismaService } from "infrastructure/database/prisma.service";

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

    it("keeps the stored session count as the total even when the period is longer than its business-day span", async () => {
        const prisma = createPrisma();
        prisma.service_record_case.findFirst.mockResolvedValue({
            id: "case-1",
            status: "IN_PROGRESS",
            startDate: new Date("2026-08-03T00:00:00.000Z"),
            endDate: new Date("2026-08-10T00:00:00.000Z"),
            requiredSessionCount: 15,
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
            createTriggerService() as unknown as MessageTriggerService,
        );

        const overview = await service.getClientOverview("branch-1", 100);

        // requiredSessionCount (15) is the contracted count and is
        // authoritative; the 6-business-day span for the current dates is
        // no longer used to override it.
        expect(overview.record?.totalSessions).toBe(15);
    });

    it("asserts branch-owned client access before reading the editor overview", async () => {
        const prisma = createPrisma();
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService,
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

    it("adds the canonical all-session projection for unwritten editor slots", async () => {
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
            undefined,
            editRepository as never,
        );

        const overview = await service.getClientEditor("branch-1", 100);

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
            undefined,
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
            triggerService as unknown as MessageTriggerService,
        );
        prisma.client.findFirst.mockResolvedValue(null);

        await expect(service.getClientEditor("branch-1", 404)).rejects.toBeInstanceOf(NotFoundException);

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
            createTriggerService() as unknown as MessageTriggerService,
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
            createTriggerService() as unknown as MessageTriggerService,
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
            statusDetail: "완료",
            stepName: "제공기록지 서명",
            createdDate: new Date("2026-07-02T07:00:00.000Z"),
            updatedDate: new Date("2026-07-02T07:10:00.000Z"),
            snapshotVersion: null,
            snapshotChunkIndex: null,
            employeeScheduleId: 3,
        });
    });

    it("attributes phone-missing failure logs only to their own assignment", async () => {
        const prisma = createPrisma();
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            createLinkService() as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService,
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
            createTriggerService() as unknown as MessageTriggerService,
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
            createTriggerService() as unknown as MessageTriggerService,
        );
        prisma.employee_schedule.findFirst.mockResolvedValue(null);

        await expect(service.sendLinkNow("branch-1", 10)).rejects.toBeInstanceOf(NotFoundException);

        expect(linkService.sendNow).not.toHaveBeenCalled();
    });

    it("prepares a link only after checking that the schedule belongs to the tenant branch", async () => {
        const prisma = createPrisma();
        const linkService = createLinkService();
        const service = new AdminServiceRecordService(
            prisma as unknown as PrismaService,
            linkService as unknown as ServiceRecordLinkService,
            createTriggerService() as unknown as MessageTriggerService,
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
            triggerService as unknown as MessageTriggerService,
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
            triggerService as unknown as MessageTriggerService,
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
            securityEventService as never,
        );
        prisma.employee_schedule.findFirst.mockResolvedValue({ id: 10 });

        await expect(service.resetLink("branch-1", 10)).rejects.toThrow("Authenticated administrator required");
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
});
