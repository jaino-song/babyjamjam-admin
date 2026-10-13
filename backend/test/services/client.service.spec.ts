import { BadRequestException, ConflictException, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { normalizeApiError, PROBLEM_CATALOG } from "@babyjamjam/shared/errors/problem-details";
import { mapHttpProblem, sendProblemResponse } from "../../infrastructure/filters/problem-response";

import { ClientService } from "../../application/services/client.service";
import { ServiceRecordLifecycleService } from "../../application/services/service-record-lifecycle.service";
import {
    CreateClientUsecase,
    DeleteClientUsecase,
    FindClientByIdUsecase,
    ListClientsPaginatedUsecase,
    ListClientsUsecase,
    UpdateClientUsecase,
} from "../../application/usecases/client";
import { LinkMirroredEformsignDocByPhoneUsecase } from "../../application/usecases/eformsign-doc";
import { MessageAutomationIntentService } from "../../application/services/message-automation-intent.service";
import { MessageTriggerService } from "../../application/services/message-trigger.service";
import { EformsignDocumentSnapshotService } from "../../application/services/eformsign-document-snapshot.service";
import { ServiceRecordLinkService } from "../../application/services/service-record-link.service";
import { SystemSettingService } from "../../application/services/system-setting.service";
import { ClientEntity } from "../../domain/entities/client.entity";
import { IClientRepository } from "../../domain/repositories/client.repository.interface";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { createKrBusinessDayCalendar, KOREAN_HOLIDAY_CALENDAR, KR_BUILTIN_CALENDAR } from "../../domain/utils/business-days";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";
import { findManyFrom, matchesWhere } from "../utils/prisma-where-evaluator";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";
import { clearSchemaCapabilityCache } from "infrastructure/database/schema-capabilities";
import { isActiveContractSignal } from "application/utils/current-contract-document";
import { legacyClientBadges } from "../../../packages/shared/src/client/badges";

/** A 2026 branch calendar: the built-in public holidays plus the given branch-added days off. */
const branchCalendar2026 = (extra: string[]) => createKrBusinessDayCalendar(
    [...(KOREAN_HOLIDAY_CALENDAR[2026] ?? []), ...extra],
    { supportedYears: [2026], version: "branch-test" },
);

describe("ClientService", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================
    
    const createMockCreateClientUsecase = () => ({
        execute: jest.fn(),
        executeWithInitialSchedule: jest.fn(),
    });

    const createMockUpdateClientUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockFindClientByIdUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockListClientsUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockListClientsPaginatedUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockDeleteClientUsecase = () => ({
        execute: jest.fn(),
    });

    const createDeferred = <T = void>() => {
        let resolve!: (value: T | PromiseLike<T>) => void;
        const promise = new Promise<T>((resolvePromise) => {
            resolve = resolvePromise;
        });
        return { promise, resolve };
    };

    const createMockPrismaService = () => {
        const prisma = {
            employee_schedule: {
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            },
            employee: {
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                findMany: jest.fn().mockImplementation(({ where }) =>
                    Promise.resolve(where.id.in.map((id: number) => ({
                        id,
                        name: `Employee ${id}`,
                        branchId: where.branchId ?? "org-1",
                        deletedAt: null,
                        openToNextWork: true,
                    }))),
                ),
            },
            client: {
                count: jest.fn().mockResolvedValue(0),
                update: jest.fn(),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findUnique: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
            },
            eformsign_doc: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            schedule_change_request: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            service_record_case: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            area: {
                findFirst: jest.fn().mockResolvedValue({ id: "incheon" }),
            },
            $queryRaw: jest.fn().mockResolvedValue([
                { id: 9 },
                { id: 10 },
                { id: 11 },
                { id: 12 },
            ]),
            $transaction: jest.fn(),
        };
        prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
        return prisma;
    };

    const createMockTriggerService = () => ({
        ensureDefaultRulesForBranch: jest.fn().mockResolvedValue(undefined),
        syncClientRulesForClient: jest.fn().mockResolvedValue(undefined),
        syncEmployeeAssignmentRulesForClient: jest.fn().mockResolvedValue(undefined),
        syncEmployeeAssignmentRulesForSchedule: jest.fn().mockResolvedValue(undefined),
        cancelPendingJobsForClientDeletion: jest.fn().mockResolvedValue(undefined),
    });

    const createMockServiceRecordLinkService = () => ({
        scheduleForServiceStart: jest.fn().mockResolvedValue(undefined),
        revoke: jest.fn().mockResolvedValue(undefined),
    });

    const createMockMessageAutomationIntentService = (
        triggerService: ReturnType<typeof createMockTriggerService>,
        serviceRecordLinkService: ReturnType<typeof createMockServiceRecordLinkService>,
    ) => ({
        persistClientIntent: jest.fn().mockResolvedValue(undefined),
        persistScheduleIntent: jest.fn().mockResolvedValue(undefined),
        fulfillClientIntent: jest.fn().mockImplementation(async (params: {
            branchId: string;
            clientId: number;
            includePast: boolean;
            suppressGreeting: boolean;
        }) => {
            await triggerService.ensureDefaultRulesForBranch(params.branchId);
            await triggerService.syncClientRulesForClient(
                params.branchId,
                params.clientId,
                params.includePast,
                params.suppressGreeting,
            );
            return true;
        }),
        fulfillScheduleIntent: jest.fn().mockImplementation(async (params: {
            branchId: string;
            scheduleId: number;
            includePast: boolean;
        }) => {
            await triggerService.syncEmployeeAssignmentRulesForSchedule(
                params.branchId,
                params.scheduleId,
                params.includePast,
            );
            await serviceRecordLinkService.scheduleForServiceStart(params.scheduleId);
            return true;
        }),
    });

    const createMockServiceRecordLifecycleService = () => ({
        validatePeriodChange: jest.fn().mockResolvedValue(undefined),
        ensureForClient: jest.fn().mockResolvedValue(undefined),
        resolveCalendarBeforeTransaction: jest.fn().mockResolvedValue(undefined),
        markTerminated: jest.fn().mockResolvedValue(undefined),
    });

    const createMockSystemSettingService = () => ({
        getClientAutoRegistrationEnabled: jest.fn().mockResolvedValue(true),
        getGreetingOnAutoRegistrationEnabled: jest.fn().mockResolvedValue(false),
    });

    const createMockConfigService = () => ({
        get: jest.fn().mockReturnValue(undefined),
    });

    const createMockDocumentSnapshotService = () => ({
        bumpVersion: jest.fn().mockResolvedValue(undefined),
        bumpCompanyEpoch: jest.fn().mockResolvedValue(undefined),
    });

    const createMockLinkMirroredDocumentByPhoneUsecase = () => ({
        execute: jest.fn().mockResolvedValue("no_match"),
    });

    const createMockClientRepository = (): jest.Mocked<IClientRepository> => ({
        findById: jest.fn(),
        findByIdForUpdate: jest.fn(),
        findAll: jest.fn(),
        findAllPaginated: jest.fn(),
        getListSummary: jest.fn(),
        create: jest.fn(),
        createWithInitialSchedule: jest.fn(),
        update: jest.fn(),
        updateServiceStatusIfCurrent: jest.fn().mockResolvedValue("updated"),
        updateIfTargetVersion: jest.fn(),
        delete: jest.fn(),
        findByStartDate: jest.fn(),
        findByEndDate: jest.fn(),
        findByCreatedDate: jest.fn(),
        findStartingWithinDays: jest.fn().mockResolvedValue([]),
        findEndingWithinDays: jest.fn().mockResolvedValue([]),
        findWithIncompleteContractsStartingWithinDays: jest.fn().mockResolvedValue([]),
        findWithoutContractSentStartingWithinDays: jest.fn().mockResolvedValue([]),
        findByPhone: jest.fn().mockResolvedValue(null),
        findPhoneMatches: jest.fn(async (branchId: string, phoneSuffixes: string[]) => {
            void branchId;
            void phoneSuffixes;
            return [];
        }),
        findNamesByIds: jest.fn().mockResolvedValue([]),
    });

    const createClientEntity = (): ClientEntity => new ClientEntity(
        1,
        "Test Client",
        "Test Address",
        "010-1234-5678",
        "A형",
        15,
        "100000",
        "50000",
        "50000",
        new Date("2024-01-01"),
        new Date("2024-06-01"),
        false,
        true,
        "900101",
        "pending",
        false,
        null,
        null, null, null, null, false, null, undefined,
        new Date("2024-01-01"),
    );

    const branchId = "org-1";

    const matchingContractDetail = (name = "Test Client", birthday = "1990-01-01") => ({
        id: "DOC-IDENTITY",
        recipients: [{ recipient_type: "05", name, sms: "01012345678" }],
        fields: [
            { id: "이용자 성명", value: name },
            { id: "이용자 생년월일", value: birthday },
            { id: "이용자 연락처", value: "01012345678" },
        ],
    });

    /** 계약-05: statuses a document may be in to be linked to a client automatically (spelled out on purpose). */
    const ELIGIBLE_LINK_STATUSES = [
        "002", "003", "010", "012", "020", "022", "030", "032", "041", "043",
        "050", "060", "062", "063", "064", "070", "072", "092",
        "040", "045", "071",
    ];

    /**
     * The client row as the phone-link transaction re-reads it under the client lock
     * (identity of the stored client, not of the caller's earlier snapshot).
     */
    const lockedClientRow = (
        client: Pick<ClientEntity, "phone" | "name" | "birthday">,
        overrides: Partial<{ phone: string | null; name: string | null; birthday: string | null }> = {},
    ) => ({
        phone: client.phone,
        name: client.name,
        birthday: client.birthday,
        ...overrides,
    });

    /** Public problem contract body carried by converted client pre-write throws. */
    const clientProblemResponse = (topCode: string, pointer: string, errorCode: string, detail: unknown) => ({
        code: topCode,
        params: {},
        outcome: "NOT_APPLIED",
        recovery: { action: "NONE", retry: { mode: "NEVER" } },
        errors: expect.arrayContaining([expect.objectContaining({
            pointer,
            code: errorCode,
            detail,
            location: "body",
        })]),
    });

    let service: ClientService;
    let createClientUsecase: ReturnType<typeof createMockCreateClientUsecase>;
    let updateClientUsecase: ReturnType<typeof createMockUpdateClientUsecase>;
    let findClientByIdUsecase: ReturnType<typeof createMockFindClientByIdUsecase>;
    let listClientsUsecase: ReturnType<typeof createMockListClientsUsecase>;
    let listClientsPaginatedUsecase: ReturnType<typeof createMockListClientsPaginatedUsecase>;
    let deleteClientUsecase: ReturnType<typeof createMockDeleteClientUsecase>;
    let prismaService: ReturnType<typeof createMockPrismaService>;
    let triggerService: ReturnType<typeof createMockTriggerService>;
    let messageAutomationIntentService: ReturnType<typeof createMockMessageAutomationIntentService>;
    let serviceRecordLinkService: ReturnType<typeof createMockServiceRecordLinkService>;
    let serviceRecordLifecycleService: ReturnType<typeof createMockServiceRecordLifecycleService>;
    let clientRepository: ReturnType<typeof createMockClientRepository>;
    let systemSettingService: ReturnType<typeof createMockSystemSettingService>;
    let configService: ReturnType<typeof createMockConfigService>;
    let documentSnapshotService: ReturnType<typeof createMockDocumentSnapshotService>;
    let linkMirroredDocumentByPhoneUsecase: ReturnType<typeof createMockLinkMirroredDocumentByPhoneUsecase>;
    let holidayCalendar: ReturnType<typeof createHolidayCalendarStub>;

    beforeEach(() => {
        createClientUsecase = createMockCreateClientUsecase();
        updateClientUsecase = createMockUpdateClientUsecase();
        findClientByIdUsecase = createMockFindClientByIdUsecase();
        listClientsUsecase = createMockListClientsUsecase();
        listClientsPaginatedUsecase = createMockListClientsPaginatedUsecase();
        deleteClientUsecase = createMockDeleteClientUsecase();
        prismaService = createMockPrismaService();
        triggerService = createMockTriggerService();
        serviceRecordLinkService = createMockServiceRecordLinkService();
        messageAutomationIntentService = createMockMessageAutomationIntentService(
            triggerService,
            serviceRecordLinkService,
        );
        serviceRecordLifecycleService = createMockServiceRecordLifecycleService();
        clientRepository = createMockClientRepository();
        systemSettingService = createMockSystemSettingService();
        configService = createMockConfigService();
        documentSnapshotService = createMockDocumentSnapshotService();
        linkMirroredDocumentByPhoneUsecase = createMockLinkMirroredDocumentByPhoneUsecase();
        holidayCalendar = createHolidayCalendarStub();

        service = new ClientService(
            createClientUsecase as unknown as CreateClientUsecase,
            findClientByIdUsecase as unknown as FindClientByIdUsecase,
            listClientsUsecase as unknown as ListClientsUsecase,
            listClientsPaginatedUsecase as unknown as ListClientsPaginatedUsecase,
            updateClientUsecase as unknown as UpdateClientUsecase,
            deleteClientUsecase as unknown as DeleteClientUsecase,
            prismaService as unknown as PrismaService,
            clientRepository,
            systemSettingService as unknown as SystemSettingService,
            documentSnapshotService as unknown as EformsignDocumentSnapshotService,
            messageAutomationIntentService as unknown as MessageAutomationIntentService,
            holidayCalendar, triggerService as unknown as MessageTriggerService,
            serviceRecordLinkService as unknown as ServiceRecordLinkService,
            serviceRecordLifecycleService as unknown as ServiceRecordLifecycleService,
            configService as unknown as ConfigService,
            linkMirroredDocumentByPhoneUsecase as unknown as LinkMirroredEformsignDocByPhoneUsecase,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // checkPhoneExists
    // ============================================
    describe("checkPhoneExists", () => {
        it("should check duplicate phones through the client repository only", async () => {
            const client = createClientEntity();
            clientRepository.findByPhone.mockResolvedValue(client);

            const result = await service.checkPhoneExists(branchId, "010-1234-5678");

            expect(result).toBe(true);
            expect(clientRepository.findByPhone).toHaveBeenCalledWith(branchId, "01012345678");
        });

        it("should return false without querying when the phone is invalid", async () => {
            const result = await service.checkPhoneExists(branchId, "1234");

            expect(result).toBe(false);
            expect(clientRepository.findByPhone).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        it("rejects malformed phone before settings, repository, or automation work", async () => {
            await expect(service.create(branchId, {
                name: "Malformed",
                phone: "not-a-phone",
                careCenter: false,
                voucherClient: false,
                breastPump: false,
            })).rejects.toMatchObject({
                status: 400,
                response: clientProblemResponse("VALIDATION_FAILED", "/phone", "INVALID_FORMAT", "연락처가 올바른 국내 전화번호 형식이 아닙니다."),
            });

            expect(systemSettingService.getClientAutoRegistrationEnabled).not.toHaveBeenCalled();
            expect(clientRepository.findByPhone).not.toHaveBeenCalled();
            expect(createClientUsecase.execute).not.toHaveBeenCalled();
            expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
        });

        it("allows an explicit null phone clear on create", async () => {
            const client = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(client);

            await expect(service.create(branchId, {
                name: "No Phone",
                phone: null,
                careCenter: false,
                voucherClient: false,
                breastPump: false,
                applyMessageAutomation: false,
            })).resolves.toBe(client);
            expect(createClientUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ phone: null }),
                expect.anything(),
                KR_BUILTIN_CALENDAR,
            );
        });

        describe("service-period duration", () => {
            // 2026-08-25 → 2026-09-14 is 15 Korean business days.
            const servicePeriod = { startDate: "2026-08-25", endDate: "2026-09-14" };
            const baseParams = {
                name: "Duration Client",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                applyMessageAutomation: false,
            };

            function createdDuration() {
                return createClientUsecase.execute.mock.calls[0]![1].duration;
            }

            it("derives the duration when the caller sends an explicit null alongside a complete service period", async () => {
                // A create has no prior value to clear, so a null duration is
                // the same "no opinion" the omitted case expresses. The client
                // form always sends null, so rejecting it blocked every
                // registration that carried both dates without a 서비스 기간.
                const client = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(client);

                await expect(service.create(branchId, {
                    ...baseParams,
                    ...servicePeriod,
                    duration: null,
                })).resolves.toBe(client);

                expect(createdDuration()).toBe(15);
            });

            it("derives the duration from the branch calendar, loaded fresh", async () => {
                // The branch adds 2026-08-26 off, so the same period holds 14 sessions, not 15.
                (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(branchCalendar2026(["2026-08-26"]));
                const client = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(client);

                await service.create(branchId, { ...baseParams, ...servicePeriod, duration: null });

                expect(holidayCalendar.forBranch).toHaveBeenCalledWith(branchId, { fresh: true });
                expect(createdDuration()).toBe(14);
            });

            it("derives the duration when the caller omits it entirely", async () => {
                const client = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(client);

                await service.create(branchId, { ...baseParams, ...servicePeriod });

                expect(createdDuration()).toBe(15);
            });

            it("keeps a supplied duration that fits inside the business-day count", async () => {
                const client = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(client);

                await service.create(branchId, { ...baseParams, ...servicePeriod, duration: 10 });

                expect(createdDuration()).toBe(10);
            });

            it("preserves a confirmed weekend-service duration and dates on create", async () => {
                createClientUsecase.execute.mockResolvedValue(createClientEntity());
                await service.create(branchId, {
                    ...baseParams, startDate: "2026-08-26", endDate: "2026-09-14",
                    duration: 15, allowBusinessDayMismatch: true,
                });
                expect(createClientUsecase.execute).toHaveBeenCalledWith(branchId, expect.objectContaining({
                    duration: 15, startDate: new Date("2026-08-26"), endDate: new Date("2026-09-14"),
                    allowBusinessDayMismatch: true,
                }), expect.anything(), KR_BUILTIN_CALENDAR);
            });

            it("still rejects a supplied duration that exceeds the business-day count", async () => {
                await expect(service.create(branchId, {
                    ...baseParams,
                    ...servicePeriod,
                    duration: 16,
                })).rejects.toMatchObject({
                    status: 400,
                    response: clientProblemResponse("CLIENT_DURATION_OUT_OF_RANGE", "/duration", "OUT_OF_RANGE", "서비스 기간은 1일 이상 15일 이하여야 합니다. (시작일~종료일 영업일 기준)"),
                });

                expect(createClientUsecase.execute).not.toHaveBeenCalled();
            });

            it("leaves the duration null when no service period was submitted", async () => {
                const client = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(client);

                await service.create(branchId, { ...baseParams, duration: null });

                expect(createdDuration()).toBeNull();
            });
        });

        describe("given valid client data with primary employee", () => {
            it("should create the client and employee schedule atomically", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const mockSchedule = { id: 10, clientId: 1 };
                createClientUsecase.executeWithInitialSchedule.mockResolvedValue({
                    client: mockClient,
                    scheduleId: mockSchedule.id,
                });

                const params = {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    address: "123 Main St",
                    phone: "010-1234-5678",
                    startDate: "2024-01-01",
                    endDate: "2024-06-01",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    reuseExistingClient: true,
                };

                // Act
                const result = await service.create(branchId, params);

                // Assert
                expect(createClientUsecase.executeWithInitialSchedule).toHaveBeenCalledWith(
                    branchId,
                    expect.objectContaining({
                        name: "New Client",
                        address: "123 Main St",
                    }),
                    expect.objectContaining({
                        primaryEmployeeId: 5,
                        secondaryEmployeeId: null,
                        workAddress: "123 Main St",
                    }),
                    expect.anything(),
                    KR_BUILTIN_CALENDAR,
                );
                expect(createClientUsecase.execute).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(10);
                expect(result).toBe(mockClient);
            });

            it("stores client and schedule recovery intents in the creation transaction", async () => {
                const mockClient = createClientEntity();
                createClientUsecase.executeWithInitialSchedule.mockResolvedValue({
                    client: mockClient,
                    scheduleId: 10,
                });

                await service.create(branchId, {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                });

                expect(messageAutomationIntentService.persistClientIntent).toHaveBeenCalledWith(
                    prismaService,
                    expect.objectContaining({
                        branchId,
                        clientId: mockClient.id,
                        includePast: true,
                    }),
                );
                expect(messageAutomationIntentService.persistScheduleIntent).toHaveBeenCalledWith(
                    prismaService,
                    expect.objectContaining({
                        branchId,
                        clientId: mockClient.id,
                        scheduleId: 10,
                        includePast: true,
                    }),
                );
            });

            it("fails the registration transaction when its recovery intent cannot be stored", async () => {
                const mockClient = createClientEntity();
                createClientUsecase.executeWithInitialSchedule.mockResolvedValue({
                    client: mockClient,
                    scheduleId: 10,
                });
                messageAutomationIntentService.persistScheduleIntent.mockRejectedValue(
                    new Error("intent storage failed"),
                );

                await expect(service.create(branchId, {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                })).rejects.toThrow("intent storage failed");

                expect(messageAutomationIntentService.fulfillClientIntent).not.toHaveBeenCalled();
                expect(messageAutomationIntentService.fulfillScheduleIntent).not.toHaveBeenCalled();
            });
        });

        describe("given valid client data without primary employee", () => {
            it("should create client and skip employee_schedule creation", async () => {
                // Arrange
                const mockClient = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(mockClient);

                const params = {
                    name: "New Client",
                    address: "123 Main St",
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    reuseExistingClient: true,
                };

                // Act
                const result = await service.create(branchId, params);

                // Assert
                expect(createClientUsecase.execute).toHaveBeenCalledWith(
                    branchId,
                    expect.objectContaining({
                        name: "New Client",
                        address: "123 Main St",
                    }),
                    expect.anything(),
                    KR_BUILTIN_CALENDAR,
                );
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(result).toBe(mockClient);
            });
        });

        it("should allow an areaId when the area belongs to the branch", async () => {
            // Arrange
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);

            const params = {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: null,
                voucherClient: true,
                breastPump: false,
                areaId: "incheon",
            };

            // Act
            await service.create(branchId, params);

            // Assert
            expect(prismaService.area.findFirst).toHaveBeenCalledWith({
                where: {
                    id: "incheon",
                    OR: [{ branchId }, { branchId: null }],
                },
                select: { id: true },
            });
            expect(createClientUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({
                    areaId: "incheon",
                    careCenter: null,
                }),
                expect.anything(),
                KR_BUILTIN_CALENDAR,
            );
        });

        it("calls ensureDefaultRulesForBranch then syncClientRulesForClient with suppressGreeting=false by default", async () => {
            // Arrange
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);

            const params = {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            };

            // Act
            await service.create(branchId, params);

            // Assert
            expect(triggerService.ensureDefaultRulesForBranch).toHaveBeenCalledWith(branchId);
            expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
                branchId,
                mockClient.id,
                true,
                false,
            );
        });

        const phoneLinkQueries = () =>
            prismaService.$queryRaw.mock.calls.map(([query]) => query as Prisma.Sql);
        const phoneLinkQueryKind = (query: { sql: string }) => {
            if (query.sql.includes("UNION")) return "owners";
            if (query.sql.includes("FROM client") && query.sql.includes("FOR UPDATE")) return "client-lock";
            if (query.sql.includes("eformsign_doc AS doc") && query.sql.includes("FOR UPDATE")) return "document-lock";
            return "other";
        };

        it.each([false, true])("saves without linking a different-name contract through create (reuse=%s)", async (reuse) => {
            const mockClient = createClientEntity();
            if (reuse) clientRepository.findByPhone.mockResolvedValue(mockClient);
            else createClientUsecase.execute.mockResolvedValue(mockClient);
            prismaService.eformsign_doc.findMany
                .mockResolvedValueOnce([{
                    id: 11,
                    documentId: "DOC-DIFFERENT-NAME",
                    clientId: null,
                    branchId,
                    customerPhone: "01012345678",
                    detailPayload: matchingContractDetail("Other Client"),
                }])
                .mockResolvedValue([]);

            await expect(service.create(branchId, {
                name: "Test Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                reuseExistingClient: reuse,
            })).resolves.toBe(mockClient);

            expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
            expect(linkMirroredDocumentByPhoneUsecase.execute).not.toHaveBeenCalled();
            expect(mockClient.eDocId).toBeNull();
            expect(documentSnapshotService.bumpVersion).not.toHaveBeenCalled();
            expect(serviceRecordLifecycleService.ensureForClient).toHaveBeenCalled();
        });

        it("links every matching contract by normalized phone after manual client creation", async () => {
            const branchId = "11111111-1111-1111-1111-111111111111";
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);
            prismaService.eformsign_doc.updateMany.mockResolvedValue({ count: 2 });
            prismaService.client.findUnique.mockResolvedValue(lockedClientRow(mockClient));
            prismaService.eformsign_doc.findMany.mockResolvedValue([
                {
                    id: 11,
                    documentId: "DOC-LATEST",
                    clientId: null,
                    branchId: null,
                    statusType: "060",
                    detailPayload: matchingContractDetail(),
                    stepRecipientSms: "고객 010-1234-5678",
                },
                {
                    id: 10,
                    documentId: "DOC-OLDER",
                    clientId: null,
                    branchId,
                    statusType: "060",
                    detailPayload: matchingContractDetail(),
                    stepRecipientSms: "연락처 +82 10 1234 5678",
                },
                {
                    id: 9,
                    documentId: "DOC-OTHER",
                    clientId: null,
                    branchId: null,
                    stepRecipientSms: "010-9999-5678",
                },
            ]);
            prismaService.client.findMany.mockResolvedValue([{
                id: mockClient.id,
                branchId,
                phone: mockClient.phone,
            }]);

            await service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            });

            expect(prismaService.eformsign_doc.findMany).toHaveBeenCalledWith({
                where: {
                    serviceRecordCaseId: null,
                    permanentPurgeRequestedAt: null,
                    statusType: { notIn: ["047", "049", "099"] },
                    syncStatus: "ready",
                    detailSourceUpdatedDate: { not: null },
                    detailSyncedAt: { not: null },
                    OR: [
                        { customerPhone: "01012345678" },
                        {
                            customerPhone: null,
                            stepRecipientSms: { contains: "5678" },
                        },
                    ],
                    AND: [
                        {
                            OR: [
                                { branchId },
                                { branchId: null, clientId: null },
                            ],
                        },
                        {
                            OR: [
                                { documentKind: "contract" },
                                { documentKind: null },
                            ],
                        },
                    ],
                },
                orderBy: [
                    { createdDate: "desc" },
                    { id: "desc" },
                ],
                select: {
                    id: true,
                    documentId: true,
                    clientId: true,
                    branchId: true,
                    documentKind: true,
                    serviceRecordCaseId: true,
                    templateId: true,
                    stepRecipientSms: true,
                    customerPhone: true,
                    detailPayload: true,
                    detailSourceUpdatedDate: true,
                    detailSyncedAt: true,
                    statusType: true,
                },
            });
            expect(prismaService.eformsign_doc.updateMany).toHaveBeenCalledWith({
                where: {
                    id: { in: [11, 10] },
                    permanentPurgeRequestedAt: null,
                    statusType: { in: ELIGIBLE_LINK_STATUSES },
                    syncStatus: "ready",
                    detailSourceUpdatedDate: { not: null },
                    detailSyncedAt: { not: null },
                    OR: [
                        { branchId },
                        { branchId: null, clientId: null },
                    ],
                },
                data: {
                    branchId,
                    clientId: mockClient.id,
                    documentKind: "contract",
                },
            });
            expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                where: {
                    id: mockClient.id,
                    branchId,
                },
                data: { eDocId: "DOC-LATEST" },
            });
            expect(mockClient.eDocId).toBe("DOC-LATEST");
            const lockQuery = phoneLinkQueries().find((query) => phoneLinkQueryKind(query) === "document-lock")!;
            expect(lockQuery.sql).toContain("ORDER BY doc.id");
            expect(lockQuery.strings.join(" ")).toMatch(/doc\.branch_id\s*=\s*::uuid/);
            expect(lockQuery.text).toMatch(/\$\d+::uuid/);
            expect(documentSnapshotService.bumpVersion).toHaveBeenCalledWith(branchId);
            expect(documentSnapshotService.bumpCompanyEpoch).toHaveBeenCalledTimes(1);
        });

        describe("phone-link lock order (client rows before document rows)", () => {
            const CREATE_DTO = {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            };

            /** Both documents are unowned; other clients may retain stale pointers. */
            const arrangeCandidates = () => {
                const mockClient = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(mockClient);
                prismaService.eformsign_doc.updateMany.mockResolvedValue({ count: 2 });
                prismaService.client.findUnique.mockResolvedValue(lockedClientRow(mockClient));
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    {
                        id: 11,
                        documentId: "DOC-LATEST",
                        clientId: null,
                        branchId: null,
                        statusType: "060",
                        detailPayload: matchingContractDetail(),
                        stepRecipientSms: "고객 010-1234-5678",
                    },
                    {
                        id: 10,
                        documentId: "DOC-OLDER",
                        clientId: null,
                        branchId,
                        statusType: "060",
                        detailPayload: matchingContractDetail(),
                        stepRecipientSms: "연락처 +82 10 1234 5678",
                    },
                ]);
                prismaService.client.findMany.mockResolvedValue([{
                    id: mockClient.id,
                    branchId,
                    phone: mockClient.phone,
                }]);
                return mockClient;
            };

            /** `owners` answers each owner/pointer read in order; the last answer repeats. */
            const arrangeQueries = (owners: number[][]) => {
                let ownerReads = 0;
                prismaService.$queryRaw.mockImplementation(async (query: { sql: string }) => {
                    switch (phoneLinkQueryKind(query)) {
                        case "owners": {
                            const answer = owners[Math.min(ownerReads, owners.length - 1)]!;
                            ownerReads += 1;
                            return answer.map((id) => ({ id }));
                        }
                        case "document-lock":
                            return [{ id: 10 }, { id: 11 }];
                        default:
                            return [];
                    }
                });
            };

            it("locks the target, every owner and every pointer client in id order before the documents", async () => {
                const mockClient = arrangeCandidates();
                // 99 and 55 retain pointers to unowned documents; the target is client 1.
                arrangeQueries([[99, 55]]);

                await service.create(branchId, CREATE_DTO);

                const queries = phoneLinkQueries();
                expect(queries.map(phoneLinkQueryKind)).toEqual([
                    "owners", "client-lock", "document-lock", "owners",
                ]);
                const clientLock = queries.find((query) => phoneLinkQueryKind(query) === "client-lock")!;
                expect(clientLock.sql).toContain("ORDER BY id");
                expect(clientLock.values).toEqual([mockClient.id, 55, 99]);
                const documentLock = queries.find((query) => phoneLinkQueryKind(query) === "document-lock")!;
                expect(documentLock.values).toEqual([10, 11, branchId]);
                // Nothing is written before both lock groups are held.
                expect(prismaService.eformsign_doc.updateMany).toHaveBeenCalledTimes(1);
                // The other locked pointer clients (99, 55) are released from the documents
                // that move to the target first; only then does the target take the pointer.
                expect(prismaService.client.updateMany.mock.calls).toEqual([
                    [{
                        where: {
                            id: { in: [55, 99] },
                            branchId,
                            eDocId: { in: ["DOC-LATEST", "DOC-OLDER"] },
                        },
                        data: { eDocId: null },
                    }],
                    [{
                        where: { id: mockClient.id, branchId },
                        data: { eDocId: "DOC-LATEST" },
                    }],
                ]);
                expect(mockClient.eDocId).toBe("DOC-LATEST");
            });

            it.each([false, true])("preserves a newly owned document under the lock (lock-set retry=%s) and saves the client", async (retry) => {
                const mockClient = arrangeCandidates();
                const candidate = {
                    id: 11,
                    documentId: "DOC-LATEST",
                    clientId: null,
                    branchId,
                    customerPhone: "01012345678",
                    statusType: "060",
                    detailPayload: matchingContractDetail(),
                    detailSourceUpdatedDate: new Date("2026-07-30T00:00:00Z"),
                    detailSyncedAt: new Date("2026-07-30T00:01:00Z"),
                };
                prismaService.eformsign_doc.findMany
                    .mockResolvedValueOnce([candidate])
                    .mockResolvedValue([{ ...candidate, clientId: 77 }]);
                prismaService.eformsign_doc.updateMany.mockResolvedValue({ count: 1 });
                // A new owner forces a retry if it was absent from the initial client lock set.
                arrangeQueries(retry ? [[99], [99, 77], [99, 77], [99, 77]] : [[99, 77]]);

                await expect(service.create(branchId, CREATE_DTO)).resolves.toBe(mockClient);

                const queries = phoneLinkQueries();
                expect(queries.filter((query) => phoneLinkQueryKind(query) === "document-lock")).toHaveLength(retry ? 2 : 1);
                const clientLocks = queries.filter((query) => phoneLinkQueryKind(query) === "client-lock");
                expect(clientLocks.map((query) => query.values)).toEqual(retry ? [
                    [mockClient.id, 99],
                    [mockClient.id, 77, 99],
                ] : [[mockClient.id, 77, 99]]);
                expect(prismaService.eformsign_doc.findMany).toHaveBeenNthCalledWith(
                    2,
                    expect.objectContaining({ select: expect.objectContaining({ clientId: true }) }),
                );
                expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
                expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                expect(documentSnapshotService.bumpVersion).not.toHaveBeenCalled();
                expect(mockClient.eDocId).toBeNull();
            });

            it("releases another client's pointer even when the latest document already belongs to the target", async () => {
                const mockClient = arrangeCandidates();
                // DOC-LATEST is already the target's document, yet client 55 still points at it:
                // setting the target's pointer would raise P2002 on the unique e_doc_id.
                prismaService.eformsign_doc.findMany.mockResolvedValue([{
                    id: 11,
                    documentId: "DOC-LATEST",
                    clientId: mockClient.id,
                    branchId,
                    stepRecipientSms: "고객 010-1234-5678",
                }]);
                arrangeQueries([[55]]);

                await service.create(branchId, CREATE_DTO);

                expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
                expect(prismaService.client.updateMany.mock.calls).toEqual([
                    [{
                        where: { id: { in: [55] }, branchId, eDocId: { in: ["DOC-LATEST"] } },
                        data: { eDocId: null },
                    }],
                    [{
                        where: { id: mockClient.id, branchId },
                        data: { eDocId: "DOC-LATEST" },
                    }],
                ]);
                expect(mockClient.eDocId).toBe("DOC-LATEST");
            });

            it("writes no client other than the target when no other client is in the locked set", async () => {
                const mockClient = arrangeCandidates();
                arrangeQueries([[]]);

                await service.create(branchId, CREATE_DTO);

                expect(prismaService.client.updateMany.mock.calls).toEqual([
                    [{
                        where: { id: mockClient.id, branchId },
                        data: { eDocId: "DOC-LATEST" },
                    }],
                ]);
            });

            it("gives up after three stale attempts, writes nothing and logs the phone-link failure", async () => {
                const mockClient = arrangeCandidates();
                // Every attempt finds one more owner after the document lock than it locked before.
                const answers = [[99], [99, 70], [99, 70], [99, 70, 71], [99, 70, 71], [99, 70, 71, 72]];
                arrangeQueries(answers);
                const errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation();

                try {
                    await expect(service.create(branchId, CREATE_DTO)).resolves.toBe(mockClient);

                    expect(phoneLinkQueries().filter((query) => phoneLinkQueryKind(query) === "document-lock")).toHaveLength(3);
                    expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
                    expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                    expect(documentSnapshotService.bumpVersion).not.toHaveBeenCalled();
                    expect(mockClient.eDocId).toBeNull();
                    expect(errorLog).toHaveBeenCalledWith(
                        expect.stringContaining("[CLIENT_CONTRACT_PHONE_LINK_FAILED]"),
                    );
                } finally {
                    errorLog.mockRestore();
                }
            });
        });

        it("links a matching partial contract to a client created after mirror ingestion", async () => {
            const branchId = "11111111-1111-1111-1111-111111111111";
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);
            prismaService.eformsign_doc.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{
                    documentId: "DOC-PARTIAL",
                    branchId: null,
                }]);
            linkMirroredDocumentByPhoneUsecase.execute.mockResolvedValue("linked");
            prismaService.client.findUnique.mockResolvedValue({
                eDocId: "DOC-PARTIAL",
            });

            await service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            });

            expect(linkMirroredDocumentByPhoneUsecase.execute).toHaveBeenCalledWith(
                "DOC-PARTIAL",
                {
                    linkExistingOnly: true,
                    existingClientId: mockClient.id,
                    existingClientBranchId: branchId,
                },
            );
            expect(prismaService.eformsign_doc.findMany).toHaveBeenNthCalledWith(2, {
                where: {
                    serviceRecordCaseId: null,
                    permanentPurgeRequestedAt: null,
                    statusType: { notIn: ["047", "049", "099"] },
                    syncStatus: { not: "ready" },
                    OR: [
                        { customerPhone: "01012345678" },
                        {
                            customerPhone: null,
                            stepRecipientSms: { contains: "5678" },
                        },
                    ],
                    AND: [
                        {
                            OR: [
                                { branchId },
                                { branchId: null, clientId: null },
                            ],
                        },
                        {
                            OR: [
                                { documentKind: "contract" },
                                { documentKind: null },
                            ],
                        },
                    ],
                },
                orderBy: [
                    { createdDate: "desc" },
                    { id: "desc" },
                ],
                select: {
                    documentId: true,
                    branchId: true,
                },
            });
            expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
            expect(prismaService.client.findUnique).toHaveBeenCalledWith({
                where: { id: mockClient.id },
                select: { eDocId: true },
            });
            expect(mockClient.eDocId).toBe("DOC-PARTIAL");
            expect(documentSnapshotService.bumpVersion).toHaveBeenCalledWith(branchId);
            expect(documentSnapshotService.bumpCompanyEpoch).toHaveBeenCalledTimes(1);
        });

        it.each(["ambiguous", "needs_confirmation"])("does not refresh the client pointer or snapshots when a partial contract returns %s", async (result) => {
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);
            prismaService.eformsign_doc.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{
                    documentId: "DOC-PARTIAL",
                    branchId: null,
                }]);
            linkMirroredDocumentByPhoneUsecase.execute.mockResolvedValue(result);

            await expect(service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            })).resolves.toBe(mockClient);

            expect(prismaService.client.findUnique).not.toHaveBeenCalled();
            expect(mockClient.eDocId).toBeNull();
            expect(documentSnapshotService.bumpVersion).not.toHaveBeenCalled();
            expect(documentSnapshotService.bumpCompanyEpoch).not.toHaveBeenCalled();
        });

        it("does not reassign a contract when its mirror generation is no longer ready", async () => {
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);
            prismaService.eformsign_doc.findMany.mockResolvedValue([
                {
                    id: 11,
                    documentId: "DOC-PURGED",
                    clientId: null,
                    branchId: null,
                    statusType: "060",
                    detailPayload: matchingContractDetail(),
                    stepRecipientSms: "고객 010-1234-5678",
                },
            ]);
            prismaService.client.findMany.mockResolvedValue([{
                id: mockClient.id,
                branchId,
                phone: mockClient.phone,
            }]);
            prismaService.$queryRaw.mockResolvedValue([]);

            await service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            });

            expect(phoneLinkQueries().map(phoneLinkQueryKind)).toEqual([
                "owners", "client-lock", "document-lock", "owners",
            ]);
            expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
            expect(mockClient.eDocId).toBeNull();
            expect(documentSnapshotService.bumpVersion).not.toHaveBeenCalled();
        });

        it("does not link a pre-lock phone candidate after its mirrored recipient changes", async () => {
            const mockClient = createClientEntity();
            const initialSourceUpdatedAt = new Date("2026-07-30T00:00:00.000Z");
            const initialSyncedAt = new Date("2026-07-30T00:01:00.000Z");
            createClientUsecase.execute.mockResolvedValue(mockClient);
            prismaService.eformsign_doc.findMany
                .mockResolvedValueOnce([{
                    id: 11,
                    documentId: "DOC-RECIPIENT-CHANGED",
                    clientId: null,
                    branchId: null,
                    statusType: "060",
                    documentKind: null,
                    serviceRecordCaseId: null,
                    templateId: null,
                    customerPhone: "01012345678",
                    stepRecipientSms: "고객 010-1234-5678",
                    detailPayload: matchingContractDetail(),
                    detailSourceUpdatedDate: initialSourceUpdatedAt,
                    detailSyncedAt: initialSyncedAt,
                }])
                .mockResolvedValueOnce([{
                    id: 11,
                    documentKind: null,
                    serviceRecordCaseId: null,
                    templateId: null,
                    customerPhone: "01099998888",
                    stepRecipientSms: "고객 010-9999-8888",
                    detailPayload: null,
                    detailSourceUpdatedDate: new Date("2026-07-30T00:02:00.000Z"),
                    detailSyncedAt: new Date("2026-07-30T00:03:00.000Z"),
                }]);
            prismaService.client.findMany.mockResolvedValue([{
                id: mockClient.id,
                branchId,
                phone: mockClient.phone,
            }]);
            prismaService.$queryRaw.mockResolvedValue([{ id: 11 }]);

            await service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            });

            expect(prismaService.eformsign_doc.findMany).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({ where: { id: { in: [11] } } }),
            );
            expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
            expect(mockClient.eDocId).toBeNull();
            expect(documentSnapshotService.bumpVersion).not.toHaveBeenCalled();
        });

        it("does not link a phone-stable candidate after its mirror generation changes", async () => {
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);
            prismaService.eformsign_doc.findMany
                .mockResolvedValueOnce([{
                    id: 11,
                    documentId: "DOC-GENERATION-CHANGED",
                    clientId: null,
                    branchId: null,
                    statusType: "060",
                    documentKind: null,
                    serviceRecordCaseId: null,
                    templateId: null,
                    customerPhone: "01012345678",
                    stepRecipientSms: "고객 010-1234-5678",
                    detailPayload: matchingContractDetail(),
                    detailSourceUpdatedDate: new Date("2026-07-30T00:00:00.000Z"),
                    detailSyncedAt: new Date("2026-07-30T00:01:00.000Z"),
                }])
                .mockResolvedValueOnce([{
                    id: 11,
                    documentKind: null,
                    serviceRecordCaseId: null,
                    templateId: null,
                    customerPhone: "01012345678",
                    stepRecipientSms: "고객 010-1234-5678",
                    detailPayload: null,
                    detailSourceUpdatedDate: new Date("2026-07-30T00:02:00.000Z"),
                    detailSyncedAt: new Date("2026-07-30T00:03:00.000Z"),
                }]);
            prismaService.client.findMany.mockResolvedValue([{
                id: mockClient.id,
                branchId,
                phone: mockClient.phone,
            }]);
            prismaService.$queryRaw.mockResolvedValue([{ id: 11 }]);

            await service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            });

            expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
            expect(mockClient.eDocId).toBeNull();
            expect(documentSnapshotService.bumpVersion).not.toHaveBeenCalled();
        });

        it("does not claim a legacy service-record document whose kind has not been backfilled", async () => {
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);
            configService.get.mockImplementation((key: string) =>
                key === "EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"
                    ? "service-record-template"
                    : undefined,
            );
            prismaService.eformsign_doc.findMany.mockResolvedValue([
                {
                    id: 11,
                    documentId: "SERVICE-RECORD-LEGACY",
                    clientId: null,
                    branchId: null,
                    statusType: "060",
                    documentKind: null,
                    serviceRecordCaseId: null,
                    templateId: "service-record-template",
                    stepRecipientSms: "고객 010-1234-5678",
                    customerPhone: "01012345678",
                    detailPayload: matchingContractDetail(),
                },
            ]);

            await service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            });

            expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
        });

        it("calls ensureDefaultRulesForBranch then syncClientRulesForClient with suppressGreeting=true when suppressGreetingSms is set", async () => {
            // Arrange
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);

            const params = {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                suppressGreetingSms: true,
            };

            // Act
            await service.create(branchId, params);

            // Assert
            expect(triggerService.ensureDefaultRulesForBranch).toHaveBeenCalledWith(branchId);
            expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
                branchId,
                mockClient.id,
                true,
                true,
            );
        });

        it("does not apply automatic message routines when applyMessageAutomation is false", async () => {
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);

            await service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                applyMessageAutomation: false,
            });

            expect(triggerService.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
            expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
            expect(messageAutomationIntentService.persistClientIntent).not.toHaveBeenCalled();
            expect(messageAutomationIntentService.persistScheduleIntent).not.toHaveBeenCalled();
        });

        it("does not schedule assignment or service-record messages when message automation is false", async () => {
            const mockClient = createClientEntity();
            createClientUsecase.executeWithInitialSchedule.mockResolvedValue({
                client: mockClient,
                scheduleId: 42,
            });

            await service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                primaryEmployeeId: 7,
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                applyMessageAutomation: false,
            });

            expect(triggerService.syncEmployeeAssignmentRulesForSchedule).not.toHaveBeenCalled();
            expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            expect(messageAutomationIntentService.persistClientIntent).not.toHaveBeenCalled();
            expect(messageAutomationIntentService.persistScheduleIntent).not.toHaveBeenCalled();
        });

        it("rejects a duplicate phone unless reuseExistingClient is explicitly enabled", async () => {
            clientRepository.findByPhone.mockResolvedValue(createClientEntity());

            await expect(service.create(branchId, {
                name: "Duplicate Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            })).rejects.toMatchObject({
                status: 409,
                response: clientProblemResponse("CLIENT_PHONE_ALREADY_REGISTERED", "/phone", "INVALID_VALUE", "같은 전화번호의 고객이 이미 등록되어 있습니다."),
            });
        });

        it("rejects contract auto registration when the branch setting is disabled", async () => {
            systemSettingService.getClientAutoRegistrationEnabled.mockResolvedValue(false);

            await expect(service.create(branchId, {
                name: "Auto Client",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                source: "contract_auto_registration",
            })).rejects.toThrow("자동 고객 등록이 꺼져 있습니다. 고객을 먼저 등록한 뒤 계약서를 생성해 주세요.");
        });

        it.each([
            [false, true],
            [true, false],
        ])("persists suppressGreetingSms=%s when auto-registration greeting enabled=%s", async (greetingEnabled, expectedSuppressed) => {
            const client = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(client);
            systemSettingService.getGreetingOnAutoRegistrationEnabled.mockResolvedValue(greetingEnabled);

            await service.create(branchId, {
                name: "Auto Client",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                source: "contract_auto_registration",
                suppressGreetingSms: greetingEnabled,
            });

            expect(createClientUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ suppressGreetingSms: expectedSuppressed }),
                expect.anything(),
                KR_BUILTIN_CALENDAR,
            );
            expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
                branchId,
                client.id,
                true,
                expectedSuppressed,
            );
        });

        it("rejects a service period whose end date precedes its start date", async () => {
            await expect(service.create(branchId, {
                name: "Invalid Period",
                startDate: "2026-07-18",
                endDate: "2026-07-17",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            })).rejects.toMatchObject({
            status: 400,
            response: clientProblemResponse("CLIENT_SERVICE_PERIOD_INVALID", "/endDate", "INVALID_VALUE", "서비스 시작일은 종료일보다 늦을 수 없습니다."),
        });
        });

        it("does not resolve client creation before automatic message jobs are synchronized", async () => {
            const mockClient = createClientEntity();
            const syncCompletion = createDeferred();
            const syncStarted = createDeferred();
            createClientUsecase.execute.mockResolvedValue(mockClient);
            triggerService.syncClientRulesForClient.mockImplementation(() => {
                syncStarted.resolve();
                return syncCompletion.promise;
            });

            let resolved = false;
            const creation = service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            });
            void creation.then(() => {
                resolved = true;
            });

            await syncStarted.promise;
            await Promise.resolve();
            expect(resolved).toBe(false);

            syncCompletion.resolve();
            await expect(creation).resolves.toBe(mockClient);
        });

        describe("given client data with both primary and secondary employees", () => {
            it("should create single schedule with both employees", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const mockSchedule = { id: 10, clientId: 1 };
                createClientUsecase.executeWithInitialSchedule.mockResolvedValue({
                    client: mockClient,
                    scheduleId: mockSchedule.id,
                });

                const params = {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: 6,
                    address: "123 Main St",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                };

                // Act
                await service.create(branchId, params);

                // Assert
                expect(createClientUsecase.executeWithInitialSchedule).toHaveBeenCalledWith(
                    branchId,
                    expect.any(Object),
                    expect.objectContaining({
                        primaryEmployeeId: 5,
                        secondaryEmployeeId: 6,
                    }),
                    expect.anything(),
                    KR_BUILTIN_CALENDAR,
                );
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(10);
            });
        });

        describe("phone deduplication (reuse-existing)", () => {
            it("rejects unconfirmed duplicate-phone creation with the public conflict code and no clientId payload", async () => {
                const existingClient = createClientEntity();
                clientRepository.findByPhone.mockResolvedValue(existingClient);

                const error: unknown = await service.create(branchId, {
                    name: "New Client",
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                }).catch((caught: unknown) => caught);
                expect(error).toMatchObject({
                    status: 409,
                    response: clientProblemResponse("CLIENT_PHONE_ALREADY_REGISTERED", "/phone", "INVALID_VALUE", "같은 전화번호의 고객이 이미 등록되어 있습니다."),
                });
                // 소비자는 코드로 중복을 식별한다: 레거시 clientId 페이로드는 일부러 제거된다.
                expect((error as { response: Record<string, unknown> }).response["clientId"]).toBeUndefined();
            });

            it("reuses the existing client when a client with the same normalized phone already exists in the branch", async () => {
                // Arrange
                const existingClient = createClientEntity();
                clientRepository.findByPhone.mockResolvedValue(existingClient);

                const params = {
                    name: "New Client",
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    reuseExistingClient: true,
                };

                // Act
                const result = await service.create(branchId, params);

                // Assert: returns the existing client unchanged
                expect(result).toBe(existingClient);
                // Assert: no new client was created
                expect(createClientUsecase.execute).not.toHaveBeenCalled();
                expect(clientRepository.create).not.toHaveBeenCalled();
                // Assert: no side-effects fired
                expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
            });

            it("initializes the service-record lifecycle when reusing a client without an assignment", async () => {
                const existingClient = createClientEntity();
                clientRepository.findByPhone.mockResolvedValue(existingClient);

                await service.create(branchId, {
                    name: "Existing Client",
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    reuseExistingClient: true,
                });

                expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
                expect(serviceRecordLifecycleService.ensureForClient).toHaveBeenCalledWith(
                    existingClient.id,
                    prismaService,
                    KR_BUILTIN_CALENDAR,
                );
            });

            it("links matching contracts when reusing an existing client by phone", async () => {
                const existingClient = createClientEntity();
                clientRepository.findByPhone.mockResolvedValue(existingClient);
                prismaService.eformsign_doc.updateMany.mockResolvedValue({ count: 1 });
                prismaService.client.findUnique.mockResolvedValue(lockedClientRow(existingClient));
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    {
                        id: 9,
                        documentId: "DOC-0009",
                        clientId: null,
                        statusType: "060",
                        detailPayload: matchingContractDetail(),
                        stepRecipientSms: "고객 010-1234-5678",
                    },
                ]);

                await service.create(branchId, {
                    name: "Existing",
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    reuseExistingClient: true,
                });

                expect(prismaService.eformsign_doc.updateMany).toHaveBeenCalledWith({
                    where: {
                        id: { in: [9] },
                        permanentPurgeRequestedAt: null,
                        statusType: { in: ELIGIBLE_LINK_STATUSES },
                        syncStatus: "ready",
                        detailSourceUpdatedDate: { not: null },
                        detailSyncedAt: { not: null },
                        OR: [
                            { branchId },
                            { branchId: null, clientId: null },
                        ],
                    },
                    data: {
                        branchId,
                        clientId: existingClient.id,
                        documentKind: "contract",
                    },
                });
                expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                    where: {
                        id: existingClient.id,
                        branchId,
                    },
                    data: { eDocId: "DOC-0009" },
                });
                expect(existingClient.eDocId).toBe("DOC-0009");
            });

            it("creates the missing assignment when a duplicate client is reused with a selected employee", async () => {
                const existingClient = createClientEntity();
                clientRepository.findByPhone.mockResolvedValue(existingClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue(null);
                prismaService.employee_schedule.create.mockResolvedValue({ id: 33, clientId: existingClient.id });

                const result = await service.create(branchId, {
                    name: "New Client",
                    phone: "010-1234-5678",
                    primaryEmployeeId: 5,
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    reuseExistingClient: true,
                });

                expect(result).toBe(existingClient);
                expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: existingClient.id,
                        branchId,
                        primaryEmployeeId: 5,
                        replaced: false,
                    }),
                });
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(33);
            });

            it("preserves the automation opt-out when reuse creates a missing assignment", async () => {
                const existingClient = createClientEntity();
                clientRepository.findByPhone.mockResolvedValue(existingClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue(null);
                prismaService.employee_schedule.create.mockResolvedValue({
                    id: 33,
                    clientId: existingClient.id,
                });

                await service.create(branchId, {
                    name: "Existing Client",
                    phone: "010-1234-5678",
                    primaryEmployeeId: 5,
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    reuseExistingClient: true,
                    applyMessageAutomation: false,
                });

                expect(prismaService.employee_schedule.create).toHaveBeenCalled();
                expect(triggerService.syncEmployeeAssignmentRulesForSchedule).not.toHaveBeenCalled();
                expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            });

            it("rejects an employee that does not belong to the client branch", async () => {
                prismaService.employee.findMany.mockResolvedValue([]);

                await expect(service.create(branchId, {
                    name: "New Client",
                    primaryEmployeeId: 999,
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                })).rejects.toMatchObject({ response: { code: "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE" } });

                expect(createClientUsecase.execute).not.toHaveBeenCalled();
                expect(createClientUsecase.executeWithInitialSchedule).not.toHaveBeenCalled();
            });

            it("activates selected unavailable employees and creates the client in one transaction after confirmation", async () => {
                const mockClient = createClientEntity();
                createClientUsecase.executeWithInitialSchedule.mockResolvedValue({
                    client: mockClient,
                    scheduleId: 10,
                });
                prismaService.employee.findMany
                    .mockResolvedValueOnce([
                        { id: 5, name: "Employee 5", branchId, deletedAt: null, openToNextWork: false },
                        { id: 6, name: "Employee 6", branchId, deletedAt: null, openToNextWork: false },
                    ])
                    .mockResolvedValueOnce([
                        { id: 5, name: "Employee 5", branchId, deletedAt: null, openToNextWork: true },
                        { id: 6, name: "Employee 6", branchId, deletedAt: null, openToNextWork: true },
                    ]);

                await service.create(branchId, {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: 6,
                    confirmedUnavailableEmployeeIds: [5, 6],
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                });

                expect(prismaService.employee.updateMany).toHaveBeenCalledWith({
                    where: {
                        id: { in: [5, 6] },
                        branchId,
                        deletedAt: null,
                        openToNextWork: false,
                    },
                    data: { openToNextWork: true },
                });
                expect(prismaService.employee.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
                    createClientUsecase.executeWithInitialSchedule.mock.invocationCallOrder[0]!,
                );
                expect(createClientUsecase.executeWithInitialSchedule).toHaveBeenCalled();
            });

            it("returns the server-current unavailable employee identities before any mutation", async () => {
                prismaService.employee.findMany.mockResolvedValueOnce([
                    { id: 5, name: "김관리", branchId, deletedAt: null, openToNextWork: false },
                ]);

                await expect(service.create(branchId, {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                })).rejects.toMatchObject({
                    response: {
                        code: "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED",
                        unavailableEmployees: [{ id: 5, name: "김관리" }],
                    },
                });

                expect(prismaService.employee.updateMany).not.toHaveBeenCalled();
                expect(createClientUsecase.executeWithInitialSchedule).not.toHaveBeenCalled();
            });

            it("rejects and re-prompts when the locked unavailable set differs from the confirmed set", async () => {
                prismaService.employee.findMany.mockResolvedValueOnce([
                    { id: 5, name: "김주", branchId, deletedAt: null, openToNextWork: false },
                    { id: 6, name: "이보조", branchId, deletedAt: null, openToNextWork: false },
                ]);

                await expect(service.create(branchId, {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: 6,
                    confirmedUnavailableEmployeeIds: [5],
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                })).rejects.toMatchObject({
                    response: {
                        code: "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED",
                        unavailableEmployees: [
                            { id: 5, name: "김주" },
                            { id: 6, name: "이보조" },
                        ],
                    },
                });

                expect(prismaService.employee.updateMany).not.toHaveBeenCalled();
                expect(createClientUsecase.executeWithInitialSchedule).not.toHaveBeenCalled();
            });

            it("does not activate or assign an employee outside the client branch after confirmation", async () => {
                prismaService.employee.findMany.mockResolvedValue([]);

                await expect(service.create(branchId, {
                    name: "New Client",
                    primaryEmployeeId: 999,
                    confirmedUnavailableEmployeeIds: [999],
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                })).rejects.toThrow("선택한 제공인력이 해당 지점 소속이 아니거나 배정 가능한 상태가 아니에요.");

                expect(prismaService.employee.updateMany).not.toHaveBeenCalled();
                expect(createClientUsecase.executeWithInitialSchedule).not.toHaveBeenCalled();
            });

            it("does not activate or assign a soft-deleted employee after confirmation", async () => {
                prismaService.employee.findMany.mockResolvedValue([
                    { id: 5, name: "Deleted", branchId, deletedAt: new Date(), openToNextWork: false },
                ]);

                await expect(service.create(branchId, {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    confirmedUnavailableEmployeeIds: [5],
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                })).rejects.toThrow("선택한 제공인력이 해당 지점 소속이 아니거나 배정 가능한 상태가 아니에요.");

                expect(prismaService.employee.updateMany).not.toHaveBeenCalled();
                expect(createClientUsecase.executeWithInitialSchedule).not.toHaveBeenCalled();
            });

            it("keeps activation inside the client-create transaction when creation fails", async () => {
                let employeeIsAvailable = false;
                prismaService.employee.findMany.mockImplementation(({ where }) => Promise.resolve(
                    where.id.in.map((id: number) => ({
                        id,
                        name: `Employee ${id}`,
                        branchId,
                        deletedAt: null,
                        openToNextWork: employeeIsAvailable,
                    })),
                ));
                prismaService.employee.updateMany.mockImplementation(async () => {
                    employeeIsAvailable = true;
                    return { count: 1 };
                });
                prismaService.$transaction.mockImplementationOnce(async (callback) => {
                    const originalAvailability = employeeIsAvailable;
                    try {
                        return await callback(prismaService);
                    } catch (error) {
                        employeeIsAvailable = originalAvailability;
                        throw error;
                    }
                });
                createClientUsecase.executeWithInitialSchedule.mockRejectedValueOnce(new Error("create failed"));

                await expect(service.create(branchId, {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    confirmedUnavailableEmployeeIds: [5],
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                })).rejects.toThrow("create failed");

                expect(prismaService.employee.updateMany).toHaveBeenCalled();
                expect(employeeIsAvailable).toBe(false);
            });

            it("creates a new client when no client with that phone exists in the branch", async () => {
                // Arrange — findByPhone returns null (no duplicate)
                clientRepository.findByPhone.mockResolvedValue(null);
                const mockClient = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(mockClient);

                const params = {
                    name: "New Client",
                    phone: "010-9999-0000",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                };

                // Act
                const result = await service.create(branchId, params);

                // Assert: normal create path ran
                expect(createClientUsecase.execute).toHaveBeenCalledTimes(1);
                expect(result).toBe(mockClient);
            });
        });

        describe("contract auto registration", () => {
            it("rejects creation when auto registration is disabled", async () => {
                systemSettingService.getClientAutoRegistrationEnabled.mockResolvedValue(false);

                await expect(service.create(branchId, {
                    name: "Auto Client",
                    source: "contract_auto_registration",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                })).rejects.toMatchObject({
                    status: 409,
                    response: expect.objectContaining({
                        message: "자동 고객 등록이 꺼져 있습니다. 고객을 먼저 등록한 뒤 계약서를 생성해 주세요.",
                    }),
                });
                expect(createClientUsecase.execute).not.toHaveBeenCalled();
            });

            it.each([
                [false, true],
                [true, false],
            ])("persists suppressGreetingSms=%s when greeting enabled is %s", async (greetingEnabled, expectedSuppress) => {
                const createdClient = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(createdClient);
                systemSettingService.getGreetingOnAutoRegistrationEnabled.mockResolvedValue(greetingEnabled);

                await service.create(branchId, {
                    name: "Auto Client",
                    source: "contract_auto_registration",
                    suppressGreetingSms: greetingEnabled,
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                });

                expect(createClientUsecase.execute).toHaveBeenCalledWith(
                    branchId,
                    expect.objectContaining({ suppressGreetingSms: expectedSuppress }),
                    expect.anything(),
                    KR_BUILTIN_CALENDAR,
                );
                expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
                    branchId,
                    createdClient.id,
                    true,
                    expectedSuppress,
                );
            });
        });

        it("rejects a service period whose end date is before its start date", async () => {
            await expect(service.create(branchId, {
                name: "Invalid Period",
                startDate: "2026-08-02",
                endDate: "2026-08-01",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            })).rejects.toMatchObject({
            status: 400,
            response: clientProblemResponse("CLIENT_SERVICE_PERIOD_INVALID", "/endDate", "INVALID_VALUE", "서비스 시작일은 종료일보다 늦을 수 없습니다."),
        });
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        it("rejects malformed phone before reading or mutating the client", async () => {
            await expect(service.update(branchId, 1, { phone: "not-a-phone" }))
                .rejects.toMatchObject({
                    status: 400,
                    response: clientProblemResponse("VALIDATION_FAILED", "/phone", "INVALID_FORMAT", "연락처가 올바른 국내 전화번호 형식이 아닙니다."),
                });

            expect(findClientByIdUsecase.execute).not.toHaveBeenCalled();
            expect(clientRepository.findByPhone).not.toHaveBeenCalled();
            expect(prismaService.$transaction).not.toHaveBeenCalled();
            expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
        });

        describe("given existing client and no employee change", () => {
            it("runs the internal claim before client writes on the same transaction", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                const beforeWrite = jest.fn(async () => undefined);

                await service.update(branchId, existingClient.id, { endDate: "2024-05-30" }, beforeWrite);

                expect(beforeWrite).toHaveBeenCalledWith(prismaService);
                expect(beforeWrite.mock.invocationCallOrder[0])
                    .toBeLessThan(prismaService.client.updateMany.mock.invocationCallOrder[0] ?? 0);
                expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
            });

            it("does not write client state when the internal claim rejects", async () => {
                findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());
                const beforeWrite = jest.fn(async () => { throw new ConflictException({ code: "ITEM_NOT_OPEN" }); });

                await expect(service.update(branchId, 1, { endDate: "2024-05-30" }, beforeWrite))
                    .rejects.toMatchObject({ response: { code: "ITEM_NOT_OPEN" } });

                expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                expect(serviceRecordLifecycleService.validatePeriodChange).not.toHaveBeenCalled();
            });

            it("revalidates a service-period change inside the owning transaction", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                serviceRecordLifecycleService.validatePeriodChange.mockImplementation(
                    async (_params: unknown, transaction?: unknown) => {
                        if (transaction) {
                            throw new ConflictException({ code: "SERVICE_RECORD_END_DATE_BEFORE_LOCKED_SESSION" });
                        }
                    },
                );

                await expect(service.update(branchId, existingClient.id, {
                    endDate: "2026-05-01",
                })).rejects.toMatchObject({
                    response: { code: "SERVICE_RECORD_END_DATE_BEFORE_LOCKED_SESSION" },
                });

                expect(serviceRecordLifecycleService.validatePeriodChange).toHaveBeenCalledWith(
                    expect.objectContaining({ clientId: existingClient.id }),
                    expect.anything(),
                );
                expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
            });

            describe("expectedEndDate guard", () => {
                it("rejects with SERVICE_RECORD_WRITE_TARGET_CHANGED when the end date moved since the snapshot", async () => {
                    const existingClient = createClientEntity(); // endDate 2024-06-01
                    findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                    await expect(service.update(branchId, existingClient.id, {
                        endDate: "2024-05-30",
                        expectedEndDate: "2024-05-31",
                    })).rejects.toMatchObject({
                        status: 409,
                        response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" },
                    });

                    expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                    expect(serviceRecordLifecycleService.validatePeriodChange).not.toHaveBeenCalled();
                });

                it("rejects when the client has no end date but one was expected", async () => {
                    const existingClient = createClientEntity();
                    existingClient.endDate = null;
                    findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                    await expect(service.update(branchId, existingClient.id, {
                        endDate: "2024-05-30",
                        expectedEndDate: "2024-06-01",
                    })).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" } });
                    expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                });

                it("writes normally when the end date still matches, without persisting the guard", async () => {
                    const existingClient = createClientEntity();
                    findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                    await service.update(branchId, existingClient.id, {
                        endDate: "2024-05-30",
                        expectedEndDate: "2024-06-01",
                    });

                    const { data } = prismaService.client.updateMany.mock.calls[0][0];
                    expect(data.endDate).toEqual(new Date("2024-05-30"));
                    expect(data).not.toHaveProperty("expectedEndDate");
                });

                it("treats a guard on its own as no update", async () => {
                    const existingClient = createClientEntity();
                    findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                    await expect(service.update(branchId, existingClient.id, { expectedEndDate: "2000-01-01" }))
                        .resolves.toBe(existingClient);
                    expect(prismaService.$transaction).not.toHaveBeenCalled();
                });

                it("checks the end date of the row read after locking, not the stale preflight copy", async () => {
                    const staleClient = createClientEntity(); // endDate 2024-06-01
                    findClientByIdUsecase.execute.mockResolvedValue(staleClient);
                    prismaService.client.findUnique.mockResolvedValue({
                        ...staleClient,
                        branchId,
                        endDate: new Date("2024-06-05T00:00:00.000Z"),
                    });

                    await expect(service.update(branchId, staleClient.id, {
                        endDate: "2024-05-30",
                        expectedEndDate: "2024-06-01",
                    })).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" } });
                    expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                });
            });

            it("should update client without creating new schedule", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                const result = await service.update(branchId, 1, { name: "New Name", address: "New Address" });

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(branchId, 1);
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                expect(prismaService.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 1, branchId },
                    data: expect.objectContaining({ name: "New Name", address: "New Address" }),
                }));
                expect(result).toBe(existingClient);
            });

            it("loads the branch calendar before the transaction and hands it to the lifecycle repair", async () => {
                const calendar = createKrBusinessDayCalendar(
                    [...(KOREAN_HOLIDAY_CALENDAR[2024] ?? []), "2024-03-05"],
                    { supportedYears: [2024], version: "branch-test" },
                );
                (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(calendar);
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                await service.update(branchId, existingClient.id, { name: "새 고객 이름" });

                expect(holidayCalendar.forBranch).toHaveBeenCalledTimes(1);
                expect((holidayCalendar.forBranch as jest.Mock).mock.invocationCallOrder[0]!)
                    .toBeLessThan((prismaService.$transaction as jest.Mock).mock.invocationCallOrder[0]!);
                expect(serviceRecordLifecycleService.ensureForClient).toHaveBeenCalledWith(
                    existingClient.id, expect.anything(), calendar,
                );
            });

            it("should refresh assignment jobs when the client name changes", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                await service.update(branchId, existingClient.id, { name: "새 고객 이름" });

                expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledTimes(1);
                expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledWith(
                    branchId,
                    existingClient.id,
                );
            });

            it("persists one deduped retry intent per active schedule when refresh is retryable", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                triggerService.syncEmployeeAssignmentRulesForClient.mockResolvedValue(false);
                prismaService.employee_schedule.findMany.mockResolvedValue([
                    { id: 12 },
                    { id: 9 },
                    { id: 12 },
                ]);

                await service.update(branchId, existingClient.id, { name: "새 고객 이름" });

                expect(prismaService.employee_schedule.findMany).toHaveBeenCalledWith({
                    where: { branchId, clientId: existingClient.id, replaced: false },
                    select: { id: true },
                    orderBy: { id: "asc" },
                });
                expect(messageAutomationIntentService.persistScheduleIntent).toHaveBeenCalledTimes(2);
                expect(messageAutomationIntentService.persistScheduleIntent).toHaveBeenNthCalledWith(
                    1,
                    prismaService,
                    expect.objectContaining({
                        branchId,
                        clientId: existingClient.id,
                        scheduleId: 9,
                        includePast: true,
                        intentAt: expect.any(Date),
                        replaceExisting: true,
                    }),
                );
                expect(messageAutomationIntentService.persistScheduleIntent).toHaveBeenNthCalledWith(
                    2,
                    prismaService,
                    expect.objectContaining({
                        branchId,
                        clientId: existingClient.id,
                        scheduleId: 12,
                        includePast: true,
                        intentAt: expect.any(Date),
                        replaceExisting: true,
                    }),
                );
            });

            it("persists schedule retry intents when the immediate refresh throws", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                triggerService.syncEmployeeAssignmentRulesForClient.mockRejectedValue(
                    new Error("assignment refresh unavailable"),
                );
                prismaService.employee_schedule.findMany.mockResolvedValue([{ id: 12 }]);

                await expect(service.update(branchId, existingClient.id, { name: "새 고객 이름" }))
                    .resolves.toBe(existingClient);

                expect(messageAutomationIntentService.persistScheduleIntent).toHaveBeenCalledWith(
                    prismaService,
                    expect.objectContaining({
                        branchId,
                        clientId: existingClient.id,
                        scheduleId: 12,
                        includePast: true,
                        replaceExisting: true,
                    }),
                );
            });

            it("keeps the client update successful when retry intent persistence fails", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                triggerService.syncEmployeeAssignmentRulesForClient.mockResolvedValue(false);
                prismaService.employee_schedule.findMany.mockResolvedValue([{ id: 12 }]);
                messageAutomationIntentService.persistScheduleIntent.mockRejectedValue(
                    new Error("intent store unavailable"),
                );

                await expect(service.update(branchId, existingClient.id, { name: "새 고객 이름" }))
                    .resolves.toBe(existingClient);
            });

            it("does not select schedules or enqueue retry intents after a successful refresh", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                triggerService.syncEmployeeAssignmentRulesForClient.mockResolvedValue(true);

                await service.update(branchId, existingClient.id, { name: "새 고객 이름" });

                expect(prismaService.employee_schedule.findMany).toHaveBeenCalledWith({
                    where: { branchId, clientId: existingClient.id },
                    select: {
                        id: true,
                        primaryEmployeeId: true,
                        secondaryEmployeeId: true,
                    },
                    orderBy: { id: "asc" },
                });
                expect(messageAutomationIntentService.persistScheduleIntent).not.toHaveBeenCalled();
            });

            it("should not refresh assignment jobs when an unrelated client field changes", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                await service.update(branchId, existingClient.id, { address: "새 주소" });

                expect(triggerService.syncEmployeeAssignmentRulesForClient).not.toHaveBeenCalled();
            });

            it("should not refresh assignment jobs when the client name is unchanged", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                await service.update(branchId, existingClient.id, { name: existingClient.name });

                expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledTimes(1);
                expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledWith(
                    branchId,
                    existingClient.id,
                );
            });

            it("refreshes assignment jobs when a supplied name matches the stale pre-write snapshot", async () => {
                const staleClient = createClientEntity();
                const committedClient = createClientEntity();
                staleClient.name = "이전 이름";
                committedClient.name = "최종 이름";
                findClientByIdUsecase.execute
                    .mockResolvedValueOnce(staleClient)
                    .mockResolvedValueOnce(committedClient);

                await service.update(branchId, staleClient.id, { name: staleClient.name });

                expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledTimes(1);
                expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledWith(
                    branchId,
                    staleClient.id,
                );
            });

            it("clears birthDate when the caller explicitly sends null (tri-state, mirrors areaId)", async () => {
                // Arrange
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                // Act
                await service.update(branchId, 1, { birthDate: null });

                // Assert
                expect(prismaService.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 1, branchId },
                    data: expect.objectContaining({ birthDate: null }),
                }));
            });

            it.each([
                ["address", "address"],
                ["phone", "phone"],
                ["type", "type"],
                ["fullPrice", "fullPrice"],
                ["grant", "grant"],
                ["actualPrice", "actualPrice"],
                ["startDate", "startDate"],
                ["endDate", "endDate"],
                ["careCenter", "careCenter"],
                ["birthday", "birthday"],
                ["dueDate", "dueDate"],
                ["birthDate", "birthDate"],
                // serviceStatus: null is no longer written as NULL — it is treated as the
                // date-derived status (rule 고객-04); see "update: a save may not change 예약 전".
                ["eDocId", "eDocId"],
                ["areaId", "areaId"],
            ])("writes explicit null for nullable %s instead of treating it as omission", async (field, dataKey) => {
                findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());

                await service.update(branchId, 1, { [field]: null } as never);

                expect(prismaService.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 1, branchId },
                    data: expect.objectContaining({ [dataKey]: null }),
                }));
            });

            it("writes an explicit null duration for a client whose service period is incomplete", async () => {
                const existingClient = createClientEntity();
                existingClient.startDate = null;
                existingClient.endDate = null;
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                await service.update(branchId, 1, { duration: null });

                expect(prismaService.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 1, branchId },
                    data: expect.objectContaining({ duration: null }),
                }));
            });

            it.each(["name", "voucherClient", "breastPump"])(
                "rejects null for non-nullable %s before opening the transaction",
                async (field) => {
                    findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());

                    await expect(service.update(branchId, 1, { [field]: null } as never))
                        .rejects.toBeInstanceOf(BadRequestException);

                    expect(prismaService.$transaction).not.toHaveBeenCalled();
                    expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                },
            );

            it("sets birthDate to a parsed Date when a value is provided", async () => {
                // Arrange
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                // Act
                await service.update(branchId, 1, { birthDate: "1995-03-15" });

                // Assert
                expect(prismaService.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 1, branchId },
                    data: expect.objectContaining({ birthDate: new Date("1995-03-15") }),
                }));
            });

            // A raw `new Date` accepted both of these: a month-only string became
            // the first of that month, and an unparseable one reached Prisma as
            // an Invalid Date and surfaced as a 500. They are bad input, so they
            // have to be rejected before the transaction opens.
            it.each([
                ["a month without a day", "2026-08"],
                ["a day that does not exist", "2026-02-31"],
                ["something that is not a date", "내일"],
            ])("rejects %s rather than guessing at it", async (_label, value) => {
                findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());

                await expect(service.update(branchId, 1, { birthDate: value })).rejects.toBeInstanceOf(
                    BadRequestException,
                );
                await expect(service.update(branchId, 1, { dueDate: value })).rejects.toBeInstanceOf(
                    BadRequestException,
                );

                expect(prismaService.$transaction).not.toHaveBeenCalled();
            });

            // These columns are calendar dates, not instants. A raw `new Date`
            // honours the offset and lands the write on the 14th in UTC.
            it("keeps 출산예정일 on the day the caller submitted, offset or not", async () => {
                findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());

                await service.update(branchId, 1, { dueDate: "2026-09-15T00:00:00+09:00" });

                expect(prismaService.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    data: expect.objectContaining({ dueDate: new Date("2026-09-15T00:00:00.000Z") }),
                }));
            });

            it("omits birthDate from the write when the caller does not send the field", async () => {
                // Arrange
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                // Act
                await service.update(branchId, 1, { name: "New Name" });

                // Assert
                const { data } = prismaService.client.updateMany.mock.calls[0][0];
                expect(data.birthDate).toBeUndefined();
            });

            it("persists the canonical phone identity while preserving display formatting", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                clientRepository.findByPhone.mockResolvedValue(null);

                await service.update(branchId, 1, { phone: "+82 10 9999 0000" });

                expect(prismaService.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    data: expect.objectContaining({
                        phone: "+82 10 9999 0000",
                        phoneNormalized: "01099990000",
                    }),
                }));
            });

            it("preserves explicit null service dates and allows equal dates", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                await service.update(branchId, 1, { startDate: null, endDate: null });

                expect(prismaService.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 1, branchId },
                    data: expect.objectContaining({ startDate: null, endDate: null }),
                }));
            });

            it("leaves duration untouched when a date patch leaves the service period incomplete", async () => {
                // duration is authoritative once set: clearing endDate must
                // not silently wipe out the stored session count anymore.
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                await service.update(branchId, 1, { endDate: null });

                const { data } = prismaService.client.updateMany.mock.calls[0][0];
                expect(data.endDate).toBeNull();
                expect(data.duration).toBeUndefined();
            });

            it("accepts a supplied duration smaller than the business-day count and persists it unchanged", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                await service.update(branchId, 1, { duration: 1 });

                expect(prismaService.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 1, branchId },
                    data: expect.objectContaining({ duration: 1 }),
                }));
            });

            it("persists confirmed weekend-service dates and duration unchanged on update", async () => {
                findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());
                await service.update(branchId, 1, {
                    startDate: "2026-08-26", endDate: "2026-09-14",
                    duration: 15, allowBusinessDayMismatch: true,
                });
                const { data } = prismaService.client.updateMany.mock.calls[0][0];
                expect(data).toEqual(expect.objectContaining({
                    duration: 15, startDate: new Date("2026-08-26"), endDate: new Date("2026-09-14"),
                }));
                expect(data).not.toHaveProperty("allowBusinessDayMismatch");
            });

            it("rejects a duration that exceeds the business-day count when the existing service period is complete", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                await expect(service.update(branchId, 1, { duration: 103 }))
                    .rejects.toMatchObject({
                        status: 400,
                        response: clientProblemResponse("CLIENT_DURATION_OUT_OF_RANGE", "/duration", "OUT_OF_RANGE", "서비스 기간은 1일 이상 102일 이하여야 합니다. (시작일~종료일 영업일 기준)"),
                    });
                expect(prismaService.$transaction).not.toHaveBeenCalled();
                expect(prismaService.client.updateMany).not.toHaveBeenCalled();
            });

            it("validates the duration against the branch calendar, loaded fresh, and reuses it in the locked re-check", async () => {
                // The branch adds 2024-03-05 off, so 2024-01-01..2024-06-01 holds 101 sessions, not 102.
                (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(createKrBusinessDayCalendar(
                    [...(KOREAN_HOLIDAY_CALENDAR[2024] ?? []), "2024-03-05"],
                    { supportedYears: [2024], version: "branch-test" },
                ));
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                await expect(service.update(branchId, 1, { duration: 102 }))
                    .rejects.toMatchObject({
                        status: 400,
                        response: clientProblemResponse("CLIENT_DURATION_OUT_OF_RANGE", "/duration", "OUT_OF_RANGE", "서비스 기간은 1일 이상 101일 이하여야 합니다. (시작일~종료일 영업일 기준)"),
                    });
                expect(holidayCalendar.forBranch).toHaveBeenCalledWith(branchId, { fresh: true });
                expect(prismaService.client.updateMany).not.toHaveBeenCalled();
            });

            it("rejects a non-null duration when a date patch cannot derive a complete period", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                await expect(service.update(branchId, 1, { endDate: null, duration: 5 }))
                    .rejects.toMatchObject({
                        status: 400,
                        response: clientProblemResponse("CLIENT_DURATION_NEEDS_SERVICE_PERIOD", "/duration", "REQUIRED", "서비스 기간을 지정하려면 시작일과 종료일이 모두 있어야 합니다."),
                    });
                expect(prismaService.$transaction).not.toHaveBeenCalled();
            });

            it("merges a partial service period with the existing client before rejecting reversed dates", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                await expect(service.update(branchId, 1, { endDate: "2023-12-31" }))
                    .rejects.toMatchObject({
                        status: 400,
                        response: clientProblemResponse("CLIENT_SERVICE_PERIOD_INVALID", "/endDate", "INVALID_VALUE", "서비스 시작일은 종료일보다 늦을 수 없습니다."),
                    });

                expect(prismaService.$transaction).not.toHaveBeenCalled();
                expect(prismaService.client.updateMany).not.toHaveBeenCalled();
            });

            it("routes one create and one update pre-write problem through the public problem response", async () => {
                // 지정한 두 원인이 공개 계약 경로(mapHttpProblem → sendProblemResponse → normalizeApiError)를
                // 온전히 통과하는지 확인한다. 사유 코드와 포인터는 새 계약의 정체성이다.
                const createException: unknown = await service.create(branchId, {
                    name: "Invalid Period",
                    startDate: "2026-07-18",
                    endDate: "2026-07-17",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                }).catch((error: unknown) => error);
                findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());
                const updateException: unknown = await service.update(branchId, 1, { name: null } as never)
                    .catch((error: unknown) => error);

                for (const locale of ["ko-KR", "en-US"] as const) {
                    const requestId = `test-client-problem-${locale}`;
                    const bodies: unknown[] = [];
                    const mapped = [createException, updateException].map((candidate) => {
                        const responseStub = {
                            locals: { errorRequestId: requestId },
                            setHeader: jest.fn(),
                            status: jest.fn().mockReturnThis(),
                            json: jest.fn(),
                        };
                        const problem = mapHttpProblem(candidate,
                            { method: "POST", acceptsLanguages: () => locale } as unknown as Request,
                            responseStub as unknown as Response);
                        if (!problem) throw new Error("Expected a registered client problem");
                        sendProblemResponse(responseStub as unknown as Response, problem);
                        expect(responseStub.status).toHaveBeenCalledWith(400);
                        expect(responseStub.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
                        expect(responseStub.setHeader).toHaveBeenCalledWith("Content-Language", locale);
                        expect(responseStub.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
                        expect(responseStub.setHeader).toHaveBeenCalledWith("X-Request-Id", requestId);
                        bodies.push(responseStub.json.mock.calls[0]?.[0]);
                        return problem;
                    });

                    expect(mapped[0]).toMatchObject({
                        code: "CLIENT_SERVICE_PERIOD_INVALID", status: 400, requestId, params: {},
                        outcome: "NOT_APPLIED",
                        detail: PROBLEM_CATALOG.CLIENT_SERVICE_PERIOD_INVALID.detail[locale],
                        recovery: { action: "NONE", retry: { mode: "NEVER" } },
                        errors: [expect.objectContaining({ pointer: "/endDate", code: "INVALID_VALUE", location: "body" })],
                    });
                    expect(mapped[1]).toMatchObject({
                        code: "VALIDATION_FAILED", status: 400, requestId, params: {},
                        outcome: "NOT_APPLIED",
                        detail: PROBLEM_CATALOG.VALIDATION_FAILED.detail[locale],
                        recovery: { action: "NONE", retry: { mode: "NEVER" } },
                        errors: [expect.objectContaining({ pointer: "/name", code: "REQUIRED", location: "body" })],
                    });

                    const normalized = normalizeApiError(
                        { response: { status: 400, data: bodies[0] } },
                        { operation: "mutation", locale },
                    );
                    expect(normalized).toMatchObject({ verified: true, outcome: "NOT_APPLIED", problem: { requestId } });
                    expect(normalized.message).toBe(PROBLEM_CATALOG.CLIENT_SERVICE_PERIOD_INVALID.detail[locale]);

                    const serialized = JSON.stringify(bodies);
                    // 커털로그가 공개 메시지를 공급한다: 각 본문은 로캘별 정본 문구를 담는다.
                    expect(serialized).toContain(PROBLEM_CATALOG.CLIENT_SERVICE_PERIOD_INVALID.detail[locale]);
                    for (const privateValue of ["2026-07-18", "2026-07-17", "Invalid Period", "name null"]) {
                        expect(serialized).not.toContain(privateValue);
                    }
                }
            });

            it("routes the duplicate-phone conflict through the public problem response", async () => {
                clientRepository.findByPhone.mockResolvedValue(createClientEntity());
                const exception: unknown = await service.create(branchId, {
                    name: "Duplicate Phone",
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                }).catch((error: unknown) => error);

                for (const locale of ["ko-KR", "en-US"] as const) {
                    const requestId = `test-client-conflict-${locale}`;
                    const responseStub = {
                        locals: { errorRequestId: requestId },
                        setHeader: jest.fn(),
                        status: jest.fn().mockReturnThis(),
                        json: jest.fn(),
                    };
                    const problem = mapHttpProblem(exception,
                        { method: "POST", acceptsLanguages: () => locale } as unknown as Request,
                        responseStub as unknown as Response);
                    if (!problem) throw new Error("Expected a registered client conflict");
                    sendProblemResponse(responseStub as unknown as Response, problem);
                    expect(responseStub.status).toHaveBeenCalledWith(409);
                    expect(responseStub.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
                    expect(problem).toMatchObject({
                        code: "CLIENT_PHONE_ALREADY_REGISTERED", status: 409, requestId, params: {},
                        outcome: "NOT_APPLIED",
                        detail: PROBLEM_CATALOG.CLIENT_PHONE_ALREADY_REGISTERED.detail[locale],
                        recovery: { action: "NONE", retry: { mode: "NEVER" } },
                        errors: [expect.objectContaining({ pointer: "/phone", code: "INVALID_VALUE", location: "body" })],
                    });

                    const body = responseStub.json.mock.calls[0]?.[0];
                    const normalized = normalizeApiError(
                        { response: { status: 409, data: body } },
                        { operation: "mutation", locale },
                    );
                    expect(normalized).toMatchObject({ verified: true, outcome: "NOT_APPLIED", problem: { requestId } });
                    expect(normalized.message).toBe(PROBLEM_CATALOG.CLIENT_PHONE_ALREADY_REGISTERED.detail[locale]);
                    // 재사용 대상 고객 id는 공개 페이로드에 남지 않는다.
                    expect(JSON.stringify(body)).not.toContain("clientId");
                }
            });

            describe("ready contract identity on client save", () => {
                const arrangeDocument = (
                    clientId: number | null,
                    detailPayload: unknown,
                    lockedClient: ReturnType<typeof lockedClientRow> = lockedClientRow(createClientEntity()),
                    statusType = "060",
                ) => {
                    prismaService.client.findUnique.mockResolvedValue(lockedClient);
                    const doc = {
                        id: 12,
                        documentId: "DOC-IDENTITY",
                        clientId,
                        branchId,
                        customerPhone: "01012345678",
                        statusType,
                        detailPayload,
                        detailSourceUpdatedDate: new Date("2026-09-01T00:00:00Z"),
                        detailSyncedAt: new Date("2026-09-01T00:01:00Z"),
                    };
                    prismaService.eformsign_doc.findMany.mockImplementation(async ({ where }) =>
                        where.syncStatus?.not ? [] : [doc]);
                    prismaService.eformsign_doc.updateMany.mockResolvedValue({ count: 1 });
                    prismaService.$queryRaw.mockImplementation(async (query: Prisma.Sql) =>
                        query.sql.includes("UNION") ? []
                            : query.sql.includes("eformsign_doc AS doc") ? [{ id: 12 }] : [{ id: 1 }]);
                    return doc;
                };

                it.each([
                    ["different name", matchingContractDetail("Other Client"), "900101", null],
                    ["different birthday", matchingContractDetail("Test Client", "1990-01-02"), "900101", null],
                    ["missing saved birthday", matchingContractDetail(), null, null],
                    ["missing detail", null, "900101", null],
                    ["another owner with matching identity", matchingContractDetail(), "900101", 99],
                ])("silently leaves a ready document unchanged for %s", async (_label, detail, birthday, owner) => {
                    const client = createClientEntity();
                    client.birthday = birthday;
                    findClientByIdUsecase.execute.mockResolvedValue(client);
                    const doc = arrangeDocument(owner, detail);
                    const before = { ...doc };

                    await expect(service.update(branchId, client.id, {})).resolves.toBe(client);

                    expect(doc).toEqual(before);
                    expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
                    expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                    expect(prismaService.$transaction).not.toHaveBeenCalled();
                    expect(linkMirroredDocumentByPhoneUsecase.execute).not.toHaveBeenCalled();
                    expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
                    expect(documentSnapshotService.bumpVersion).not.toHaveBeenCalled();
                    expect(client.eDocId).toBeNull();
                });

                it.each([null, 1])("keeps matching/unassigned or already-owned behavior (owner %s)", async (owner) => {
                    const client = createClientEntity();
                    findClientByIdUsecase.execute.mockResolvedValue(client);
                    arrangeDocument(owner, owner === null ? matchingContractDetail() : null);

                    await expect(service.update(branchId, client.id, {})).resolves.toBe(client);

                    expect(prismaService.eformsign_doc.updateMany).toHaveBeenCalledTimes(owner === null ? 1 : 0);
                    expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                        where: { id: client.id, branchId },
                        data: { eDocId: "DOC-IDENTITY" },
                    });
                    expect(client.eDocId).toBe("DOC-IDENTITY");
                    expect(linkMirroredDocumentByPhoneUsecase.execute).not.toHaveBeenCalled();
                });

                it.each([
                    ["Other Client", "Test Client", true],
                    ["Test Client", "Other Client", false],
                ])("compares the saved name (%s -> %s)", async (oldName, savedName, linked) => {
                    const stale = createClientEntity();
                    stale.name = oldName;
                    const saved = createClientEntity();
                    saved.name = savedName;
                    findClientByIdUsecase.execute.mockResolvedValueOnce(stale).mockResolvedValue(saved);
                    arrangeDocument(null, matchingContractDetail(), lockedClientRow(saved));

                    await expect(service.update(branchId, stale.id, { name: savedName })).resolves.toBe(saved);

                    expect(prismaService.eformsign_doc.updateMany).toHaveBeenCalledTimes(linked ? 1 : 0);
                    const pointerWrites = prismaService.client.updateMany.mock.calls.filter(([args]) =>
                        args.data.eDocId !== undefined);
                    expect(pointerWrites).toHaveLength(linked ? 1 : 0);
                    expect(saved.eDocId).toBe(linked ? "DOC-IDENTITY" : null);
                    expect(linkMirroredDocumentByPhoneUsecase.execute).not.toHaveBeenCalled();
                });

                it.each([
                    ["1990-01-02", "1990-01-01", true],
                    ["1990-01-01", "1990-01-02", false],
                ])("compares the saved birthday (%s -> %s)", async (oldBirthday, savedBirthday, linked) => {
                    const stale = createClientEntity();
                    stale.birthday = oldBirthday;
                    const saved = createClientEntity();
                    saved.birthday = savedBirthday;
                    findClientByIdUsecase.execute.mockResolvedValueOnce(stale).mockResolvedValue(saved);
                    arrangeDocument(null, matchingContractDetail(), lockedClientRow(saved));

                    await expect(service.update(branchId, stale.id, { birthday: savedBirthday })).resolves.toBe(saved);

                    expect(prismaService.eformsign_doc.updateMany).toHaveBeenCalledTimes(linked ? 1 : 0);
                    expect(prismaService.client.updateMany.mock.calls.filter(([args]) =>
                        args.data.eDocId !== undefined)).toHaveLength(linked ? 1 : 0);
                    expect(saved.eDocId).toBe(linked ? "DOC-IDENTITY" : null);
                });

                describe("계약-05: only an allowed document status is linked", () => {
                    it.each(["001", "011", "042", "080"])(
                        "does not link an unlinked document in status %s even when the identity matches",
                        async (statusType) => {
                            const client = createClientEntity();
                            findClientByIdUsecase.execute.mockResolvedValue(client);
                            arrangeDocument(null, matchingContractDetail(), lockedClientRow(client), statusType);

                            await expect(service.update(branchId, client.id, {})).resolves.toBe(client);

                            expect(prismaService.$transaction).not.toHaveBeenCalled();
                            expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
                            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                            expect(client.eDocId).toBeNull();
                        },
                    );

                    it.each(["060", "003", "040", "045", "071"])(
                        "links an unlinked document in status %s",
                        async (statusType) => {
                            const client = createClientEntity();
                            findClientByIdUsecase.execute.mockResolvedValue(client);
                            arrangeDocument(null, matchingContractDetail(), lockedClientRow(client), statusType);

                            await expect(service.update(branchId, client.id, {})).resolves.toBe(client);

                            expect(prismaService.eformsign_doc.updateMany).toHaveBeenCalledTimes(1);
                            expect(client.eDocId).toBe("DOC-IDENTITY");
                        },
                    );

                    it("keeps a document already linked to the client in status 080 as the pointer target", async () => {
                        const client = createClientEntity();
                        findClientByIdUsecase.execute.mockResolvedValue(client);
                        arrangeDocument(client.id, null, lockedClientRow(client), "080");

                        await expect(service.update(branchId, client.id, {})).resolves.toBe(client);

                        // Nothing is reassigned (it is already this client's) and the locked
                        // document SELECT carries no status condition that would make this throw.
                        expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
                        expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                            where: { id: client.id, branchId },
                            data: { eDocId: "DOC-IDENTITY" },
                        });
                        const documentLock = prismaService.$queryRaw.mock.calls
                            .map(([query]) => query as Prisma.Sql)
                            .find((query) => query.sql.includes("eformsign_doc AS doc") && query.sql.includes("FOR UPDATE"))!;
                        expect(documentLock).toBeDefined();
                        expect(documentLock.sql).toContain("doc.status_type NOT IN ('047', '049', '099')");
                        expect(documentLock.sql).not.toContain("'060'");
                        expect(client.eDocId).toBe("DOC-IDENTITY");
                    });

                    it("writes nothing when the document is 080 in the locked re-read although eligible in the unlocked read", async () => {
                        const client = createClientEntity();
                        findClientByIdUsecase.execute.mockResolvedValue(client);
                        const doc = arrangeDocument(null, matchingContractDetail(), lockedClientRow(client), "060");
                        prismaService.eformsign_doc.findMany.mockImplementation(async ({ where }) =>
                            where.syncStatus?.not ? []
                                : where.id ? [{ ...doc, statusType: "080" }] : [doc]);
                        const errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation();

                        try {
                            await expect(service.update(branchId, client.id, {})).resolves.toBe(client);

                            expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
                            expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
                            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                            expect(client.eDocId).toBeNull();
                            expect(errorLog).toHaveBeenCalledWith(
                                expect.stringContaining("[CLIENT_CONTRACT_PHONE_LINK_FAILED]"),
                            );
                        } finally {
                            errorLog.mockRestore();
                        }
                    });
                });

                describe("the locked client's identity is re-read under the lock", () => {
                    it.each([
                        ["birthday", { birthday: "1990-01-02" }],
                        ["name", { name: "Other Client" }],
                        ["phone", { phone: "010-9999-9999" }],
                        ["missing row", null],
                    ])("writes nothing when the locked client's %s differs from the caller's snapshot", async (_label, change) => {
                        const client = createClientEntity();
                        findClientByIdUsecase.execute.mockResolvedValue(client);
                        arrangeDocument(
                            null,
                            matchingContractDetail(),
                            change === null ? (null as never) : lockedClientRow(client, change),
                        );
                        const errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation();

                        try {
                            await expect(service.update(branchId, client.id, {})).resolves.toBe(client);

                            expect(prismaService.client.findUnique).toHaveBeenCalledWith({
                                where: { id: client.id },
                                select: { phone: true, name: true, birthday: true },
                            });
                            expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
                            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                            expect(client.eDocId).toBeNull();
                            expect(errorLog).toHaveBeenCalledWith(
                                expect.stringContaining("[CLIENT_CONTRACT_PHONE_LINK_FAILED]"),
                            );
                        } finally {
                            errorLog.mockRestore();
                        }
                    });

                    it("links as before when the locked client still matches", async () => {
                        const client = createClientEntity();
                        findClientByIdUsecase.execute.mockResolvedValue(client);
                        arrangeDocument(null, matchingContractDetail(), lockedClientRow(client));

                        await expect(service.update(branchId, client.id, {})).resolves.toBe(client);

                        expect(prismaService.eformsign_doc.updateMany).toHaveBeenCalledTimes(1);
                        expect(client.eDocId).toBe("DOC-IDENTITY");
                    });
                });
            });

            it("links matching contracts by the effective phone after client information is updated", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                prismaService.eformsign_doc.updateMany.mockResolvedValue({ count: 1 });
                prismaService.client.findUnique.mockResolvedValue(lockedClientRow(existingClient));
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    {
                        id: 12,
                        documentId: "DOC-AFTER-UPDATE",
                        clientId: null,
                        branchId: null,
                        statusType: "060",
                        stepRecipientSms: "제공기관 010 9999 9999",
                        customerPhone: "01012345678",
                        detailPayload: matchingContractDetail(),
                    },
                ]);
                prismaService.client.findMany.mockResolvedValue([{
                    id: existingClient.id,
                    branchId,
                    phone: existingClient.phone,
                }]);

                // A no-op save is an explicit, targeted local-DB reconciliation.
                const result = await service.update(branchId, existingClient.id, {});

                expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
                expect(serviceRecordLifecycleService.validatePeriodChange).not.toHaveBeenCalled();
                expect(serviceRecordLifecycleService.ensureForClient).not.toHaveBeenCalled();
                expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
                expect(prismaService.eformsign_doc.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        where: expect.objectContaining({
                            serviceRecordCaseId: null,
                            OR: [
                                { customerPhone: "01012345678" },
                                {
                                    customerPhone: null,
                                    stepRecipientSms: { contains: "5678" },
                                },
                            ],
                            AND: expect.arrayContaining([
                                {
                                    OR: [
                                        { branchId },
                                        { branchId: null, clientId: null },
                                    ],
                                },
                            ]),
                        }),
                    }),
                );
                expect(prismaService.eformsign_doc.updateMany).toHaveBeenCalledWith({
                    where: {
                        id: { in: [12] },
                        permanentPurgeRequestedAt: null,
                        statusType: { in: ELIGIBLE_LINK_STATUSES },
                        syncStatus: "ready",
                        detailSourceUpdatedDate: { not: null },
                        detailSyncedAt: { not: null },
                        OR: [
                            { branchId },
                            { branchId: null, clientId: null },
                        ],
                    },
                    data: {
                        branchId,
                        clientId: existingClient.id,
                        documentKind: "contract",
                    },
                });
                expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                    where: {
                        id: existingClient.id,
                        branchId,
                    },
                    data: { eDocId: "DOC-AFTER-UPDATE" },
                });
                // The default raw-query double reports clients 9-12 as owners/pointers: they are
                // released from the moving document before the target takes the pointer.
                expect(prismaService.client.updateMany).toHaveBeenCalledTimes(2);
                expect(prismaService.client.updateMany).toHaveBeenNthCalledWith(1, {
                    where: {
                        id: { in: expect.arrayContaining([9, 10, 11, 12]) },
                        branchId,
                        eDocId: { in: ["DOC-AFTER-UPDATE"] },
                    },
                    data: { eDocId: null },
                });
                expect(result.eDocId).toBe("DOC-AFTER-UPDATE");
                expect(documentSnapshotService.bumpVersion).toHaveBeenCalledWith(branchId);
                expect(documentSnapshotService.bumpCompanyEpoch).toHaveBeenCalledTimes(1);
            });

            it("does not claim a branchless contract when the phone belongs to clients in multiple branches", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    {
                        id: 12,
                        documentId: "DOC-AMBIGUOUS",
                        clientId: null,
                        branchId: null,
                        stepRecipientSms: "고객 010-1234-5678",
                        customerPhone: "01012345678",
                        detailPayload: matchingContractDetail(),
                    },
                ]);
                prismaService.client.findMany.mockResolvedValue([
                    {
                        id: existingClient.id,
                        branchId,
                        phone: existingClient.phone,
                    },
                    {
                        id: 22,
                        branchId: "org-2",
                        phone: "+82 10 1234 5678",
                    },
                ]);

                const result = await service.update(branchId, existingClient.id, {});

                expect(prismaService.eformsign_doc.updateMany).not.toHaveBeenCalled();
                expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                expect(prismaService.$transaction).not.toHaveBeenCalled();
                expect(result.eDocId).toBeNull();
            });

            it("treats an empty update as relink-only even when lifecycle reconciliation would fail", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                serviceRecordLifecycleService.ensureForClient.mockRejectedValue(
                    new NotFoundException("Client not found"),
                );

                await expect(service.update(branchId, existingClient.id, {})).resolves.toBe(existingClient);

                expect(prismaService.eformsign_doc.findMany).toHaveBeenCalled();
                expect(prismaService.$transaction).not.toHaveBeenCalled();
                expect(serviceRecordLifecycleService.validatePeriodChange).not.toHaveBeenCalled();
                expect(serviceRecordLifecycleService.ensureForClient).not.toHaveBeenCalled();
                expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
            });

            it("returns a semantic not-found error when the scoped client does not exist", async () => {
                findClientByIdUsecase.execute.mockResolvedValue(null);

                await expect(service.update(branchId, 999, {})).rejects.toBeInstanceOf(NotFoundException);

                expect(prismaService.eformsign_doc.findMany).not.toHaveBeenCalled();
                expect(prismaService.$transaction).not.toHaveBeenCalled();
            });

            it("does not resolve a service date update before scheduled jobs are recalculated", async () => {
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();
                const syncCompletion = createDeferred();
                const syncStarted = createDeferred();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                updateClientUsecase.execute.mockResolvedValue(updatedClient);
                triggerService.syncClientRulesForClient.mockImplementation(() => {
                    syncStarted.resolve();
                    return syncCompletion.promise;
                });

                let resolved = false;
                const update = service.update(branchId, 1, { endDate: "2026-08-01" });
                void update.then(() => {
                    resolved = true;
                });

                await syncStarted.promise;
                await Promise.resolve();
                expect(resolved).toBe(false);

                syncCompletion.resolve();
                await expect(update).resolves.toBe(existingClient);
            });
        });

        describe("given a client that leaves 예약 전 (service-record link SMS for already-assigned schedules)", () => {
            const futureStart = new Date("2026-11-02T00:00:00.000Z");
            const futureEnd = new Date("2026-11-30T00:00:00.000Z");

            type StatusInputs = {
                serviceStatus: string | null;
                startDate: Date | null;
                endDate: Date | null;
            };

            // The preflight read (and the locked row, absent from this mock) sees
            // the client before the write; the re-read after commit sees it after.
            const arrange = (before: StatusInputs, after: StatusInputs) => {
                const beforeClient = Object.assign(createClientEntity(), before);
                const afterClient = Object.assign(createClientEntity(), after);
                findClientByIdUsecase.execute.mockImplementation(async () =>
                    prismaService.client.updateMany.mock.calls.length > 0 ? afterClient : beforeClient);
                const events: string[] = [];
                prismaService.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
                    const result = await callback(prismaService);
                    events.push("committed");
                    return result;
                });
                serviceRecordLinkService.scheduleForServiceStart.mockImplementation(async (scheduleId: number) => {
                    events.push(`schedule:${scheduleId}`);
                });
                return { events, afterClient };
            };

            const activeSchedulesAfterCommit = (ids: number[]) => {
                prismaService.employee_schedule.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
                    where["terminatedAt"] === null ? ids.map((id) => ({ id })) : []);
            };

            const preBooking: StatusInputs = { serviceStatus: "pre_booking", startDate: futureStart, endDate: null };
            const waiting: StatusInputs = { serviceStatus: "waiting", startDate: futureStart, endDate: futureEnd };

            it("schedules the link for the one active schedule after the transaction commits", async () => {
                const { events } = arrange(preBooking, waiting);
                activeSchedulesAfterCommit([7]);

                await service.update(branchId, 1, { endDate: "2026-11-30" });

                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledTimes(1);
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(7);
                expect(events).toEqual(["committed", "schedule:7"]);
                expect(prismaService.employee_schedule.findMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: expect.objectContaining({
                        branchId,
                        clientId: 1,
                        replaced: false,
                        terminatedAt: null,
                    }),
                    orderBy: { id: "asc" },
                }));
            });

            it("schedules the link for every active schedule, in id order", async () => {
                arrange(preBooking, waiting);
                activeSchedulesAfterCommit([7, 9]);

                await service.update(branchId, 1, { endDate: "2026-11-30" });

                expect(serviceRecordLinkService.scheduleForServiceStart.mock.calls).toEqual([[7], [9]]);
            });

            it("does not schedule while the end date is still missing (effective status stays 예약 전)", async () => {
                arrange(
                    preBooking,
                    { serviceStatus: "waiting", startDate: futureStart, endDate: null },
                );
                activeSchedulesAfterCommit([7]);

                await service.update(branchId, 1, { serviceStatus: "waiting" });

                expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            });

            it("schedules the link when the save fills in the missing end date of a client with no stored status", async () => {
                arrange(
                    { serviceStatus: null, startDate: futureStart, endDate: null },
                    { serviceStatus: null, startDate: futureStart, endDate: futureEnd },
                );
                activeSchedulesAfterCommit([7]);

                await service.update(branchId, 1, { endDate: "2026-11-30" });

                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledTimes(1);
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(7);
            });

            it("does not schedule when the save keeps the client in 예약 전", async () => {
                arrange(preBooking, preBooking);
                activeSchedulesAfterCommit([7]);

                await service.update(branchId, 1, { name: "새 고객 이름" });

                expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            });

            it("does not schedule when the client was not 예약 전 before the save", async () => {
                arrange(waiting, waiting);
                activeSchedulesAfterCommit([7]);

                await service.update(branchId, 1, { name: "새 고객 이름" });

                expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            });

            it("schedules a schedule created by the same save exactly once", async () => {
                arrange(preBooking, waiting);
                prismaService.employee_schedule.findFirst.mockResolvedValue({
                    id: 10,
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: null,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });
                activeSchedulesAfterCommit([20]);

                await service.update(branchId, 1, { endDate: "2026-11-30", primaryEmployeeId: 7 });

                expect(prismaService.employee_schedule.create).toHaveBeenCalled();
                expect(serviceRecordLinkService.scheduleForServiceStart.mock.calls).toEqual([[20]]);
            });

            it("still schedules the other active schedules when the save also creates one", async () => {
                arrange(preBooking, waiting);
                prismaService.employee_schedule.findFirst.mockResolvedValue({
                    id: 10,
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: null,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });
                activeSchedulesAfterCommit([20, 21]);

                await service.update(branchId, 1, { endDate: "2026-11-30", primaryEmployeeId: 7 });

                expect(serviceRecordLinkService.scheduleForServiceStart.mock.calls).toEqual([[20], [21]]);
            });

            it("keeps the save successful and logs when scheduling a link rejects", async () => {
                const { afterClient } = arrange(preBooking, waiting);
                activeSchedulesAfterCommit([7, 9]);
                serviceRecordLinkService.scheduleForServiceStart.mockRejectedValueOnce(new Error("sms unavailable"));
                const logError = jest.spyOn((service as unknown as { logger: { error: (message: string) => void } }).logger, "error")
                    .mockImplementation(() => undefined);

                await expect(service.update(branchId, 1, { endDate: "2026-11-30" })).resolves.toBe(afterClient);

                expect(logError).toHaveBeenCalledWith(expect.stringContaining("sms unavailable"));
                // The failure of one schedule does not stop the next one.
                expect(serviceRecordLinkService.scheduleForServiceStart.mock.calls).toEqual([[7], [9]]);
            });

            it("keeps the save successful and logs when reading the active schedules fails", async () => {
                const { afterClient } = arrange(preBooking, waiting);
                prismaService.employee_schedule.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
                    if (where["terminatedAt"] === null) throw new Error("read unavailable");
                    return [];
                });
                const logError = jest.spyOn((service as unknown as { logger: { error: (message: string) => void } }).logger, "error")
                    .mockImplementation(() => undefined);

                await expect(service.update(branchId, 1, { endDate: "2026-11-30" })).resolves.toBe(afterClient);

                expect(logError).toHaveBeenCalledWith(expect.stringContaining("read unavailable"));
                expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            });
        });

        describe("given existing client and primary employee change", () => {
            it("discovers historical schedules before locking the case or writing a replacement", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                prismaService.employee_schedule.findMany.mockResolvedValue([
                    { id: 1, primaryEmployeeId: 1, secondaryEmployeeId: null },
                    { id: 10, primaryEmployeeId: 3, secondaryEmployeeId: null },
                ]);
                prismaService.employee_schedule.findFirst.mockResolvedValue({
                    id: 10,
                    clientId: existingClient.id,
                    primaryEmployeeId: 3,
                    secondaryEmployeeId: null,
                });
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: existingClient.id });

                await service.update(branchId, existingClient.id, { primaryEmployeeId: 4 });

                expect(prismaService.employee_schedule.findMany).toHaveBeenCalledWith({
                    where: { branchId, clientId: existingClient.id },
                    select: {
                        id: true,
                        primaryEmployeeId: true,
                        secondaryEmployeeId: true,
                    },
                    orderBy: { id: "asc" },
                });
                expect(prismaService.employee_schedule.create).toHaveBeenCalled();
            });

            it("should mark old schedule as replaced and create new schedule", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Mock findFirst to return current schedule with a different employee
                prismaService.employee_schedule.findFirst.mockResolvedValue({ 
                    id: 10, 
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: null,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(branchId, 1, { primaryEmployeeId: 7 });

                // Assert
                // Should lookup current schedule by clientId
                expect(prismaService.employee_schedule.findFirst).toHaveBeenCalledWith({
                    where: { clientId: 1, branchId: "org-1", replaced: false },
                    orderBy: { id: 'desc' },
                });
                // Mark old schedule as replaced
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 10 },
                    data: { replaced: true, endDate: expect.any(Date) },
                });
                // Create new schedule with clientId
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 7,
                        replaced: false,
                    }),
                });
                expect(serviceRecordLinkService.revoke).toHaveBeenCalledWith(10);
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(20);
            });

            const arrangeReplacement = (currentScheduleStartDate: Date) => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue({
                    id: 10,
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: null,
                    startDate: currentScheduleStartDate,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });
                updateClientUsecase.execute.mockResolvedValue(createClientEntity());
            };

            const writtenPeriods = () => ({
                outgoingEndDate: prismaService.employee_schedule.update.mock.calls[0][0].data.endDate as Date,
                incoming: prismaService.employee_schedule.create.mock.calls[0][0].data as {
                    startDate: Date;
                    endDate: Date;
                },
            });

            // Regression: the incoming schedule used to inherit the client's contract start,
            // so every past provider appeared to have started on the contract's first day.
            it("starts the incoming schedule on the handover day, not the contract start", async () => {
                jest.useFakeTimers().setSystemTime(new Date("2024-03-15T01:00:00.000Z"));
                try {
                    arrangeReplacement(new Date("2024-01-01T00:00:00.000Z"));

                    await service.update(branchId, 1, { primaryEmployeeId: 7 });

                    const { outgoingEndDate, incoming } = writtenPeriods();
                    expect(incoming.startDate).not.toEqual(new Date("2024-01-01T00:00:00.000Z"));
                    // The handover day is shared: the outgoing row ends where the incoming row starts.
                    expect(incoming.startDate).toEqual(outgoingEndDate);
                    expect(incoming.endDate).toEqual(new Date("2024-06-01"));
                } finally {
                    jest.useRealTimers();
                }
            });

            it("does not write an inverted range when the contract has already ended", async () => {
                jest.useFakeTimers().setSystemTime(new Date("2026-09-02T01:00:00.000Z"));
                try {
                    arrangeReplacement(new Date("2024-01-01T00:00:00.000Z"));

                    await service.update(branchId, 1, { primaryEmployeeId: 7 });

                    const { incoming } = writtenPeriods();
                    expect(incoming.startDate.getTime()).toBeLessThanOrEqual(incoming.endDate.getTime());
                    // Pulled up to the handover day rather than extended by a default service period.
                    expect(incoming.endDate).toEqual(incoming.startDate);
                } finally {
                    jest.useRealTimers();
                }
            });

            it("keeps the contract period for a first assignment", async () => {
                jest.useFakeTimers().setSystemTime(new Date("2024-03-15T01:00:00.000Z"));
                try {
                    findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());
                    prismaService.employee_schedule.findFirst.mockResolvedValue(null);
                    prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });
                    updateClientUsecase.execute.mockResolvedValue(createClientEntity());

                    await service.update(branchId, 1, { primaryEmployeeId: 7 });

                    const incoming = prismaService.employee_schedule.create.mock.calls[0][0].data;
                    expect(incoming.startDate).toEqual(new Date("2024-01-01"));
                    expect(incoming.endDate).toEqual(new Date("2024-06-01"));
                    expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                } finally {
                    jest.useRealTimers();
                }
            });

            it("keeps service-record access for the old assignment when replacement creation fails", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue({
                    id: 10,
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: null,
                });
                prismaService.employee_schedule.create.mockRejectedValue(new Error("schedule insert failed"));

                await expect(
                    service.update(branchId, 1, { primaryEmployeeId: 7 }),
                ).rejects.toThrow("schedule insert failed");

                expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
                expect(serviceRecordLinkService.revoke).not.toHaveBeenCalled();
                expect(updateClientUsecase.execute).not.toHaveBeenCalled();
            });

            it("should NOT create new schedule if same employee is selected", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Mock findFirst to return current schedule with the SAME employee
                prismaService.employee_schedule.findFirst.mockResolvedValue({ 
                    id: 10, 
                    clientId: 1,
                    primaryEmployeeId: 7,
                    secondaryEmployeeId: null,
                });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(branchId, 1, { primaryEmployeeId: 7 });

                // Assert
                // Should lookup current schedule
                expect(prismaService.employee_schedule.findFirst).toHaveBeenCalled();
                // Should NOT mark old schedule as replaced or create new schedule
                expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            });
        });

        describe("given non-existent client", () => {
            it("should reject with the public RESOURCE_NOT_FOUND problem body", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                const error: unknown = await service.update(branchId, 999, { name: "New Name" })
                    .catch((caught: unknown) => caught);
                expect(error).toBeInstanceOf(NotFoundException);
                expect((error as NotFoundException).getResponse()).toEqual({
                    code: "RESOURCE_NOT_FOUND",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                    message: "고객을 찾을 수 없습니다.",
                });
            });
        });

        describe("given secondary employee being added", () => {
            it("should create new schedule with secondary employee", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // No existing schedule
                prismaService.employee_schedule.findFirst.mockResolvedValue(null);
                prismaService.employee_schedule.create.mockResolvedValue({ id: 21, clientId: 1 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(branchId, 1, { primaryEmployeeId: 5, secondaryEmployeeId: 8 });

                // Assert
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 5,
                        secondaryEmployeeId: 8,
                        replaced: false,
                    }),
                });
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(21);
            });
        });

        describe("given secondary employee being removed", () => {
            it("should mark old schedule as replaced and create new schedule without secondary", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Current schedule has secondary employee
                prismaService.employee_schedule.findFirst.mockResolvedValue({
                    id: 15,
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: 6,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(branchId, 1, { secondaryEmployeeId: null });

                // Assert
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 15 },
                    data: { replaced: true, endDate: expect.any(Date) },
                });
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 5,
                        secondaryEmployeeId: null,
                    }),
                });
                expect(serviceRecordLinkService.revoke).toHaveBeenCalledWith(15);
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(20);
            });
        });

        describe("phone collision guard", () => {
            it("rejects updating a client's phone to one already used by another client in the branch", async () => {
                // Arrange
                const existingClient = createClientEntity(); // id = 1
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                // Another client (id = 2) already holds that phone
                const otherClient = new ClientEntity(
                    2, "Other Client", "Other Address", "010-1234-5678",
                    "A형", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false, null,
                );
                clientRepository.findByPhone.mockResolvedValue(otherClient);

                // Act & Assert
                await expect(
                    service.update(branchId, 1, { phone: "010-1234-5678" }),
                ).rejects.toMatchObject({
                    status: 409,
                    response: clientProblemResponse("CLIENT_PHONE_ALREADY_REGISTERED", "/phone", "INVALID_VALUE", "같은 전화번호의 고객이 이미 등록되어 있습니다."),
                });

                // No DB writes should have occurred
                expect(updateClientUsecase.execute).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
            });

            it("allows update when the matching client is the same record (self)", async () => {
                // Arrange
                const existingClient = createClientEntity(); // id = 1
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                updateClientUsecase.execute.mockResolvedValue(existingClient);

                // findByPhone returns the same client (id = 1) — keeping own phone
                clientRepository.findByPhone.mockResolvedValue(existingClient);

                // Act
                await service.update(branchId, 1, { phone: "010-1234-5678" });

                // Assert: update proceeded
                expect(prismaService.client.updateMany).toHaveBeenCalledTimes(1);
            });

            it("allows update when no other client has that phone", async () => {
                // Arrange
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                updateClientUsecase.execute.mockResolvedValue(existingClient);

                // findByPhone returns null — no collision
                clientRepository.findByPhone.mockResolvedValue(null);

                // Act
                await service.update(branchId, 1, { phone: "010-9999-0000" });

                // Assert: update proceeded
                expect(prismaService.client.updateMany).toHaveBeenCalledTimes(1);
            });
        });
    });

    // ============================================
    // findAll
    // ============================================
    describe("findAll", () => {
        it("should delegate to listClientsUsecase and attach employee info", async () => {
            // Arrange
            const mockClients = [createClientEntity()];
            listClientsUsecase.execute.mockResolvedValue(mockClients);

            // Act
            const result = await service.findAll(branchId);

            // Assert
            expect(listClientsUsecase.execute).toHaveBeenCalledWith(branchId);
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                id: 1,
                name: "Test Client",
                primaryEmployee: null,
                secondaryEmployee: null,
                hasSigned: false,
            });
        });

        it("should include employee phone numbers from active schedule", async () => {
            // Arrange
            const mockClients = [createClientEntity()];
            listClientsUsecase.execute.mockResolvedValue(mockClients);
            prismaService.employee_schedule.findMany.mockResolvedValue([
                {
                    clientId: 1,
                    primaryEmployee: {
                        id: 55,
                        name: "지원자 1",
                        phone: "010-0000-1111",
                    },
                    secondaryEmployee: {
                        id: 66,
                        name: "지원자 2",
                        phone: "010-0000-2222",
                    },
                },
            ]);

            // Act
            const result = await service.findAll(branchId);

            // Assert
            expect(result[0]).toMatchObject({
                primaryEmployee: {
                    id: 55,
                    name: "지원자 1",
                    phone: "010-0000-1111",
                },
                secondaryEmployee: {
                    id: 66,
                    name: "지원자 2",
                    phone: "010-0000-2222",
                },
            });
        });

        it("flags serviceRecordPeriodLocked from one batched finalized-case lookup", async () => {
            const lockedClient = createClientEntity();
            const openClient = createClientEntity();
            Object.assign(lockedClient, { id: 1 });
            Object.assign(openClient, { id: 2 });
            listClientsUsecase.execute.mockResolvedValue([lockedClient, openClient]);
            prismaService.service_record_case.findMany.mockResolvedValue([{ clientId: 1 }]);

            const result = await service.findAll(branchId);

            expect(result.map((client) => [client.id, client.serviceRecordPeriodLocked])).toEqual([[1, true], [2, false]]);
            expect(prismaService.service_record_case.findMany).toHaveBeenCalledTimes(1);
            expect(prismaService.service_record_case.findMany).toHaveBeenCalledWith({
                where: {
                    clientId: { in: [1, 2] },
                    status: { in: ["FINALIZING", "FINALIZATION_FAILED", "DOCUMENTS_CREATED", "COMPLETED"] },
                },
                select: { clientId: true },
            });
        });

        describe("hasSigned contract projection", () => {
            const clientWithDocument = () => {
                const client = createClientEntity();
                client.eDocId = "document-1";
                return client;
            };

            it("stays false while the customer signing step is current", async () => {
                listClientsUsecase.execute.mockResolvedValue([clientWithDocument()]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "060", stepType: "05", stepName: "고객 서명" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.hasSigned).toBe(false);
            });

            it("is true when an in-progress document is at the provider review step", async () => {
                listClientsUsecase.execute.mockResolvedValue([clientWithDocument()]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "070", stepType: "06", stepName: "제공기관 확인" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.hasSigned).toBe(true);
            });

            it("is true for a completed document even when step fields are absent", async () => {
                listClientsUsecase.execute.mockResolvedValue([clientWithDocument()]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "003" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.hasSigned).toBe(true);
            });

            it("is true for 071 (reviewer rejection, 계약-04) on the provider-review step: the customer's signature is still valid", async () => {
                listClientsUsecase.execute.mockResolvedValue([clientWithDocument()]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "071", stepType: "06", stepName: "제공기관 확인" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.hasSigned).toBe(true);
            });

            it.each(["042", "049", "080", "999"])(
                "fails closed for dead or unknown status %s",
                async (statusType) => {
                    listClientsUsecase.execute.mockResolvedValue([clientWithDocument()]);
                    prismaService.eformsign_doc.findMany.mockResolvedValue([
                        { clientId: 1, statusType, stepType: "06", stepName: "제공기관 확인" },
                    ]);

                    const [result] = await service.findAll(branchId);

                    expect(result?.hasSigned).toBe(false);
                },
            );

            it("fails closed when the client has no latest contract document", async () => {
                const client = clientWithDocument();
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([]);

                const [result] = await service.findAll(branchId);

                expect(result?.hasSigned).toBe(false);
            });
        });

        describe("contract required badge", () => {
            const createWaitingClient = (startDate: string, eDocId: string | null = null) =>
                new ClientEntity(
                    1,
                    "Test Client",
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    new Date(`${startDate}T00:00:00.000Z`),
                    new Date("2026-08-31T00:00:00.000Z"),
                    false,
                    true,
                    null,
                    "waiting",
                    false,
                    eDocId,
                    null, null, null, null, false, null, undefined, new Date("2026-01-01"),
                );

            beforeEach(() => {
                jest.useFakeTimers();
                jest.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
            });

            afterEach(() => {
                jest.useRealTimers();
            });

            it("should show contract required from exactly three business days before service start", async () => {
                listClientsUsecase.execute.mockResolvedValue([createWaitingClient("2026-07-16")]);

                const [client] = await service.findAll(branchId);

                expect(client?.badges[0]?.key).toBe("contract_required");
            });

            // 2026-07-17 is 제헌절, so these calendar dates are deliberately not
            // the same distance in business days.
            it("should show contract required at exactly six business days before start when unsent", async () => {
                listClientsUsecase.execute.mockResolvedValue([createWaitingClient("2026-07-22")]);

                const [client] = await service.findAll(branchId);

                expect(client?.badges.some((badge) => badge.key === "contract_required")).toBe(true);
            });

            it("should hide contract required more than six business days before service start", async () => {
                listClientsUsecase.execute.mockResolvedValue([createWaitingClient("2026-07-23")]);

                const [client] = await service.findAll(branchId);

                expect(client?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
            });

            it("should hide contract required once an active document exists, even unsigned", async () => {
                const client = createWaitingClient("2026-07-22", "sent-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "060", stepType: "02", stepName: "이용자 서명" },
                ]);

                const [result] = await service.findAll(branchId);

                // "060" (requested) is an active document — no signal even though unsigned.
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
            });

            it("should hide contract required after the contract is completed", async () => {
                const client = createWaitingClient("2026-07-16", "completed-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "003" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
            });

            it("should hide contract required once the customer signed and only provider review remains", async () => {
                const client = createWaitingClient("2026-07-16", "signed-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "070", stepType: "06", stepName: "제공기관 확인" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.documentStatus).toBe("requested");
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
            });

            it("should not show contract required while an unsigned document is still active", async () => {
                const client = createWaitingClient("2026-07-16", "awaiting-signature-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "060", stepType: "02", stepName: "이용자 서명" },
                ]);

                const [result] = await service.findAll(branchId);

                // A sent-but-unsigned contract no longer gets flagged.
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
            });

            it("should not show contract required for a document at 071 (reviewer rejection, 계약-04): it is a live contract", async () => {
                const client = createWaitingClient("2026-07-16", "reviewer-rejected-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "071", stepType: "06", stepName: "제공기관 확인" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.documentStatus).toBe("requested");
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
            });

            it("should show contract required when a document rejected at the review step is the latest", async () => {
                const client = createWaitingClient("2026-07-16", "rejected-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "061", stepType: "06", stepName: "제공기관 확인" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.documentStatus).toBe("rejected");
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(true);
            });

            it("should show contract required when the only document was revoked, even though eDocId is still set", async () => {
                const client = createWaitingClient("2026-07-16", "revoked-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "042" },
                ]);

                const [result] = await service.findAll(branchId);

                // The client's own eDocId still points at the cancelled document, but a
                // revoked document is a dead document — it must not suppress the badge.
                expect(result?.eDocId).toBe("revoked-document");
                expect(result?.documentStatus).toBe("revoked");
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(true);
            });

            it("should read a cancellation-requested (040) document as revoke_requested and keep it a live contract", async () => {
                const client = createWaitingClient("2026-07-16", "revoke-requested-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "040" },
                ]);

                const [result] = await service.findAll(branchId);

                // 040 is a pending request, not a cancellation: eformsign may still refuse it.
                expect(result?.documentStatus).toBe("revoke_requested");
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
                expect(result?.actionRequired).toBeNull();
            });

            it.each([
                ["040", "revoke_requested"],
                ["045", "revoke_requested"],
                ["041", "requested"],
                ["060", "requested"],
                ["063", "requested"],
                ["064", "requested"],
                ["070", "requested"],
                ["042", "revoked"],
                ["090", "revoked"],
                ["099", "deleted"],
                ["062", "completed"],
                ["050", "completed"],
            ])("should map eformsign %s to client documentStatus %s", async (statusType, documentStatus) => {
                listClientsUsecase.execute.mockResolvedValue([
                    createWaitingClient("2026-07-16", "doc"),
                ]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([{ clientId: 1, statusType }]);

                const [result] = await service.findAll(branchId);

                expect(result?.documentStatus).toBe(documentStatus);
            });

            it.each(["040", "045", "041", "060", "063", "064"])(
                "should keep a %s document a live contract: no 계약서 필요 badge, no action required",
                async (statusType) => {
                    listClientsUsecase.execute.mockResolvedValue([
                        createWaitingClient("2026-07-16", "doc"),
                    ]);
                    prismaService.eformsign_doc.findMany.mockResolvedValue([{ clientId: 1, statusType }]);

                    const [result] = await service.findAll(branchId);

                    expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
                    expect(result?.actionRequired).toBeNull();
                },
            );

            it.each(["042", "090"])("should still flag 계약서 필요 for a %s (revoked) document", async (statusType) => {
                listClientsUsecase.execute.mockResolvedValue([
                    createWaitingClient("2026-07-16", "doc"),
                ]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([{ clientId: 1, statusType }]);

                const [result] = await service.findAll(branchId);

                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(true);
            });

            it("should read a signed-and-revoke-requested document as revoke_requested", async () => {
                const client = createWaitingClient("2026-07-16", "revoke-requested-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "040", stepType: "06", stepName: "제공기관 확인" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.documentStatus).toBe("revoke_requested");
            });

            it.each([
                ["060", "requested"],
                ["042", "revoked"],
            ])("should read a later %s after a 040 as %s", async (laterStatusType, documentStatus) => {
                listClientsUsecase.execute.mockResolvedValue([
                    createWaitingClient("2026-07-16", "doc"),
                ]);
                // Newest first: the refused (060) or completed (042) cancellation is the latest row.
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, documentId: "doc", statusType: laterStatusType },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.documentStatus).toBe(documentStatus);
            });

            it.each(["042", "090"])("should keep %s as revoked", async (statusType) => {
                listClientsUsecase.execute.mockResolvedValue([
                    createWaitingClient("2026-07-16", "doc"),
                ]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([{ clientId: 1, statusType }]);

                const [result] = await service.findAll(branchId);

                expect(result?.documentStatus).toBe("revoked");
            });

            it("should preserve a completed lifecycle status while its mirror is syncing", async () => {
                const client = createWaitingClient("2026-07-16", "completed-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "003" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.documentStatus).toBe("completed");
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
                expect(prismaService.eformsign_doc.findMany).toHaveBeenCalledWith({
                    where: {
                        clientId: { in: [1] },
                        serviceRecordCaseId: null,
                        OR: [
                            { documentKind: "contract" },
                            { documentKind: null },
                        ],
                    },
                    orderBy: [
                        { createdDate: "desc" },
                        { id: "desc" },
                    ],
                    select: {
                        clientId: true,
                        documentId: true,
                        statusType: true,
                        stepType: true,
                        stepName: true,
                        detailPayload: true,
                        permanentPurgeRequestedAt: true,
                        documentKind: true,
                        serviceRecordCaseId: true,
                        templateId: true,
                    },
                });
            });

            it("should not fall back to an older completed contract when the newest mirror artifacts are not ready", async () => {
                const client = createWaitingClient("2026-07-16", "new-requested-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "060" },
                    { clientId: 1, statusType: "003" },
                ]);

                const [result] = await service.findAll(branchId);

                // Proves no fallback to the older completed doc: had it fallen back,
                // documentStatus would read "completed" instead of "requested".
                // "060"/requested is itself an active document, so no badge either way.
                expect(result?.documentStatus).toBe("requested");
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
            });

            it("should not fall back to an older completed contract when the newest contract is deleted", async () => {
                const client = createWaitingClient("2026-07-16", "deleted-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "049", permanentPurgeRequestedAt: null },
                    { clientId: 1, statusType: "003", permanentPurgeRequestedAt: null },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.documentStatus).toBe("deleted");
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(true);
            });

            it("should ignore legacy service-record rows when choosing the latest contract", async () => {
                const client = createWaitingClient("2026-07-16", "requested-contract");
                listClientsUsecase.execute.mockResolvedValue([client]);
                configService.get.mockImplementation((key: string) =>
                    key === "EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"
                        ? "service-record-template"
                        : undefined);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    {
                        clientId: 1,
                        statusType: "003",
                        documentKind: null,
                        serviceRecordCaseId: "case-1",
                        templateId: null,
                    },
                    {
                        clientId: 1,
                        statusType: "003",
                        documentKind: null,
                        serviceRecordCaseId: null,
                        templateId: "service-record-template",
                    },
                    {
                        clientId: 1,
                        statusType: "060",
                        documentKind: "contract",
                        serviceRecordCaseId: null,
                        templateId: "contract-template",
                    },
                ]);

                const [result] = await service.findAll(branchId);

                // The correctly-identified contract row ("060"/requested) is itself an
                // active document, so no badge — but the assertion proves the two
                // service-record rows were skipped, not that a badge should show.
                expect(result?.documentStatus).toBe("requested");
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
            });

            it.each([
                ["003", "completed"],
                ["060", "requested"],
            ])("pairs the latest contract ID with its %s status despite a stale pin", async (statusType, documentStatus) => {
                listClientsUsecase.execute.mockResolvedValue([
                    createWaitingClient("2026-07-16", "old-document"),
                ]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, documentId: "latest-document", statusType },
                    { clientId: 1, documentId: "old-document", statusType: "080" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result).toMatchObject({
                    eDocId: "old-document",
                    latestContractDocumentId: "latest-document",
                    documentStatus,
                });
            });

            it("should use the latest contract instead of the pinned eDocId for the badge", async () => {
                const client = createWaitingClient("2026-07-16", "old-rejected-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "003" },
                    { clientId: 1, statusType: "080" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.eDocId).toBe("old-rejected-document");
                expect(result?.documentStatus).toBe("completed");
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
                expect(prismaService.eformsign_doc.findMany).toHaveBeenCalledWith({
                    where: {
                        clientId: { in: [1] },
                        serviceRecordCaseId: null,
                        OR: [
                            { documentKind: "contract" },
                            { documentKind: null },
                        ],
                    },
                    orderBy: [
                        { createdDate: "desc" },
                        { id: "desc" },
                    ],
                    select: {
                        clientId: true,
                        documentId: true,
                        statusType: true,
                        stepType: true,
                        stepName: true,
                        detailPayload: true,
                        permanentPurgeRequestedAt: true,
                        documentKind: true,
                        serviceRecordCaseId: true,
                        templateId: true,
                    },
                });
                expect(prismaService.eformsign_doc.findMany).toHaveBeenCalledTimes(1);
            });

            it("should keep the existing badge behavior when the client has no contract documents", async () => {
                listClientsUsecase.execute.mockResolvedValue([createWaitingClient("2026-07-16")]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([]);

                const [result] = await service.findAll(branchId);

                expect(result?.documentStatus).toBeNull();
                expect(result).toHaveProperty("latestContractDocumentId", null);
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(true);
            });

            it("should keep showing contract required after service starts", async () => {
                listClientsUsecase.execute.mockResolvedValue([createWaitingClient("2026-07-10")]);

                const [client] = await service.findAll(branchId);

                expect(client?.badges[0]?.key).toBe("contract_required");
            });

            it("should show a neutral pre-booking badge without requiring a contract", async () => {
                const preBookingClient = createWaitingClient("2026-07-16");
                preBookingClient.startDate = null;
                preBookingClient.endDate = null;
                preBookingClient.serviceStatus = "pre_booking";
                listClientsUsecase.execute.mockResolvedValue([preBookingClient]);

                const [client] = await service.findAll(branchId);

                expect(client?.badges).toEqual([
                    expect.objectContaining({
                        key: "service_status",
                        status: "preBooking",
                        label: "예약 전",
                        tone: "neutral",
                    }),
                ]);
            });
        });

        // Ported from the deleted frontend copy (lib/client/action-required.ts).
        // The dashboard now renders this value instead of recomputing it.
        describe("actionRequired", () => {
            const createClient = (
                startDate: string,
                eDocId: string | null,
                serviceStatus = "active",
            ) => {
                const client = new ClientEntity(
                    1,
                    "Test Client",
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    new Date(`${startDate}T00:00:00.000Z`),
                    new Date("2026-04-04T00:00:00.000Z"),
                    false,
                    true,
                    null,
                    serviceStatus,
                    false,
                    eDocId,
                    null, null, null, null, false, null, undefined,
                    serviceStatus === "pre_booking" ? null : new Date("2026-01-01"),
                );
                return client;
            };

            beforeEach(() => {
                jest.useFakeTimers();
                jest.setSystemTime(new Date("2026-03-17T09:00:00.000Z"));
                prismaService.eformsign_doc.findMany.mockResolvedValue([]);
            });

            afterEach(() => {
                jest.useRealTimers();
            });

            const actionRequiredFor = async (client: ClientEntity) => {
                listClientsUsecase.execute.mockResolvedValue([client]);
                const [result] = await service.findAll(branchId);
                return result?.actionRequired ?? null;
            };

            it("returns no action for a pre-booking client even if a start date is present", async () => {
                const client = createClient("2026-07-15", null, "pre_booking");

                expect(await actionRequiredFor(client)).toBeNull();
            });

            it("returns replacement requested with highest priority", async () => {
                const client = createClient("2026-03-30", "doc-1", "replacement_requested");

                expect(await actionRequiredFor(client)).toEqual({ reason: "교체 요청", priority: 1 });
            });

            it("returns send required when start date is within 6 days and document is not sent", async () => {
                const client = createClient("2026-03-23", null);

                expect(await actionRequiredFor(client)).toEqual({ reason: "발송 필요", priority: 3 });
            });

            it("keeps send required even when service starts in 2 days if document is not sent", async () => {
                const client = createClient("2026-03-19", null);

                expect(await actionRequiredFor(client)).toEqual({ reason: "발송 필요", priority: 3 });
            });

            it("returns no action when an active document is sent but still unsigned", async () => {
                const client = createClient("2026-03-19", "doc-1");
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "010", stepType: "02", stepName: "이용자 서명" },
                ]);

                // "010" (created) is an active document — no signal even close to start.
                expect(await actionRequiredFor(client)).toBeNull();
            });

            it("does not return send required beyond the 6-business-day threshold", async () => {
                const client = createClient("2026-04-30", null);

                expect(await actionRequiredFor(client)).toBeNull();
            });

            it("counts the send window with the branch calendar", async () => {
                // 2026-03-26 is 7 business days out, so no send alert; a branch day off on
                // 2026-03-20 pulls it to 6 and the alert appears.
                const client = createClient("2026-03-26", null);
                expect(await actionRequiredFor(client)).toBeNull();

                (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(branchCalendar2026(["2026-03-20"]));
                expect(await actionRequiredFor(client)).toEqual({ reason: "발송 필요", priority: 3 });
            });

            it("counts the window in business days, not calendar days", async () => {
                // 2026-03-22 is 5 calendar days out but only 3 business days.
                const client = createClient("2026-03-22", null);

                expect(await actionRequiredFor(client)).toEqual({ reason: "발송 필요", priority: 3 });
            });

            it("does not return action required for completed documents", async () => {
                const client = createClient("2026-03-18", "doc-1");
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "003", stepType: "06", stepName: "제공기관 확인" },
                ]);

                expect(await actionRequiredFor(client)).toBeNull();
            });

            it("does not return signature required once the customer signed and only provider review remains", async () => {
                const client = createClient("2026-03-18", "doc-1");
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "070", stepType: "06", stepName: "제공기관 확인" },
                ]);

                expect(await actionRequiredFor(client)).toBeNull();
            });

            it("flags a client whose service status is unset", async () => {
                const client = createClient("2026-03-18", null, null as unknown as string);

                expect(await actionRequiredFor(client)).toEqual({ reason: "발송 필요", priority: 3 });
            });

            it("keeps the contract badge on a replacement-requested client with no contract", async () => {
                const client = createClient("2026-03-18", null, "replacement_requested");
                listClientsUsecase.execute.mockResolvedValue([client]);

                const [result] = await service.findAll(branchId);

                // 교체 요청 outranks it in the list, but the contract is still missing.
                expect(result?.actionRequired).toEqual({ reason: "교체 요청", priority: 1 });
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(true);
            });
        });

        // The dashboard counts the badge while the list renders actionRequired,
        // so the two must switch on at the same moment.
        describe("badge and actionRequired agreement", () => {
            const cases = [
                { label: "unsent, inside the send window", startDate: "2026-03-18", eDocId: null },
                { label: "unsent, outside the send window", startDate: "2026-04-30", eDocId: null },
                { label: "sent, inside the signature window", startDate: "2026-03-18", eDocId: "doc-1" },
                { label: "sent, outside the signature window", startDate: "2026-03-27", eDocId: "doc-1" },
            ];

            beforeEach(() => {
                jest.useFakeTimers();
                jest.setSystemTime(new Date("2026-03-17T09:00:00.000Z"));
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "060", stepType: "02", stepName: "이용자 서명" },
                ]);
            });

            afterEach(() => {
                jest.useRealTimers();
            });

            it.each(cases)("agrees when $label", async ({ startDate, eDocId }) => {
                listClientsUsecase.execute.mockResolvedValue([
                    new ClientEntity(
                        1, "Test Client", null, null, null, null, null, null, null,
                        new Date(`${startDate}T00:00:00.000Z`),
                        new Date("2026-05-30T00:00:00.000Z"),
                        false, true, null, "active", false, eDocId,
                    ),
                ]);

                const [result] = await service.findAll(branchId);
                const hasBadge = result?.badges.some((badge) => badge.key === "contract_required");

                expect(hasBadge).toBe(result?.actionRequired !== null);
            });
        });
    });

    // ============================================
    // findById
    // ============================================
    // ============================================
    // getActionRequiredAlerts (sidebar feed)
    // ============================================
    describe("getActionRequiredAlerts", () => {
        const alertClient = (overrides: Record<string, unknown> = {}) => ({
            id: 1,
            name: "Test Client",
            createdAt: new Date("2026-03-01T00:00:00.000Z"),
            startDate: new Date("2026-03-18T00:00:00.000Z"),
            endDate: new Date("2026-04-04T00:00:00.000Z"),
            serviceStatus: "active",
            eDocId: "doc-1",
            bookingConfirmedAt: new Date("2026-01-01"),
            ...overrides,
        });

        beforeEach(() => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date("2026-03-17T09:00:00.000Z"));
            prismaService.eformsign_doc.findMany.mockResolvedValue([]);
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it("drops the alert while an active document is unsigned", async () => {
            prismaService.client.findMany.mockResolvedValue([alertClient()]);
            prismaService.eformsign_doc.findMany.mockResolvedValue([
                { clientId: 1, statusType: "060", stepType: "02", stepName: "이용자 서명" },
            ]);

            // "060" (requested) is an active document — a sent-but-unsigned
            // contract no longer raises an alert.
            expect(await service.getActionRequiredAlerts(branchId)).toEqual([]);
        });

        it("drops the alert once the customer signed and only provider review remains", async () => {
            prismaService.client.findMany.mockResolvedValue([alertClient()]);
            prismaService.eformsign_doc.findMany.mockResolvedValue([
                { clientId: 1, statusType: "070", stepType: "06", stepName: "제공기관 확인" },
            ]);

            expect(await service.getActionRequiredAlerts(branchId)).toEqual([]);
        });

        it.each(["040", "045", "041"])(
            "drops the alert while the latest contract is %s (revoke requested / refused revoke)",
            async (statusType) => {
                prismaService.client.findMany.mockResolvedValue([alertClient()]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType },
                ]);

                expect(await service.getActionRequiredAlerts(branchId)).toEqual([]);
            },
        );

        it("reads the latest contract rather than the document pinned by eDocId", async () => {
            prismaService.client.findMany.mockResolvedValue([alertClient()]);
            // Newest first: the latest document was revoked even though an older
            // one had completed — the client needs a new contract sent.
            prismaService.eformsign_doc.findMany.mockResolvedValue([
                { clientId: 1, statusType: "042" },
                { clientId: 1, statusType: "003" },
            ]);

            const alerts = await service.getActionRequiredAlerts(branchId);

            expect(alerts).toEqual([
                expect.objectContaining({ reason: "발송 필요", priority: 3 }),
            ]);
        });

        it("uses one branch calendar for both the scan cutoff and the per-client decision", async () => {
            const lteOf = (): Date => {
                const where = prismaService.client.findMany.mock.calls.at(-1)![0].where;
                return where.OR[1].startDate.lt as Date;
            };
            const client = alertClient({ eDocId: null, startDate: new Date("2026-03-26T00:00:00.000Z") });
            prismaService.client.findMany.mockResolvedValue([client]);

            // 2026-03-26 is 7 business days out: beyond both the cutoff and the threshold.
            expect(await service.getActionRequiredAlerts(branchId)).toEqual([]);
            const builtinCutoff = lteOf();

            (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(branchCalendar2026(["2026-03-20"]));
            const alerts = await service.getActionRequiredAlerts(branchId);

            expect(alerts).toEqual([expect.objectContaining({ reason: "발송 필요", priority: 3 })]);
            expect(lteOf().getTime()).toBeGreaterThan(builtinCutoff.getTime());
            expect(holidayCalendar.forBranch).toHaveBeenCalledWith(branchId);
        });

        // 2026-09-30T16:30:00Z is 2026-10-01 01:30 in Korea. A UTC server must still
        // count business days from the Korean date (Oct 1), not from Sep 30.
        // 2026-10-01T03:00:00Z (12:00 KST) is the control: both readings agree.
        // Stored start dates are calendar dates held as UTC midnight, so the filter is
        // judged by which of those it admits, not by one particular lte/lt form.
        describe.each([
            ["2026-09-30T16:30:00.000Z", "just after Korean midnight"],
            ["2026-10-01T03:00:00.000Z", "midday in Korea (control)"],
        ])("send-window cutoff at %s (%s)", (instant) => {
            it("admits start dates up to the 6th business day after the Korean date, no later", async () => {
                jest.setSystemTime(new Date(instant));
                prismaService.client.findMany.mockResolvedValue([]);

                await service.getActionRequiredAlerts(branchId);

                const where = prismaService.client.findMany.mock.calls.at(-1)![0].where;
                const { lt } = where.OR[1].startDate as { lt: Date };
                const admits = (calendarDate: string) =>
                    new Date(`${calendarDate}T00:00:00.000Z`).getTime() < lt.getTime();
                // 2026-10-01 (KST) + 6 business days over the built-in holidays = 2026-10-13.
                expect(admits("2026-10-12")).toBe(true);
                expect(admits("2026-10-13")).toBe(true);
                expect(admits("2026-10-14")).toBe(false);
            });
        });

        it("stores the cutoff as the UTC-midnight Date of the business day just past the window", async () => {
            jest.setSystemTime(new Date("2026-09-30T16:30:00.000Z"));
            prismaService.client.findMany.mockResolvedValue([]);

            await service.getActionRequiredAlerts(branchId);

            const where = prismaService.client.findMany.mock.calls.at(-1)![0].where;
            expect(where.OR[1].startDate).toEqual({ lt: new Date("2026-10-14T00:00:00.000Z") });
        });

        // 2026-03-12 (Thu) + 6 business days = 2026-03-20 (Fri). A start on Saturday 03-21
        // is still 6 business days out, so it is due — the scan must not drop it.
        it("scans a weekend start that the per-client decision counts as inside the window", async () => {
            jest.setSystemTime(new Date("2026-03-12T03:00:00.000Z"));
            prismaService.client.findMany.mockResolvedValue([
                alertClient({ eDocId: null, startDate: new Date("2026-03-21T00:00:00.000Z") }),
            ]);

            const alerts = await service.getActionRequiredAlerts(branchId);

            expect(alerts).toEqual([expect.objectContaining({ reason: "발송 필요", priority: 3 })]);
            const where = prismaService.client.findMany.mock.calls.at(-1)![0].where;
            const { lt } = where.OR[1].startDate as { lt: Date };
            expect(new Date("2026-03-21T00:00:00.000Z").getTime()).toBeLessThan(lt.getTime());
            expect(new Date("2026-03-23T00:00:00.000Z").getTime()).toBeGreaterThanOrEqual(lt.getTime());
        });

        it("reports 발송 필요 when no document has been sent", async () => {
            prismaService.client.findMany.mockResolvedValue([
                alertClient({ eDocId: null, startDate: new Date("2026-03-20T00:00:00.000Z") }),
            ]);

            const alerts = await service.getActionRequiredAlerts(branchId);

            expect(alerts).toEqual([
                expect.objectContaining({ reason: "발송 필요", priority: 3 }),
            ]);
        });

        it.each(["pre_booking"])("scans confirmed dated clients with stale stored %s but excludes unconfirmed clients", async (serviceStatus) => {
            const rows = [
                alertClient({ id: 1, branchId, serviceStatus, eDocId: null }),
                alertClient({ id: 2, branchId, serviceStatus: "waiting", bookingConfirmedAt: null, eDocId: null }),
            ];
            prismaService.client.findMany.mockImplementation(findManyFrom(rows));

            expect(await service.getActionRequiredAlerts(branchId)).toEqual([
                expect.objectContaining({ id: 1, reason: "발송 필요" }),
            ]);
        });

        it("keeps finished clients from crowding a waiting client's alert out of the scan window", async () => {
            const finishedClientCount = 12;
            const waitingClientId = finishedClientCount + 1;
            const rows = [
                alertClient({ id: waitingClientId, branchId, serviceStatus: "waiting", eDocId: null }),
                ...Array.from({ length: finishedClientCount }, (_, index) => alertClient({
                    id: index + 1,
                    branchId,
                    serviceStatus: "completed",
                    createdAt: new Date(`2026-03-${String(index + 2).padStart(2, "0")}T00:00:00.000Z`),
                    startDate: new Date("2026-02-02T00:00:00.000Z"),
                    endDate: new Date("2026-02-20T00:00:00.000Z"),
                    eDocId: null,
                })),
            ];
            prismaService.client.findMany.mockImplementation(async (args: {
                where: Record<string, unknown>;
                orderBy: { createdAt: "asc" | "desc" };
                take: number;
            }) => rows
                .filter((row) => matchesWhere(row, args.where))
                .sort((left, right) => args.orderBy.createdAt === "desc"
                    ? right.createdAt.getTime() - left.createdAt.getTime()
                    : left.createdAt.getTime() - right.createdAt.getTime())
                .slice(0, args.take));

            expect(await service.getActionRequiredAlerts(branchId)).toEqual([
                expect.objectContaining({ id: waitingClientId, reason: "발송 필요" }),
            ]);
        });

        it("sorts by priority and honours the limit", async () => {
            prismaService.client.findMany.mockResolvedValue([
                alertClient({ id: 1, eDocId: null, startDate: new Date("2026-03-20T00:00:00.000Z") }),
                alertClient({ id: 2, serviceStatus: "replacement_requested" }),
            ]);

            const alerts = await service.getActionRequiredAlerts(branchId, 1);

            expect(alerts).toEqual([
                expect.objectContaining({ id: 2, reason: "교체 요청", priority: 1 }),
            ]);
        });
    });

    // ============================================
    // getStats (dashboard counts)
    // ============================================
    describe("getStats month boundaries", () => {
        afterEach(() => {
            jest.useRealTimers();
        });

        // 2026-09-30T16:30:00Z is 2026-10-01 01:30 in Korea; the server runs in UTC, so
        // the runtime's own month would still be September. 2026-10-01T03:00:00Z is the
        // control where both readings already agree.
        it.each([
            ["2026-09-30T16:30:00.000Z"],
            ["2026-10-01T03:00:00.000Z"],
        ])("counts upcoming clients by the Korean month at %s", async (instant) => {
            jest.useFakeTimers().setSystemTime(new Date(instant));
            // Stored start dates are calendar dates held as UTC midnight. All are in the future,
            // so each is "waiting" on the Korean calendar of both instants.
            const waitingStartingOn = (id: number, startDate: string) => ({
                id,
                bookingConfirmedAt: new Date("2026-01-01"),
                serviceStatus: "waiting",
                startDate: new Date(`${startDate}T00:00:00.000Z`),
                endDate: new Date("2027-03-01T00:00:00.000Z"),
            });
            prismaService.client.findMany.mockResolvedValue([
                waitingStartingOn(1, "2026-10-02"),
                waitingStartingOn(2, "2026-10-31"),
                waitingStartingOn(3, "2026-11-01"),
                waitingStartingOn(4, "2026-11-30"),
                waitingStartingOn(5, "2026-12-01"),
            ]);

            const stats = await service.getStats(branchId);

            expect(stats.upcomingThisMonth).toBe(2);
            expect(stats.upcomingNextMonth).toBe(2);
        });
    });

    // The dashboard counts the DERIVED status the client list shows, never the stored column.
    describe("getStats derived service status", () => {
        beforeEach(() => {
            jest.useFakeTimers().setSystemTime(new Date("2026-10-15T03:00:00.000Z"));
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        const stored = (id: number, serviceStatus: string | null, startDate: string, endDate: string) => ({
            id,
            serviceStatus,
            bookingConfirmedAt: serviceStatus === "pre_booking" ? null : new Date("2026-01-01"),
            startDate: new Date(`${startDate}T00:00:00.000Z`),
            endDate: new Date(`${endDate}T00:00:00.000Z`),
        });

        it("counts activeClients by the effective status, not the stored one", async () => {
            prismaService.client.findMany.mockResolvedValue([
                stored(1, "waiting", "2026-10-01", "2026-11-20"), // stored lag: running today
                stored(2, "active", "2026-10-01", "2026-11-20"), // running
                stored(3, "active", "2026-09-01", "2026-10-10"), // stored lag: already ended
                stored(4, "active", "2026-10-20", "2026-11-20"), // stored lag: not started yet
                stored(5, "terminated", "2026-10-01", "2026-11-20"), // manual status wins
                stored(6, "replacement_requested", "2026-10-01", "2026-11-20"), // manual status wins
            ]);

            const stats = await service.getStats(branchId);

            expect(stats.activeClients).toBe(2);
        });

        it("counts upcomingThisMonth / upcomingNextMonth by the effective waiting status", async () => {
            prismaService.client.findMany.mockResolvedValue([
                stored(1, "active", "2026-10-20", "2026-11-20"), // stored lag: waiting, starts this month
                stored(2, "waiting", "2026-10-20", "2026-11-20"), // waiting, this month
                stored(3, "waiting", "2026-10-01", "2026-11-20"), // stored lag: already running, not upcoming
                stored(4, "waiting", "2026-11-05", "2026-12-20"), // next month
                stored(5, "pre_booking", "2026-10-20", "2026-11-20"), // manual, not waiting
                stored(6, "terminated", "2026-11-05", "2026-12-20"), // manual, not waiting
            ]);

            const stats = await service.getStats(branchId);

            expect(stats.upcomingThisMonth).toBe(2);
            expect(stats.upcomingNextMonth).toBe(1);
        });

        it("no longer asks the database for stored-status counts", async () => {
            prismaService.client.findMany.mockResolvedValue([]);

            await service.getStats(branchId);

            expect(prismaService.client.count).not.toHaveBeenCalled();
        });
    });

    // A client whose dates fall outside the holiday calendar's supported range must not fail
    // the whole request: it is skipped from the business-day-based counts and logged by id.
    describe("calendar range guard", () => {
        const OUT_OF_RANGE = {
            startDate: new Date("2030-03-04T00:00:00.000Z"),
            endDate: new Date("2030-03-19T00:00:00.000Z"),
        };
        let warn: jest.SpyInstance;

        beforeEach(() => {
            jest.useFakeTimers().setSystemTime(new Date("2026-03-17T09:00:00.000Z"));
            warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        });

        afterEach(() => {
            warn.mockRestore();
            jest.useRealTimers();
        });

        const loggedText = () => warn.mock.calls.map(([message]) => String(message)).join("\n");

        it("getStats skips the out-of-range client from contractsNotSent and logs its id only", async () => {
            prismaService.client.findMany.mockResolvedValue([
                { id: 1, serviceStatus: "waiting", bookingConfirmedAt: new Date("2026-01-01"), startDate: new Date("2026-03-20T00:00:00.000Z"), endDate: new Date("2026-04-04T00:00:00.000Z"), name: "Kim Minji" },
                { id: 77, serviceStatus: "waiting", bookingConfirmedAt: new Date("2026-01-01"), ...OUT_OF_RANGE, name: "Park Soyoung" },
            ]);

            const stats = await service.getStats(branchId);

            expect(stats.contractsNotSent).toBe(1);
            expect(loggedText()).toContain("client 77");
            expect(loggedText()).not.toContain("Park");
        });

        it("getStats skips a client whose contract end date is out of range from the review count", async () => {
            prismaService.client.findMany.mockResolvedValue([{ id: 5 }]);
            prismaService.eformsign_doc.findMany.mockResolvedValue([{
                clientId: 5,
                documentId: "doc-5",
                statusType: "070",
                stepType: "06",
                stepName: "제공기관 확인",
                detailPayload: { fields: [{ id: "contract_end_date", value: "2030-03-19" }] },
                permanentPurgeRequestedAt: null,
                documentKind: "contract",
                serviceRecordCaseId: null,
                templateId: null,
            }]);

            await expect(service.getStats(branchId)).resolves.toEqual(expect.objectContaining({
                contractsPendingSignature: expect.any(Number),
            }));
        });

        it("getActionRequiredAlerts keeps serving the other clients", async () => {
            prismaService.client.findMany.mockResolvedValue([
                { id: 1, name: "A", createdAt: null, serviceStatus: "waiting", bookingConfirmedAt: new Date("2026-01-01"), startDate: new Date("2026-03-20T00:00:00.000Z"), endDate: new Date("2026-04-04T00:00:00.000Z") },
                { id: 77, name: "B", createdAt: null, serviceStatus: "waiting", bookingConfirmedAt: new Date("2026-01-01"), ...OUT_OF_RANGE },
            ]);

            const alerts = await service.getActionRequiredAlerts(branchId);

            expect(alerts.map((alert) => alert.id)).toEqual([1]);
            expect(loggedText()).toContain("client 77");
        });

        it("the client list still renders when one client's dates are out of range", async () => {
            const outOfRange = createClientEntity();
            outOfRange.startDate = OUT_OF_RANGE.startDate;
            outOfRange.endDate = OUT_OF_RANGE.endDate;
            outOfRange.serviceStatus = "waiting";
            listClientsUsecase.execute.mockResolvedValue([outOfRange]);

            const [client] = await service.findAll(branchId);

            expect(client?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
            expect(client?.actionRequired).toBeNull();
        });
    });

    // /clients/filtered, the AI chat and the PWA digest all read the repository's lists, so the
    // filters must hand the repository the branch calendar and stop passing the old eDocId pin.
    describe("findByFilter", () => {
        it("no-contract delegates to the dashboard rule with the branch calendar", async () => {
            const result = await service.findByFilter(branchId, "no-contract");

            expect(result).toEqual([]);
            expect(holidayCalendar.forBranch).toHaveBeenCalledWith(branchId);
            expect(clientRepository.findWithoutContractSentStartingWithinDays).toHaveBeenCalledWith(
                branchId,
                await (holidayCalendar.forBranch as jest.Mock).mock.results[0]!.value,
            );
        });

        it("incomplete-contracts reads the 7-day window through the repository", async () => {
            await service.findByFilter(branchId, "incomplete-contracts");

            expect(clientRepository.findWithIncompleteContractsStartingWithinDays).toHaveBeenCalledWith(branchId, 7);
        });
    });

    // The list the filter returns must be exactly the clients the dashboard counts in
    // contractsNotSent. Both read the same rows through the same rule.
    describe("no-contract list equals getStats().contractsNotSent", () => {
        const NOW = new Date("2026-03-17T09:00:00.000Z");
        const contractDoc = (clientId: number, statusType: string) => ({
            clientId,
            documentId: `doc-${clientId}`,
            statusType,
            stepType: "02",
            stepName: "이용자 서명",
            detailPayload: null,
            permanentPurgeRequestedAt: null,
            documentKind: "contract",
            serviceRecordCaseId: null,
            templateId: null,
        });
        const row = (id: number, overrides: Record<string, unknown> = {}) => ({
            id,
            name: `Client ${id}`,
            branchId,
            address: null,
            phone: null,
            type: null,
            duration: null,
            fullPrice: null,
            grant: null,
            actualPrice: null,
            careCenter: false,
            voucherClient: false,
            birthday: null,
            dueDate: null,
            birthDate: null,
            breastPump: false,
            areaId: null,
            createdAt: null,
            eDocId: null,
            serviceStatus: "waiting",
            startDate: new Date("2026-03-20T00:00:00.000Z"),
            endDate: new Date("2026-04-04T00:00:00.000Z"),
            bookingConfirmedAt: new Date("2026-01-01"),
            ...overrides,
        });

        beforeEach(() => {
            jest.useFakeTimers().setSystemTime(NOW);
            clearSchemaCapabilityCache();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it("agrees on a fixture covering 040/045/041, stale pins, dead contracts and status drift", async () => {
            const fixtureClients = [
                row(1, { eDocId: "doc-1" }), // 080 expired but still pinned: needs a contract
                row(2, { eDocId: null }), // 060 live, linked only by clientId: not counted
                row(3), // nothing at all: counted
                row(4), // 040 revoke requested, eDocId null: NOT counted
                row(5), // 045: NOT counted
                row(6), // 041 refused revoke: NOT counted
                row(7), // 042 revoked: counted
                row(8, { startDate: new Date("2026-03-30T00:00:00.000Z") }), // outside the send window
                row(9, { serviceStatus: "active" }), // stored active, effectively waiting: counted
                row(10, { startDate: new Date("2026-02-01T00:00:00.000Z"), endDate: new Date("2026-03-01T00:00:00.000Z") }), // ended
                row(11, { serviceStatus: "terminated" }),
                row(12, { startDate: new Date("2030-03-04T00:00:00.000Z"), endDate: new Date("2030-03-19T00:00:00.000Z") }), // out of calendar range
            ];
            const docs = [
                contractDoc(1, "080"),
                contractDoc(2, "060"),
                contractDoc(4, "040"),
                contractDoc(5, "045"),
                contractDoc(6, "041"),
                contractDoc(7, "042"),
            ];
            seedFixture(fixtureClients, docs);
            const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

            try {
                const stats = await service.getStats(branchId);
                const listed = await service.findByFilter(branchId, "no-contract");

                expect(stats.contractsNotSent).toBe(4);
                expect(listed.map((client) => client.id).sort((a, b) => a - b)).toEqual([1, 3, 7, 9]);
                expect(listed).toHaveLength(stats.contractsNotSent);
            } finally {
                warn.mockRestore();
            }
        });

        // Backs `service` with a real repository over the same fake database the stats read.
        // The fake EVALUATES the complete where clause of every query, so the repository's
        // database predicate is part of what the parity test exercises.
        function seedFixture(clients: ReturnType<typeof row>[], docs: ReturnType<typeof contractDoc>[]) {
            prismaService.client.findMany.mockImplementation(findManyFrom(clients));
            prismaService.eformsign_doc.findMany.mockImplementation(findManyFrom(docs));
            const repositoryPrisma = {
                client: { findMany: jest.fn(findManyFrom(clients)) },
                eformsign_doc: { findMany: jest.fn(findManyFrom(docs)) },
                $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
            };
            const realRepository = new SbClientRepository(repositoryPrisma as unknown as PrismaService);
            clientRepository.findWithoutContractSentStartingWithinDays.mockImplementation(
                (...args) => realRepository.findWithoutContractSentStartingWithinDays(...args),
            );
        }

        // At year end the repository's 7-business-day lookahead runs past the supported
        // holiday years. The dashboard still counts the client, so the filter must too.
        describe("at year end, when the lookahead is outside the supported holiday years", () => {
            beforeEach(() => {
                jest.setSystemTime(new Date("2027-12-30T03:00:00.000Z"));
            });

            it("lists the client the dashboard counts", async () => {
                const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
                try {
                    seedFixture(
                        [
                            row(1, { serviceStatus: "active", startDate: new Date("2027-12-20T00:00:00.000Z"), endDate: new Date("2027-12-31T00:00:00.000Z") }),
                            row(2, { serviceStatus: "active", startDate: new Date("2027-12-20T00:00:00.000Z"), endDate: new Date("2027-12-31T00:00:00.000Z") }),
                            row(3, { startDate: new Date("2028-01-05T00:00:00.000Z"), endDate: new Date("2028-02-05T00:00:00.000Z") }),
                        ],
                        [contractDoc(2, "060")],
                    );

                    const stats = await service.getStats(branchId);
                    const listed = await service.findByFilter(branchId, "no-contract");

                    expect(stats.contractsNotSent).toBe(1);
                    expect(listed.map((client) => client.id)).toEqual([1]);
                } finally {
                    warn.mockRestore();
                }
            });

            it("still serves the action-required feed instead of failing on the lookahead", async () => {
                const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
                try {
                    prismaService.client.findMany.mockResolvedValue([
                        { id: 1, name: "A", createdAt: null, serviceStatus: "active", bookingConfirmedAt: new Date("2026-01-01"), startDate: new Date("2027-12-20T00:00:00.000Z"), endDate: new Date("2027-12-31T00:00:00.000Z") },
                    ]);

                    const alerts = await service.getActionRequiredAlerts(branchId);

                    expect(alerts.map((alert) => alert.id)).toEqual([1]);
                    expect(prismaService.client.findMany.mock.calls.at(-1)![0].where.OR[1].startDate).toEqual({ not: null });
                } finally {
                    warn.mockRestore();
                }
            });
        });
    });

    // The contract_status badge is the backend twin of the shared fallback's
    // `legacyClientBadges`: both apps must show the same badges with or without `badges`.
    describe("contract_status badge (철회 요청됨)", () => {
        beforeEach(() => {
            jest.useFakeTimers().setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        const activeClient = () => {
            const client = createClientEntity();
            client.serviceStatus = "active";
            client.startDate = new Date("2026-07-01T00:00:00.000Z");
            client.endDate = new Date("2026-08-31T00:00:00.000Z");
            return client;
        };
        const keys = (client: { badges: Array<{ key: string }> } | undefined) =>
            client?.badges.map((badge) => badge.key);

        it.each(["040", "045"])("emits the warning badge from the backend list for a current %s contract", async (statusType) => {
            listClientsUsecase.execute.mockResolvedValue([activeClient()]);
            prismaService.eformsign_doc.findMany.mockResolvedValue([
                { clientId: 1, documentId: "d", statusType, stepType: "02", stepName: "x" },
            ]);

            const [client] = await service.findAll(branchId);

            expect(client?.badges).toEqual([
                { key: "contract_status", status: "review", label: "철회 요청됨", tone: "warning", priority: 15 },
                expect.objectContaining({ key: "service_status", label: "진행중" }),
            ]);
        });

        it.each(["060", "063", "064", "050", "041"])("does not emit it for a current %s contract", async (statusType) => {
            listClientsUsecase.execute.mockResolvedValue([activeClient()]);
            prismaService.eformsign_doc.findMany.mockResolvedValue([
                { clientId: 1, documentId: "d", statusType, stepType: "02", stepName: "x" },
            ]);

            const [client] = await service.findAll(branchId);

            expect(keys(client)).not.toContain("contract_status");
        });

        it("matches the shared fallback badge for badge, order and content", async () => {
            const clientEntity = activeClient();
            clientEntity.breastPump = true;
            listClientsUsecase.execute.mockResolvedValue([clientEntity]);
            prismaService.eformsign_doc.findMany.mockResolvedValue([
                { clientId: 1, documentId: "d", statusType: "040", stepType: "02", stepName: "x" },
            ]);

            const [client] = await service.findAll(branchId);
            const fallback = legacyClientBadges({
                serviceStatus: client?.serviceStatus,
                documentStatus: client?.documentStatus,
                breastPump: true,
            });

            const fallbackStatus = fallback.find((badge) => badge.key === "contract_status");
            const backendStatus = client?.badges.find((badge) => badge.key === "contract_status");
            expect(backendStatus).toEqual(fallbackStatus);
            // contract_status sits right after contract_required and before everything else.
            expect(fallback.map((badge) => badge.key).indexOf("contract_status")).toBe(0);
            expect(client?.badges[0]?.key).toBe("contract_status");
            // Still never "계약서 필요" for a live 040/045 contract.
            expect(keys(client)).not.toContain("contract_required");
        });
    });

    // The digest, filters and badge share `isActiveContractSignal`; the list/documentStatus path
    // keeps its own mapping. They must agree for every status code.
    describe("active-contract rule parity", () => {
        it("isActiveContractSignal matches ACTIVE_DOCUMENT_STATUSES over every 3-digit status code", () => {
            const mapStatus = (code: string) =>
                (service as unknown as { mapStatusTypeToDocumentStatus(code: string): string | null })
                    .mapStatusTypeToDocumentStatus(code);
            const activeStatuses = new Set(["created", "requested", "revoke_requested", "opened", "completed"]);

            for (let n = 0; n < 1000; n++) {
                const code = String(n).padStart(3, "0");
                expect({ code, active: isActiveContractSignal({ statusType: code, permanentPurgeRequestedAt: null }) })
                    .toEqual({ code, active: activeStatuses.has(mapStatus(code) ?? "") });
            }
        });
    });

    describe("findById", () => {
        it("should delegate to findClientByIdUsecase and attach employee info", async () => {
            // Arrange
            const mockClient = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(mockClient);

            // Act
            const result = await service.findById(branchId, 1);

            // Assert
            expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(branchId, 1);
            expect(result).toMatchObject({
                id: 1,
                name: "Test Client",
                primaryEmployee: null,
                secondaryEmployee: null,
                hasSigned: false,
            });
        });

        it("should include employee phone numbers from active schedule", async () => {
            // Arrange
            const mockClient = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(mockClient);
            prismaService.employee_schedule.findMany.mockResolvedValue([
                {
                    clientId: 1,
                    primaryEmployee: {
                        id: 55,
                        name: "지원자 1",
                        phone: "010-0000-1111",
                    },
                    secondaryEmployee: {
                        id: 66,
                        name: "지원자 2",
                        phone: "010-0000-2222",
                    },
                },
            ]);

            // Act
            const result = await service.findById(branchId, 1);

            // Assert
            expect(result).toMatchObject({
                primaryEmployee: {
                    id: 55,
                    name: "지원자 1",
                    phone: "010-0000-1111",
                },
                secondaryEmployee: {
                    id: 66,
                    name: "지원자 2",
                    phone: "010-0000-2222",
                },
            });
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        it("should only run legacy pending-job cleanup after a successful guarded delete", async () => {
            // Arrange
            deleteClientUsecase.execute.mockResolvedValue(undefined);

            // Act
            await service.delete(branchId, 1);

            // Assert
            expect(triggerService.cancelPendingJobsForClientDeletion).toHaveBeenCalledWith(branchId, 1);
            expect(deleteClientUsecase.execute).toHaveBeenCalledWith(branchId, 1);
            expect(
                triggerService.cancelPendingJobsForClientDeletion.mock.invocationCallOrder[0],
            ).toBeGreaterThan(deleteClientUsecase.execute.mock.invocationCallOrder[0] ?? 0);
        });

        it("must not cancel pending jobs when the guarded delete is rejected", async () => {
            const blocked = new Error("CLIENT_RETENTION_BLOCKED");
            deleteClientUsecase.execute.mockRejectedValue(blocked);

            await expect(service.delete(branchId, 1)).rejects.toBe(blocked);

            expect(triggerService.cancelPendingJobsForClientDeletion).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // The branch calendar is a saved computation, read ONCE and before the
    // owning transaction opens (a second pooled connection held while client
    // rows are locked starves the direct route's five-connection pool).
    // ============================================
    describe("branch calendar read before the owning transaction", () => {
        const createParams = {
            name: "New Client",
            address: "123 Main St",
            phone: "010-1234-5678",
            startDate: "2026-08-26",
            endDate: "2026-09-14",
            careCenter: false,
            voucherClient: true,
            breastPump: false,
            reuseExistingClient: true,
        };

        function loadedBeforeTransaction() {
            const forBranchOrder = (holidayCalendar.forBranch as jest.Mock).mock.invocationCallOrder[0]!;
            const transactionOrder = (prismaService.$transaction as jest.Mock).mock.invocationCallOrder[0]!;
            expect(forBranchOrder).toBeLessThan(transactionOrder);
        }

        it("create without an employee reads the calendar once and passes it to the usecase and the lifecycle", async () => {
            const calendar = branchCalendar2026(["2026-08-26"]);
            (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(calendar);
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);

            await service.create(branchId, createParams);

            expect(holidayCalendar.forBranch).toHaveBeenCalledTimes(1);
            expect(holidayCalendar.forBranch).toHaveBeenCalledWith(branchId, { fresh: true });
            loadedBeforeTransaction();
            expect(createClientUsecase.execute).toHaveBeenCalledWith(
                branchId, expect.anything(), expect.anything(), calendar,
            );
            expect(serviceRecordLifecycleService.ensureForClient).toHaveBeenCalledWith(
                mockClient.id, expect.anything(), calendar,
            );
        });

        it("create with an employee reads the calendar once and passes it to the usecase and the lifecycle", async () => {
            const calendar = branchCalendar2026(["2026-08-26"]);
            (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(calendar);
            const mockClient = createClientEntity();
            createClientUsecase.executeWithInitialSchedule.mockResolvedValue({ client: mockClient, scheduleId: 10 });

            await service.create(branchId, { ...createParams, primaryEmployeeId: 5 });

            expect(holidayCalendar.forBranch).toHaveBeenCalledTimes(1);
            loadedBeforeTransaction();
            expect(createClientUsecase.executeWithInitialSchedule).toHaveBeenCalledWith(
                branchId, expect.anything(), expect.anything(), expect.anything(), calendar,
            );
            expect(serviceRecordLifecycleService.ensureForClient).toHaveBeenCalledWith(
                mockClient.id, expect.anything(), calendar,
            );
        });

        it("reusing a client with an assignment hands the pre-transaction calendar to the lifecycle repair", async () => {
            const calendar = branchCalendar2026(["2026-08-26"]);
            (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(calendar);
            const existingClient = createClientEntity();
            clientRepository.findByPhone.mockResolvedValue(existingClient);
            prismaService.employee_schedule.findFirst.mockResolvedValue(null);
            prismaService.employee_schedule.create.mockResolvedValue({ id: 33, clientId: existingClient.id });

            await service.create(branchId, { ...createParams, primaryEmployeeId: 5 });

            expect(holidayCalendar.forBranch).toHaveBeenCalledTimes(1);
            loadedBeforeTransaction();
            expect(serviceRecordLifecycleService.ensureForClient).toHaveBeenCalledWith(
                existingClient.id, expect.anything(), calendar,
            );
        });

        it("requestReplacement resolves the lifecycle calendar before the transaction and hands it to the repair", async () => {
            const calendar = branchCalendar2026(["2026-08-26"]);
            serviceRecordLifecycleService.resolveCalendarBeforeTransaction.mockResolvedValue(calendar);
            findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());
            prismaService.employee_schedule.findFirst.mockResolvedValue(null);
            prismaService.employee_schedule.create.mockResolvedValue({ id: 90, clientId: 1 });

            await service.requestReplacement(branchId, 1, 7);

            expect(serviceRecordLifecycleService.resolveCalendarBeforeTransaction).toHaveBeenCalledWith(1);
            expect(serviceRecordLifecycleService.resolveCalendarBeforeTransaction.mock.invocationCallOrder[0]!)
                .toBeLessThan((prismaService.$transaction as jest.Mock).mock.invocationCallOrder[0]!);
            expect(serviceRecordLifecycleService.ensureForClient).toHaveBeenCalledWith(1, expect.anything(), calendar);
        });

        it("terminateService loads the calendar before the transaction and passes it to the update", async () => {
            const calendar = branchCalendar2026(["2026-08-26"]);
            (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(calendar);
            findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());
            updateClientUsecase.execute.mockResolvedValue(createClientEntity());
            prismaService.employee_schedule.updateMany = jest.fn().mockResolvedValue({ count: 1 });

            await service.terminateService(branchId, 1, "Client requested");

            expect(holidayCalendar.forBranch).toHaveBeenCalledWith(branchId, { fresh: true });
            loadedBeforeTransaction();
            expect(updateClientUsecase.execute).toHaveBeenCalledWith(
                branchId, 1, expect.anything(), expect.anything(), calendar,
            );
        });

        it("completeReplacement loads the calendar before the transaction and passes it to the update and the lifecycle", async () => {
            const calendar = branchCalendar2026(["2026-08-26"]);
            (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(calendar);
            const mockClient = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(mockClient);
            updateClientUsecase.execute.mockResolvedValue(mockClient);
            clientRepository.findByIdForUpdate.mockResolvedValue(mockClient);

            await service.completeReplacement(branchId, 1);

            expect(holidayCalendar.forBranch).toHaveBeenCalledWith(branchId, { fresh: true });
            loadedBeforeTransaction();
            expect(updateClientUsecase.execute).toHaveBeenCalledWith(
                branchId, 1, expect.anything(), expect.anything(), calendar,
            );
            expect(serviceRecordLifecycleService.ensureForClient).toHaveBeenCalledWith(1, expect.anything(), calendar);
        });
    });

    describe("booking confirmation writes", () => {
        const confirmation = new Date("2026-01-01");
        const confirmedClient = (): ClientEntity => Object.assign(createClientEntity(), {
            bookingConfirmedAt: confirmation,
            startDate: new Date("2026-11-02"), endDate: new Date("2026-11-13"), duration: 10,
        });
        const realEntityUpdate = (client: ClientEntity) => {
            findClientByIdUsecase.execute.mockResolvedValue(client);
            clientRepository.findById.mockResolvedValue(client);
            clientRepository.findByIdForUpdate.mockResolvedValue(client);
            clientRepository.update.mockImplementation(async (_branch, updated) => {
                expect(ClientMapper.toPrismaUpdate(updated)).not.toHaveProperty("bookingConfirmedAt");
                return updated;
            });
            const realUpdate = new UpdateClientUsecase(clientRepository, holidayCalendar);
            updateClientUsecase.execute.mockImplementation(realUpdate.execute.bind(realUpdate));
            return realUpdate;
        };

        it.each(["add", "change", "remove"])("%s service dates leaves an unconfirmed client in 예약 전 without link scheduling", async (operation) => {
            const client = Object.assign(confirmedClient(), { bookingConfirmedAt: null, serviceStatus: "pre_booking" });
            if (operation === "add") { client.startDate = null; client.endDate = null; }
            findClientByIdUsecase.execute.mockResolvedValue(client);
            prismaService.client.updateMany.mockImplementation(async ({ data }) => {
                if (data.startDate !== undefined) client.startDate = data.startDate as Date | null;
                if (data.endDate !== undefined) client.endDate = data.endDate as Date | null;
                return { count: 1 };
            });
            const result = await service.update(branchId, client.id, operation === "remove"
                ? { endDate: null }
                : { startDate: "2026-11-02", endDate: operation === "change" ? "2026-11-30" : "2026-11-13" });
            expect(result.computeCurrentStatus()).toBe("pre_booking");
            expect(result.bookingConfirmedAt).toBeNull();
            expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
        });

        it("service create stores dated waiting input as unconfirmed 예약 전 in the shared create layer", async () => {
            clientRepository.create.mockImplementation(async (_branch, client) => client);
            const realCreate = new CreateClientUsecase(clientRepository, holidayCalendar);
            createClientUsecase.execute.mockImplementation(realCreate.execute.bind(realCreate));
            const result = await service.create(branchId, {
                name: "상담 고객", phone: null, careCenter: false, voucherClient: false, breastPump: false,
                startDate: "2026-11-02", endDate: "2026-11-13", serviceStatus: "waiting",
            });
            expect(ClientMapper.toPrismaCreate(result)).toMatchObject({ serviceStatus: "pre_booking", bookingConfirmedAt: null });
            expect(clientRepository.create).toHaveBeenCalled();
        });

        it("client.service.update never writes the confirmation column", async () => {
            const client = confirmedClient();
            findClientByIdUsecase.execute.mockResolvedValue(client);
            await service.update(branchId, client.id, { address: "변경 주소" });
            expect(prismaService.client.updateMany).toHaveBeenCalled();
            for (const [args] of prismaService.client.updateMany.mock.calls) {
                expect(args.data).not.toHaveProperty("bookingConfirmedAt");
            }
            expect(client.bookingConfirmedAt).toEqual(confirmation);
        });

        it("UpdateClientUsecase leaves confirmation out of the whole-entity update payload", async () => {
            const client = confirmedClient();
            await realEntityUpdate(client).execute(branchId, client.id, { address: "변경 주소" });
            expect(clientRepository.update).toHaveBeenCalled();
            expect(client.bookingConfirmedAt).toEqual(confirmation);
        });

        it("terminateService leaves confirmation out of the whole-entity update payload", async () => {
            const client = confirmedClient();
            realEntityUpdate(client);
            await service.terminateService(branchId, client.id);
            expect(clientRepository.update).toHaveBeenCalled();
            expect(client.bookingConfirmedAt).toEqual(confirmation);
        });

        it("completeReplacement leaves confirmation out of the whole-entity update payload", async () => {
            const client = confirmedClient();
            client.serviceStatus = "replacement_requested";
            realEntityUpdate(client);
            await service.completeReplacement(branchId, client.id);
            expect(clientRepository.update).toHaveBeenCalled();
            expect(client.bookingConfirmedAt).toEqual(confirmation);
        });
    });
    // ============================================
    // confirmBooking (rule 고객-04)
    // ============================================
    describe("confirmBooking", () => {
        const futureDates = { startDate: new Date("2099-01-05T00:00:00.000Z"), endDate: new Date("2099-01-20T00:00:00.000Z") };
        const unconfirmedRow = (overrides: Partial<ClientEntity> = {}): ClientEntity => Object.assign(createClientEntity(), {
            bookingConfirmedAt: null,
            serviceStatus: "pre_booking",
            ...futureDates,
            ...overrides,
        });
        const confirmedRow = (overrides: Partial<ClientEntity> = {}): ClientEntity =>
            unconfirmedRow({ bookingConfirmedAt: new Date("2026-01-01"), serviceStatus: "waiting", ...overrides });

        let tx: Record<string, unknown> & { client: { updateMany: jest.Mock } };
        let committed: boolean;
        let followUpSawCommit: boolean[];

        /** `locked` is what the FOR UPDATE re-read returns; `after` what the post-commit read returns. */
        const arrange = (locked: ClientEntity | null, after: ClientEntity | null = locked) => {
            committed = false;
            followUpSawCommit = [];
            tx = { ...prismaService, client: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
            prismaService.$transaction.mockImplementation(async (callback: (transaction: unknown) => unknown) => {
                const result = await callback(tx);
                committed = true;
                return result;
            });
            findClientByIdUsecase.execute.mockResolvedValue(after ?? unconfirmedRow());
            clientRepository.findByIdForUpdate.mockResolvedValue(locked);
            triggerService.syncClientRulesForClient.mockImplementation(async () => { followUpSawCommit.push(committed); });
            prismaService.employee_schedule.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
                where["terminatedAt"] === null ? [{ id: 7 }] : []);
            serviceRecordLinkService.scheduleForServiceStart.mockImplementation(async () => { followUpSawCommit.push(committed); });
        };
        const expectRefusal = async (detail: string) => {
            const error = await service.confirmBooking(branchId, 1).catch((cause: unknown) => cause);
            expect(error).toBeInstanceOf(BadRequestException);
            expect((error as BadRequestException).getResponse()).toMatchObject({
                code: "VALIDATION_FAILED",
                errors: [{ pointer: "/id", code: "INVALID_VALUE", detail, location: "path" }],
            });
            expect(tx.client.updateMany).not.toHaveBeenCalled();
            expect(serviceRecordLifecycleService.ensureForClient).not.toHaveBeenCalled();
            expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
            expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
        };

        it("answers a missing client with not-found before opening a transaction", async () => {
            arrange(null);
            findClientByIdUsecase.execute.mockResolvedValue(null);

            const error = await service.confirmBooking(branchId, 999).catch((cause: unknown) => cause);

            expect(error).toBeInstanceOf(NotFoundException);
            expect((error as NotFoundException).getResponse()).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
            expect(prismaService.$transaction).not.toHaveBeenCalled();
        });

        it("answers a client missing from the locked re-read with not-found and writes nothing", async () => {
            arrange(null, unconfirmedRow());

            await expect(service.confirmBooking(branchId, 1)).rejects.toBeInstanceOf(NotFoundException);

            expect(tx.client.updateMany).not.toHaveBeenCalled();
            expect(serviceRecordLifecycleService.ensureForClient).not.toHaveBeenCalled();
        });

        it.each(["terminated", "replacement_requested"])("refuses a client stored as %s", async (stored) => {
            arrange(unconfirmedRow({ serviceStatus: stored }));

            await expectRefusal("종료되었거나 교체 요청 중인 고객은 예약을 확정할 수 없습니다.");
        });

        it("judges the stored terminated / replacement_requested refusal before the already-confirmed check", async () => {
            arrange(confirmedRow({ serviceStatus: "terminated" }));

            await expectRefusal("종료되었거나 교체 요청 중인 고객은 예약을 확정할 수 없습니다.");
        });

        it("judges the already-confirmed check before the missing-dates check", async () => {
            const row = confirmedRow({ startDate: null, endDate: null });
            arrange(row);

            await expect(service.confirmBooking(branchId, 1)).resolves.toBe(row);

            expect(tx.client.updateMany).not.toHaveBeenCalled();
        });

        it.each([
            ["start", { startDate: null }],
            ["end", { endDate: null }],
            ["both", { startDate: null, endDate: null }],
        ])("refuses an unconfirmed client with the %s date missing", async (_which, missing) => {
            arrange(unconfirmedRow(missing));

            await expectRefusal("서비스 시작일과 종료일을 먼저 입력해 주세요.");
        });

        it.each([
            ["a future period", futureDates, "waiting"],
            ["a running period", { startDate: new Date("2000-01-03T00:00:00.000Z"), endDate: new Date("2999-12-31T00:00:00.000Z") }, "active"],
            ["a finished period", { startDate: new Date("2020-01-06T00:00:00.000Z"), endDate: new Date("2020-01-17T00:00:00.000Z") }, "completed"],
        ])("confirms with exactly the confirmation instant and the date-derived status for %s", async (_label, dates, derived) => {
            const calendar = branchCalendar2026([]);
            (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(calendar);
            arrange(unconfirmedRow(dates), confirmedRow({ ...dates, serviceStatus: derived }));

            const before = Date.now();
            await service.confirmBooking(branchId, 1);
            const after = Date.now();

            expect(tx.client.updateMany).toHaveBeenCalledTimes(1);
            expect(tx.client.updateMany).toHaveBeenCalledWith({
                where: { id: 1, branchId },
                data: { bookingConfirmedAt: expect.any(Date), serviceStatus: derived },
            });
            const [{ data }] = tx.client.updateMany.mock.calls[0] as [{ data: { bookingConfirmedAt: Date } }];
            expect(Object.keys(data).sort()).toEqual(["bookingConfirmedAt", "serviceStatus"]);
            expect(data.bookingConfirmedAt.getTime()).toBeGreaterThanOrEqual(before);
            expect(data.bookingConfirmedAt.getTime()).toBeLessThanOrEqual(after);
            // The direct write is the only writer: it goes through the transaction client, never the root one.
            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
            expect(clientRepository.findByIdForUpdate).toHaveBeenCalledWith(branchId, 1, tx);
        });

        it("reads the calendar fresh before the transaction and repairs the lifecycle with the same transaction client and calendar", async () => {
            const calendar = branchCalendar2026(["2026-08-26"]);
            (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(calendar);
            arrange(unconfirmedRow(), confirmedRow());

            await service.confirmBooking(branchId, 1);

            expect(holidayCalendar.forBranch).toHaveBeenCalledWith(branchId, { fresh: true });
            expect((holidayCalendar.forBranch as jest.Mock).mock.invocationCallOrder[0]!)
                .toBeLessThan((prismaService.$transaction as jest.Mock).mock.invocationCallOrder[0]!);
            expect(serviceRecordLifecycleService.ensureForClient).toHaveBeenCalledTimes(1);
            const [clientId, transactionArg, calendarArg] = serviceRecordLifecycleService.ensureForClient.mock.calls[0]!;
            expect(clientId).toBe(1);
            expect(transactionArg).toBe(tx);
            expect(calendarArg).toBe(calendar);
            expect(tx.client.updateMany.mock.invocationCallOrder[0]!)
                .toBeLessThan(serviceRecordLifecycleService.ensureForClient.mock.invocationCallOrder[0]!);
        });

        it("runs both follow-ups after commit and returns the post-commit client", async () => {
            const confirmed = confirmedRow();
            arrange(unconfirmedRow(), confirmed);

            await expect(service.confirmBooking(branchId, 1)).resolves.toBe(confirmed);

            expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(branchId, 1, false);
            // The client left 예약 전, so the provider link SMS is scheduled for the active schedule.
            expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(7);
            expect(followUpSawCommit).toEqual([true, true]);
        });

        it("does not fail the confirm when a post-commit follow-up throws", async () => {
            const confirmed = confirmedRow();
            arrange(unconfirmedRow(), confirmed);
            triggerService.syncClientRulesForClient.mockRejectedValue(new Error("trigger sync down"));
            serviceRecordLinkService.scheduleForServiceStart.mockRejectedValue(new Error("sms down"));
            const logError = jest.spyOn((service as unknown as { logger: { error: (message: string) => void } }).logger, "error")
                .mockImplementation(() => undefined);

            await expect(service.confirmBooking(branchId, 1)).resolves.toBe(confirmed);

            expect(logError).toHaveBeenCalledWith(expect.stringContaining("trigger sync down"));
            expect(logError).toHaveBeenCalledWith(expect.stringContaining("sms down"));
        });

        it("rejects the confirm and runs neither follow-up when the lifecycle repair rejects", async () => {
            arrange(unconfirmedRow(), confirmedRow());
            serviceRecordLifecycleService.ensureForClient.mockRejectedValue(new Error("lifecycle repair failed"));

            await expect(service.confirmBooking(branchId, 1)).rejects.toThrow("lifecycle repair failed");

            expect(committed).toBe(false);
            expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
            expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
        });

        it("answers a zero-row write with not-found and does not repair the lifecycle", async () => {
            arrange(unconfirmedRow(), confirmedRow());
            tx.client.updateMany.mockResolvedValue({ count: 0 });

            await expect(service.confirmBooking(branchId, 1)).rejects.toBeInstanceOf(NotFoundException);

            expect(serviceRecordLifecycleService.ensureForClient).not.toHaveBeenCalled();
            expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
        });

        it("is idempotent: an already confirmed client is returned with no write and no follow-up", async () => {
            const row = confirmedRow();
            arrange(row);

            await expect(service.confirmBooking(branchId, 1)).resolves.toBe(row);
            await expect(service.confirmBooking(branchId, 1)).resolves.toBe(row);

            expect(tx.client.updateMany).not.toHaveBeenCalled();
            expect(serviceRecordLifecycleService.ensureForClient).not.toHaveBeenCalled();
            expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
            expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // update: serviceStatus may not change 예약 전 (rule 고객-04)
    // ============================================
    describe("update: a save may not change 예약 전", () => {
        const confirmedAt = new Date("2026-01-01");
        // Pinned clock inside a running period, so a confirmed client's date-derived status is "active".
        const running = { startDate: new Date("2026-11-02T00:00:00.000Z"), endDate: new Date("2026-11-13T00:00:00.000Z") };
        beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date("2026-11-05T03:00:00.000Z")); });
        afterEach(() => { jest.useRealTimers(); });
        const unconfirmedClient = (overrides: Partial<ClientEntity> = {}): ClientEntity => Object.assign(createClientEntity(), {
            bookingConfirmedAt: null,
            serviceStatus: "pre_booking",
            ...running,
            ...overrides,
        });
        const confirmedClient = (overrides: Partial<ClientEntity> = {}): ClientEntity =>
            unconfirmedClient({ bookingConfirmedAt: confirmedAt, serviceStatus: "active", ...overrides });
        const BODY_REFUSAL = "예약 상태는 [예약 확정]으로만 바꿀 수 있습니다.";
        const PRE_BOOKING_REPLACEMENT = "예약 전 고객은 제공인력 교체를 요청할 수 없습니다";

        const lastUpdateData = () => {
            const calls = prismaService.client.updateMany.mock.calls;
            return calls[calls.length - 1]![0].data as Record<string, unknown>;
        };

        it.each([
            ["row 5: unconfirmed -> waiting", () => unconfirmedClient(), "waiting", BODY_REFUSAL],
            ["row 5: unconfirmed -> active", () => unconfirmedClient(), "active", BODY_REFUSAL],
            ["row 5: unconfirmed -> completed", () => unconfirmedClient(), "completed", BODY_REFUSAL],
            ["row 4: unconfirmed -> replacement_requested", () => unconfirmedClient(), "replacement_requested", PRE_BOOKING_REPLACEMENT],
            ["row 8: confirmed with dates -> pre_booking", () => confirmedClient(), "pre_booking", BODY_REFUSAL],
        ])("%s is refused and writes nothing", async (_label, build, supplied, detail) => {
            findClientByIdUsecase.execute.mockResolvedValue(build());

            const error = await service.update(branchId, 1, { address: "변경 주소", serviceStatus: supplied }).catch((cause: unknown) => cause);

            expect(error).toBeInstanceOf(BadRequestException);
            expect((error as BadRequestException).getResponse()).toMatchObject({
                code: "VALIDATION_FAILED",
                errors: [{ pointer: "/serviceStatus", code: "INVALID_VALUE", detail, location: "body" }],
            });
            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
            expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
            expect(serviceRecordLifecycleService.ensureForClient).not.toHaveBeenCalled();
        });

        it("judges the locked row, not the preflight snapshot", async () => {
            // The preflight read says confirmed, but the row under the lock is unconfirmed.
            findClientByIdUsecase.execute.mockResolvedValue(confirmedClient());
            prismaService.client.findUnique.mockResolvedValue(unconfirmedClient());

            await expect(service.update(branchId, 1, { serviceStatus: "waiting" }))
                .rejects.toBeInstanceOf(BadRequestException);

            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
        });

        it("row 9: a confirmed client's supplied date-derived status is replaced by the derived one", async () => {
            findClientByIdUsecase.execute.mockResolvedValue(confirmedClient({ serviceStatus: "waiting" }));

            await service.update(branchId, 1, { serviceStatus: "completed" });

            expect(lastUpdateData()["serviceStatus"]).toBe("active");
        });

        it("row 2: null on a confirmed stored-terminated client stores the derived status, never NULL", async () => {
            findClientByIdUsecase.execute.mockResolvedValue(confirmedClient({ serviceStatus: "terminated" }));

            await service.update(branchId, 1, { serviceStatus: null });

            expect(lastUpdateData()["serviceStatus"]).toBe("active");
        });

        it("row 2: null on an unconfirmed client stores nothing for the status", async () => {
            findClientByIdUsecase.execute.mockResolvedValue(unconfirmedClient());

            await service.update(branchId, 1, { address: "변경 주소", serviceStatus: null });

            expect(lastUpdateData()).toMatchObject({ address: "변경 주소" });
            expect(lastUpdateData()["serviceStatus"]).toBeUndefined();
        });

        it("row 3: a status equal to the effective one stores nothing for the status", async () => {
            findClientByIdUsecase.execute.mockResolvedValue(confirmedClient({ serviceStatus: "waiting" }));

            await service.update(branchId, 1, { address: "변경 주소", serviceStatus: "active" });

            expect(lastUpdateData()["serviceStatus"]).toBeUndefined();
        });

        it("rows 6 and 10 keep today's behaviour: terminated / replacement_requested are stored as sent", async () => {
            findClientByIdUsecase.execute.mockResolvedValue(unconfirmedClient());
            await service.update(branchId, 1, { serviceStatus: "terminated" });
            expect(lastUpdateData()["serviceStatus"]).toBe("terminated");

            findClientByIdUsecase.execute.mockResolvedValue(confirmedClient());
            await service.update(branchId, 1, { serviceStatus: "replacement_requested" });
            expect(lastUpdateData()["serviceStatus"]).toBe("replacement_requested");
        });

        it("row 7 keeps today's behaviour: pre_booking over a stored terminated unconfirmed client is stored", async () => {
            findClientByIdUsecase.execute.mockResolvedValue(unconfirmedClient({ serviceStatus: "terminated" }));

            await service.update(branchId, 1, { serviceStatus: "pre_booking" });

            expect(lastUpdateData()["serviceStatus"]).toBe("pre_booking");
        });

        it("judges E on the after-save dates: clearing the dates makes pre_booking acceptable, keeping them does not", async () => {
            findClientByIdUsecase.execute.mockResolvedValue(confirmedClient());
            await expect(service.update(branchId, 1, { startDate: null, endDate: null, serviceStatus: "pre_booking" }))
                .resolves.toBeDefined();
            expect(lastUpdateData()).toMatchObject({ startDate: null, endDate: null });
            expect(lastUpdateData()["serviceStatus"]).toBeUndefined();

            prismaService.client.updateMany.mockClear();
            findClientByIdUsecase.execute.mockResolvedValue(confirmedClient());
            await expect(service.update(branchId, 1, { serviceStatus: "pre_booking" }))
                .rejects.toBeInstanceOf(BadRequestException);
            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
        });
    });


    // ============================================
    // terminateService
    // ============================================
    describe("terminateService", () => {
        describe("KST date-only end date", () => {
            afterEach(() => jest.useRealTimers());

            it.each([
                ["future weekday", "2026-10-05T03:00:00Z", "2026-10-12", "2026-10-12"],
                ["future weekend with zero business days", "2026-10-05T03:00:00Z", "2026-10-10", "2026-10-10"],
                ["future holiday with zero business days", "2026-10-05T03:00:00Z", "2026-10-09", "2026-10-09"],
                ["start day before 09:00 KST", "2026-10-05T15:30:00Z", "2026-10-06", "2026-10-06"],
                ["normal KST day after UTC midnight boundary", "2026-10-05T15:30:00Z", "2026-10-01", "2026-10-06"],
            ])("terminates on the correct date for %s and preserves contracted duration", async (_, now, start, expectedEnd) => {
                jest.useFakeTimers().setSystemTime(new Date(now));
                const client = createClientEntity();
                client.startDate = new Date(start);
                client.endDate = new Date("2026-11-30");
                client.duration = 15;
                findClientByIdUsecase.execute.mockResolvedValue(client);
                clientRepository.findByIdForUpdate.mockResolvedValue(client);
                clientRepository.update.mockImplementation(async (_branch, updated) => updated);
                const realUpdate = new UpdateClientUsecase(clientRepository, holidayCalendar);
                updateClientUsecase.execute.mockImplementation(realUpdate.execute.bind(realUpdate));

                const result = await service.terminateService(branchId, 1);

                expect(result.endDate).toEqual(new Date(expectedEnd));
                expect(result.duration).toBe(15);
                expect(result.serviceStatus).toBe("terminated");
                expect(clientRepository.update).toHaveBeenCalledWith(branchId, result, prismaService);
                expect(serviceRecordLifecycleService.validatePeriodChange).toHaveBeenCalledWith({
                    clientId: 1, endDate: new Date(expectedEnd),
                }, prismaService);
                expect(prismaService.employee_schedule.updateMany).toHaveBeenCalledWith({
                    where: { clientId: 1, branchId, replaced: false, terminatedAt: null },
                    data: { terminatedAt: new Date(now) },
                });
                expect(serviceRecordLifecycleService.markTerminated).toHaveBeenCalledWith(1, prismaService);
            });
        });

        describe("given existing client", () => {
            it("should update client status to terminated", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const terminatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date(),
                    false, true, "900101", "terminated", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(terminatedClient);
                prismaService.employee_schedule.updateMany = jest.fn().mockResolvedValue({ count: 1 });

                // Act
                const result = await service.terminateService(branchId, 1, "Client requested");

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(branchId, 1);
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(branchId, 1, {
                    serviceStatus: "terminated",
                    endDate: expect.any(Date),
                }, expect.anything(), KR_BUILTIN_CALENDAR);
                expect(prismaService.employee_schedule.updateMany).toHaveBeenCalledWith({
                    where: { clientId: 1, branchId, replaced: false, terminatedAt: null },
                    data: { terminatedAt: expect.any(Date) },
                });
                expect(result.serviceStatus).toBe("terminated");
            });

            it("should terminate without reason", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const terminatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date(),
                    false, true, "900101", "terminated", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(terminatedClient);
                prismaService.employee_schedule.updateMany = jest.fn().mockResolvedValue({ count: 1 });

                // Act
                await service.terminateService(branchId, 1);

                // Assert
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(branchId, 1, expect.objectContaining({
                    serviceStatus: "terminated",
                }), expect.anything(), KR_BUILTIN_CALENDAR);
            });

            it("should sync client trigger rules with includePast=false", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const terminatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date(),
                    false, true, "900101", "terminated", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(terminatedClient);
                prismaService.employee_schedule.updateMany = jest.fn().mockResolvedValue({ count: 1 });

                // Act
                await service.terminateService(branchId, 1);

                // Assert
                expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(branchId, 1, false);
            });

            // Regression: termination used to close schedules by overwriting end_date,
            // which destroyed the contracted period and wrote start_date > end_date
            // whenever the service was terminated before it began.
            it("records termination on its own column instead of overwriting end_date", async () => {
                const mockClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(mockClient);
                prismaService.employee_schedule.updateMany = jest.fn().mockResolvedValue({ count: 1 });

                await service.terminateService(branchId, 1);

                const call = prismaService.employee_schedule.updateMany.mock.calls[0][0];
                expect(call.data).toEqual({ terminatedAt: expect.any(Date) });
                expect(call.data).not.toHaveProperty("endDate");
            });

            it("scopes the schedule write to the branch and skips already-terminated rows", async () => {
                const mockClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(mockClient);
                prismaService.employee_schedule.updateMany = jest.fn().mockResolvedValue({ count: 1 });

                await service.terminateService(branchId, 1);

                expect(prismaService.employee_schedule.updateMany.mock.calls[0][0].where).toEqual({
                    clientId: 1,
                    branchId,
                    replaced: false,
                    terminatedAt: null,
                });
            });
        });

        describe("given non-existent client", () => {
            it("should throw NotFoundException", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                const error = await service.terminateService(branchId, 999).catch((cause: unknown) => cause);
                expect(error).toBeInstanceOf(NotFoundException);
                expect((error as NotFoundException).getResponse()).toMatchObject({
                    code: "RESOURCE_NOT_FOUND",
                });
            });
        });
    });

    // ============================================
    // requestReplacement
    // ============================================
    describe("requestReplacement", () => {
        it("derives replacement timing and address from the client reread after locking", async () => {
            jest.useFakeTimers().setSystemTime(new Date("2024-03-15T01:00:00.000Z"));
            try {
                const staleClient = createClientEntity();
                staleClient.address = "stale address";
                staleClient.endDate = new Date("2024-03-20T00:00:00.000Z");
                const lockedClient = createClientEntity();
                lockedClient.address = "locked address";
                lockedClient.endDate = new Date("2024-06-01T00:00:00.000Z");
                findClientByIdUsecase.execute.mockResolvedValue(staleClient);
                prismaService.client.findUnique.mockResolvedValue(lockedClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue(null);
                prismaService.employee_schedule.create.mockResolvedValue({ id: 90, clientId: lockedClient.id });

                await service.requestReplacement(branchId, lockedClient.id, 7);

                expect(prismaService.client.findUnique).toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        workAddress: "locked address",
                        startDate: new Date("2024-03-15T01:00:00.000Z"),
                        endDate: new Date("2024-06-01T00:00:00.000Z"),
                    }),
                });
            } finally {
                jest.useRealTimers();
            }
        });

        describe("rule 기록-09: a 예약 전 client cannot request a replacement", () => {
            const expectRefusedWithoutWrites = async (): Promise<void> => {
                await expect(service.requestReplacement(branchId, 1, 7)).rejects.toMatchObject({
                    status: 400,
                    response: {
                        code: "VALIDATION_FAILED",
                        errors: [{
                            pointer: "/id",
                            code: "INVALID_VALUE",
                            detail: "예약 전 고객은 제공인력 교체를 요청할 수 없습니다",
                        }],
                    },
                });
                expect(prismaService.client.updateMany).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                expect(serviceRecordLifecycleService.ensureForClient).not.toHaveBeenCalled();
                expect(serviceRecordLinkService.revoke).not.toHaveBeenCalled();
                expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            };

            it("refuses a stored pre_booking client that has both dates", async () => {
                const client = createClientEntity();
                Object.assign(client, { bookingConfirmedAt: null });
                client.serviceStatus = "pre_booking";
                findClientByIdUsecase.execute.mockResolvedValue(client);

                await expectRefusedWithoutWrites();
            });

            it("refuses an unconfirmed stored waiting client with both dates", async () => {
                const client = Object.assign(createClientEntity(), { bookingConfirmedAt: null, serviceStatus: "waiting" });
                findClientByIdUsecase.execute.mockResolvedValue(client);
                await expectRefusedWithoutWrites();
            });

            it("refuses a client without an end date (stored status null)", async () => {
                const client = createClientEntity();
                client.serviceStatus = null;
                client.endDate = null;
                findClientByIdUsecase.execute.mockResolvedValue(client);

                await expectRefusedWithoutWrites();
            });

            it("decides on the locked re-read, not the preflight snapshot", async () => {
                const preflight = createClientEntity();
                preflight.serviceStatus = "waiting";
                const locked = createClientEntity();
                locked.serviceStatus = "pre_booking";
                Object.assign(locked, { bookingConfirmedAt: null });
                findClientByIdUsecase.execute.mockResolvedValue(preflight);
                prismaService.client.findUnique.mockResolvedValue(locked);

                await expectRefusedWithoutWrites();
            });

            it("still proceeds for a stored waiting client with both dates", async () => {
                const client = createClientEntity();
                client.serviceStatus = "waiting";
                findClientByIdUsecase.execute.mockResolvedValue(client);
                prismaService.employee_schedule.findFirst.mockResolvedValue(null);
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });

                await service.requestReplacement(branchId, 1, 7);

                expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                    where: { id: 1, branchId },
                    data: { serviceStatus: "replacement_requested" },
                });
                expect(serviceRecordLifecycleService.ensureForClient).toHaveBeenCalled();
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(20);
            });
        });

        it("rejects employees outside the client branch", async () => {
            findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());
            prismaService.employee.findMany.mockResolvedValue([]);

            await expect(service.requestReplacement(branchId, 1, 99)).rejects.toMatchObject({ status: 400 });
        });

        it("rejects the same primary and secondary employee", async () => {
            findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());

            await expect(service.requestReplacement(branchId, 1, 7, 7))
                .rejects.toMatchObject({
                    response: {
                        code: "VALIDATION_FAILED",
                        errors: [{ pointer: "/newSecondaryEmployeeId", code: "INVALID_FORMAT" }],
                    },
                });
        });

        it("keeps status and existing schedule unchanged when replacement schedule creation fails", async () => {
            const client = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(client);
            const persisted = { serviceStatus: "pending", replaced: false };
            prismaService.employee_schedule.findFirst.mockResolvedValue({ id: 10 });
            prismaService.client.updateMany.mockImplementation(async ({ data }) => {
                persisted.serviceStatus = data.serviceStatus;
                return { count: 1 };
            });
            prismaService.employee_schedule.update.mockImplementation(async () => {
                persisted.replaced = true;
                return {};
            });
            prismaService.employee_schedule.create.mockRejectedValue(new Error("schedule create failed"));
            prismaService.$transaction.mockImplementation(async (callback) => {
                const snapshot = { ...persisted };
                try {
                    return await callback(prismaService);
                } catch (error) {
                    Object.assign(persisted, snapshot);
                    throw error;
                }
            });

            await expect(service.requestReplacement(branchId, 1, 7)).rejects.toThrow("schedule create failed");
            expect(persisted).toEqual({ serviceStatus: "pending", replaced: false });
            expect(serviceRecordLinkService.revoke).not.toHaveBeenCalled();
        });

        describe("given existing client and new employee", () => {
            it("should update status to replacement_requested and create new schedule", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const updatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date("2024-06-01"),
                    false, true, "900101", "replacement_requested", false, null,
                    null, null, null, null, false, null, undefined, new Date("2024-01-01")
                );
                findClientByIdUsecase.execute
                    .mockResolvedValueOnce(mockClient)
                    .mockResolvedValueOnce(updatedClient);
                updateClientUsecase.execute.mockResolvedValue(updatedClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue({
                    id: 10,
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: null,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });

                // Act
                const result = await service.requestReplacement(branchId, 1, 7, 8);

                // Assert
                // Should update status
                expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                    where: { id: 1, branchId },
                    data: { serviceStatus: "replacement_requested" },
                });
                // Should mark old schedule as replaced
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 10 },
                    data: { replaced: true, endDate: expect.any(Date) },
                });
                // Should create new schedule with new employees
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 7,
                        secondaryEmployeeId: 8,
                        replaced: false,
                    }),
                });
                expect(result.serviceStatus).toBe("replacement_requested");
                expect(serviceRecordLinkService.revoke).toHaveBeenCalledWith(10);
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(20);
            });

            it("keeps the committed replacement and logs when link revocation fails", async () => {
                const mockClient = createClientEntity();
                const updatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date("2024-06-01"),
                    false, true, "900101", "replacement_requested", false, null
                );
                findClientByIdUsecase.execute
                    .mockResolvedValueOnce(mockClient)
                    .mockResolvedValueOnce(updatedClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue({ id: 10 });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });
                serviceRecordLinkService.revoke.mockRejectedValue(new Error("revoke failed"));
                const errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation();

                await expect(service.requestReplacement(branchId, 1, 7)).resolves.toBe(updatedClient);

                expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                    where: { id: 1, branchId },
                    data: { serviceStatus: "replacement_requested" },
                });
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 10 },
                    data: { replaced: true, endDate: expect.any(Date) },
                });
                expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(
                    "[SERVICE_RECORD_LINK_REVOKE_FAILED] 제공기록지 링크 폐기 실패 — 고객 1",
                ));
            });

            it("should handle replacement with primary employee only", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const updatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date("2024-06-01"),
                    false, true, "900101", "replacement_requested", false, null
                );
                findClientByIdUsecase.execute
                    .mockResolvedValueOnce(mockClient)
                    .mockResolvedValueOnce(updatedClient);
                updateClientUsecase.execute.mockResolvedValue(updatedClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue(null); // No existing schedule
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });

                // Act
                await service.requestReplacement(branchId, 1, 7);

                // Assert
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 7,
                        secondaryEmployeeId: null,
                        replaced: false,
                    }),
                });
            });
        });

        describe("given non-existent client", () => {
            it("should throw NotFoundException", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                const error = await service.requestReplacement(branchId, 999, 7).catch((cause: unknown) => cause);
                expect(error).toBeInstanceOf(NotFoundException);
                expect((error as NotFoundException).getResponse()).toMatchObject({
                    code: "RESOURCE_NOT_FOUND",
                });
            });
        });
    });

    describe("retained assignment eligibility", () => {
        type EmployeeCandidate = {
            id: number;
            branchId: string;
            deletedAt: Date | null;
            openToNextWork: boolean;
        };

        const candidate = (id: number, overrides: Partial<EmployeeCandidate> = {}): EmployeeCandidate => ({
            id,
            branchId,
            deletedAt: null,
            openToNextWork: true,
            ...overrides,
        });

        it("allows an unavailable retained primary when adding an available secondary", async () => {
            const existingClient = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(existingClient);
            prismaService.employee_schedule.findFirst.mockResolvedValue({
                id: 10,
                clientId: existingClient.id,
                primaryEmployeeId: 5,
                secondaryEmployeeId: null,
            });
            prismaService.employee.findMany.mockResolvedValue([
                candidate(5, { openToNextWork: false }),
                candidate(8),
            ]);
            prismaService.employee_schedule.update.mockResolvedValue({});
            prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: existingClient.id });

            await expect(service.update(branchId, existingClient.id, { secondaryEmployeeId: 8 }))
                .resolves.toBe(existingClient);

            expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: 8,
                    replaced: false,
                }),
            });
        });

        it("rejects an unavailable newly added secondary while retaining an unavailable primary", async () => {
            const existingClient = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(existingClient);
            prismaService.employee_schedule.findFirst.mockResolvedValue({
                id: 10,
                clientId: existingClient.id,
                primaryEmployeeId: 5,
                secondaryEmployeeId: null,
            });
            prismaService.employee.findMany.mockResolvedValue([
                candidate(5, { openToNextWork: false }),
                candidate(8, { openToNextWork: false }),
            ]);

            await expect(service.update(branchId, existingClient.id, { secondaryEmployeeId: 8 }))
                .rejects.toBeInstanceOf(BadRequestException);

            expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
            expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
        });

        it.each([
            ["wrong branch", candidate(5, { branchId: "branch-b", openToNextWork: false })],
            ["soft deleted", candidate(5, {
                deletedAt: new Date("2026-01-01T00:00:00.000Z"),
                openToNextWork: false,
            })],
        ])("still rejects a retained %s employee", async (_label, retainedEmployee) => {
            const existingClient = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(existingClient);
            prismaService.employee_schedule.findFirst.mockResolvedValue({
                id: 10,
                clientId: existingClient.id,
                primaryEmployeeId: 5,
                secondaryEmployeeId: null,
            });
            prismaService.employee.findMany.mockResolvedValue([retainedEmployee, candidate(8)]);

            await expect(service.update(branchId, existingClient.id, { secondaryEmployeeId: 8 }))
                .rejects.toBeInstanceOf(BadRequestException);

            expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
            expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
        });

        it("allows an unavailable retained primary when duplicate-client reuse adds an available secondary", async () => {
            const existingClient = createClientEntity();
            clientRepository.findByPhone.mockResolvedValue(existingClient);
            prismaService.employee_schedule.findFirst.mockResolvedValue({
                id: 10,
                clientId: existingClient.id,
                primaryEmployeeId: 5,
                secondaryEmployeeId: null,
            });
            prismaService.employee.findMany.mockResolvedValue([
                candidate(5, { openToNextWork: false }),
                candidate(8),
            ]);
            prismaService.employee_schedule.create.mockResolvedValue({ id: 33, clientId: existingClient.id });

            await expect(service.create(branchId, {
                name: "Existing Client",
                phone: existingClient.phone,
                secondaryEmployeeId: 8,
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                reuseExistingClient: true,
            })).resolves.toBe(existingClient);

            expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: 8,
                    replaced: false,
                }),
            });
        });

        it("rejects an unavailable newly added secondary during duplicate-client reuse", async () => {
            const existingClient = createClientEntity();
            clientRepository.findByPhone.mockResolvedValue(existingClient);
            prismaService.employee_schedule.findFirst.mockResolvedValue({
                id: 10,
                clientId: existingClient.id,
                primaryEmployeeId: 5,
                secondaryEmployeeId: null,
            });
            prismaService.employee.findMany.mockResolvedValue([
                candidate(5, { openToNextWork: false }),
                candidate(8, { openToNextWork: false }),
            ]);

            await expect(service.create(branchId, {
                name: "Existing Client",
                phone: existingClient.phone,
                secondaryEmployeeId: 8,
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                reuseExistingClient: true,
            })).rejects.toBeInstanceOf(BadRequestException);

            expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
            expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
        });

        it("allows an unavailable retained counterpart in a replacement request", async () => {
            const existingClient = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(existingClient);
            prismaService.employee_schedule.findFirst.mockResolvedValue({
                id: 10,
                clientId: existingClient.id,
                primaryEmployeeId: 5,
                secondaryEmployeeId: 6,
            });
            prismaService.employee.findMany.mockResolvedValue([
                candidate(7),
                candidate(6, { openToNextWork: false }),
            ]);
            prismaService.employee_schedule.update.mockResolvedValue({});
            prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: existingClient.id });

            await expect(service.requestReplacement(branchId, existingClient.id, 7, 6))
                .resolves.toBe(existingClient);

            expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    primaryEmployeeId: 7,
                    secondaryEmployeeId: 6,
                    replaced: false,
                }),
            });
        });

        it("rejects an unavailable newly requested replacement employee", async () => {
            const existingClient = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(existingClient);
            prismaService.employee_schedule.findFirst.mockResolvedValue({
                id: 10,
                clientId: existingClient.id,
                primaryEmployeeId: 5,
                secondaryEmployeeId: 6,
            });
            prismaService.employee.findMany.mockResolvedValue([
                candidate(7, { openToNextWork: false }),
                candidate(6, { openToNextWork: false }),
            ]);

            await expect(service.requestReplacement(branchId, existingClient.id, 7, 6))
                .rejects.toBeInstanceOf(BadRequestException);

            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
            expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
            expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
        });
    });

    describe("assignment eligibility refusal", () => {
        type EmployeeCandidate = {
            id: number;
            branchId: string;
            deletedAt: Date | null;
            openToNextWork: boolean;
        };

        const eligible = (id = 2): EmployeeCandidate => ({
            id,
            branchId,
            deletedAt: null,
            openToNextWork: true,
        });

        const invalidCases: Array<[
            string,
            EmployeeCandidate[],
            number,
            number | null,
        ]> = [
            ["wrong branch", [], 2, null],
            ["soft deleted", [{ ...eligible(2), deletedAt: new Date("2026-01-01T00:00:00.000Z") }], 2, null],
            ["unavailable", [{ ...eligible(2), openToNextWork: false }], 2, null],
            ["missing", [], 999, null],
            ["wrong branch secondary", [eligible(2), { ...eligible(3), branchId: "branch-b" }], 2, 3],
            ["soft deleted secondary", [eligible(2), { ...eligible(3), deletedAt: new Date("2026-01-01T00:00:00.000Z") }], 2, 3],
            ["unavailable secondary", [eligible(2), { ...eligible(3), openToNextWork: false }], 2, 3],
            ["missing secondary", [eligible(2)], 2, 999],
            ["same employee in both roles", [eligible(2)], 2, 2],
        ];

        const expectNoAssignmentResidue = () => {
            expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
            expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
            expect(prismaService.client.updateMany).not.toHaveBeenCalled();
            expect(createClientUsecase.execute).not.toHaveBeenCalled();
            expect(createClientUsecase.executeWithInitialSchedule).not.toHaveBeenCalled();
            expect(messageAutomationIntentService.persistClientIntent).not.toHaveBeenCalled();
            expect(messageAutomationIntentService.persistScheduleIntent).not.toHaveBeenCalled();
            expect(messageAutomationIntentService.fulfillClientIntent).not.toHaveBeenCalled();
            expect(messageAutomationIntentService.fulfillScheduleIntent).not.toHaveBeenCalled();
            expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
            expect(triggerService.syncEmployeeAssignmentRulesForSchedule).not.toHaveBeenCalled();
            expect(serviceRecordLinkService.revoke).not.toHaveBeenCalled();
            expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            expect(serviceRecordLifecycleService.ensureForClient).not.toHaveBeenCalled();
        };

        it.each(invalidCases)(
            "refuses %s during client assignment without writes or side effects",
            async (label, employees, primaryEmployeeId, secondaryEmployeeId) => {
                prismaService.employee.findMany.mockResolvedValue(employees);

                const creation = service.create(branchId, {
                    name: "Invalid Assignment",
                    primaryEmployeeId,
                    secondaryEmployeeId,
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                });
                if (label.includes("unavailable")) {
                    await expect(creation).rejects.toBeInstanceOf(ConflictException);
                } else {
                    await expect(creation).rejects.toBeInstanceOf(BadRequestException);
                }

                expectNoAssignmentResidue();
            },
        );

        it.each(invalidCases)(
            "refuses %s during client reassignment before replacing the current schedule",
            async (_label, employees, primaryEmployeeId, secondaryEmployeeId) => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue({
                    id: 10,
                    clientId: existingClient.id,
                    primaryEmployeeId: 1,
                    secondaryEmployeeId: null,
                });
                prismaService.employee.findMany.mockResolvedValue(employees);

                await expect(service.update(branchId, existingClient.id, {
                    primaryEmployeeId,
                    secondaryEmployeeId,
                })).rejects.toBeInstanceOf(BadRequestException);

                expectNoAssignmentResidue();
            },
        );

        it.each(invalidCases)(
            "refuses %s during replacement before changing client status",
            async (_label, employees, primaryEmployeeId, secondaryEmployeeId) => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                prismaService.employee.findMany.mockResolvedValue(employees);

                await expect(service.requestReplacement(
                    branchId,
                    existingClient.id,
                    primaryEmployeeId,
                    secondaryEmployeeId,
                )).rejects.toBeInstanceOf(BadRequestException);

                expectNoAssignmentResidue();
            },
        );
    });

    // ============================================
    // completeReplacement
    // ============================================
    describe("completeReplacement", () => {
        describe("given client in replacement_requested status", () => {
            it("should compute and restore status based on dates", async () => {
                // Arrange
                const mockClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000",
                    new Date("2024-01-01"), // start date in the past
                    new Date("2025-12-31"), // end date in the future
                    false, true, "900101", "replacement_requested", false, null,
                    null, null, null, null, false, null, undefined, new Date("2024-01-01")
                );
                const completedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2025-12-31"),
                    false, true, "900101", "active", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(completedClient);
                clientRepository.findByIdForUpdate.mockResolvedValue(mockClient);

                // Act
                await service.completeReplacement(branchId, 1);

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(branchId, 1);
                // Should compute status (active since we're between start and end dates)
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(branchId, 1, {
                    serviceStatus: expect.stringMatching(/active|waiting|completed/),
                }, expect.anything(), KR_BUILTIN_CALENDAR);
            });
        });

        describe("given client not in replacement_requested status", () => {
            it("should still complete but log warning", async () => {
                // Arrange
                const mockClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2025-12-31"),
                    false, true, "900101", "active", false, null // Not in replacement_requested
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(mockClient);
                clientRepository.findByIdForUpdate.mockResolvedValue(mockClient);

                // Act
                await service.completeReplacement(branchId, 1);

                // Assert
                // Should still update status
                expect(updateClientUsecase.execute).toHaveBeenCalled();
            });
        });

        describe("given a confirmed client whose stored 예약 전 is stale during completeReplacement", () => {
            const futureStart = new Date("2026-11-02T00:00:00.000Z");
            const futureEnd = new Date("2026-11-30T00:00:00.000Z");

            const arrange = (beforeStatus: string) => {
                const beforeClient = Object.assign(createClientEntity(), {
                    serviceStatus: beforeStatus,
                    startDate: futureStart,
                    endDate: futureEnd,
                });
                const afterClient = Object.assign(createClientEntity(), {
                    serviceStatus: "waiting",
                    startDate: futureStart,
                    endDate: futureEnd,
                });
                findClientByIdUsecase.execute.mockResolvedValue(beforeClient);
                clientRepository.findByIdForUpdate.mockResolvedValue(beforeClient);
                updateClientUsecase.execute.mockResolvedValue(afterClient);
                prismaService.employee_schedule.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
                    where["terminatedAt"] === null ? [{ id: 7 }] : []);
                return { afterClient };
            };

            it("does not schedule a link merely because the stored status was 예약 전", async () => {
                arrange("pre_booking");
                let release!: () => void;
                const held = new Promise<void>((resolve) => { release = resolve; });
                let transactionBodyDone = false;
                prismaService.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
                    const result = await callback(prismaService);
                    transactionBodyDone = true;
                    await held;
                    return result;
                });

                const running = service.completeReplacement(branchId, 1);
                for (let turn = 0; turn < 50 && !transactionBodyDone; turn += 1) {
                    await new Promise((resolve) => setImmediate(resolve));
                }
                await new Promise((resolve) => setImmediate(resolve));
                expect(transactionBodyDone).toBe(true);
                expect(prismaService.employee_schedule.findMany).not.toHaveBeenCalledWith(
                    expect.objectContaining({ where: expect.objectContaining({ terminatedAt: null }) }),
                );
                expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();

                release();
                await running;

                expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            });

            it("does not schedule when the client was not stored as 예약 전 (replacement_requested)", async () => {
                arrange("replacement_requested");

                await service.completeReplacement(branchId, 1);

                expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            });

            it("still resolves without attempting a link for the already-confirmed dated client", async () => {
                const { afterClient } = arrange("pre_booking");
                serviceRecordLinkService.scheduleForServiceStart.mockRejectedValueOnce(new Error("sms unavailable"));
                const logError = jest.spyOn((service as unknown as { logger: { error: (message: string) => void } }).logger, "error")
                    .mockImplementation(() => undefined);

                await expect(service.completeReplacement(branchId, 1)).resolves.toBe(afterClient);

                expect(logError).not.toHaveBeenCalled();
            });
        });

        describe("given non-existent client", () => {
            it("should throw NotFoundException", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                const error = await service.completeReplacement(branchId, 999).catch((cause: unknown) => cause);
                expect(error).toBeInstanceOf(NotFoundException);
                expect((error as NotFoundException).getResponse()).toMatchObject({
                    code: "RESOURCE_NOT_FOUND",
                });
            });
        });
    });

    // ============================================
    // findAllPaginated
    // ============================================
    describe("findAllPaginated", () => {
        it("should return paginated results with employee info", async () => {
            // Arrange
            const mockClients = [createClientEntity()];
            const paginatedResult = {
                data: mockClients,
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1,
            };
            listClientsPaginatedUsecase.execute.mockResolvedValue(paginatedResult);

            // Act
            const result = await service.findAllPaginated(branchId, 1, 10, "Test");

            // Assert
            expect(listClientsPaginatedUsecase.execute).toHaveBeenCalledWith(branchId, 1, 10, "Test");
            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(1);
            expect(result.page).toBe(1);
            expect(result.totalPages).toBe(1);
        });

        it("passes the selected client tab through to the paginated use case", async () => {
            const paginatedResult = {
                data: [createClientEntity()],
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1,
            };
            listClientsPaginatedUsecase.execute.mockResolvedValue(paginatedResult);

            await service.findAllPaginated(branchId, 1, 10, "Kim", "active");

            expect(listClientsPaginatedUsecase.execute).toHaveBeenCalledWith(
                branchId,
                1,
                10,
                "Kim",
                "active",
            );
        });

        it("should handle empty search results", async () => {
            // Arrange
            const paginatedResult = {
                data: [],
                total: 0,
                page: 1,
                limit: 10,
                totalPages: 0,
            };
            listClientsPaginatedUsecase.execute.mockResolvedValue(paginatedResult);

            // Act
            const result = await service.findAllPaginated(branchId, 1, 10, "NonExistent");

            // Assert
            expect(result.data).toHaveLength(0);
            expect(result.total).toBe(0);
        });
    });

    describe("getListSummary", () => {
        it("returns the branch-scoped summary from the repository", async () => {
            const summary = {
                total: 2,
                byTab: {
                    all: 2,
                    pre_booking: 0,
                    waiting: 0,
                    replacement_requested: 0,
                    active: 1,
                    completed: 1,
                    terminated: 0,
                },
                dueDate: { thisMonth: 1, nextMonth: 0 },
                serviceEnd: { count: 1, from: "2026-09-28", to: "2026-10-01" },
            };
            (clientRepository.getListSummary as jest.Mock).mockResolvedValue(summary);

            await expect(service.getListSummary(branchId, "Kim")).resolves.toEqual(summary);
            expect(clientRepository.getListSummary).toHaveBeenCalledWith(branchId, "Kim");
        });
    });

    describe("getStats", () => {
        it("counts review-needed state from each client's latest contract instead of the pinned eDocId", async () => {
            prismaService.client.count.mockResolvedValue(0);
            prismaService.client.findMany.mockResolvedValue([{ id: 1 }]);
            prismaService.eformsign_doc.findMany.mockResolvedValue([
                {
                    clientId: 1,
                    documentId: "latest-contract",
                    statusType: "070",
                    stepType: "06",
                    stepName: "제공기관 확인",
                    detailPayload: null,
                    permanentPurgeRequestedAt: null,
                    documentKind: "contract",
                    serviceRecordCaseId: null,
                    templateId: null,
                },
            ]);

            const result = await service.getStats(branchId);

            expect(result.contractsPendingSignature).toBe(1);
        });

        // contractsNotSent must equal the number of clients whose list row carries the
        // "발송 필요" badge: effective service status, latest-contract lookup, send window.
        describe("contractsNotSent (계약서 발송 필요)", () => {
            type StoredClient = {
                id: number;
                bookingConfirmedAt: Date | null;
                eDocId: string | null;
                serviceStatus: string | null;
                startDate: Date;
                endDate: Date;
            };
            const storedClient = (overrides: Partial<StoredClient> = {}): StoredClient => ({
                id: 1,
                bookingConfirmedAt: new Date("2026-01-01"),
                eDocId: null,
                serviceStatus: "waiting",
                startDate: new Date("2026-03-20T00:00:00.000Z"),
                endDate: new Date("2026-04-04T00:00:00.000Z"),
                ...overrides,
            });
            const contractDoc = (overrides: Record<string, unknown> = {}) => ({
                clientId: 1,
                documentId: "doc-1",
                statusType: "060",
                stepType: "02",
                stepName: "이용자 서명",
                detailPayload: null,
                permanentPurgeRequestedAt: null,
                documentKind: "contract",
                serviceRecordCaseId: null,
                templateId: null,
                ...overrides,
            });

            const seed = (clients: StoredClient[], docs: Record<string, unknown>[]) => {
                // A tiny stand-in for the database so the legacy stored-status count query
                // (eDocId IS NULL AND service_status = waiting) behaves like the real one.
                prismaService.client.count.mockImplementation(async ({ where }: { where: { eDocId?: string | null; serviceStatus?: string } }) =>
                    clients.filter((client) =>
                        (where.eDocId === undefined || client.eDocId === where.eDocId)
                        && (where.serviceStatus === undefined || client.serviceStatus === where.serviceStatus),
                    ).length);
                prismaService.client.findMany.mockResolvedValue(clients);
                prismaService.eformsign_doc.findMany.mockResolvedValue(docs);
            };

            beforeEach(() => {
                jest.useFakeTimers();
                jest.setSystemTime(new Date("2026-03-17T09:00:00.000Z"));
            });

            afterEach(() => {
                jest.useRealTimers();
            });

            it("counts a client whose only contract expired even though eDocId still points at it", async () => {
                seed(
                    [storedClient({ eDocId: "doc-1" })],
                    [contractDoc({ statusType: "080" })],
                );

                expect((await service.getStats(branchId)).contractsNotSent).toBe(1);
            });

            it("does not count a client with a live contract that is linked only by clientId", async () => {
                seed(
                    [storedClient({ eDocId: null })],
                    [contractDoc({ statusType: "060" })],
                );

                expect((await service.getStats(branchId)).contractsNotSent).toBe(0);
            });

            it("does not count a client whose latest contract is completed or under provider review", async () => {
                seed(
                    [storedClient({ id: 1 }), storedClient({ id: 2 })],
                    [
                        contractDoc({ clientId: 1, documentId: "doc-1", statusType: "050", stepType: "05", stepName: "완료" }),
                        contractDoc({ clientId: 2, documentId: "doc-2", statusType: "070", stepType: "06", stepName: "제공기관 확인" }),
                    ],
                );

                expect((await service.getStats(branchId)).contractsNotSent).toBe(0);
            });

            it.each(["040", "045", "041"])(
                "does not count a client whose latest contract is %s (revoke requested / refused revoke)",
                async (statusType) => {
                    seed(
                        [storedClient({ eDocId: "doc-1" })],
                        [contractDoc({ statusType })],
                    );

                    expect((await service.getStats(branchId)).contractsNotSent).toBe(0);
                },
            );

            it.each(["042", "090"])("counts a client whose latest contract is %s (revoked)", async (statusType) => {
                seed(
                    [storedClient({ eDocId: "doc-1" })],
                    [contractDoc({ statusType })],
                );

                expect((await service.getStats(branchId)).contractsNotSent).toBe(1);
            });

            it("counts a client with no contract at all", async () => {
                seed([storedClient()], []);

                expect((await service.getStats(branchId)).contractsNotSent).toBe(1);
            });

            it("counts a client whose latest contract was deleted or purged", async () => {
                seed(
                    [storedClient({ id: 1 }), storedClient({ id: 2 })],
                    [
                        contractDoc({ clientId: 1, documentId: "doc-1", statusType: "049" }),
                        contractDoc({ clientId: 2, documentId: "doc-2", statusType: "003", permanentPurgeRequestedAt: new Date("2026-03-01T00:00:00.000Z") }),
                    ],
                );

                expect((await service.getStats(branchId)).contractsNotSent).toBe(2);
            });

            it("uses the effective service status, not the stored one", async () => {
                // Stored "active" but the start date is still ahead: the list shows it as waiting.
                seed([storedClient({ serviceStatus: "active" })], []);
                expect((await service.getStats(branchId)).contractsNotSent).toBe(1);

                // Stored "waiting" but the service already ended: the list shows it as completed.
                seed(
                    [storedClient({
                        serviceStatus: "waiting",
                        startDate: new Date("2026-02-01T00:00:00.000Z"),
                        endDate: new Date("2026-03-01T00:00:00.000Z"),
                    })],
                    [],
                );
                expect((await service.getStats(branchId)).contractsNotSent).toBe(0);
            });

            it("only counts clients inside the business-day send window", async () => {
                // 2026-03-30 is more than six business days after 2026-03-17.
                seed([storedClient({ startDate: new Date("2026-03-30T00:00:00.000Z") })], []);

                expect((await service.getStats(branchId)).contractsNotSent).toBe(0);
            });
        });
    });

    // ============================================
    // Service status computation tests
    // ============================================
    describe("service status computation", () => {
        beforeEach(() => {
            jest.useFakeTimers().setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        const createStatusClient = (
            storedStatus: string | null,
            startDate: string | null,
            endDate: string | null,
        ): ClientEntity => {
            const client = createClientEntity();
            client.serviceStatus = storedStatus;
            if (storedStatus === "pre_booking") Object.assign(client, { bookingConfirmedAt: null });
            client.startDate = startDate ? new Date(`${startDate}T00:00:00.000Z`) : null;
            client.endDate = endDate ? new Date(`${endDate}T00:00:00.000Z`) : null;
            return client;
        };

        it.each([
            {
                label: "missing dates",
                storedStatus: null,
                startDate: null,
                endDate: null,
                effectiveStatus: "pre_booking",
                badgeStatus: "preBooking",
            },
            {
                label: "start date after today",
                storedStatus: "active",
                startDate: "2026-10-02",
                endDate: "2026-10-03",
                effectiveStatus: "waiting",
                badgeStatus: "pending",
            },
            {
                label: "start date equal to today and end date equal to today",
                storedStatus: "waiting",
                startDate: "2026-10-01",
                endDate: "2026-10-01",
                effectiveStatus: "active",
                badgeStatus: "active",
            },
            {
                label: "end date before today despite stored active status",
                storedStatus: "active",
                startDate: "2026-09-01",
                endDate: "2026-09-30",
                effectiveStatus: "completed",
                badgeStatus: "completed",
            },
            {
                label: "manual pre-booking status",
                storedStatus: "pre_booking",
                startDate: "2026-09-01",
                endDate: "2026-09-30",
                effectiveStatus: "pre_booking",
                badgeStatus: "preBooking",
            },
            {
                label: "manual terminated status",
                storedStatus: "terminated",
                startDate: "2026-10-02",
                endDate: "2026-10-03",
                effectiveStatus: "terminated",
                badgeStatus: "terminated",
            },
            {
                label: "manual replacement requested status",
                storedStatus: "replacement_requested",
                startDate: "2026-09-01",
                endDate: "2026-09-30",
                effectiveStatus: "replacement_requested",
                badgeStatus: "terminated",
            },
        ])("uses the effective Korea date status for $label", async ({
            storedStatus,
            startDate,
            endDate,
            effectiveStatus,
            badgeStatus,
        }) => {
            listClientsUsecase.execute.mockResolvedValue([
                createStatusClient(storedStatus, startDate, endDate),
            ]);

            const [result] = await service.findAll(branchId);

            expect(result?.serviceStatus).toBe(effectiveStatus);
            expect(result?.badges).toEqual(expect.arrayContaining([
                expect.objectContaining({ key: "service_status", status: badgeStatus }),
            ]));
            if (effectiveStatus === "completed" || effectiveStatus === "terminated" || effectiveStatus === "pre_booking") {
                expect(result?.actionRequired).toBeNull();
            }
            if (effectiveStatus === "replacement_requested") {
                expect(result?.actionRequired).toEqual({ reason: "교체 요청", priority: 1 });
            }
        });

        it("should attach computed service status to clients", async () => {
            // Arrange
            // Create client with dates that would result in 'active' status
            const futureEndDate = new Date();
            futureEndDate.setMonth(futureEndDate.getMonth() + 1);
            const pastStartDate = new Date();
            pastStartDate.setMonth(pastStartDate.getMonth() - 1);

            const mockClient = new ClientEntity(
                1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                "100000", "50000", "50000",
                pastStartDate, futureEndDate,
                false, true, "900101", "waiting", // Stored as waiting
                false, null,
                null, null, null, null, false, null, undefined, new Date("2024-01-01")
            );
            listClientsUsecase.execute.mockResolvedValue([mockClient]);
            // Mock the prismaService.client.update for background update
            prismaService.client = { update: jest.fn().mockResolvedValue({}) } as unknown as typeof prismaService.client;

            // Act
            const result = await service.findAll(branchId);

            // Assert
            // Should return computed status, not stored status
            expect(result).toHaveLength(1);
            expect(result[0]?.serviceStatus).toBe("active");
        });
    });
});
