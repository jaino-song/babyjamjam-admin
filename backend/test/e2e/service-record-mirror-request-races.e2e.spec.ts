import { ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, PrismaClient } from "@prisma/client";

import { ScheduleChangeService } from "application/services/schedule-change.service";
import {
    ExpectedEformsignMirrorGeneration,
    LinkMirroredEformsignDocByPhoneUsecase,
} from "application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { PrismaService } from "infrastructure/database/prisma.service";

import {
    assertApprovedServiceRecordWriteLockDatabaseTarget,
    createApprovedServiceRecordWriteLockClient,
} from "./helpers/service-record-write-lock-order.helper";

const E2E_ENABLED = process.env["SERVICE_RECORD_WRITE_LOCK_E2E"] === "1";
const describeE2E = E2E_ENABLED ? describe : describe.skip;
const RACE_TIMEOUT_MS = 5_000;
const TEMPLATE_ID = "task3-race-contract-template";
const CREATED_DOCUMENT_STATUS = "072";

type FixtureIds = {
    branchIds: string[];
    clientIds: number[];
    employeeIds: number[];
    scheduleIds: number[];
    caseIds: string[];
    requestIds: string[];
    documentRowIds: number[];
};

type Barrier = {
    arrive: () => Promise<void>;
    waitUntilReady: () => Promise<void>;
    release: () => void;
};

type QueryBarrierMode = "before" | "after";

type QueryBarrierPredicate = (info: {
    model: string | undefined;
    operation: string;
}) => boolean;

let prisma: PrismaClient;
let activeFixture: FixtureIds;
let fixtureSequence = 0;

function newFixture(): FixtureIds {
    return {
        branchIds: [],
        clientIds: [],
        employeeIds: [],
        scheduleIds: [],
        caseIds: [],
        requestIds: [],
        documentRowIds: [],
    };
}

function fixtureToken(): string {
    fixtureSequence += 1;
    return `${process.pid}-${Date.now()}-${fixtureSequence}`;
}

function fixturePhone(): string {
    const suffix = String((process.pid * 1_000 + fixtureSequence) % 100_000_000)
        .padStart(8, "0");
    return `010${suffix}`;
}

function atUtcDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
}

function createBarrier(expectedArrivals: number): Barrier {
    let arrivals = 0;
    let releaseGate!: () => void;
    let ready!: () => void;

    const readyPromise = new Promise<void>((resolve) => {
        ready = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
        releaseGate = resolve;
    });

    return {
        arrive: async () => {
            arrivals += 1;
            if (arrivals === expectedArrivals) ready();
            await releasePromise;
        },
        waitUntilReady: () => withTimeout(readyPromise, "barrier arrivals"),
        release: () => releaseGate(),
    };
}

/** A timer here is only a bounded failure guard; synchronization uses barriers. */
async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`${label} did not complete within ${RACE_TIMEOUT_MS}ms`)),
            RACE_TIMEOUT_MS,
        );
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

function withQueryBarrier(
    client: PrismaClient,
    predicate: QueryBarrierPredicate,
    barrier: Barrier,
    mode: QueryBarrierMode,
): PrismaClient {
    let paused = false;
    const extended = client.$extends({
        query: {
            $allOperations: async ({ model, operation, args, query }) => {
                const shouldPause = !paused && predicate({ model, operation });
                const resultPromise = query(args);
                if (shouldPause && mode === "before") {
                    paused = true;
                    await barrier.arrive();
                }
                const result = await resultPromise;
                if (shouldPause && mode === "after") {
                    paused = true;
                    await barrier.arrive();
                }
                return result;
            },
        },
    });
    return extended as unknown as PrismaClient;
}

function withMirrorClientMatchBarrier(
    client: PrismaClient,
    barrier: Barrier,
): PrismaClient {
    return withQueryBarrier(
        client,
        ({ model, operation }) => model === "client" && operation === "findMany",
        barrier,
        "after",
    );
}

function withScheduleRequestReadBarrier(
    client: PrismaClient,
    barrier: Barrier,
): PrismaClient {
    return withQueryBarrier(
        client,
        ({ model, operation }) =>
            model === "schedule_change_request" && operation === "findFirst",
        barrier,
        "after",
    );
}

