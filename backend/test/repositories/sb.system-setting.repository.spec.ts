import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { GetSettingUsecase } from "application/usecases/system-setting/get-setting.usecase";
import { UpdateSettingUsecase } from "application/usecases/system-setting/update-setting.usecase";
import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { SystemSettingService } from "application/services/system-setting.service";
import { describeReal, assertThrowawayTarget, createIntegrityPrisma, closeIntegrityPrisma, IntegrityPrisma } from "../integrity/helpers/real-db";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessagePolicyRecipientGroup, SystemSettingEntity } from "domain/entities/system-setting.entity";

const retryPreviewPolicy = (group: MessagePolicyRecipientGroup, action: "DEFER" | "CANCEL") => ({
    schemaVersion: 1, dispatchCheckIntervalMinutes: 1, defaultRuleSendTime: "09:00",
    triggerRetryIntervalMinutes: 5, processingReclaimMinutes: 10, smsRetryIntervalMinutes: 5,
    pastExpiryHours: 24, pastSendIntervalMinutes: 1, pastRuleOrder: [], duplicateWindowHours: 72,
    quietHours: { enabled: true, start: "22:00", end: "08:00", recipientGroups: [group], action, timezone: "Asia/Seoul" },
});

// Keep the repository projection, exact-phone resolver, service and evaluator real;
// no pending jobs are needed to isolate the retry's contribution to the preview.
const createRetryPreviewService = (prisma: PrismaService) => {
    const settings = new SbSystemSettingRepository(prisma);
    const jobs = { findPolicyPreviewCandidates: async () => [] } as unknown as NonNullable<ConstructorParameters<typeof SystemSettingService>[5]>;
    return new SystemSettingService(new GetSettingUsecase(settings), new UpdateSettingUsecase(settings),
        undefined, undefined, undefined, jobs, new SbMessageLogRepository(prisma));
};

