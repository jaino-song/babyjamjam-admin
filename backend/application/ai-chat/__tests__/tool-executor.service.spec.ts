import { BadRequestException } from "@nestjs/common";

import { sanitizeEformsignErrorMessage } from "../../../domain/utils/eformsign-error-message";
import { clientProblemBody } from "../../usecases/client/client-write-validation";
import { LegacyChatConfirmationService } from "../legacy-chat-confirmation.service";
import { ToolExecutorService, type ToolExecutionResult } from "../tool-executor.service";

const TEST_PRINCIPAL = { branchId: "branch-1", globalRole: "owner" };
type TestExecutor = Omit<ToolExecutorService, "execute"> & {
    execute(branchId: string, toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult>;
};

type ServiceMocks = {
    clientService: {
        findAllPaginated: jest.Mock;
        findById: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
        findAll: jest.Mock;
        findByFilter: jest.Mock;
        terminateService: jest.Mock;
        requestReplacement: jest.Mock;
    };
    employeeService: {
        findAll: jest.Mock;
        findById: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
        delete: jest.Mock;
        findAllOpenToNextWork: jest.Mock;
        findByWorkArea: jest.Mock;
        findByGrade: jest.Mock;
        changeOpenStatus: jest.Mock;
    };
    messageService: {
        findAll: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
        delete: jest.Mock;
    };
    areaTemplateService: {
        findAll: jest.Mock;
        findByArea: jest.Mock;
    };
    eformsignDocService: {
        createAndSendContract: jest.Mock;
        findByDocumentId: jest.Mock;
        findByClientId: jest.Mock;
        findAll: jest.Mock;
    };
    voucherPriceInfoService: {
        list: jest.Mock;
        findByType: jest.Mock;
    };
    bankAccountInfoService: {
        findAll: jest.Mock;
        findByArea: jest.Mock;
    };
    employeeScheduleService: {
        findAll: jest.Mock;
        findByPrimaryEmployeeId: jest.Mock;
        findBySecondaryEmployeeId: jest.Mock;
    };
};

function createExecutor(): { executor: TestExecutor; mocks: ServiceMocks } {
    const mocks: ServiceMocks = {
        clientService: {
            findAllPaginated: jest.fn().mockResolvedValue({
                data: [],
                total: 0,
                page: 1,
                totalPages: 0,
            }),
            findById: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            update: jest.fn(),
            findAll: jest.fn().mockResolvedValue([]),
            findByFilter: jest.fn().mockResolvedValue([]),
            terminateService: jest.fn(),
            requestReplacement: jest.fn(),
        },
        employeeService: {
            findAll: jest.fn().mockResolvedValue([]),
            findById: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            findAllOpenToNextWork: jest.fn().mockResolvedValue([]),
            findByWorkArea: jest.fn().mockResolvedValue([]),
            findByGrade: jest.fn().mockResolvedValue([]),
            changeOpenStatus: jest.fn(),
        },
        messageService: {
            findAll: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        areaTemplateService: {
            findAll: jest.fn().mockResolvedValue([]),
            findByArea: jest.fn(),
        },
        eformsignDocService: {
            createAndSendContract: jest.fn(),
            findByDocumentId: jest.fn(),
            findByClientId: jest.fn(),
            findAll: jest.fn().mockResolvedValue([]),
        },
        voucherPriceInfoService: {
            list: jest.fn().mockResolvedValue([]),
            findByType: jest.fn().mockResolvedValue([]),
        },
        bankAccountInfoService: {
            findAll: jest.fn().mockResolvedValue([]),
            findByArea: jest.fn(),
        },
        employeeScheduleService: {
            findAll: jest.fn().mockResolvedValue([]),
            findByPrimaryEmployeeId: jest.fn().mockResolvedValue([]),
            findBySecondaryEmployeeId: jest.fn().mockResolvedValue([]),
        },
    };

    const realExecutor = new ToolExecutorService(
        mocks.clientService as never,
        mocks.employeeService as never,
        mocks.messageService as never,
        mocks.areaTemplateService as never,
        mocks.eformsignDocService as never,
        mocks.voucherPriceInfoService as never,
        mocks.bankAccountInfoService as never,
        mocks.employeeScheduleService as never,
    );

    const executeWithPrincipal = realExecutor.execute.bind(realExecutor);
    const executor = realExecutor as unknown as TestExecutor;
    executor.execute = (branchId, toolName, args) => executeWithPrincipal(
        branchId,
        toolName,
        args,
        TEST_PRINCIPAL,
    );

    return { executor, mocks };
}

describe("ToolExecutorService", () => {
    it("should default missing search pagination but reject invalid provided values", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "searchClients", { query: "김" }))
            .resolves.toMatchObject({ success: true });
        expect(mocks.clientService.findAllPaginated).toHaveBeenCalledWith("branch-1", 1, 10, "김");

        mocks.clientService.findAllPaginated.mockClear();
        await expect(executor.execute("branch-1", "searchClients", { query: "김", page: "abc" }))
            .resolves.toMatchObject({ success: false, error: expect.stringContaining("page") });
        expect(mocks.clientService.findAllPaginated).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "searchClients", { query: "김", limit: -1 }))
            .resolves.toMatchObject({ success: false, error: expect.stringContaining("limit") });
    });

    it("should reject invalid required identifiers before calling downstream services", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "getClient", { clientId: "abc" }))
            .resolves.toMatchObject({ success: false, error: expect.stringContaining("clientId") });
        expect(mocks.clientService.findById).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "getEmployee", { employeeId: 0 }))
            .resolves.toMatchObject({ success: false, error: expect.stringContaining("employeeId") });
        expect(mocks.employeeService.findById).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "getContractStatus", { clientId: 0 }))
            .resolves.toMatchObject({ success: false, error: expect.stringContaining("clientId") });
        expect(mocks.eformsignDocService.findByClientId).not.toHaveBeenCalled();
    });

    it("should reject invalid creation and update numeric fields before mutation services run", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "createClient", {
            confirmed: true,
            name: "김산모",
            primaryEmployeeId: "nan",
            careCenter: false,
            voucherClient: true,
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("primaryEmployeeId") });
        expect(mocks.clientService.create).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "requestEmployeeReplacement", {
            confirmed: true,
            clientName: "김산모",
            newPrimaryEmployeeName: "박관리",
            newSecondaryEmployeeId: 0,
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("newSecondaryEmployeeId") });
        expect(mocks.clientService.requestReplacement).not.toHaveBeenCalled();
    });

    it("should reject invalid optional year filters instead of passing NaN", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "getVoucherPriceByType", {
            type: "A통합1형",
            year: "soon",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("year") });
        expect(mocks.voucherPriceInfoService.findByType).not.toHaveBeenCalled();

        mocks.voucherPriceInfoService.list.mockResolvedValue([
            { id: 1, type: "A통합1형", duration: 10n, fullPrice: "100", grant: "50", actualPrice: "50", year: 2025 },
            { id: 2, type: "A통합1형", duration: 15n, fullPrice: "150", grant: "70", actualPrice: "80", year: 2026 },
        ]);

        await expect(executor.execute("branch-1", "listVoucherPrices", { year: 2026 }))
            .resolves.toMatchObject({
                success: true,
                data: [
                    expect.objectContaining({ id: 2, year: 2026 }),
                ],
            });
    });

    it("should reject non-boolean client flags instead of coercing strings", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "createClient", {
            confirmed: true,
            name: "김산모",
            primaryEmployeeId: 1,
            careCenter: "false",
            voucherClient: true,
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("careCenter") });
        expect(mocks.clientService.create).not.toHaveBeenCalled();

        mocks.clientService.create.mockResolvedValue({ id: 7, name: "김산모" });
        await expect(executor.execute("branch-1", "createClient", {
            confirmed: true,
            name: "김산모",
            primaryEmployeeId: 1,
            careCenter: false,
            voucherClient: true,
            breastPump: false,
        })).resolves.toMatchObject({ success: true });
        expect(mocks.clientService.create).not.toHaveBeenCalled();
    });

    it("should keep the structured client validation detail readable in tool failure text", () => {
        const error = new BadRequestException(clientProblemBody("CLIENT_SERVICE_PERIOD_INVALID", {
            pointer: "/endDate",
            code: "INVALID_VALUE",
            detail: "서비스 시작일은 종료일보다 늦을 수 없습니다.",
            location: "body",
        }));

        expect(sanitizeEformsignErrorMessage(error)).toContain("서비스 시작일은 종료일보다 늦을 수 없습니다.");
    });

    it("should reject non-boolean employee availability values", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "createEmployee", {
            confirmed: true,
            id: 1,
            name: "박관리",
            phone: "010-0000-0000",
            grade: "A",
            openToNextWork: "false",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("openToNextWork") });
        expect(mocks.employeeService.create).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "changeEmployeeAvailability", {
            confirmed: true,
            employeeId: 1,
            available: "false",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("available") });
        expect(mocks.employeeService.changeOpenStatus).not.toHaveBeenCalled();
    });

    it("should honor employee availability filters during search", async () => {
        const { executor, mocks } = createExecutor();
        mocks.employeeService.findAll.mockResolvedValue([
            { id: 1, name: "김관리", phone: "010-1111-1111", grade: "A", openToNextWork: true },
            { id: 2, name: "김관리2", phone: "010-2222-2222", grade: "B", openToNextWork: false },
        ]);

        await expect(executor.execute("branch-1", "searchEmployees", {
            query: "김관리",
            openToNextWork: true,
        })).resolves.toMatchObject({
            success: true,
            data: [
                expect.objectContaining({ id: 1, openToNextWork: true }),
            ],
        });

        await expect(executor.execute("branch-1", "searchEmployees", {
            query: "김관리",
            openToNextWork: "true",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("openToNextWork") });
    });

    it("should reject missing required strings and invalid enum filters before service calls", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "createEmployee", {
            confirmed: true,
            phone: "010-0000-0000",
            grade: "A",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("name") });
        expect(mocks.employeeService.create).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "createMessage", {
            confirmed: true,
            title: "공지",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("text") });
        expect(mocks.messageService.create).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "updateMessage", {
            confirmed: true,
            messageId: 1,
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("title") });
        expect(mocks.messageService.update).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "createAndSendContract", {
            confirmed: true,
            clientId: 1,
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("areaId") });
        expect(mocks.areaTemplateService.findByArea).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "getClientsByFilter", {
            filter: "everything",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("filter") });
        expect(mocks.clientService.findByFilter).not.toHaveBeenCalled();
    });

    it("should reject malformed date strings before mutation services run", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "createClient", {
            confirmed: true,
            name: "김산모",
            primaryEmployeeId: 1,
            careCenter: false,
            voucherClient: true,
            startDate: "2026-02-31",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("startDate") });
        expect(mocks.clientService.create).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "createClient", {
            confirmed: true,
            name: "김산모",
            primaryEmployeeId: 1,
            careCenter: false,
            voucherClient: true,
            birthday: "2026-01-01",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("birthday") });
        expect(mocks.clientService.create).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "createEmployee", {
            confirmed: true,
            name: "박관리",
            phone: "010-0000-0000",
            grade: "A",
            companyRegisteredDate: "tomorrow",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("companyRegisteredDate") });
        expect(mocks.employeeService.create).not.toHaveBeenCalled();
    });

    describe("createAndSendContract uncertainty classification", () => {
        const chatContext = {
            userId: "user-1",
            branchId: "branch-1",
            sessionId: "session-1",
            globalRole: "owner",
            branchRole: "admin",
        };
        const dispatchArgs = { clientId: 7, areaId: "incheon" };

        async function dispatchWithResult(result: Record<string, unknown>) {
            const { mocks } = createExecutor();
            const prismaIntentRows: Array<Record<string, unknown>> = [];
            const prisma = {
                legacy_chat_confirmation_intent: {
                    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
                        const row = {
                            id: `intent-${prismaIntentRows.length + 1}`,
                            expiresAt: new Date(Date.now() + 60_000),
                            ...data,
                        };
                        prismaIntentRows.push(row);
                        return Promise.resolve({ id: row.id, expiresAt: row.expiresAt });
                    }),
                    findFirst: jest.fn(({ where }: { where: { id: string } }) => {
                        const row = prismaIntentRows.find((entry) => entry["id"] === where.id);
                        return Promise.resolve(row ?? null);
                    }),
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
            };
            const confirmationService = new LegacyChatConfirmationService(prisma as never);
            const boundExecutor = new ToolExecutorService(
                mocks.clientService as never,
                mocks.employeeService as never,
                mocks.messageService as never,
                mocks.areaTemplateService as never,
                mocks.eformsignDocService as never,
                mocks.voucherPriceInfoService as never,
                mocks.bankAccountInfoService as never,
                mocks.employeeScheduleService as never,
                confirmationService,
            );
            mocks.areaTemplateService.findByArea.mockResolvedValue({
                areaId: "incheon",
                templateId: "template-1",
                templateName: "표준계약서",
            });
            mocks.eformsignDocService.createAndSendContract.mockResolvedValue(result);

            const proposal = await boundExecutor.execute(chatContext, "createAndSendContract", dispatchArgs, TEST_PRINCIPAL);
            const consumed = await confirmationService.consumeIntent(chatContext, {
                intentId: String(proposal.confirmationIntentId),
                nonce: String(proposal.confirmationNonce),
            });
            const authorized = await boundExecutor.executeAuthorized(
                chatContext,
                "createAndSendContract",
                dispatchArgs,
                consumed,
                TEST_PRINCIPAL,
            );
            return { result: authorized, mocks };
        }

        it("classifies an additive UNKNOWN outcome as uncertain", async () => {
            const { result, mocks } = await dispatchWithResult({
                success: false,
                error: "계약서 발송 결과 확인이 필요합니다",
                outcome: "UNKNOWN",
            });
            expect(result).toMatchObject({ success: false, uncertain: true });
            expect(mocks.eformsignDocService.createAndSendContract).toHaveBeenCalledTimes(1);
        });

        it("keeps legacy uncertain and remoteDocumentId failures classified as uncertain", async () => {
            const legacyUncertain = await dispatchWithResult({
                success: false,
                error: "계약서 발송 결과 확인이 필요합니다",
                uncertain: true,
            });
            expect(legacyUncertain.result).toMatchObject({ success: false, uncertain: true });

            const legacyRemoteId = await dispatchWithResult({
                success: false,
                error: "계약서 발송 결과 확인이 필요합니다",
                remoteDocumentId: "remote-1",
            });
            expect(legacyRemoteId.result).toMatchObject({ success: false, uncertain: true });
        });

        it("keeps a NOT_APPLIED outcome a certain failure without an uncertainty flag", async () => {
            const { result } = await dispatchWithResult({
                success: false,
                error: "고객의 제공인력 배정을 먼저 저장해 주세요.",
                code: "CLIENT_ASSIGNMENT_REQUIRED",
                outcome: "NOT_APPLIED",
            });
            expect(result).toEqual({ success: false, error: "고객의 제공인력 배정을 먼저 저장해 주세요." });
        });
    });
});