function expectedGeneration(): ExpectedEformsignMirrorGeneration {
    return {
        detailSourceUpdatedDate: new Date("2026-09-01T01:00:00.000Z"),
        detailSyncedAt: new Date("2026-09-01T01:01:00.000Z"),
    };
}

function contractDetail(phone: string): Record<string, unknown> {
    return {
        id: `detail-${fixtureToken()}`,
        document_number: `DOC-${fixtureSequence}`,
        template: { id: TEMPLATE_ID, name: "계약서" },
        document_name: "산모신생아 건강관리 계약서",
        creator: { recipient_type: "01", id: `task3-${fixtureSequence}@example.test`, name: "담당자" },
        created_date: Date.parse("2026-09-01T00:00:00.000Z"),
        updated_date: Date.parse("2026-09-01T01:00:00.000Z"),
        current_status: {
            status_type: CREATED_DOCUMENT_STATUS,
            step_type: "06",
            step_index: "3",
            step_name: "완료",
            step_recipients: [],
            step_group: 3,
        },
        fields: [
            { id: "이용자 성명", value: "김고객", type: "text" },
            { id: "이용자 주소", value: "서울시 중구", type: "text" },
            { id: "이용자 생년월일", value: "920304", type: "text" },
            { id: "계약 시작일", value: "2026-09-01", type: "date" },
            { id: "계약 종료일", value: "2026-09-14", type: "date" },
            { id: "서비스 비용", value: "1,500,000", type: "text" },
            { id: "정부지원금", value: "1,000,000", type: "text" },
            { id: "본인부담금", value: "500,000", type: "text" },
        ],
        recipients: [{
            recipient_type: "02",
            name: "김고객",
            sms: `010-${phone.slice(3, 7)}-${phone.slice(7)}`,
        }],
    };
}

