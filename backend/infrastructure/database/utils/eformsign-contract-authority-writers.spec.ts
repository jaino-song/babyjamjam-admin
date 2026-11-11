import { Prisma } from "@prisma/client";
import { SbClientRepository } from "../repositories/sb.client.repository";
import { SbEformsignDocRepository } from "../repositories/sb.eformsign-doc.repository";
import { SbEformsignDocumentMirrorRepository } from "../repositories/sb.eformsign-document-mirror.repository";
import { ClientMapper } from "../mapper/client.mapper";
import { clearSchemaCapabilityCache } from "../schema-capabilities";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { CreateClientUsecase } from "application/usecases/client/create-client.usecase";
import { lockServiceRecordWriteSet } from "application/policies/service-record-write-lock.policy";
import { mapHttpProblem } from "infrastructure/filters/problem-response";
import { clientAgentTargetVersion } from "application/usecases/client/client-agent-target";
import { AuthorityConflictError } from "./eformsign-contract-authority";
import { ClientService } from "application/services/client.service";
import { LinkMirroredEformsignDocByPhoneUsecase } from "application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase";

const B = "11111111-1111-4111-8111-111111111111", G = "33333333-3333-4333-8333-333333333333";
const row = (id: number, eDocId: string | null) => ({ id, branchId: B, eDocId, name: "Fixture", phone: "01012345678",
    address: null, type: null, duration: null, fullPrice: null, grant: null, actualPrice: null, startDate: null,
    endDate: null, careCenter: null, voucherClient: false, birthday: null, dueDate: null, serviceStatus: "waiting",
    breastPump: false, createdAt: new Date("2026-11-05"), deletedAt: null });
