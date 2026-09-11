import type { Request, Response } from "express";
import { normalizeApiError, PROBLEM_CATALOG } from "@babyjamjam/shared/errors/problem-details";
import { mapHttpProblem, sendProblemResponse } from "infrastructure/filters/problem-response";
import {
    BadGatewayException,
    BadRequestException,
    ConflictException,
    ServiceUnavailableException,
} from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageDeliveryController } from "interface/controllers/message-delivery.controller";

describe("MessageDeliveryController", () => {
    let controller: MessageDeliveryController;
    let aligoService: jest.Mocked<Pick<AligoService, "sendSms">>;
    let messageSenderApprovalService: jest.Mocked<Pick<MessageSenderApprovalService, "ensureApproved">>;
    let prismaService: {
        client: { findFirst: jest.Mock; findMany?: jest.Mock };
        employee?: { findFirst: jest.Mock; findMany?: jest.Mock };
        message_log: { create: jest.Mock; update: jest.Mock };
    };

    beforeEach(() => {
        aligoService = {
            sendSms: jest.fn(),
        };
        messageSenderApprovalService = {
            ensureApproved: jest.fn().mockResolvedValue(undefined),
        };
        prismaService = {
            client: {
                findFirst: jest.fn().mockImplementation(async ({ where }: { where: { id?: number; phone?: string } }) => ({
                    id: where.id ?? 1,
                    name: "테스트 수신자",
                    phone: where.phone ?? "01012345678",
                })),
            },
            employee: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
            message_log: {
                create: jest.fn().mockResolvedValue({
                    id: 42,
                    variables: {
                        triggerType: "immediate",
                    },
                }),
                update: jest.fn().mockResolvedValue({}),
            },
        };
        controller = new MessageDeliveryController(
            aligoService as unknown as AligoService,
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            prismaService as unknown as PrismaService,
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should reject scheduled requests that are less than 10 minutes ahead in KST", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-03-09T11:00:00.000Z").getTime());

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트",
                    triggerType: "scheduled",
                    scheduledDate: "2026-03-09",
                    scheduledTime: "20:05",
                },
            ),
        ).rejects.toThrow(BadRequestException);

        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(prismaService.message_log.create).not.toHaveBeenCalled();
    });

    it.each([
        { scheduledDate: "2026-02-30", scheduledTime: "12:00", reason: "impossible calendar day" },
        { scheduledDate: "2026-02-28", scheduledTime: "24:00", reason: "midnight overflow" },
        { scheduledDate: "2026-03-01", scheduledTime: "24:01", reason: "out-of-range time" },
        { scheduledDate: "2026-03-01", scheduledTime: "12:60", reason: "minute overflow" },
        { scheduledDate: "2026-2-01", scheduledTime: "12:00", reason: "malformed date" },
    ])("should reject $reason before creating a log or calling Aligo", async ({ scheduledDate, scheduledTime }) => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-01-01T00:00:00.000Z").getTime());

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트 예약 발송",
                    triggerType: "scheduled",
                    scheduledDate,
                    scheduledTime,
                },
            ),
        ).rejects.toThrow(BadRequestException);

        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(prismaService.message_log.create).not.toHaveBeenCalled();
    });

    it("should reject a scheduled request with missing date or time before side effects", async () => {
        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "필수 예약 값 누락",
                    triggerType: "scheduled",
                },
            ),
        ).rejects.toThrow(BadRequestException);

        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(prismaService.message_log.create).not.toHaveBeenCalled();
    });

    it("should normalize scheduled fields for the Aligo request and response payload", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-03-09T11:00:00.000Z").getTime());
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                scheduledDate: "20260309",
                scheduledTime: "2015",
                testModeYn: "Y",
            },
            response: {
                result_code: 1,
                message: "성공적으로 전송요청 하였습니다.",
                msg_id: 321,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "LMS",
            },
        });

        const result = await controller.sendSms(
            { branchId: "org-1" },
            {
                receiver: "010-1234-5678",
                recipientName: "김산모",
                message: "장문 테스트 메시지",
                title: "안내",
                triggerType: "scheduled",
                scheduledDate: "2026-03-09",
                scheduledTime: "20:15",
                testMode: true,
            },
        );

        expect(aligoService.sendSms).toHaveBeenCalledWith({
            receiver: "01012345678",
            message: "장문 테스트 메시지",
            recipientName: "테스트 수신자",
            title: "안내",
            msgType: undefined,
            scheduledDate: "20260309",
            scheduledTime: "2015",
            testMode: true,
        });
        expect(result).toEqual({
            provider: "aligo_sms",
            triggerType: "scheduled",
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                scheduledAt: "202603092015",
                testMode: true,
            },
            result: {
                resultCode: 1,
                message: "성공적으로 전송요청 하였습니다.",
                msgId: 321,
                successCount: 1,
                errorCount: 0,
                msgType: "LMS",
            },
        });
        expect(prismaService.message_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "org-1",
                provider: "aligo_sms",
                templateKey: "안내",
                receiver: "01012345678",
                status: "pending",
                attempts: 0,
            }),
        });
        expect(prismaService.message_log.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: expect.objectContaining({
                receiver: "01012345678",
                recipientPhone: "01012345678",
                status: "pending",
                aligoMid: "321",
                errorMessage: null,
                attempts: 1,
            }),
        });
    });

    it("should accept successful Aligo SMS responses when numeric fields arrive as strings", async () => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: "1" as unknown as number,
                message: "success",
                msg_id: "123" as unknown as number,
                success_cnt: "1" as unknown as number,
                error_cnt: "0" as unknown as number,
                msg_type: "SMS",
            },
        });

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트 발송 본문",
                    triggerType: "immediate",
                    msgType: "AUTO",
                },
            ),
        ).resolves.toMatchObject({
            provider: "aligo_sms",
            triggerType: "immediate",
            result: {
                message: "success",
            },
        });

        expect(prismaService.message_log.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: expect.objectContaining({
                status: "sent",
                errorMessage: null,
            }),
        });
        expect(prismaService.client.findFirst).toHaveBeenCalled();
    });

    it.each([
        { description: "an omitted client ID", clientId: undefined },
        { description: "an explicit null client ID", clientId: null },
    ])("should resolve $description through a branch-owned recipient", async ({ clientId }) => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "success",
                msg_id: 123,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "SMS",
            },
        });

        await expect(
            controller.sendSms(
                { branchId: "branch-a" },
                {
                    receiver: "01012345678",
                    message: "연결되지 않은 수신자 안내",
                    ...(clientId === undefined ? {} : { clientId }),
                },
            ),
        ).resolves.toMatchObject({ provider: "aligo_sms" });

        expect(prismaService.client.findFirst).toHaveBeenCalled();
        expect(prismaService.message_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "branch-a",
                clientId: 1,
            }),
        });
    });

    it("rejects a stale branch before recipient lookup, approval, history, or provider", async () => {
        await expect(controller.sendSms(
            { branchId: "branch-b" },
            { receiver: "01012345678", message: "Branch A draft", clientId: 7 },
            undefined,
            "branch-a",
        )).rejects.toMatchObject({
            response: {
                code: "BRANCH_CONTEXT_CHANGED",
                message: "지점이 변경됐어요. 화면을 새로고침한 뒤 다시 시도해 주세요.",
            },
            status: 409,
        });
        expect(prismaService.client.findFirst).not.toHaveBeenCalled();
        expect(messageSenderApprovalService.ensureApproved).not.toHaveBeenCalled();
        expect(prismaService.message_log.create).not.toHaveBeenCalled();
        expect(prismaService.message_log.update).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    it("should reject a client from another branch before approval, history, or provider side effects", async () => {
        prismaService.client.findFirst.mockResolvedValue(null);

        await expect(
            controller.sendSms(
                { branchId: "branch-a" },
                {
                    receiver: "01012345678",
                    message: "다른 지점 고객 오염 시도",
                    clientId: 7,
                },
            ),
        ).rejects.toMatchObject({ status: 404, response: { code: "RESOURCE_NOT_FOUND", outcome: "NOT_APPLIED" } });

        expect(prismaService.client.findFirst).toHaveBeenCalledWith({
            where: { id: 7, branchId: "branch-a" },
            select: { id: true, name: true, phone: true },
        });
        expect(messageSenderApprovalService.ensureApproved).not.toHaveBeenCalled();
        expect(prismaService.message_log.create).not.toHaveBeenCalled();
        expect(prismaService.message_log.update).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    it.each([undefined, "branch-a"])("preserves same-branch manual SMS with expected branch %s", async (expectedBranchId) => {
        prismaService.client.findFirst.mockResolvedValue({ id: 7, name: "지점 고객", phone: "01012345678" });
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "success",
                msg_id: 123,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "SMS",
            },
        });

        await expect(
            controller.sendSms(
                { branchId: "branch-a" },
                {
                    receiver: "01012345678",
                    message: "같은 지점 고객 안내",
                    clientId: 7,
                },
                undefined,
                expectedBranchId,
            ),
        ).resolves.toMatchObject({ provider: "aligo_sms" });

        expect(prismaService.client.findFirst).toHaveBeenCalledWith({
            where: { id: 7, branchId: "branch-a" },
            select: { id: true, name: true, phone: true },
        });
        expect(prismaService.message_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ branchId: "branch-a", clientId: 7 }),
        });
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
    });

    it("should reject a free-form recipient before approval, history, or provider side effects", async () => {
        prismaService.client.findFirst.mockResolvedValue(null);
        prismaService.employee?.findFirst.mockResolvedValue(null);

        await expect(
            controller.sendSms(
                { branchId: "branch-a" },
                {
                    receiver: "01099998888",
                    message: "임의 번호 발송 시도",
                },
            ),
        ).rejects.toMatchObject({ status: 404, response: { code: "RESOURCE_NOT_FOUND", outcome: "NOT_APPLIED" } });

        expect(messageSenderApprovalService.ensureApproved).not.toHaveBeenCalled();
        expect(prismaService.message_log.create).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });


    it.each([{ clientId: 7 }, { employeeId: 12 }, {}])(
        "preserves a safe pre-send recipient 404 through the public response: %j",
        async (selection) => {
            prismaService.client.findFirst.mockResolvedValue(null);
            prismaService.employee?.findFirst.mockResolvedValue(null);
            for (const locale of ["ko-KR", "en-US"] as const) {
                const exception: unknown = await controller.sendSms(
                    { branchId: "branch-a" },
                    { receiver: "01099998888", message: "private message", ...selection },
                ).catch((error: unknown) => error);
                const requestId = `test-recipient-404-${locale}`;
                const response = {
                    locals: { errorRequestId: requestId },
                    setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn(),
                };
                const problem = mapHttpProblem(exception,
                    { method: "POST", acceptsLanguages: () => locale } as unknown as Request,
                    response as unknown as Response);
                if (!problem) throw new Error("Expected a registered recipient problem");
                sendProblemResponse(response as unknown as Response, problem);
                const body: unknown = response.json.mock.calls[0]?.[0];
                expect(body).toMatchObject({
                    code: "RESOURCE_NOT_FOUND", status: 404, requestId, params: {},
                    outcome: "NOT_APPLIED", detail: PROBLEM_CATALOG.RESOURCE_NOT_FOUND.detail[locale],
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                });
                expect(problem.params).toEqual({});
                expect(response.status).toHaveBeenCalledWith(404);
                expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
                expect(response.setHeader).toHaveBeenCalledWith("Content-Language", locale);
                expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
                expect(response.setHeader).toHaveBeenCalledWith("X-Request-Id", requestId);
                const normalized = normalizeApiError({ response: { status: 404, data: body } }, { operation: "mutation", locale });
                expect(normalized).toMatchObject({ verified: true, outcome: "NOT_APPLIED", problem: { requestId } });
                expect(normalized.message).toBe(PROBLEM_CATALOG.RESOURCE_NOT_FOUND.detail[locale]);
                for (const privateValue of ["branch-a", "01099998888", "private message", "Client not found", "Employee not found"]) {
                    expect(JSON.stringify(body)).not.toContain(privateValue);
                }
            }
            const query = expect.objectContaining({ where: expect.objectContaining({ branchId: "branch-a" }) });
            if ("clientId" in selection) expect(prismaService.client.findFirst).toHaveBeenCalledWith(query);
            else if ("employeeId" in selection) {
                expect(prismaService.employee?.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 12, branchId: "branch-a", deletedAt: null },
                }));
            } else {
                expect(prismaService.client.findFirst).toHaveBeenCalledWith(query);
                expect(prismaService.employee?.findFirst).toHaveBeenCalledWith(query);
            }
            expect(messageSenderApprovalService.ensureApproved).not.toHaveBeenCalled();
            expect(prismaService.message_log.create).not.toHaveBeenCalled();
            expect(prismaService.message_log.update).not.toHaveBeenCalled();
            expect(aligoService.sendSms).not.toHaveBeenCalled();
        },
    );

    it("does not turn an unexpected recipient lookup error into a known 404", async () => {
        const failure = new Error("private database lookup failure");
        prismaService.client.findFirst.mockRejectedValue(failure);
        await expect(controller.sendSms({ branchId: "branch-a" }, {
            receiver: "01099998888", message: "test", clientId: 7,
        })).rejects.toBe(failure);
        expect(messageSenderApprovalService.ensureApproved).not.toHaveBeenCalled();
        expect(prismaService.message_log.create).not.toHaveBeenCalled();
        expect(prismaService.message_log.update).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    const smsInvalidRequestCases: Array<{
        description: string;
        setup: () => void;
        tenant: { branchId?: string };
        dto: { receiver: string; message: string; clientId?: number; employeeId?: number };
        privateValues: string[];
    }> = [
        {
            description: "a missing branch",
            setup: () => undefined,
            tenant: {},
            dto: { receiver: "01012345678", message: "private message" },
            privateValues: ["A branch is required"],
        },
        {
            description: "both a client and an employee selected",
            setup: () => undefined,
            tenant: { branchId: "branch-a" },
            dto: { receiver: "01012345678", message: "private message", clientId: 7, employeeId: 12 },
            privateValues: ["both a client and an employee"],
        },
        {
            description: "an empty or invalid recipient list",
            setup: () => undefined,
            tenant: { branchId: "branch-a" },
            dto: { receiver: ",", message: "private message" },
            privateValues: ["valid branch-owned"],
        },
        {
            description: "two recipients with a selected client",
            setup: () => undefined,
            tenant: { branchId: "branch-a" },
            dto: { receiver: "01012345678,01099999999", message: "private message", clientId: 7 },
            privateValues: ["exactly one recipient"],
        },
        {
            description: "a client phone mismatch",
            setup: () => {
                prismaService.client.findFirst.mockResolvedValue({ id: 7, name: "지점 고객", phone: "01033334444" });
            },
            tenant: { branchId: "branch-a" },
            dto: { receiver: "01012345678", message: "private message", clientId: 7 },
            privateValues: ["does not match the selected client"],
        },
        {
            description: "two recipients with a selected employee",
            setup: () => undefined,
            tenant: { branchId: "branch-a" },
            dto: { receiver: "01012345678,01099999999", message: "private message", employeeId: 12 },
            privateValues: ["exactly one recipient"],
        },
        {
            description: "an employee phone mismatch",
            setup: () => {
                prismaService.employee?.findFirst.mockResolvedValue({ id: 12, name: "지점 직원", phone: "01033334444" });
            },
            tenant: { branchId: "branch-a" },
            dto: { receiver: "01012345678", message: "private message", employeeId: 12 },
            privateValues: ["does not match the selected employee"],
        },
        {
            description: "an ambiguous free-form recipient",
            setup: () => {
                prismaService.client.findFirst.mockResolvedValue({ id: 3, name: "중복 고객", phone: "01012345678" });
                prismaService.employee?.findFirst.mockResolvedValue({ id: 5, name: "중복 직원", phone: "01012345678" });
            },
            tenant: { branchId: "branch-a" },
            dto: { receiver: "01012345678", message: "private message" },
            privateValues: ["more than one branch record"],
        },
    ];

    it.each(smsInvalidRequestCases)(
        "rejects $description with REQUEST_INVALID before approval, history, or provider side effects",
        async ({ setup, tenant, dto }) => {
            prismaService.client.findFirst.mockResolvedValue({ id: 1, name: "테스트 수신자", phone: "01012345678" });
            setup();

            await expect(controller.sendSms(tenant, dto)).rejects.toMatchObject({
                status: 400,
                response: { code: "REQUEST_INVALID", outcome: "NOT_APPLIED" },
            });

            expect(messageSenderApprovalService.ensureApproved).not.toHaveBeenCalled();
            expect(prismaService.message_log.create).not.toHaveBeenCalled();
            expect(prismaService.message_log.update).not.toHaveBeenCalled();
            expect(aligoService.sendSms).not.toHaveBeenCalled();
        },
    );

    // Non-null assertions are justified: indices 1/4/7 are fully populated entries of smsInvalidRequestCases.
    const smsPublicResponseCases = [smsInvalidRequestCases[1]!, smsInvalidRequestCases[4]!, smsInvalidRequestCases[7]!];

    it.each(smsPublicResponseCases)(
        "preserves a pre-send REQUEST_INVALID rejection through the public response: %j",
        async ({ setup, tenant, dto }) => {
            prismaService.client.findFirst.mockResolvedValue({ id: 1, name: "테스트 수신자", phone: "01012345678" });
            prismaService.employee?.findFirst.mockResolvedValue({ id: 12, name: "지점 직원", phone: "010-1234-5678" });
            setup();

            for (const locale of ["ko-KR", "en-US"] as const) {
                const exception: unknown = await controller.sendSms(tenant, dto).catch((error: unknown) => error);
                const requestId = `test-recipient-request-invalid-${locale}`;
                const response = {
                    locals: { errorRequestId: requestId },
                    setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn(),
                };
                const problem = mapHttpProblem(exception,
                    { method: "POST", acceptsLanguages: () => locale } as unknown as Request,
                    response as unknown as Response);
                if (!problem) throw new Error("Expected a registered recipient problem");
                sendProblemResponse(response as unknown as Response, problem);
                const body: unknown = response.json.mock.calls[0]?.[0];
                expect(body).toMatchObject({
                    code: "REQUEST_INVALID", status: 400, requestId, params: {},
                    outcome: "NOT_APPLIED", detail: PROBLEM_CATALOG.REQUEST_INVALID.detail[locale],
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                });
                expect(problem.params).toEqual({});
                expect(response.status).toHaveBeenCalledWith(400);
                expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
                expect(response.setHeader).toHaveBeenCalledWith("Content-Language", locale);
                expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
                expect(response.setHeader).toHaveBeenCalledWith("X-Request-Id", requestId);
                const normalized = normalizeApiError({ response: { status: 400, data: body } }, { operation: "mutation", locale });
                expect(normalized).toMatchObject({ verified: true, outcome: "NOT_APPLIED", problem: { requestId } });
                expect(normalized.message).toBe(PROBLEM_CATALOG.REQUEST_INVALID.detail[locale]);
                const serialized = JSON.stringify(body);
                expect(serialized).not.toContain("branch-a");
                expect(serialized).not.toContain("private message");
                for (const phone of dto.receiver.split(",")) {
                    expect(serialized).not.toContain(phone);
                }
            }
        },
    );

    it("should bind an employee-associated SMS to an active employee in the selected branch", async () => {
        prismaService.client.findFirst.mockResolvedValue(null);
        prismaService.employee?.findFirst.mockResolvedValue({
            id: 12,
            name: "지점 직원",
            phone: "010-1234-5678",
        });
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "success",
                msg_id: 124,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "SMS",
            },
        });

        await expect(
            controller.sendSms(
                { branchId: "branch-a" },
                {
                    receiver: "01012345678",
                    employeeId: 12,
                    recipientName: "caller-controlled",
                    message: "직원 안내",
                },
            ),
        ).resolves.toMatchObject({ provider: "aligo_sms" });

        expect(prismaService.employee?.findFirst).toHaveBeenCalledWith({
            where: { id: 12, branchId: "branch-a", deletedAt: null },
            select: { id: true, name: true, phone: true },
        });
        expect(prismaService.message_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "branch-a",
                clientId: null,
                recipientName: "지점 직원",
                variables: expect.objectContaining({ employeeId: 12 }),
            }),
        });
    });

    it("should record failed logs and reject when Aligo does not accept the SMS request", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-06-05T09:20:00.000Z").getTime());
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: -101,
                message: "수신번호 형식이 올바르지 않습니다.",
                error_cnt: 1,
                msg_type: "LMS",
            },
        });

        const error = await controller.sendSms(
            { branchId: "org-1" },
            {
                receiver: "01012345678",
                message: "테스트 발송 본문",
                title: "안내",
                triggerType: "immediate",
                msgType: "AUTO",
            },
        ).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BadGatewayException);
        expect((error as BadGatewayException).getResponse()).toMatchObject({
            code: "MESSAGE_SEND_REJECTED",
            outcome: "FAILED",
            operationId: "42",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
        });
        expect(JSON.stringify((error as BadGatewayException).getResponse())).not.toContain("수신번호 형식");

        expect(prismaService.message_log.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: expect.objectContaining({
                receiver: "01012345678",
                recipientPhone: "01012345678",
                status: "failed",
                errorMessage: "수신번호 형식이 올바르지 않습니다.",
                attempts: 1,
                nextRetryAt: null,
                variables: expect.objectContaining({ retrySafety: "manual-provider-rejected" }),
            }),
        });
    });

    it("should not schedule auto-retry on partial-success batches (would duplicate to already-delivered recipients)", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-06-05T09:20:00.000Z").getTime());
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678,01099999999",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "일부 수신번호 형식이 올바르지 않습니다.",
                success_cnt: 1,
                error_cnt: 1,
                msg_type: "SMS",
            },
        });

        const error = await controller.sendSms(
            { branchId: "org-1" },
            {
                receiver: "01012345678,01099999999",
                message: "테스트 발송 본문",
                title: "안내",
                triggerType: "immediate",
                msgType: "AUTO",
            },
        ).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BadGatewayException);
        expect((error as BadGatewayException).getResponse()).toMatchObject({
            code: "MESSAGE_SEND_PARTIAL",
            outcome: "PARTIALLY_APPLIED",
            operationId: "42",
            recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
        });

        expect(prismaService.message_log.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: expect.objectContaining({
                status: "failed",
                recipientPhone: "01012345678,01099999999",
                nextRetryAt: null,
                errorMessage: expect.stringContaining("부분 발송"),
                providerAcceptanceState: "uncertain",
                variables: expect.objectContaining({ retrySafety: "partial" }),
            }),
        });
    });

    it("should record a failed log and reject when Aligo rejects the SMS request before returning a result body", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-06-05T09:20:00.000Z").getTime());
        aligoService.sendSms.mockRejectedValue(
            new Error("Aligo SMS API error (403): 등록되지 않은 IP 입니다."),
        );

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트 발송 본문",
                    title: "안내",
                    triggerType: "immediate",
                    msgType: "AUTO",
                },
            ),
        ).rejects.toThrow(BadGatewayException);

        expect(prismaService.message_log.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: expect.objectContaining({
                status: "failed",
                errorMessage: "Aligo SMS API error (403): 등록되지 않은 IP 입니다.",
                attempts: 1,
                nextRetryAt: null,
                variables: expect.objectContaining({ retrySafety: "uncertain" }),
            }),
        });
    });

    it("should not call the provider when the initial delivery record cannot be created", async () => {
        prismaService.message_log.create.mockRejectedValue(new Error("database unavailable"));

        const error = await controller.sendSms(
            { branchId: "org-1" },
            {
                receiver: "01012345678",
                message: "테스트 발송 본문",
                triggerType: "immediate",
            },
        ).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
            code: "MESSAGE_SEND_NOT_STARTED",
            outcome: "NOT_APPLIED",
        });

        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    it("should surface a partial persistence failure while keeping the pre-created record", async () => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "success",
                msg_id: 123,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "SMS",
            },
        });
        prismaService.message_log.update.mockRejectedValue(new Error("database unavailable"));

        const error = await controller.sendSms(
            { branchId: "org-1" },
            {
                receiver: "01012345678",
                message: "테스트 발송 본문",
                triggerType: "immediate",
            },
        ).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
            code: "MESSAGE_SEND_UNCONFIRMED",
            outcome: "UNKNOWN",
        });

        expect(prismaService.message_log.create).toHaveBeenCalledTimes(1);
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
    });

    it("should fence a provider failure when the uncertain-state update also fails", async () => {
        const row = {
            id: 42,
            variables: { triggerType: "immediate" },
            providerAcceptanceState: "prepared",
        };
        prismaService.message_log.create.mockResolvedValue(row);
        prismaService.message_log.update.mockRejectedValue(new Error("database unavailable"));
        aligoService.sendSms.mockRejectedValue(new Error("provider connection reset"));

        const error = await controller.sendSms(
            { branchId: "org-1" },
            {
                receiver: "01012345678",
                message: "결과가 불확실한 발송",
                triggerType: "immediate",
            },
        ).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
            code: "MESSAGE_SEND_UNCONFIRMED",
            outcome: "UNKNOWN",
        });

        expect(row.providerAcceptanceState).toBe("started");
        expect(prismaService.message_log.update).toHaveBeenCalledTimes(1);
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
    });

    it("should keep malformed provider counters unconfirmed without scheduling a retry", async () => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "성공",
                msg_id: 321,
                success_cnt: 2,
                error_cnt: 0,
                msg_type: "SMS",
            },
        });

        const error = await controller.sendSms(
            { branchId: "org-1" },
            { receiver: "01012345678", message: "카운터 불일치" },
        ).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadGatewayException);
        expect((error as BadGatewayException).getResponse()).toMatchObject({
            code: "MESSAGE_SEND_UNCONFIRMED",
            outcome: "UNKNOWN",
            operationId: "42",
            recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
        });
        expect(prismaService.message_log.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: expect.objectContaining({
                providerAcceptanceState: "uncertain",
                providerAcceptedAt: null,
                nextRetryAt: null,
            }),
        });
    });

    it.each([0, 2])("should keep unregistered non-negative provider result codes unconfirmed (%s)", async (resultCode) => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: resultCode,
                message: "provider response",
            },
        });

        const error = await controller.sendSms(
            { branchId: "org-1" },
            { receiver: "01012345678", message: "등록되지 않은 결과 코드" },
        ).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadGatewayException);
        expect((error as BadGatewayException).getResponse()).toMatchObject({
            code: "MESSAGE_SEND_UNCONFIRMED",
            outcome: "UNKNOWN",
        });
        expect(prismaService.message_log.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: expect.objectContaining({
                providerAcceptanceState: "uncertain",
                nextRetryAt: null,
            }),
        });
    });

    it("should treat a negative provider result with absent counters as an explicit rejection", async () => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: -101,
                message: "provider rejected",
            },
        });

        const error = await controller.sendSms(
            { branchId: "org-1" },
            { receiver: "01012345678", message: "명시적 거부" },
        ).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadGatewayException);
        expect((error as BadGatewayException).getResponse()).toMatchObject({
            code: "MESSAGE_SEND_REJECTED",
            outcome: "FAILED",
        });
    });

    it("should keep negative provider results with malformed counters unconfirmed", async () => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: -101,
                message: "provider response",
                success_cnt: -1,
                error_cnt: 1,
            },
        });

        const error = await controller.sendSms(
            { branchId: "org-1" },
            { receiver: "01012345678", message: "거부 카운터 불일치" },
        ).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadGatewayException);
        expect((error as BadGatewayException).getResponse()).toMatchObject({
            code: "MESSAGE_SEND_UNCONFIRMED",
            outcome: "UNKNOWN",
        });
    });

    it("should classify a complete result-code-one error count as rejected", async () => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "all recipients rejected",
                success_cnt: 0,
                error_cnt: 1,
            },
        });

        const error = await controller.sendSms(
            { branchId: "org-1" },
            { receiver: "01012345678", message: "전체 거부" },
        ).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadGatewayException);
        expect((error as BadGatewayException).getResponse()).toMatchObject({
            code: "MESSAGE_SEND_REJECTED",
            outcome: "FAILED",
        });
    });

    it("should classify a pre-send fingerprint mismatch separately from an existing request", async () => {
        const messageLogModel = prismaService.message_log as typeof prismaService.message_log & {
            findUnique: jest.Mock;
        };
        messageLogModel.findUnique = jest.fn().mockResolvedValue({
            id: 73,
            providerAcceptanceFingerprint: "different-fingerprint",
            providerAcceptanceState: "prepared",
        });

        const error = await controller.sendSms(
            { branchId: "org-1" },
            {
                receiver: "01012345678",
                message: "다른 내용",
                idempotencyKey: "same-key",
            },
        ).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
            code: "MESSAGE_REQUEST_KEY_CONFLICT",
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
        });
        expect(prismaService.message_log.create).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    it("should classify a matching durable request as UNKNOWN and avoid the provider", async () => {
        const messageLogModel = prismaService.message_log as typeof prismaService.message_log & {
            findUnique: jest.Mock;
        };
        messageLogModel.findUnique = jest.fn().mockResolvedValue({
            id: 74,
            providerAcceptanceFingerprint: undefined,
            providerAcceptanceState: "started",
            status: "pending",
        });
        const request = {
            receiver: "01012345678",
            message: "이미 기록된 요청",
            idempotencyKey: "already-requested",
        };
        // Derive the fingerprint through the first call's create path, then
        // return a matching durable record for the retrying identity.
        messageLogModel.findUnique.mockResolvedValueOnce(null);
        prismaService.message_log.create.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({
            ...data,
            id: 74,
            providerAcceptanceState: "started",
            status: "pending",
        }));
        aligoService.sendSms.mockResolvedValueOnce(undefined as never);
        await expect(controller.sendSms({ branchId: "org-1" }, request)).rejects.toThrow(BadGatewayException);
        const createdData = prismaService.message_log.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
        messageLogModel.findUnique.mockReset();
        messageLogModel.findUnique.mockResolvedValue({
            id: 74,
            providerAcceptanceFingerprint: createdData["providerAcceptanceFingerprint"],
            providerAcceptanceState: "started",
            status: "pending",
        });

        const error = await controller.sendSms({ branchId: "org-1" }, request).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
            code: "MESSAGE_SEND_ALREADY_REQUESTED",
            outcome: "UNKNOWN",
            operationId: "74",
            recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
        });
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
    });

    it("should not cross Aligo when provider-call boundary persistence is unavailable", async () => {
        const messageLogModel = prismaService.message_log as typeof prismaService.message_log & {
            updateMany: jest.Mock;
        };
        messageLogModel.updateMany = jest.fn().mockRejectedValue(new Error("database unavailable"));

        const error = await controller.sendSms(
            { branchId: "org-1" },
            { receiver: "01012345678", message: "경계 기록 실패" },
        ).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
            code: "MESSAGE_SEND_UNCONFIRMED",
            outcome: "UNKNOWN",
        });
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    it("should converge duplicate manual requests with one idempotency key before crossing Aligo", async () => {
        let persistedRow: Record<string, unknown> | null = null;
        const messageLogModel = prismaService.message_log as typeof prismaService.message_log & {
            findUnique: jest.Mock;
        };
        messageLogModel.findUnique = jest.fn().mockImplementation(async () => persistedRow);
        prismaService.message_log.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
            persistedRow = { ...data, id: 42 };
            return persistedRow;
        });
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "success",
                msg_id: 321,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "SMS",
            },
        });

        const request = {
            receiver: "01012345678",
            message: "멱등 요청",
            triggerType: "immediate" as const,
            idempotencyKey: "manual-request-42",
        };
        await expect(controller.sendSms({ branchId: "org-1" }, request)).resolves.toMatchObject({
            provider: "aligo_sms",
        });
        await expect(controller.sendSms({ branchId: "org-1" }, request)).rejects.toThrow(ConflictException);

        expect(messageLogModel.findUnique).toHaveBeenCalledTimes(2);
        expect(prismaService.message_log.create).toHaveBeenCalledTimes(1);
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
    });
});