function createMirrorUsecase(
    client: PrismaClient,
    branchId: string,
    autoRegistrationEnabled = true,
): LinkMirroredEformsignDocByPhoneUsecase {
    const config = {
        get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const settings = {
        getClientAutoRegistrationEnabled: jest.fn().mockResolvedValue(autoRegistrationEnabled),
        getGreetingOnAutoRegistrationEnabled: jest.fn().mockResolvedValue(false),
        getEformsignTemplateBranch: jest.fn().mockResolvedValue({
            branchId,
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        }),
    };
    return new LinkMirroredEformsignDocByPhoneUsecase(
        client as unknown as PrismaService,
        config,
        settings as never,
    );
}

async function createBranch(name: string): Promise<string> {
    const branch = await prisma.branch.create({
        data: {
            name,
            slug: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        },
        select: { id: true },
    });
    activeFixture.branchIds.push(branch.id);
    return branch.id;
}

async function createMirrorDocument(phone: string): Promise<{
    rowId: number;
    documentId: string;
    generation: ExpectedEformsignMirrorGeneration;
}> {
    const token = fixtureToken();
    const documentId = `task3-mirror-race-${token}`;
    const generation = expectedGeneration();
    const detail = contractDetail(phone);
    const row = await prisma.eformsign_doc.create({
        data: {
            documentId,
            documentName: "산모신생아 건강관리 계약서",
            documentNumber: `DOC-${token}`,
            templateName: "계약서",
            stepRecipientTypes: "02",
            createdDate: new Date("2026-09-01T00:00:00.000Z"),
            updatedDate: new Date("2026-09-01T01:00:00.000Z"),
            statusType: CREATED_DOCUMENT_STATUS,
            statusDetail: "완료",
            stepType: "06",
            stepIndex: "3",
            stepName: "완료",
            stepRecipientType: "02",
            stepRecipientName: "김고객",
            stepRecipientSms: `010-${phone.slice(3, 7)}-${phone.slice(7)}`,
            expiredDate: new Date("2026-10-01T00:00:00.000Z"),
            branchId: null,
            clientId: null,
            documentKind: null,
            templateId: TEMPLATE_ID,
            serviceRecordCaseId: null,
            detailPayload: detail as unknown as Prisma.InputJsonValue,
            detailSourceUpdatedDate: generation.detailSourceUpdatedDate,
            detailSyncedAt: generation.detailSyncedAt,
            syncStatus: "ready",
        },
        select: { id: true },
    });
    activeFixture.documentRowIds.push(row.id);
    await prisma.eformsign_doc_file.createMany({
        data: ["document", "audit_trail"].map((fileType) => ({
            eformsignDocId: row.id,
            fileType,
            content: Buffer.from(`task3-${token}-${fileType}`),
            contentType: "application/pdf",
            byteSize: `task3-${token}-${fileType}`.length,
            sha256: "a".repeat(64),
            sourceUpdatedDate: generation.detailSourceUpdatedDate,
        })),
    });
    return { rowId: row.id, documentId, generation };
}

async function createExistingClient(branchId: string, phone: string): Promise<{
    clientId: number;
    caseId: string;
}> {
    const client = await prisma.client.create({
        data: {
            name: "김고객",
            voucherClient: true,
            phone: `010-${phone.slice(3, 7)}-${phone.slice(7)}`,
            phoneNormalized: phone,
            branchId,
            duration: 10,
            startDate: atUtcDate("2026-09-01"),
            endDate: atUtcDate("2026-09-14"),
        },
        select: { id: true },
    });
    activeFixture.clientIds.push(client.id);
    const record = await prisma.service_record_case.create({
        data: {
            branchId,
            clientId: client.id,
            startDate: atUtcDate("2026-09-01"),
            endDate: atUtcDate("2026-09-14"),
            requiredSessionCount: 10,
        },
        select: { id: true },
    });
    activeFixture.caseIds.push(record.id);
    return { clientId: client.id, caseId: record.id };
}

async function createScheduleFixture(): Promise<{
    branchId: string;
    clientId: number;
    employeeId: number;
    scheduleId: number;
    caseId: string;
    requestId: string;
    oldEndDate: Date;
    expectedEndDate: Date;
    expectedServiceDate: Date;
}> {
    const token = fixtureToken();
    const branchId = await createBranch(`task3-schedule-race-${token}`);
    const employee = await prisma.employee.create({
        data: {
            name: "Task 3 Race Employee",
            phone: `010${String((process.pid * 3_000 + fixtureSequence) % 100_000_000).padStart(8, "0")}`,
            workArea: ["task3"],
            grade: "산모신생아 건강관리사",
            branchId,
        },
        select: { id: true },
    });
    activeFixture.employeeIds.push(employee.id);
    const oldEndDate = atUtcDate("2026-09-02");
    const expectedEndDate = atUtcDate("2026-09-03");
    const expectedServiceDate = atUtcDate("2026-09-02");
    const client = await prisma.client.create({
        data: {
            name: "Task 3 Schedule Client",
            voucherClient: false,
            branchId,
            duration: 2,
            startDate: atUtcDate("2026-09-01"),
            endDate: oldEndDate,
        },
        select: { id: true },
    });
    activeFixture.clientIds.push(client.id);
    const schedule = await prisma.employee_schedule.create({
        data: {
            branchId,
            clientId: client.id,
            primaryEmployeeId: employee.id,
            workAddress: "task3",
            startDate: atUtcDate("2026-09-01"),
            endDate: oldEndDate,
        },
        select: { id: true },
    });
    activeFixture.scheduleIds.push(schedule.id);
    const record = await prisma.service_record_case.create({
        data: {
            branchId,
            clientId: client.id,
            startDate: atUtcDate("2026-09-01"),
            endDate: oldEndDate,
            requiredSessionCount: 2,
        },
        select: { id: true },
    });
    activeFixture.caseIds.push(record.id);
    const request = await prisma.schedule_change_request.create({
        data: {
            branchId,
            scheduleId: schedule.id,
            clientId: client.id,
            sessionIndex: 1,
            fromDate: atUtcDate("2026-09-01"),
            toDate: expectedServiceDate,
            oldEndDate,
            newEndDate: expectedEndDate,
            status: "pending",
        },
        select: { id: true },
    });
    activeFixture.requestIds.push(request.id);
    return {
        branchId,
        clientId: client.id,
        employeeId: employee.id,
        scheduleId: schedule.id,
        caseId: record.id,
        requestId: request.id,
        oldEndDate,
        expectedEndDate,
        expectedServiceDate,
    };
}

async function cleanupFixture(fixture: FixtureIds): Promise<void> {
    if (!prisma) return;
    if (fixture.requestIds.length > 0) {
        await prisma.schedule_change_request.deleteMany({
            where: { id: { in: fixture.requestIds } },
        });
    }
    if (fixture.clientIds.length > 0) {
        // eDocId is a separate FK to eformsign_doc.document_id and must be
        // cleared before the exact document rows are removed.
        await prisma.client.updateMany({
            where: { id: { in: fixture.clientIds } },
            data: { eDocId: null },
        });
    }
    if (fixture.documentRowIds.length > 0) {
        await prisma.eformsign_doc.deleteMany({
            where: { id: { in: fixture.documentRowIds } },
        });
    }
    if (fixture.caseIds.length > 0) {
        await prisma.service_record_day.deleteMany({
            where: { serviceRecordCaseId: { in: fixture.caseIds } },
        });
        await prisma.service_record_assignment.deleteMany({
            where: { serviceRecordCaseId: { in: fixture.caseIds } },
        });
        await prisma.service_record_case.deleteMany({
            where: { id: { in: fixture.caseIds } },
        });
    }
    if (fixture.scheduleIds.length > 0) {
        await prisma.employee_schedule.deleteMany({
            where: { id: { in: fixture.scheduleIds } },
        });
    }
    if (fixture.clientIds.length > 0) {
        await prisma.client.deleteMany({
            where: { id: { in: fixture.clientIds } },
        });
    }
    if (fixture.employeeIds.length > 0) {
        await prisma.employee.deleteMany({
            where: { id: { in: fixture.employeeIds } },
        });
    }
    if (fixture.branchIds.length > 0) {
        await prisma.branch.deleteMany({
            where: { id: { in: fixture.branchIds } },
        });
    }
}

function realTokenService(): ServiceRecordTokenService {
    return new ServiceRecordTokenService(prisma as unknown as PrismaService);
}

function expectRequestNotPending(error: unknown): void {
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual(
        expect.objectContaining({ code: "REQUEST_NOT_PENDING" }),
    );
}

describe("service-record mirror and schedule request races (real PostgreSQL)", () => {
    beforeAll(async () => {
        // This guard intentionally runs before createApproved... constructs a client.
        assertApprovedServiceRecordWriteLockDatabaseTarget();
        prisma = createApprovedServiceRecordWriteLockClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        if (prisma) await prisma.$disconnect();
    });

    beforeEach(() => {
        activeFixture = newFixture();
    });

    afterEach(async () => {
        if (activeFixture) await cleanupFixture(activeFixture);
    });

    describeE2E("branchless mirrored contract linking", () => {
        it("links a branchless mirror to the exact existing client through the complete transaction", async () => {
            const branchId = await createBranch(`task3-existing-mirror-${fixtureToken()}`);
            const phone = fixturePhone();
            const existing = await createExistingClient(branchId, phone);
            const mirror = await createMirrorDocument(phone);
            const usecase = createMirrorUsecase(prisma, branchId);

            await expect(usecase.execute(
                mirror.documentId,
                { suppressOutboundAutomation: true },
                mirror.generation,
            )).resolves.toBe("linked");

            const persistedDocument = await prisma.eformsign_doc.findUnique({
                where: { id: mirror.rowId },
                select: { branchId: true, clientId: true, autoRegisteredClient: true },
            });
            expect(persistedDocument).toEqual({
                branchId,
                clientId: existing.clientId,
                autoRegisteredClient: false,
            });
            const persistedClient = await prisma.client.findUnique({
                where: { id: existing.clientId },
                select: { branchId: true, eDocId: true },
            });
            expect(persistedClient).toEqual({ branchId, eDocId: mirror.documentId });
            await expect(prisma.service_record_case.findUnique({
                where: { id: existing.caseId },
                select: { branchId: true, clientId: true },
            })).resolves.toEqual({ branchId, clientId: existing.clientId });
        });

        it("does not claim a branchless mirror for a same-phone client in another authorized branch", async () => {
            const clientBranchId = await createBranch(`task3-scope-client-${fixtureToken()}`);
            const authorizedBranchId = await createBranch(`task3-scope-authorized-${fixtureToken()}`);
            const phone = fixturePhone();
            const existing = await createExistingClient(clientBranchId, phone);
            const mirror = await createMirrorDocument(phone);
            const usecase = createMirrorUsecase(prisma, authorizedBranchId, false);

            await expect(usecase.execute(
                mirror.documentId,
                { suppressOutboundAutomation: true },
                mirror.generation,
            )).resolves.toBe("disabled");

            await expect(prisma.eformsign_doc.findUnique({
                where: { id: mirror.rowId },
                select: { branchId: true, clientId: true },
            })).resolves.toEqual({ branchId: null, clientId: null });
            await expect(prisma.client.findUnique({
                where: { id: existing.clientId },
                select: { branchId: true, eDocId: true },
            })).resolves.toEqual({ branchId: clientBranchId, eDocId: null });
            await expect(prisma.client.count({
                where: { branchId: authorizedBranchId, phoneNormalized: phone },
            })).resolves.toBe(0);
        });

        it("auto-registers a branchless mirror and persists the mapped destination branch", async () => {
            const sourceBranchId = await createBranch(`task3-auto-source-${fixtureToken()}`);
            const destinationBranchId = await createBranch(`task3-auto-destination-${fixtureToken()}`);
            const phone = fixturePhone();
            const mirror = await createMirrorDocument(phone);
            const usecase = createMirrorUsecase(prisma, destinationBranchId);

            // This assertion intentionally covers execute() and its post-link
            // generation fence, not only the inner create transaction.
            const result = await usecase.execute(
                mirror.documentId,
                { suppressOutboundAutomation: true },
                mirror.generation,
            );

            const persistedDocument = await prisma.eformsign_doc.findUnique({
                where: { id: mirror.rowId },
                select: { branchId: true, clientId: true, autoRegisteredClient: true },
            });
            if (!persistedDocument || persistedDocument.clientId === null) {
                throw new Error("auto-registration did not persist a client id");
            }
            const createdClientId = persistedDocument.clientId;
            activeFixture.clientIds.push(createdClientId);
            expect(result).toBe("created");
            expect(persistedDocument?.branchId).toBe(destinationBranchId);
            expect(persistedDocument.clientId).toBe(createdClientId);
            expect(persistedDocument?.autoRegisteredClient).toBe(true);
            const persistedClient = await prisma.client.findUnique({
                where: { id: createdClientId },
                select: {
                    branchId: true,
                    eDocId: true,
                    phoneNormalized: true,
                    duration: true,
                },
            });
            expect(persistedClient).toEqual({
                branchId: destinationBranchId,
                eDocId: mirror.documentId,
                phoneNormalized: phone,
                duration: 10,
            });
            expect(await prisma.employee_schedule.count({ where: { clientId: createdClientId } })).toBe(0);
            expect(sourceBranchId).not.toBe(destinationBranchId);
        });

        it("rejects a branch-ownership change observed after the branchless snapshot", async () => {
            const sourceBranchId = await createBranch(`task3-owner-source-${fixtureToken()}`);
            const destinationBranchId = await createBranch(`task3-owner-destination-${fixtureToken()}`);
            const phone = fixturePhone();
            const existing = await createExistingClient(sourceBranchId, phone);
            const mirror = await createMirrorDocument(phone);
            const barrier = createBarrier(1);
            const linkClient = createApprovedServiceRecordWriteLockClient();
            await linkClient.$connect();
            const usecase = createMirrorUsecase(
                withMirrorClientMatchBarrier(linkClient, barrier),
                sourceBranchId,
            );
            const execution = usecase.execute(
                mirror.documentId,
                { suppressOutboundAutomation: true },
                mirror.generation,
            );

            try {
                await barrier.waitUntilReady();
                await prisma.eformsign_doc.update({
                    where: { id: mirror.rowId },
                    data: { branchId: destinationBranchId },
                });
                barrier.release();
                await expect(withTimeout(execution, "mirror ownership race")).resolves.toBe("mirror_not_ready");
            } finally {
                barrier.release();
                await Promise.allSettled([execution]);
                await linkClient.$disconnect();
            }

            const persistedDocument = await prisma.eformsign_doc.findUnique({
                where: { id: mirror.rowId },
                select: { branchId: true, clientId: true },
            });
            expect(persistedDocument).toEqual({ branchId: destinationBranchId, clientId: null });
            await expect(prisma.client.findUnique({
                where: { id: existing.clientId },
                select: { branchId: true, eDocId: true },
            })).resolves.toEqual({ branchId: sourceBranchId, eDocId: null });
            await expect(prisma.service_record_case.findUnique({
                where: { id: existing.caseId },
                select: { branchId: true, clientId: true },
            })).resolves.toEqual({ branchId: sourceBranchId, clientId: existing.clientId });
        });

        it("rejects a changed mirror generation without leaving an auto-registered client", async () => {
            const destinationBranchId = await createBranch(`task3-generation-destination-${fixtureToken()}`);
            const phone = fixturePhone();
            const mirror = await createMirrorDocument(phone);
            const changedSource = new Date("2026-09-01T02:00:00.000Z");
            const changedSync = new Date("2026-09-01T02:01:00.000Z");
            const barrier = createBarrier(1);
            const linkClient = createApprovedServiceRecordWriteLockClient();
            await linkClient.$connect();
            const usecase = createMirrorUsecase(
                withMirrorClientMatchBarrier(linkClient, barrier),
                destinationBranchId,
            );
            const execution = usecase.execute(
                mirror.documentId,
                { suppressOutboundAutomation: true },
                mirror.generation,
            );

            try {
                await barrier.waitUntilReady();
                await prisma.eformsign_doc.update({
                    where: { id: mirror.rowId },
                    data: {
                        detailSourceUpdatedDate: changedSource,
                        detailSyncedAt: changedSync,
                    },
                });
                barrier.release();
                await expect(withTimeout(execution, "mirror generation race")).resolves.toBe("mirror_not_ready");
            } finally {
                barrier.release();
                await Promise.allSettled([execution]);
                await linkClient.$disconnect();
            }

            const persistedDocument = await prisma.eformsign_doc.findUnique({
                where: { id: mirror.rowId },
                select: {
                    branchId: true,
                    clientId: true,
                    detailSourceUpdatedDate: true,
                    detailSyncedAt: true,
                },
            });
            expect(persistedDocument).toEqual({
                branchId: null,
                clientId: null,
                detailSourceUpdatedDate: changedSource,
                detailSyncedAt: changedSync,
            });
            await expect(prisma.client.count({ where: { phoneNormalized: phone } })).resolves.toBe(0);
        });
    });

    describeE2E("schedule-change request races", () => {
        it("approves a duplicate request once and never downgrades the terminal row to stale", async () => {
            const fixture = await createScheduleFixture();
            const barrier = createBarrier(2);
            const leftClient = createApprovedServiceRecordWriteLockClient();
            const rightClient = createApprovedServiceRecordWriteLockClient();
            await Promise.all([leftClient.$connect(), rightClient.$connect()]);
            const leftService = new ScheduleChangeService(
                withScheduleRequestReadBarrier(leftClient, barrier) as unknown as PrismaService,
                realTokenService(),
            );
            const rightService = new ScheduleChangeService(
                withScheduleRequestReadBarrier(rightClient, barrier) as unknown as PrismaService,
                realTokenService(),
            );
            const leftUserId = crypto.randomUUID();
            const rightUserId = crypto.randomUUID();
            const leftApproval = leftService.approve(fixture.requestId, {
                branchId: fixture.branchId,
                userId: leftUserId,
            });
            const rightApproval = rightService.approve(fixture.requestId, {
                branchId: fixture.branchId,
                userId: rightUserId,
            });

            let results: PromiseSettledResult<unknown>[];
            try {
                await barrier.waitUntilReady();
                barrier.release();
                results = await withTimeout(
                    Promise.allSettled([leftApproval, rightApproval]),
                    "duplicate approve race",
                );
            } finally {
                barrier.release();
                await Promise.allSettled([leftApproval, rightApproval]);
                await Promise.all([leftClient.$disconnect(), rightClient.$disconnect()]);
            }

            expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
            const rejected = results.find((result) => result.status === "rejected");
            expect(rejected?.status).toBe("rejected");
            if (rejected?.status === "rejected") expectRequestNotPending(rejected.reason);

            const request = await prisma.schedule_change_request.findUnique({
                where: { id: fixture.requestId },
                select: { status: true, decidedBy: true, reason: true },
            });
            expect(request?.status).toBe("approved");
            expect([leftUserId, rightUserId]).toContain(request?.decidedBy);
            const schedule = await prisma.employee_schedule.findUnique({
                where: { id: fixture.scheduleId },
                select: { endDate: true },
            });
            const client = await prisma.client.findUnique({
                where: { id: fixture.clientId },
                select: { endDate: true },
            });
            expect(schedule?.endDate).toEqual(fixture.expectedEndDate);
            expect(client?.endDate).toEqual(fixture.expectedEndDate);
            expect(await prisma.service_record_day.count({
                where: { serviceRecordCaseId: fixture.caseId, caseSessionIndex: 1 },
            })).toBe(1);
            await expect(prisma.service_record_day.findFirst({
                where: { serviceRecordCaseId: fixture.caseId, caseSessionIndex: 1 },
                select: { serviceDate: true },
            })).resolves.toEqual({ serviceDate: fixture.expectedServiceDate });
        });

        it("lets approve or reject win once while preserving the matching schedule outcome", async () => {
            const fixture = await createScheduleFixture();
            const barrier = createBarrier(2);
            const approveClient = createApprovedServiceRecordWriteLockClient();
            const rejectClient = createApprovedServiceRecordWriteLockClient();
            await Promise.all([approveClient.$connect(), rejectClient.$connect()]);
            const approvalService = new ScheduleChangeService(
                withScheduleRequestReadBarrier(approveClient, barrier) as unknown as PrismaService,
                realTokenService(),
            );
            const rejectionService = new ScheduleChangeService(
                withScheduleRequestReadBarrier(rejectClient, barrier) as unknown as PrismaService,
                realTokenService(),
            );
            const approvalUserId = crypto.randomUUID();
            const rejectionUserId = crypto.randomUUID();
            const approval = approvalService.approve(fixture.requestId, {
                branchId: fixture.branchId,
                userId: approvalUserId,
            });
            const rejection = rejectionService.reject(
                fixture.requestId,
                { branchId: fixture.branchId, userId: rejectionUserId },
                "경합 회귀 테스트",
            );

            let results: PromiseSettledResult<unknown>[];
            try {
                await barrier.waitUntilReady();
                barrier.release();
                results = await withTimeout(
                    Promise.allSettled([approval, rejection]),
                    "approve/reject race",
                );
            } finally {
                barrier.release();
                await Promise.allSettled([approval, rejection]);
                await Promise.all([approveClient.$disconnect(), rejectClient.$disconnect()]);
            }

            expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
            const rejected = results.find((result) => result.status === "rejected");
            expect(rejected?.status).toBe("rejected");
            if (rejected?.status === "rejected") expectRequestNotPending(rejected.reason);

            const request = await prisma.schedule_change_request.findUnique({
                where: { id: fixture.requestId },
                select: { status: true, decidedBy: true, reason: true },
            });
            const terminalStatus = request?.status;
            expect(["approved", "rejected"]).toContain(terminalStatus);
            expect(terminalStatus).not.toBe("stale");
            const winnerUserId = terminalStatus === "approved"
                ? approvalUserId
                : rejectionUserId;
            expect(request?.decidedBy).toBe(winnerUserId);
            const schedule = await prisma.employee_schedule.findUnique({
                where: { id: fixture.scheduleId },
                select: { endDate: true },
            });
            const client = await prisma.client.findUnique({
                where: { id: fixture.clientId },
                select: { endDate: true },
            });
            const days = await prisma.service_record_day.findMany({
                where: { serviceRecordCaseId: fixture.caseId },
                select: { caseSessionIndex: true, serviceDate: true },
            });
            if (terminalStatus === "approved") {
                expect(request?.reason).toBeNull();
                expect(schedule?.endDate).toEqual(fixture.expectedEndDate);
                expect(client?.endDate).toEqual(fixture.expectedEndDate);
                expect(days).toEqual([{
                    caseSessionIndex: 1,
                    serviceDate: fixture.expectedServiceDate,
                }]);
            } else {
                expect(request?.reason).toBe("경합 회귀 테스트");
                expect(schedule?.endDate).toEqual(fixture.oldEndDate);
                expect(client?.endDate).toEqual(fixture.oldEndDate);
                expect(days).toEqual([]);
            }
        });
    });
});