describe("SbSystemSettingRepository", () => {
    const createMockPrismaClient = () => ({
        $transaction: jest.fn(),
        $queryRaw: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    });

    const createSystemSettingRow = (overrides = {}) => ({
        key: "alimtalk_provider",
        value: "aligo_alimtalk",
        updatedAt: new Date("2025-01-14T00:00:00Z"),
        ...overrides,
    });

    let systemSettingModel: ReturnType<typeof createMockPrismaClient>;
    let prisma: PrismaService;
    let repository: SbSystemSettingRepository;

    beforeEach(() => {
        systemSettingModel = createMockPrismaClient();
        prisma = {
            system_setting: systemSettingModel,
            $transaction: jest.fn(),
            $queryRaw: jest.fn(),
        } as unknown as PrismaService;
        (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        repository = new SbSystemSettingRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("findByKey", () => {
        describe("given a setting exists", () => {
            it("should return the mapped SystemSettingEntity", async () => {
                const row = createSystemSettingRow();
                systemSettingModel.findUnique.mockResolvedValue(row);

                const result = await repository.findByKey("alimtalk_provider");

                expect(systemSettingModel.findUnique).toHaveBeenCalledWith({
                    where: { key: "alimtalk_provider" },
                });
                expect(result).toBeInstanceOf(SystemSettingEntity);
                expect(result?.key).toBe("alimtalk_provider");
                expect(result?.value).toBe("aligo_alimtalk");
            });
        });

        describe("given a setting does not exist", () => {
            it("should return null", async () => {
                systemSettingModel.findUnique.mockResolvedValue(null);

                const result = await repository.findByKey("nonexistent_key");

                expect(result).toBeNull();
            });
        });
    });

    describe("upsert", () => {
        describe("given a new setting", () => {
            it("should create and return the setting", async () => {
                const entity = SystemSettingEntity.create("alimtalk_provider", "aligo_alimtalk");
                const row = createSystemSettingRow({ value: "aligo_alimtalk" });
                systemSettingModel.upsert.mockResolvedValue(row);

                const result = await repository.upsert(entity);

                expect(systemSettingModel.upsert).toHaveBeenCalledWith({
                    where: { key: "alimtalk_provider" },
                    create: {
                        key: "alimtalk_provider",
                        value: "aligo_alimtalk",
                        updatedAt: entity.updatedAt,
                    },
                    update: {
                        value: "aligo_alimtalk",
                        updatedAt: entity.updatedAt,
                    },
                });
                expect(result).toBeInstanceOf(SystemSettingEntity);
                expect(result.value).toBe("aligo_alimtalk");
            });
        });

        describe("given an existing setting", () => {
            it("should update and return the setting", async () => {
                const entity = new SystemSettingEntity(
                    "alimtalk_provider",
                    "none",
                    new Date()
                );
                const row = createSystemSettingRow({ value: "none" });
                systemSettingModel.upsert.mockResolvedValue(row);

                const result = await repository.upsert(entity);

                expect(systemSettingModel.upsert).toHaveBeenCalledWith({
                    where: { key: "alimtalk_provider" },
                    create: {
                        key: "alimtalk_provider",
                        value: "none",
                        updatedAt: entity.updatedAt,
                    },
                    update: {
                        value: "none",
                        updatedAt: entity.updatedAt,
                    },
                });
                expect(result.value).toBe("none");
            });
        });
    });

    describe("compareAndSet", () => {
        it("locks and updates an existing setting only when its version matches", async () => {
            const current = createSystemSettingRow({ value: "old" });
            const updated = createSystemSettingRow({ value: "new" });
            systemSettingModel.findUnique.mockResolvedValue(current);
            systemSettingModel.update.mockResolvedValue(updated);
            const entity = SystemSettingEntity.create("alimtalk_provider", "new");

            await expect(repository.compareAndSet("alimtalk_provider", "old", entity, (value) => value ?? "missing"))
                .resolves.toEqual(expect.objectContaining({ value: "new" }));
            expect((prisma.$transaction as jest.Mock)).toHaveBeenCalled();
            expect((prisma.$queryRaw as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({
                strings: ['SELECT "key" FROM "system_setting" WHERE "key" = ', ' FOR UPDATE'],
                values: ["alimtalk_provider"],
            }));
            expect(systemSettingModel.update).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "alimtalk_provider" } }));
        });

        it("does not write when the version is stale", async () => {
            systemSettingModel.findUnique.mockResolvedValue(createSystemSettingRow({ value: "newer" }));
            const entity = SystemSettingEntity.create("alimtalk_provider", "new");

            await expect(repository.compareAndSet("alimtalk_provider", "old", entity, (value) => value ?? "missing"))
                .resolves.toBeNull();
            expect(systemSettingModel.update).not.toHaveBeenCalled();
            expect(systemSettingModel.create).not.toHaveBeenCalled();
        });
    });
});

