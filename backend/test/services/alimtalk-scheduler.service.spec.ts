import { ConfigService } from "@nestjs/config";
import { AlimtalkSchedulerService } from "application/services/alimtalk-scheduler.service";
import { AlimtalkService } from "application/services/alimtalk.service";
import { IClientRepository } from "domain/repositories/client.repository.interface";
import { IBranchRepository } from "domain/repositories/branch.repository.interface";
import { IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import { ClientEntity } from "domain/entities/client.entity";

describe("AlimtalkSchedulerService", () => {
    const createMockAlimtalkService = () => ({
        sendContractReminder3DaysAlimtalk: jest.fn(),
        sendContractReminder1DayAlimtalk: jest.fn(),
        sendSurveyRequestAlimtalk: jest.fn(),
        sendPaymentReminderAlimtalk: jest.fn(),
    });

    const createMockConfigService = () => ({
        get: jest.fn().mockReturnValue("https://example.com/survey"),
    });

    const createMockClientRepository = () => ({
        findByStartDate: jest.fn(),
        findByEndDate: jest.fn(),
        findByCreatedDate: jest.fn(),
    });

    const createMockBranchRepository = () => ({
        findAllActive: jest.fn().mockResolvedValue([
            { id: "org-1", name: "Test Org" },
        ]),
    });

    const createMockEmployeeScheduleRepository = () => ({
        findByClientId: jest.fn().mockResolvedValue([]),
    });

    const createMockEmployeeRepository = () => ({
        findById: jest.fn().mockResolvedValue(null),
    });

    const createMockClient = (overrides: Partial<ClientEntity> = {}): ClientEntity =>
        new ClientEntity(
            overrides.id ?? 1,
            overrides.name ?? "홍길동",
            "서울시 강남구",
            overrides.phone ?? "010-1234-5678",
            "A가-1형",
            15,
            "100000",
            "50000",
            "50000",
            overrides.startDate ?? new Date("2025-01-20"),
            overrides.endDate ?? new Date("2025-03-20"),
            false,
            true,
            "900101",
            "active",
            false,
            null
        );

    let scheduler: AlimtalkSchedulerService;
    let alimtalkService: ReturnType<typeof createMockAlimtalkService>;
    let clientRepository: ReturnType<typeof createMockClientRepository>;
    let branchRepository: ReturnType<typeof createMockBranchRepository>;

    beforeEach(() => {
        alimtalkService = createMockAlimtalkService();
        clientRepository = createMockClientRepository();
        branchRepository = createMockBranchRepository();

        scheduler = new AlimtalkSchedulerService(
            alimtalkService as unknown as AlimtalkService,
            createMockConfigService() as unknown as ConfigService,
            clientRepository as unknown as IClientRepository,
            branchRepository as unknown as IBranchRepository,
            createMockEmployeeScheduleRepository() as unknown as IEmployeeScheduleRepository,
            createMockEmployeeRepository() as unknown as IEmployeeRepository,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("checkContractReminders", () => {
        describe("given clients with service starting in 3 days", () => {
            it("should send 3-day reminder to each client", async () => {
                const clients = [
                    createMockClient({ id: 1, name: "김철수" }),
                    createMockClient({ id: 2, name: "이영희" }),
                ];
                clientRepository.findByStartDate.mockResolvedValueOnce(clients);
                clientRepository.findByStartDate.mockResolvedValueOnce([]);

                await scheduler.checkContractReminders();

                expect(alimtalkService.sendContractReminder3DaysAlimtalk).toHaveBeenCalledTimes(2);
                expect(alimtalkService.sendContractReminder3DaysAlimtalk).toHaveBeenCalledWith(
                    expect.objectContaining({ name: "김철수" }),
                    expect.any(String)
                );
            });
        });

        describe("given clients with service starting in 1 day", () => {
            it("should send 1-day reminder to each client", async () => {
                const client = createMockClient({ id: 3 });
                clientRepository.findByStartDate.mockResolvedValueOnce([]);
                clientRepository.findByStartDate.mockResolvedValueOnce([client]);

                await scheduler.checkContractReminders();

                expect(alimtalkService.sendContractReminder1DayAlimtalk).toHaveBeenCalledTimes(1);
            });
        });

        describe("given no clients found", () => {
            it("should not call any alimtalk methods", async () => {
                clientRepository.findByStartDate.mockResolvedValue([]);

                await scheduler.checkContractReminders();

                expect(alimtalkService.sendContractReminder3DaysAlimtalk).not.toHaveBeenCalled();
                expect(alimtalkService.sendContractReminder1DayAlimtalk).not.toHaveBeenCalled();
            });
        });

        describe("given alimtalk service fails for one client", () => {
            it("should continue processing other clients", async () => {
                const clients = [
                    createMockClient({ id: 1 }),
                    createMockClient({ id: 2 }),
                ];
                clientRepository.findByStartDate.mockResolvedValueOnce(clients);
                clientRepository.findByStartDate.mockResolvedValueOnce([]);
                alimtalkService.sendContractReminder3DaysAlimtalk
                    .mockRejectedValueOnce(new Error("API Error"))
                    .mockResolvedValueOnce(undefined);

                await expect(scheduler.checkContractReminders()).resolves.not.toThrow();
                expect(alimtalkService.sendContractReminder3DaysAlimtalk).toHaveBeenCalledTimes(2);
            });
        });
    });

    describe("checkSurveyRequests", () => {
        describe("given clients whose service ended yesterday", () => {
            it("should send survey request to each client", async () => {
                const client = createMockClient({
                    id: 1,
                    endDate: new Date("2025-01-14"),
                });
                clientRepository.findByEndDate.mockResolvedValue([client]);

                await scheduler.checkSurveyRequests();

                expect(alimtalkService.sendSurveyRequestAlimtalk).toHaveBeenCalledWith(
                    expect.objectContaining({ id: 1 }),
                    expect.any(String),
                    expect.any(String),
                    expect.any(String)
                );
            });
        });

        describe("given no clients found", () => {
            it("should not call survey alimtalk", async () => {
                clientRepository.findByEndDate.mockResolvedValue([]);

                await scheduler.checkSurveyRequests();

                expect(alimtalkService.sendSurveyRequestAlimtalk).not.toHaveBeenCalled();
            });
        });
    });

    describe("checkPaymentReminders", () => {
        describe("given clients registered 3 days ago", () => {
            it("should send 3-day payment reminder", async () => {
                const client = createMockClient({ id: 1 });
                clientRepository.findByCreatedDate
                    .mockResolvedValueOnce([client])
                    .mockResolvedValueOnce([]);

                await scheduler.checkPaymentReminders();

                expect(alimtalkService.sendPaymentReminderAlimtalk).toHaveBeenCalledWith(
                    expect.objectContaining({ id: 1 }),
                    expect.any(String),
                    3
                );
            });
        });

        describe("given clients registered 7 days ago", () => {
            it("should send 7-day payment reminder", async () => {
                const client = createMockClient({ id: 2 });
                clientRepository.findByCreatedDate
                    .mockResolvedValueOnce([])
                    .mockResolvedValueOnce([client]);

                await scheduler.checkPaymentReminders();

                expect(alimtalkService.sendPaymentReminderAlimtalk).toHaveBeenCalledWith(
                    expect.objectContaining({ id: 2 }),
                    expect.any(String),
                    7
                );
            });
        });

        describe("given repository throws an error", () => {
            it("should not throw and log error", async () => {
                branchRepository.findAllActive.mockRejectedValue(new Error("DB Error"));

                await expect(scheduler.checkPaymentReminders()).resolves.not.toThrow();
            });
        });
    });
});