function fixture(activeClient?: number, phase = "reserved") {
    const clients = new Map([[2, row(2, "prior-doc")], [8, row(8, "bound-doc")]]);
    const sql: string[] = [], schedules: number[] = [];
    const document = { id: 11, documentId: "bound-doc", branchId: B, clientId: 8, autoRegisteredClient: false,
        createdDate: new Date("2026-11-05"), updatedDate: new Date("2026-11-05"), documentKind: "contract",
        serviceRecordCaseId: null, revisionId: null, voidedAt: null, statusType: "072", customerPhone: "01012345678",
        syncStatus: "ready", detailPayload: {}, detailSourceUpdatedDate: new Date("2026-11-05"), detailSyncedAt: new Date("2026-11-05") };
    const matches = (where: any, client: any) => (!where.id || (typeof where.id === "number" ? where.id === client.id : where.id.in.includes(client.id)))
        && (!where.branchId || where.branchId === client.branchId)
        && (where.eDocId === undefined || (typeof where.eDocId === "object" && where.eDocId !== null ? where.eDocId.in.includes(client.eDocId) : where.eDocId === client.eDocId));
    const db: any = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn(async (input: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
            const query = Array.isArray(input) ? Prisma.sql(input as TemplateStringsArray, ...values) : input as Prisma.Sql;
            const text = query.text; sql.push(text);
            const unquoted = text.replace(/"/g, "");
            const ids = query.values.filter(value => typeof value === "number");
            if (text.includes("SELECT document_id FROM eformsign_doc")) return query.values.filter(id => ["prior-doc", "bound-doc", "next-doc"].includes(String(id))).map(document_id => ({ document_id }));
            if (text.includes("SELECT EXISTS")) return [{ conflict: text.includes("phase <> 'closed'") && activeClient !== undefined && phase !== "closed" }];
            if (text.includes("FROM eformsign_contract_authority")) {
                if (text.includes("provider_document_id" ) && !text.includes("FOR UPDATE")) return activeClient ? [{ client_id: activeClient }] : [];
                return activeClient && ids.includes(activeClient) ? [{ branch_id: B, client_id: activeClient, generation: G,
                    creation_job_id: G, fingerprint: "a".repeat(64), prior_document_id: "prior-doc", provider_document_id: "bound-doc",
                    phase, claim_epoch: 0n, claim_user_id: null, claim_expires_at: null,
                    creation_intent_id: null, draft_intent_id: null, human_intent_id: null }] : [];
            }
            if (text.includes("UNION")) return [...clients.values()].filter(client => client.eDocId === "bound-doc" || client.id === document.clientId)
                .map(client => ({ id: client.id, branchId: client.branchId, documentId: "bound-doc" }));
            if (unquoted.includes("FROM service_record_case")) return [];
            if (text.includes("pointer_client")) return [...clients.values()].filter(client => client.eDocId === "bound-doc" && client.id !== ids[0]);
            if (unquoted.includes("FROM eformsign_doc")) return [{ ...document, targetDocumentId: clients.get(2)?.eDocId, pointerClientIds: [8] }];
            if (unquoted.includes("FROM client")) return [...clients.values()].filter(client => ids.length ? ids.includes(client.id) : client.eDocId === "bound-doc")
                .sort((a, b) => a.id - b.id).map(client => ({ ...client, e_doc_id: client.eDocId, branch_id: B }));
            throw new Error(`Unhandled SQL: ${text}`);
        }),
        client: {
            findFirst: jest.fn(async ({ where }: any) => [...clients.values()].find(client => matches(where, client)) ?? null),
            findUnique: jest.fn(async ({ where }: any) => clients.get(where.id) ?? null),
            findMany: jest.fn(async ({ where = {} }: any = {}) => [...clients.values()].filter(client => matches(where, client))),
            updateMany: jest.fn(async ({ where, data }: any) => {
                const affected = [...clients.values()].filter(client => matches(where, client));
                for (const client of affected) Object.assign(client, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
                return { count: affected.length };
            }),
            create: jest.fn(async ({ data }: any) => {
                const created = { ...row(12, null), ...data, id: 12, employeeSchedules: [{ id: 90 }] };
                clients.set(12, created); if (data.employeeSchedules) schedules.push(90); return created;
            }),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        eformsign_doc: { findMany: jest.fn().mockResolvedValue([document]), findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(document), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        eformsign_doc_file: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
        employee_schedule: { findMany: jest.fn().mockResolvedValue([]) }, service_record_case: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const savepoints = new Map<string, { clients: Array<readonly [number, ReturnType<typeof row>]>; schedules: number[] }>();
    db.$executeRaw.mockImplementation(async (input: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
        const query = Array.isArray(input) ? Prisma.sql(input as TemplateStringsArray, ...values) : input as Prisma.Sql;
        const [command, , name] = query.text.trim().split(/\s+/);
        if (command === "SAVEPOINT") savepoints.set(query.text.trim().split(/\s+/)[1]!, {
            clients: [...clients.entries()].map(([id, client]) => [id, { ...client }] as const), schedules: [...schedules],
        });
        else if (command === "ROLLBACK") {
            const saved = savepoints.get(query.text.trim().split(/\s+/).at(-1)!)!;
            clients.clear(); saved.clients.forEach(([id, client]) => clients.set(id, { ...client })); schedules.splice(0, schedules.length, ...saved.schedules);
        } else if (command === "RELEASE") savepoints.delete(name!);
        else return 1;
        return 0;
    });
    db.$transaction = jest.fn(async (operation: any) => {
        const snapshot = [...clients.entries()].map(([id, client]) => [id, { ...client }] as const), scheduleCount = schedules.length;
        try { return await operation(db); } catch (error) { clients.clear(); snapshot.forEach(([id, client]) => clients.set(id, client)); schedules.length = scheduleCount; throw error; }
    });
    return { db, clients, schedules, sql, document };
}
function serviceFor(f: ReturnType<typeof fixture>): any {
    return Object.assign(Object.create(ClientService.prototype), { prismaService: f.db, clientRepository: {},
        findClientByIdUsecase: { execute: jest.fn(async () => ClientMapper.toDomain(f.clients.get(2)! as any)) },
        holidayCalendar: { forBranch: jest.fn().mockResolvedValue(KR_BUILTIN_CALENDAR) }, configService: { get: jest.fn() },
        logger: { error: jest.fn(), debug: jest.fn(), warn: jest.fn() } });
}
function mirrorFor(f: ReturnType<typeof fixture>): any {
    return Object.assign(Object.create(LinkMirroredEformsignDocByPhoneUsecase.prototype), { prisma: f.db,
        holidayCalendar: { forBranch: jest.fn().mockResolvedValue(KR_BUILTIN_CALENDAR) }, configService: { get: jest.fn() },
        logger: { log: jest.fn(), warn: jest.fn() } });
}
describe("generic authority writer fences (transaction mocks, no PostgreSQL isolation proof)", () => {
    beforeEach(() => clearSchemaCapabilityCache());
    it.each([false, true])("client update pointer change, active=%s", async active => {
        const f = fixture(active ? 2 : undefined), entity = ClientMapper.toDomain(f.clients.get(2)! as any);
        entity.update({ eDocId: "next-doc" }, KR_BUILTIN_CALENDAR);
        const result = new SbClientRepository(f.db).update(B, entity);
        if (active) { await expect(result).rejects.toBeInstanceOf(AuthorityConflictError); expect(f.db.client.updateMany).not.toHaveBeenCalled(); }
        else { await result; expect(f.clients.get(2)?.eDocId).toBe("next-doc"); }
        expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    });
    it("same persisted pointer allows an ordinary customer edit despite active authority", async () => {
        const f = fixture(2), entity = ClientMapper.toDomain(f.clients.get(2)! as any);
        entity.update({ name: "Edited" }, KR_BUILTIN_CALENDAR);
        await new SbClientRepository(f.db).update(B, entity); expect(f.clients.get(2)?.name).toBe("Edited");
    });
    it("closed authority allows an ordinary pointer change", async () => {
        const f = fixture(2, "closed"), entity = ClientMapper.toDomain(f.clients.get(2)! as any);
        entity.update({ eDocId: "next-doc" }, KR_BUILTIN_CALENDAR); await new SbClientRepository(f.db).update(B, entity);
        expect(f.clients.get(2)?.eDocId).toBe("next-doc");
    });
    it("clearing NULL is compared against the locked actual pointer, not the submitted entity", async () => {
        const f = fixture(2), entity = ClientMapper.toDomain(f.clients.get(2)! as any);
        entity.update({ eDocId: null }, KR_BUILTIN_CALENDAR);
        await expect(new SbClientRepository(f.db).update(B, entity)).rejects.toBeInstanceOf(AuthorityConflictError);
        expect(f.db.client.updateMany).not.toHaveBeenCalled();
    });
    it.each([false, true])("versioned pointer update, active=%s", async active => {
        const f = fixture(active ? 2 : undefined), entity = ClientMapper.toDomain(f.clients.get(2)! as any);
        const result = new SbClientRepository(f.db).updateIfTargetVersion(B, 2, clientAgentTargetVersion(entity), { eDocId: null }, KR_BUILTIN_CALENDAR);
        if (active) { await expect(result).rejects.toBeInstanceOf(AuthorityConflictError); expect(f.db.client.updateMany).not.toHaveBeenCalled(); }
        else { await expect(result).resolves.not.toBeNull(); expect(f.clients.get(2)?.eDocId).toBeNull(); }
    });
    it("missing versioned pointer target retains its stale/null outcome", async () => {
        const f = fixture(); f.clients.delete(2);
        await expect(new SbClientRepository(f.db).updateIfTargetVersion(B, 2, "stale", { eDocId: null }, KR_BUILTIN_CALENDAR)).resolves.toBeNull();
        expect(f.db.client.updateMany).not.toHaveBeenCalled();
    });
    it.each([[false, false], [false, true], [true, false], [true, true]])("create with initial schedule: active=%s, schedule=%s", async (active, schedule) => {
        const f = fixture(active ? 8 : undefined), entity = ClientMapper.toDomain(row(0, "bound-doc") as any), repo = new SbClientRepository(f.db);
        f.clients.get(8)!.eDocId = null;
        const result = schedule ? repo.createWithInitialSchedule(B, entity, { primaryEmployeeId: 1, secondaryEmployeeId: null,
            workAddress: "Fixture", startDate: new Date("2026-11-05"), endDate: new Date("2026-11-05") }) : repo.create(B, entity);
        if (active) { await expect(result).rejects.toBeInstanceOf(AuthorityConflictError); expect(f.clients.has(12)).toBe(false); expect(f.schedules).toEqual([]); }
        else { await result; expect(f.clients.get(12)?.eDocId).toBe("bound-doc"); expect(f.schedules).toEqual(schedule ? [90] : []); }
    });
    it.each([false, true])("caught post-insert create refusal rolls back only its own writes, schedule=%s", async schedule => {
        const f = fixture(8, "closed"), repo = new SbClientRepository(f.db), entity = ClientMapper.toDomain(row(0, "bound-doc") as any);
        f.clients.get(8)!.eDocId = null;
        const original = f.db.$queryRaw.getMockImplementation();
        f.db.$queryRaw.mockImplementation((query: Prisma.Sql) => query.text.includes("SELECT client_id FROM eformsign_contract_authority") && f.clients.has(12)
            ? Promise.resolve([{ client_id: 1 }]) : original(query));
        await f.db.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.client.updateMany({ where: { id: 2 }, data: { name: "Outer retained" } });
            try {
                if (schedule) await repo.createWithInitialSchedule(B, entity, { primaryEmployeeId: 1, secondaryEmployeeId: null,
                    workAddress: "Fixture", startDate: new Date("2026-11-05"), endDate: new Date("2026-11-05") }, tx);
                else await repo.create(B, entity, tx);
                throw new Error("Expected authority refusal");
            } catch (error) { expect(error).toBeInstanceOf(AuthorityConflictError); }
            await tx.client.updateMany({ where: { id: 8 }, data: { name: "Continued" } });
        });
        expect(f.db.client.create).toHaveBeenCalledTimes(1); expect(f.clients.has(12)).toBe(false); expect(f.schedules).toEqual([]);
        expect(f.clients.get(2)?.name).toBe("Outer retained"); expect(f.clients.get(8)?.name).toBe("Continued");
        expect(f.db.$queryRaw.mock.calls.filter(([query]: [Prisma.Sql]) => query.text.includes("FOR UPDATE"))
            .every(([query]: [Prisma.Sql]) => !query.values.includes(1))).toBe(true);
    });
    it.each(["closed", "reserved", "absent"])("actual service/usecase creation preserves client-first locks, authority=%s", async phase => {
        const f = fixture(phase === "absent" ? undefined : 8, phase); f.clients.get(8)!.eDocId = null;
        const employee = { id: 1, branchId: B, deletedAt: null, openToNextWork: true };
        f.db.employee = { findMany: jest.fn().mockResolvedValue([employee]) };
        const original = f.db.$queryRaw.getMockImplementation(), order: string[] = [];
        f.db.$queryRaw.mockImplementation((query: Prisma.Sql) => {
            const text = query.text.replace(/"/g, "");
            if (text.includes("FOR UPDATE") && /FROM employee\b/.test(text)) { order.push("employee:1"); return Promise.resolve([employee]); }
            if (text.includes("FOR UPDATE") && /FROM client\b/.test(text)) order.push(`client:${query.values.filter(value => typeof value === "number").join(",")}`);
            return original(query);
        });
        const service = serviceFor(f), repo = new SbClientRepository(f.db);
        service.clientRepository = repo; service.createClientUsecase = new CreateClientUsecase(repo, service.holidayCalendar);
        const result = service.create(B, { name: "Fixture", primaryEmployeeId: 1, phone: null, eDocId: "bound-doc",
            careCenter: false, voucherClient: false, breastPump: false, applyMessageAutomation: false });
        if (phase === "reserved") {
            await expect(result).rejects.toBeInstanceOf(AuthorityConflictError); expect(f.db.client.create).not.toHaveBeenCalled();
            expect(order).toEqual(["client:8"]); expect(f.schedules).toEqual([]);
        } else {
            await result; expect(f.clients.get(12)?.eDocId).toBe("bound-doc"); expect(f.schedules).toEqual([90]);
            expect(order[0]).toBe(phase === "closed" ? "client:8" : "employee:1");
            if (phase === "closed") expect(order.indexOf("client:8")).toBeLessThan(order.indexOf("employee:1"));
        }
        order.length = 0; await lockServiceRecordWriteSet(f.db, { branchId: B, clientId: 8, employeeIds: [1] });
        expect(order.slice(0, 2)).toEqual(["client:8", "employee:1"]);
    });
    it.each([false, true])("service snapshot refuses new owners after employee locks, known owner=%s", async known => {
        const f = fixture(known ? 8 : undefined, "closed"); f.clients.get(8)!.eDocId = null;
        const employee = { id: 1, branchId: B, deletedAt: null, openToNextWork: true };
        f.db.employee = { findMany: jest.fn().mockResolvedValue([employee]) };
        const original = f.db.$queryRaw.getMockImplementation(); let employeesLocked = false;
        f.db.$queryRaw.mockImplementation((query: Prisma.Sql) => {
            if (/FROM "employee"[\s\S]*FOR UPDATE/.test(query.text)) { employeesLocked = true; return Promise.resolve([employee]); }
            if (employeesLocked && query.text.includes("SELECT client_id FROM eformsign_contract_authority")) return Promise.resolve([{ client_id: 1 }]);
            return original(query);
        });
        const service = serviceFor(f), repo = new SbClientRepository(f.db);
        service.clientRepository = repo; service.createClientUsecase = new CreateClientUsecase(repo, service.holidayCalendar);
        await expect(service.create(B, { name: "Fixture", primaryEmployeeId: 1, phone: null, eDocId: "bound-doc",
            careCenter: false, voucherClient: false, breastPump: false, applyMessageAutomation: false })).rejects.toBeInstanceOf(AuthorityConflictError);
        expect(f.clients.has(12)).toBe(false); expect(f.schedules).toEqual([]);
        expect(f.db.$queryRaw.mock.calls.filter(([query]: [Prisma.Sql]) => /FROM client[\s\S]*FOR UPDATE/.test(query.text))
            .every(([query]: [Prisma.Sql]) => !query.values.includes(1))).toBe(true);
    });
    it("authority refusal remains a safe HTTP 409", () => {
        expect(mapHttpProblem(new AuthorityConflictError(), { method: "POST" } as any, { locals: {} } as any))
            .toMatchObject({ code: "REQUEST_CONFLICT", status: 409 });
    });
    it.each([false, true])("link guards old-owner release before assignment and document locks, active=%s", async active => {
        const f = fixture(active ? 8 : undefined), result = new SbEformsignDocRepository(f.db).linkClientIfActive(B, "bound-doc", 2);
        if (active) {
            await expect(result).rejects.toBeInstanceOf(AuthorityConflictError); expect(f.db.client.updateMany).not.toHaveBeenCalled();
            expect(f.db.eformsign_doc.updateMany).not.toHaveBeenCalled(); expect(f.sql.some(sql => /FROM eformsign_doc[\s\S]*FOR UPDATE/.test(sql))).toBe(false);
        } else { await expect(result).resolves.toBe(true); expect(f.clients.get(8)?.eDocId).toBeNull(); expect(f.clients.get(2)?.eDocId).toBe("bound-doc"); }
    });
    it.each([false, true])("purge guards every pointer before tombstoning, active=%s", async active => {
        const f = fixture(active ? 8 : undefined), result = new SbEformsignDocumentMirrorRepository(f.db).purgeContent(["bound-doc"], new Date("2026-11-05"));
        if (active) {
            await expect(result).rejects.toBeInstanceOf(AuthorityConflictError); expect(f.db.client.updateMany).not.toHaveBeenCalled();
            expect(f.db.eformsign_doc.updateMany).not.toHaveBeenCalled(); expect(f.db.eformsign_doc_file.deleteMany).not.toHaveBeenCalled();
        } else { await result; expect(f.clients.get(8)?.eDocId).toBeNull(); expect(f.db.eformsign_doc.updateMany).toHaveBeenCalled(); }
    });
    it.each([false, true])("service direct pointer update, active=%s", async active => {
        const f = fixture(active ? 2 : undefined); f.db.eformsign_doc.findMany.mockResolvedValue([]);
        const result = serviceFor(f).update(B, 2, { eDocId: null });
        if (active) { await expect(result).rejects.toBeInstanceOf(AuthorityConflictError); expect(f.db.client.updateMany).not.toHaveBeenCalled(); }
        else { await result; expect(f.clients.get(2)?.eDocId).toBeNull(); }
    });
    it("service ordinary edit with the same persisted pointer succeeds under active authority", async () => {
        const f = fixture(2); f.db.eformsign_doc.findMany.mockResolvedValue([]);
        await serviceFor(f).update(B, 2, { name: "Edited", eDocId: "prior-doc" }); expect(f.clients.get(2)?.name).toBe("Edited");
    });
    it.each([false, true])("best-effort phone relink transaction stops before partial release, active=%s", async active => {
        const f = fixture(active ? 8 : undefined); f.document.clientId = 2;
        await serviceFor(f).linkContractDocumentsByPhone(B, ClientMapper.toDomain(f.clients.get(2)! as any), "01012345678");
        if (active) { expect(f.db.client.updateMany).not.toHaveBeenCalled(); expect(f.db.eformsign_doc.updateMany).not.toHaveBeenCalled(); }
        else expect(f.clients.get(2)?.eDocId).toBe("bound-doc");
        expect(f.db.$transaction).toHaveBeenCalled();
    });
    it("ordinary edit commits while a separate best-effort phone relink is denied", async () => {
        const f = fixture(8); f.document.clientId = 2;
        await serviceFor(f).update(B, 2, { name: "Edited" });
        expect(f.clients.get(2)).toMatchObject({ name: "Edited", eDocId: "prior-doc" });
        expect(f.clients.get(8)?.eDocId).toBe("bound-doc"); expect(f.db.client.updateMany).toHaveBeenCalledTimes(1);
        expect(f.db.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });
    it.each([false, true])("mirrored existing-client relink guards before document writes, active=%s", async active => {
        const f = fixture(active ? 2 : undefined); f.document.clientId = 2;
        const result = mirrorFor(f).execute("bound-doc", undefined, { linkExistingOnly: true });
        if (active) { await expect(result).rejects.toBeInstanceOf(AuthorityConflictError); expect(f.db.client.updateMany).not.toHaveBeenCalled(); expect(f.db.eformsign_doc.updateMany).not.toHaveBeenCalled(); }
        else { await expect(result).resolves.toBe("linked"); expect(f.clients.get(2)?.eDocId).toBe("bound-doc"); }
    });
    it.each([false, true])("mirrored auto-create commits atomically or refuses reserved provider ID, active=%s", async active => {
        const f = fixture(active ? 8 : undefined); f.document.clientId = null as any; f.clients.get(8)!.eDocId = null;
        f.db.client.findMany.mockResolvedValue([]);
        Object.assign(f.document, { detailPayload: { id: "bound-doc", template: { id: "template", name: "Fixture" },
            fields: [{ id: "이용자 성명", value: "Fixture", type: "text" }],
            recipients: [{ recipient_type: "02", name: "Fixture", sms: "01012345678" }] } });
        f.db.area = { findMany: jest.fn().mockResolvedValue([]) };
        const result = mirrorFor(f).runTransactionWithRetry({ documentId: "bound-doc", phone: "01012345678", canCreate: true,
            creationBranchId: B, existingClientBranchId: B, suppressGreetingSms: true, applyMessageAutomation: false,
            initializeLifecycle: false, intentAt: new Date("2026-11-05") });
        if (active) { await expect(result).rejects.toBeInstanceOf(AuthorityConflictError); expect(f.clients.has(12)).toBe(false); expect(f.schedules).toEqual([]); expect(f.db.eformsign_doc.updateMany).not.toHaveBeenCalled(); }
        else { await expect(result).resolves.toMatchObject({ status: "created", createdClientId: 12 }); expect(f.clients.get(12)?.eDocId).toBe("bound-doc"); }
    });
    it("zero target update count aborts a mirrored relink and rolls back the earlier pointer release", async () => {
        const f = fixture(), original = f.db.client.updateMany.getMockImplementation(); f.document.clientId = 2;
        f.db.client.updateMany.mockImplementation((args: any) => args.where.id === 2 ? Promise.resolve({ count: 0 }) : original(args));
        await expect(mirrorFor(f).execute("bound-doc", undefined, { linkExistingOnly: true })).rejects.toBeInstanceOf(AuthorityConflictError);
        expect(f.clients.get(8)?.eDocId).toBe("bound-doc"); expect(f.clients.get(2)?.eDocId).toBe("prior-doc");
        expect(f.db.client.updateMany).toHaveBeenCalledTimes(2);
    });
    it.each([false, true])("branchless purge still fences provider IDs with no document/client owner, active=%s", async active => {
        const f = fixture(active ? 8 : undefined); f.document.branchId = null as any; f.document.clientId = null as any; f.clients.get(8)!.eDocId = null;
        const result = new SbEformsignDocumentMirrorRepository(f.db).purgeContent(["bound-doc"], new Date("2026-11-05"));
        if (active) { await expect(result).rejects.toBeInstanceOf(AuthorityConflictError); expect(f.db.client.updateMany).not.toHaveBeenCalled(); expect(f.db.eformsign_doc.updateMany).not.toHaveBeenCalled(); }
        else { await result; expect(f.db.eformsign_doc.updateMany).toHaveBeenCalled(); }
    });
    it("a newly discovered lower owner is refused before any late owner lock or mutation", async () => {
        const f = fixture(), original = f.db.$queryRaw.getMockImplementation(); let discoveries = 0;
        f.db.$queryRaw.mockImplementation((query: Prisma.Sql) => query.text?.includes("SELECT client_id FROM eformsign_contract_authority")
            && ++discoveries > 1 ? Promise.resolve([{ client_id: 1 }]) : original(query));
        const entity = ClientMapper.toDomain(f.clients.get(2)! as any); entity.update({ eDocId: "next-doc" }, KR_BUILTIN_CALENDAR);
        await expect(new SbClientRepository(f.db).update(B, entity)).rejects.toBeInstanceOf(AuthorityConflictError);
        expect(f.db.client.updateMany).not.toHaveBeenCalled();
        expect(f.db.$queryRaw.mock.calls.filter(([query]: [Prisma.Sql]) => query.text?.includes("FOR UPDATE")).every(([query]: [Prisma.Sql]) => !query.values.includes(1))).toBe(true);
    });
    it("purge rechecks the boolean after document locks before any pointer or tombstone write", async () => {
        const f = fixture(), original = f.db.$queryRaw.getMockImplementation(); let checks = 0;
        f.db.$queryRaw.mockImplementation((query: Prisma.Sql) => query.text.includes("phase <> 'closed'") && ++checks === 2
            ? Promise.resolve([{ conflict: true }]) : original(query));
        await expect(new SbEformsignDocumentMirrorRepository(f.db).purgeContent(["bound-doc"], new Date())).rejects.toBeInstanceOf(AuthorityConflictError);
        expect(f.db.client.updateMany).not.toHaveBeenCalled(); expect(f.db.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });
});
it.each([false, true])("client pointer writer rediscovery occurs after the shared parent wait, new owner=%s", async conflict => {
    const f = fixture(), original = f.db.$queryRaw.getMockImplementation()!; let parentLocked = false;
    f.db.$queryRaw.mockImplementation(async (input: Prisma.Sql) => {
        if (input.text.includes("SELECT document_id FROM eformsign_doc")) parentLocked = true;
        if (parentLocked && conflict && input.text.includes("provider_document_id IN") && !input.text.includes("SELECT EXISTS")) return [{ client_id: 99 }];
        return original(input);
    });
    const entity = ClientMapper.toDomain(f.clients.get(2)! as any); entity.update({ eDocId: "next-doc" }, KR_BUILTIN_CALENDAR);
    const result = new SbClientRepository(f.db).update(B, entity);
    if (conflict) { await expect(result).rejects.toBeInstanceOf(AuthorityConflictError); expect(f.clients.get(2)?.eDocId).toBe("prior-doc"); expect(f.db.client.updateMany).not.toHaveBeenCalled(); }
    else { await result; expect(f.clients.get(2)?.eDocId).toBe("next-doc"); }
    expect(parentLocked).toBe(true);
});