// A mock proves identity/no nesting and error propagation, not database rollback.
describe("SbSystemSettingRepository provided transaction", () => {
    it("uses the caller transaction for the read, CAS and audit without opening another", async () => {
        const model = { findUnique: jest.fn().mockResolvedValue({ key: "k", value: "old", updatedAt: new Date() }),
            update: jest.fn().mockResolvedValue({ key: "k", value: "new", updatedAt: new Date() }) };
        const tx = { system_setting: model, $queryRaw: jest.fn() } as unknown as Prisma.TransactionClient;
        const prisma = { $transaction: jest.fn(), system_setting: { findUnique: jest.fn() } } as unknown as PrismaService;
        const audit = { append: jest.fn() } as unknown as AdminAuditEventWriter;
        const repository = new SbSystemSettingRepository(prisma, audit);
        expect((await new GetSettingUsecase(repository).execute("k", tx))).toBe("old");
        const context = { actor: { userId: "actor" }, action: "system_setting.message_automation.updated" };
        await new UpdateSettingUsecase(repository).executeIfVersion("k", "new", "old", value => value ?? "absent", context, tx);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.system_setting.findUnique).not.toHaveBeenCalled();
        expect(model.findUnique).toHaveBeenCalledTimes(2);
        expect(audit.append).toHaveBeenCalledWith(tx, expect.objectContaining({ before: expect.any(Object), after: expect.any(Object) }));
    });
    it("propagates caller-transaction P2002 without querying an aborted transaction; owned transaction maps it after rollback", async () => {
        const fault = new Prisma.PrismaClientKnownRequestError("create collision", { code: "P2002", clientVersion: "test" });
        const model = { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockRejectedValue(fault), update: jest.fn() };
        const tx = { system_setting: model, $queryRaw: jest.fn() } as unknown as Prisma.TransactionClient;
        const prisma = { $transaction: jest.fn().mockRejectedValue(fault) } as unknown as PrismaService;
        const repository = new SbSystemSettingRepository(prisma);
        const entity = SystemSettingEntity.create("k", "new");
        await expect(repository.compareAndSet("k", "absent", entity, value => value ?? "absent", undefined, tx)).rejects.toBe(fault);
        expect(model.findUnique).toHaveBeenCalledTimes(1);
        expect(model.update).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        await expect(repository.compareAndSet("k", "absent", entity, value => value ?? "absent")).resolves.toBeNull();
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
});

describe("SbMessageLogRepository reservation-count transaction selection", () => {
    const branchId = "d771e5fc-5420-4b52-9f2e-253dc5f9133b";
    const now = new Date("2098-12-31T23:00:00Z");

    it("queries the provided transaction instead of the base Prisma client", async () => {
        const queryTransaction = jest.fn().mockResolvedValue([{ count: 1n }]);
        const queryBase = jest.fn().mockResolvedValue([{ count: 0n }]);
        const tx = { $queryRaw: queryTransaction } as unknown as Prisma.TransactionClient;
        const prisma = { $queryRaw: queryBase } as unknown as PrismaService;
        const repository = new SbMessageLogRepository(prisma);

        await expect(repository.countFutureProviderReservations(branchId, now, tx)).resolves.toBe(1);

        expect(queryTransaction).toHaveBeenCalledTimes(1);
        expect(queryTransaction).toHaveBeenCalledWith(expect.objectContaining({ values: [branchId, "209901010800"] }));
        expect(queryBase).not.toHaveBeenCalled();
    });

    it("retains the base Prisma client fallback when no transaction is provided", async () => {
        const queryBase = jest.fn().mockResolvedValue([{ count: 3n }]);
        const prisma = { $queryRaw: queryBase } as unknown as PrismaService;
        const repository = new SbMessageLogRepository(prisma);

        await expect(repository.countFutureProviderReservations(branchId, now)).resolves.toBe(3);

        expect(queryBase).toHaveBeenCalledTimes(1);
        expect(queryBase).toHaveBeenCalledWith(expect.objectContaining({ values: [branchId, "209901010800"] }));
    });
});

describe("SbMessageLogRepository retry preview recipient identity", () => {
    const branchId = "d771e5fc-5420-4b52-9f2e-253dc5f9133b";
    const foreignBranchId = "b4253737-7836-45b3-83df-a59d651bc5e3";
    const now = new Date("2026-11-04T13:00:00Z"); // 22:00 KST
    const retry = (overrides = {}) => ({ nextRetryAt: now, recipientPhone: "01012345678", receiver: "01099999999",
        clientId: 7, variables: {}, triggerJob: { branchId, recipientType: "PRIMARY_EMPLOYEE" }, ...overrides });
    const mockPrisma = (rows: ReturnType<typeof retry>[], groups: { phone: string; group_name: MessagePolicyRecipientGroup }[] = []) => ({
        message_log: { findMany: jest.fn().mockResolvedValue(rows) },
        system_setting: { findUnique: jest.fn().mockResolvedValue(null) },
        $queryRaw: jest.fn().mockResolvedValueOnce([{ count: 0n }]).mockResolvedValue(groups),
    });

    it.each(["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE", "CLIENT"])("previews %s retries with client context using the actual recipient type", async recipientType => {
        for (const action of ["DEFER", "CANCEL"] as const) {
            for (const group of ["CLIENT", "CAREGIVER"] as const) {
                const prisma = mockPrisma([retry({ triggerJob: { branchId, recipientType },
                    variables: { recipientType: recipientType === "CLIENT" ? "PRIMARY_EMPLOYEE" : "CLIENT", employeeId: 9 } })]);
                const service = createRetryPreviewService(prisma as unknown as PrismaService);
                const affected = group === (recipientType === "CLIENT" ? "CLIENT" : "CAREGIVER") ? 1 : 0;
                await expect(service.previewMessageAutomationPolicyConfig(branchId, null, retryPreviewPolicy(group, action), now))
                    .resolves.toMatchObject({ deferredCount: action === "DEFER" ? affected : 0,
                        canceledCount: action === "CANCEL" ? affected : 0 });
                expect(prisma.message_log.findMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: expect.objectContaining({ branchId, provider: "aligo_sms" }),
                    select: expect.objectContaining({ triggerJob: { select: { branchId: true, recipientType: true } } }),
                }));
            }
        }
    });

    it("still unions an exact customer phone with a verified caregiver identity", async () => {
        const prisma = mockPrisma([retry()], [{ phone: "+82 10-1234-5678", group_name: "CLIENT" }]);
        await expect(createRetryPreviewService(prisma as unknown as PrismaService)
            .previewMessageAutomationPolicyConfig(branchId, null, retryPreviewPolicy("CLIENT", "DEFER"), now))
            .resolves.toMatchObject({ deferredCount: 1, canceledCount: 0 });
        expect(prisma.$queryRaw.mock.calls[1]?.[0].values).toContain(branchId);
    });

    it.each([
        { label: "legacy primary type with contextual client", triggerJob: null, clientId: 7, variables: { recipientType: "PRIMARY_EMPLOYEE" }, groups: ["CAREGIVER"] },
        { label: "legacy secondary type with contextual client", triggerJob: null, clientId: 7, variables: { recipientType: "SECONDARY_EMPLOYEE" }, groups: ["CAREGIVER"] },
        { label: "legacy client type with employee context", triggerJob: null, clientId: null, variables: { recipientType: "CLIENT", employeeId: 9 }, groups: ["CLIENT"] },
        { label: "unknown type with both IDs", triggerJob: { branchId, recipientType: "UNKNOWN" }, clientId: 7, variables: { employeeId: 9 }, groups: ["CLIENT"] },
        { label: "missing type with employee context", triggerJob: null, clientId: null, variables: { employeeId: 9 }, groups: ["CAREGIVER"] },
        { label: "unknown type without IDs", triggerJob: null, clientId: null, variables: { recipientType: "UNKNOWN" }, groups: [] },
        { label: "foreign caregiver job with client context", triggerJob: { branchId: foreignBranchId, recipientType: "PRIMARY_EMPLOYEE" }, clientId: 7, variables: {}, groups: ["CLIENT"] },
        { label: "foreign client job with legacy caregiver type", triggerJob: { branchId: foreignBranchId, recipientType: "CLIENT" }, clientId: 7, variables: { recipientType: "SECONDARY_EMPLOYEE" }, groups: ["CAREGIVER"] },
        { label: "foreign caregiver job without legacy identity", triggerJob: { branchId: foreignBranchId, recipientType: "SECONDARY_EMPLOYEE" }, clientId: null, variables: {}, groups: [] },
    ])("retains branch-fenced legacy fallback: $label", async ({ triggerJob, clientId, variables, groups }) => {
        const prisma = mockPrisma([retry({ triggerJob, clientId, variables })]);
        await expect(new SbMessageLogRepository(prisma as unknown as PrismaService).findPolicyPreviewCandidates(branchId))
            .resolves.toEqual([{ dueAt: now, recipientPhone: "01012345678", recipientGroups: groups }]);
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
});

describeReal("policy settings real PostgreSQL transaction proof", () => {
    let handle: IntegrityPrisma;
    const prefix = `policy-cas-${randomUUID()}`;
    const versionOf = (raw: string | null) => raw ?? "absent";
    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
    });
    afterAll(async () => {
        if (!handle) return;
        await handle.raw.system_setting.deleteMany({ where: { key: { startsWith: prefix } } });
        await closeIntegrityPrisma(handle);
    });
    it("rolls back BOTH setting and an actual inserted audit after an outer-transaction fault", async () => {
        const key = `${prefix}-rollback`;
        await handle.raw.system_setting.create({ data: { key, value: "before" } });
        const writer = new AdminAuditEventWriter(handle.service);
        const repository = new SbSystemSettingRepository(handle.service, writer);
        let inserted = false;
        await expect(handle.service.$transaction(async tx => {
            expect(await new GetSettingUsecase(repository).execute(key, tx)).toBe("before");
            await new UpdateSettingUsecase(repository).executeIfVersion(key, "after", "before", versionOf, {
                action: "system_setting.message_automation.updated", source: "policy-real-proof",
            }, tx);
            expect(await tx.system_setting.findUnique({ where: { key } })).toMatchObject({ value: "after" });
            expect(await tx.admin_audit_event.count({ where: { targetId: key } })).toBe(1);
            inserted = true;
            throw new Error("fault after real audit insert");
        })).rejects.toThrow("fault after real audit insert");
        expect(inserted).toBe(true);
        expect(await handle.raw.system_setting.findUnique({ where: { key } })).toMatchObject({ value: "before" });
        expect(await handle.raw.admin_audit_event.count({ where: { targetId: key } })).toBe(0);
    });
    it("commits provided-TX setting/audit together, then stale CAS changes neither", async () => {
        const key = `${prefix}-success`;
        const repository = new SbSystemSettingRepository(handle.service, new AdminAuditEventWriter(handle.service));
        const context = { action: "system_setting.message_automation.updated", source: "policy-real-proof" };
        await handle.service.$transaction(async tx => {
            expect(await new GetSettingUsecase(repository).executeEntity(key, tx)).toBeNull();
            expect(await repository.compareAndSet(key, "absent", SystemSettingEntity.create(key, "first"), versionOf, context, tx)).not.toBeNull();
        });
        expect(await handle.raw.system_setting.findUnique({ where: { key } })).toMatchObject({ value: "first" });
        expect(await handle.raw.admin_audit_event.count({ where: { targetId: key } })).toBe(1);
        await handle.service.$transaction(async tx => {
            expect(await repository.compareAndSet(key, "absent", SystemSettingEntity.create(key, "stale"), versionOf, context, tx)).toBeNull();
        });
        expect(await handle.raw.system_setting.findUnique({ where: { key } })).toMatchObject({ value: "first" });
        expect(await handle.raw.admin_audit_event.count({ where: { targetId: key } })).toBe(1);
    });
    it("keeps legacy transaction ownership and permits exactly one concurrent same-version CAS", async () => {
        const key = `${prefix}-concurrent`;
        await handle.raw.system_setting.create({ data: { key, value: "before" } });
        const repository = new SbSystemSettingRepository(handle.service, new AdminAuditEventWriter(handle.service));
        const results = await Promise.all(["one", "two"].map(value => repository.compareAndSet(key, "before", SystemSettingEntity.create(key, value), versionOf,
            { action: "system_setting.message_automation.updated", source: "policy-real-proof" })));
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(await handle.raw.system_setting.findUnique({ where: { key } })).toMatchObject({ value: results.find(Boolean)!.value });
        expect(await handle.raw.admin_audit_event.count({ where: { targetId: key } })).toBe(1);
    });
    it("counts an uncommitted reservation only through its caller transaction and rolls it back", async () => {
        const branchId = randomUUID();
        const now = new Date("2098-12-31T23:00:00Z");
        const repository = new SbMessageLogRepository(handle.service);
        const rollback = new Error("rollback uncommitted reservation proof");

        await expect(handle.service.$transaction(async tx => {
            await tx.branch.create({ data: { id: branchId, name: "Policy TX visibility", slug: `${prefix}-tx-visibility` } });
            await tx.message_log.create({ data: {
                branchId, provider: "aligo_sms", providerAcceptanceState: "accepted", status: "sent",
                templateKey: "manual_sms", receiver: "01012345678", messageBody: "transaction visibility fixture",
                variables: { scheduledDate: "20990101", scheduledTime: "0900" },
            } });

            expect(await repository.countFutureProviderReservations(branchId, now, tx)).toBe(1);
            expect(await repository.countFutureProviderReservations(branchId, now)).toBe(0);
            expect(await handle.raw.message_log.count({ where: { branchId } })).toBe(0);
            throw rollback;
        })).rejects.toBe(rollback);

        expect(await repository.countFutureProviderReservations(branchId, now)).toBe(0);
        expect(await handle.raw.message_log.count({ where: { branchId } })).toBe(0);
        expect(await handle.raw.branch.findUnique({ where: { id: branchId } })).toBeNull();
    });
    it("queries real branch reservations by provider acceptance and KST schedule; unions exact recipient groups", async () => {
        const branchA = await handle.raw.branch.create({ data: { name: "Policy A", slug: `${prefix}-a` } });
        const branchB = await handle.raw.branch.create({ data: { name: "Policy B", slug: `${prefix}-b` } });
        const user = await handle.raw.user.create({ data: { phone: "+82 10-1234-5678" } });
        try {
            await handle.raw.user_branch.create({ data: { branchId: branchA.id, userId: user.id } });
            await handle.raw.message_log.createMany({ data: [
                { branchId: branchA.id, providerAcceptanceState: "accepted", status: "sent" },
                { branchId: branchB.id, providerAcceptanceState: "accepted", status: "sent" },
                { branchId: branchA.id, providerAcceptanceState: "prepared", status: "pending" },
                { branchId: branchA.id, providerAcceptanceState: "rejected", status: "failed" },
            ].map(row => ({ ...row, provider: "aligo_sms", templateKey: "manual_sms", receiver: "01012345678", messageBody: "fixture",
                variables: { scheduledDate: "20990101", scheduledTime: "0900" } })) });
            const repository = new SbMessageLogRepository(handle.service);
            await handle.service.$transaction(async tx => {
                expect(await repository.countFutureProviderReservations(branchA.id, new Date("2098-12-31T23:00:00Z"), tx)).toBe(1);
                expect(await repository.countFutureProviderReservations(branchA.id, new Date("2099-01-01T00:00:00Z"), tx)).toBe(0);
            });
            const candidates = await repository.resolvePolicyRecipientGroups(branchA.id, [{ dueAt: new Date(), recipientPhone: "010-1234-5678", recipientGroups: ["CLIENT"] }]);
            expect(candidates[0]?.recipientGroups).toEqual(["CLIENT", "STAFF"]);
            const foreign = await repository.resolvePolicyRecipientGroups(branchB.id, [{ dueAt: new Date(), recipientPhone: "01012345678", recipientGroups: ["CAREGIVER"] }]);
            expect(foreign[0]?.recipientGroups).toEqual(["CAREGIVER"]);
        } finally {
            await handle.raw.message_log.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } });
            await handle.raw.user_branch.deleteMany({ where: { userId: user.id } });
            await handle.raw.user.delete({ where: { id: user.id } });
            await handle.raw.branch.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } });
        }
    });

    it("projects linked caregiver retries through preview without treating client context or foreign jobs as recipient identity", async () => {
        const branchA = await handle.raw.branch.create({ data: { name: "Retry preview A", slug: `${prefix}-retry-a` } });
        const branchB = await handle.raw.branch.create({ data: { name: "Retry preview B", slug: `${prefix}-retry-b` } });
        const branchIds = [branchA.id, branchB.id];
        const now = new Date("2026-11-04T13:00:00Z");
        const phone = "01012345678";
        try {
            const context = await handle.raw.client.create({ data: {
                branchId: branchA.id, name: "Retry client context fixture", voucherClient: false, phone: "01099999999",
            } });
            // An exact phone in another branch must not add CLIENT to branch A.
            await handle.raw.client.create({ data: {
                branchId: branchB.id, name: "Foreign phone fixture", voucherClient: false, phone,
            } });
            const rules = await Promise.all(branchIds.map(branchId => handle.raw.message_trigger_rule.create({ data: {
                branchId, name: "Retry preview fixture", eventType: "SERVICE_RECORD_LINK", offsetType: "ON",
                recipientType: "PRIMARY_EMPLOYEE", templateKey: "SERVICE_RECORD_LINK",
            } })));
            const job = await handle.raw.message_trigger_job.create({ data: {
                branchId: branchA.id, ruleId: rules[0]!.id, recipientType: "PRIMARY_EMPLOYEE", clientId: context.id,
                recipientPhone: phone, scheduledFor: now, status: "failed", templateKey: "SERVICE_RECORD_LINK", dedupeKey: `${prefix}-retry`,
            } });
            const log = await handle.raw.message_log.create({ data: {
                branchId: branchA.id, triggerJobId: job.id, clientId: context.id, recipientPhone: phone, receiver: phone,
                provider: "aligo_sms", status: "failed", attempts: 1, nextRetryAt: now, providerAcceptanceState: "rejected",
                templateKey: "SERVICE_RECORD_LINK", messageBody: "Retry preview fixture", variables: {},
            } });
            const repository = new SbMessageLogRepository(handle.service);
            const service = createRetryPreviewService(handle.service);
            for (const recipientType of ["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE", "CLIENT"]) {
                await handle.raw.message_trigger_job.update({ where: { id: job.id }, data: { recipientType } });
                const expected = recipientType === "CLIENT" ? "CLIENT" : "CAREGIVER";
                const candidates = await repository.findPolicyPreviewCandidates(branchA.id);
                expect(candidates).toEqual([{ dueAt: now, recipientPhone: phone, recipientGroups: [expected] }]);
                expect((await repository.resolvePolicyRecipientGroups(branchA.id, candidates))[0]?.recipientGroups).toEqual([expected]);
                for (const action of ["DEFER", "CANCEL"] as const) {
                    for (const group of ["CLIENT", "CAREGIVER"] as const) {
                        const affected = expected === group ? 1 : 0;
                        await expect(service.previewMessageAutomationPolicyConfig(branchA.id, null, retryPreviewPolicy(group, action), now))
                            .resolves.toMatchObject({ deferredCount: action === "DEFER" ? affected : 0,
                                canceledCount: action === "CANCEL" ? affected : 0 });
                    }
                }
            }
            await handle.raw.message_trigger_job.update({ where: { id: job.id }, data: { recipientType: "PRIMARY_EMPLOYEE" } });
            await handle.raw.client.update({ where: { id: context.id }, data: { phone: "+82 10-1234-5678" } });
            expect((await repository.resolvePolicyRecipientGroups(branchA.id, await repository.findPolicyPreviewCandidates(branchA.id)))[0]?.recipientGroups)
                .toEqual(["CAREGIVER", "CLIENT"]);
            await expect(service.previewMessageAutomationPolicyConfig(branchA.id, null, retryPreviewPolicy("CLIENT", "CANCEL"), now))
                .resolves.toMatchObject({ deferredCount: 0, canceledCount: 1 });

            await handle.raw.message_trigger_job.update({ where: { id: job.id }, data: { branchId: branchB.id, ruleId: rules[1]!.id } });
            await handle.raw.message_log.update({ where: { id: log.id }, data: { clientId: null } });
            expect((await repository.findPolicyPreviewCandidates(branchA.id))[0]?.recipientGroups).toEqual([]);
            await handle.raw.message_log.update({ where: { id: log.id }, data: { variables: { recipientType: "SECONDARY_EMPLOYEE" } } });
            expect((await repository.findPolicyPreviewCandidates(branchA.id))[0]?.recipientGroups).toEqual(["CAREGIVER"]);
            await handle.raw.message_log.update({ where: { id: log.id }, data: { triggerJobId: null, clientId: context.id, variables: {} } });
            expect((await repository.findPolicyPreviewCandidates(branchA.id))[0]?.recipientGroups).toEqual(["CLIENT"]);
        } finally {
            await handle.raw.message_log.deleteMany({ where: { branchId: { in: branchIds } } });
            await handle.raw.message_trigger_job.deleteMany({ where: { branchId: { in: branchIds } } });
            await handle.raw.message_trigger_rule.deleteMany({ where: { branchId: { in: branchIds } } });
            await handle.raw.client.deleteMany({ where: { branchId: { in: branchIds } } });
            await handle.raw.branch.deleteMany({ where: { id: { in: branchIds } } });
        }
    });

});
