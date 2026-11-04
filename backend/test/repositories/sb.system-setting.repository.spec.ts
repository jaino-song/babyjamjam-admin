import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { GetSettingUsecase } from "application/usecases/system-setting/get-setting.usecase";
import { UpdateSettingUsecase } from "application/usecases/system-setting/update-setting.usecase";
import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { describeReal, assertThrowawayTarget, createIntegrityPrisma, closeIntegrityPrisma, IntegrityPrisma } from "../integrity/helpers/real-db";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";

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

});
