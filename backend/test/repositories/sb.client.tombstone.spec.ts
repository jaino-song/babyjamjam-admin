import { ConflictException, NotFoundException } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { ScopedDeleteNotFoundError } from "domain/errors/retention-delete-blocked.error";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { clearSchemaCapabilityCache } from "infrastructure/database/schema-capabilities";
import { DeleteClientUsecase } from "application/usecases/client/delete-client.usecase";
import { findClientByNormalizedPhone } from "application/usecases/client/client-write-validation";
import { matchesWhere } from "../utils/prisma-where-evaluator";

/**
 * 고객-06: a client with history is deleted as a tombstone. These tests run the real
 * repositories against a small stateful in-memory database whose `where` evaluation is the
 * production predicate, so a dropped `deletedAt: null` or a wrong termination predicate
 * changes the outcome instead of only a call signature.
 */
type Row = any;

const BRANCH = "branch-1";
const MOM_PHONE = "010-1111-2222";
const MOM_PHONE_NORMALIZED = "01011112222";

function createFakeDatabase() {
    const clients: Row[] = [];
    const schedules: Row[] = [];
    const jobs: Row[] = [];
    const messageLogClientIds = new Set<number>();
    let nextClientId = 1;

    const clientRow = (overrides: Row = {}): Row => ({
        id: nextClientId++,
        name: "산모",
        address: null,
        phone: MOM_PHONE,
        phoneNormalized: MOM_PHONE_NORMALIZED,
        type: null,
        duration: null,
        fullPrice: null,
        grant: null,
        actualPrice: null,
        startDate: null,
        endDate: null,
        careCenter: null,
        voucherClient: false,
        birthday: null,
        dueDate: null,
        birthDate: null,
        serviceStatus: null,
        bookingConfirmedAt: null,
        breastPump: false,
        eDocId: null,
        areaId: null,
        suppressGreetingSms: false,
        smsAutomationEnabled: true,
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        branchId: BRANCH,
        deletedAt: null,
        ...overrides,
    });

    const scheduleModel = {
        updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
            const matched = schedules.filter((row) => matchesWhere(row, where));
            matched.forEach((row) => Object.assign(row, data));
            return { count: matched.length };
        }),
        count: jest.fn(async ({ where }: { where: Row }) =>
            schedules.filter((row) => matchesWhere(row, where)).length),
    };

    const jobModel = {
        // The production predicate also carries the ordinary-automation JSON filter, which the
        // evaluator cannot read; the assertions on its shape live in the usecase spec.
        updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
            const { OR, status, branchId } = where;
            const clientId = OR[0].clientId as number;
            const matched = jobs.filter((job) =>
                job.branchId === branchId
                && status.in.includes(job.status)
                && (job.clientId === clientId
                    || schedules.find((schedule) => schedule.id === job.employeeScheduleId)?.clientId === clientId));
            matched.forEach((job) => Object.assign(job, data));
            return { count: matched.length };
        }),
    };

    const clientModel = {
        findFirst: jest.fn(async ({ where }: { where: Row }) =>
            clients.find((row) => matchesWhere(row, where)) ?? null),
        findMany: jest.fn(async ({ where }: { where?: Row } = {}) =>
            clients.filter((row) => matchesWhere(row, where))),
        count: jest.fn(async ({ where }: { where?: Row } = {}) =>
            clients.filter((row) => matchesWhere(row, where)).length),
        create: jest.fn(async ({ data }: { data: Row }) => {
            // client_branch_phone_normalized_key
            if (data.phoneNormalized != null && clients.some((row) =>
                row.branchId === data.branchId && row.phoneNormalized === data.phoneNormalized)) {
                throw new Error("Unique constraint failed on client_branch_phone_normalized_key");
            }
            const row = clientRow({ ...data, id: undefined });
            row.id = nextClientId - 1;
            clients.push(row);
            return row;
        }),
        updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
            const matched = clients.filter((row) => matchesWhere(row, where));
            matched.forEach((row) => Object.assign(row, data));
            return { count: matched.length };
        }),
        deleteMany: jest.fn(async ({ where }: { where: Row }) => {
            const matched = clients.filter((row) => matchesWhere(row, where));
            matched.forEach((row) => clients.splice(clients.indexOf(row), 1));
            return { count: matched.length };
        }),
    };

    const queryRaw = jest.fn(async (strings: readonly string[], ...values: unknown[]) => {
        const sql = strings.join("?");
        if (sql.includes("FOR UPDATE")) {
            const [id, branchId] = values as [number, string];
            const live = sql.includes('"deleted_at" IS NULL');
            return clients
                .filter((row) => row.id === id && row.branchId === branchId && (!live || row.deletedAt === null))
                .map((row) => ({ id: row.id }));
        }
        const id = values[0] as number;
        const count = schedules.filter((row) => row.clientId === id).length
            + jobs.filter((row) => row.clientId === id).length
            + (messageLogClientIds.has(id) ? 1 : 0);
        return [{ count }];
    });

    const prisma: { client: typeof clientModel } & Record<string, unknown> = {
        client: clientModel,
        employee_schedule: scheduleModel,
        message_trigger_job: jobModel,
        $queryRaw: queryRaw,
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
        $transaction: jest.fn(async (callback: (transaction: unknown) => Promise<unknown>): Promise<unknown> => callback(prisma)),
    };

    return {
        prisma,
        clients,
        schedules,
        jobs,
        messageLogClientIds,
        addClient: (overrides: Row = {}) => {
            const row = clientRow(overrides);
            clients.push(row);
            return row;
        },
        addSchedule: (overrides: Row) => {
            const row = {
                id: schedules.length + 1,
                branchId: BRANCH,
                replaced: false,
                terminatedAt: null,
                endDate: new Date(Date.now() + 30 * 86_400_000),
                primaryEmployeeId: 7,
                secondaryEmployeeId: null,
                ...overrides,
            };
            schedules.push(row);
            return row;
        },
        addJob: (overrides: Row) => {
            const row = { id: `job-${jobs.length + 1}`, branchId: BRANCH, status: "pending", clientId: null, employeeScheduleId: null, ...overrides };
            jobs.push(row);
            return row;
        },
    };
}

describe("client tombstone (고객-06)", () => {
    let db: ReturnType<typeof createFakeDatabase>;
    let repository: SbClientRepository;
    let employeeRepository: SbEmployeeRepository;
    let usecase: DeleteClientUsecase;

    const originalSwitch = process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"];

    // The tombstone delete is behind CLIENT_TOMBSTONE_DELETE_ENABLED (default off); the
    // cases below describe the switched-on behaviour, the "switch off" block the default.
    beforeEach(() => {
        process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"] = "true";
        clearSchemaCapabilityCache();
        db = createFakeDatabase();
        const prisma = db.prisma as unknown as PrismaService;
        repository = new SbClientRepository(prisma);
        employeeRepository = new SbEmployeeRepository(prisma);
        usecase = new DeleteClientUsecase(repository);
    });

    afterEach(() => {
        if (originalSwitch === undefined) delete process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"];
        else process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"] = originalSwitch;
    });

    describe("delete with CLIENT_TOMBSTONE_DELETE_ENABLED off", () => {
        it.each([undefined, "", "false", "TRUE", "1", "yes", " true"])(
            "refuses a client with history with a 409 and writes nothing (switch=%j)",
            async (value) => {
                if (value === undefined) delete process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"];
                else process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"] = value;
                const client = db.addClient();
                db.messageLogClientIds.add(client.id);
                const schedule = db.addSchedule({ clientId: client.id });
                const job = db.addJob({ clientId: client.id });

                await expect(usecase.execute(BRANCH, client.id)).rejects.toBeInstanceOf(ConflictException);

                expect(db.clients).toHaveLength(1);
                expect(db.clients[0]?.deletedAt).toBeNull();
                expect(db.clients[0]?.phoneNormalized).toBe(MOM_PHONE_NORMALIZED);
                expect(schedule.terminatedAt ?? null).toBeNull();
                expect(job.cancelReason ?? null).toBeNull();
                expect(job.status).toBe("pending");
            },
        );

        it("carries the existing CLIENT_RETENTION_BLOCKED code and message", async () => {
            process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"] = "false";
            const client = db.addClient();
            db.messageLogClientIds.add(client.id);

            const error = await usecase.execute(BRANCH, client.id).catch((caught) => caught);

            expect(error).toBeInstanceOf(ConflictException);
            expect((error as ConflictException).getResponse()).toMatchObject({
                code: "CLIENT_RETENTION_BLOCKED",
                message: "연결된 운영 또는 이력 데이터가 있어 고객을 삭제할 수 없습니다.",
            });
        });

        it("is on by default only under NODE_ENV=production", async () => {
            const originalNodeEnv = process.env["NODE_ENV"];
            try {
                delete process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"];
                process.env["NODE_ENV"] = "production";
                const kept = db.addClient();
                db.messageLogClientIds.add(kept.id);
                await expect(usecase.execute(BRANCH, kept.id)).resolves.toBe("tombstoned");

                process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"] = "false";
                const refused = db.addClient({ phone: "010-2222-3333", phoneNormalized: "01022223333" });
                db.messageLogClientIds.add(refused.id);
                await expect(usecase.execute(BRANCH, refused.id)).rejects.toBeInstanceOf(ConflictException);
            } finally {
                if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
                else process.env["NODE_ENV"] = originalNodeEnv;
            }
        });

        it("still hard deletes a client without history", async () => {
            process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"] = "false";
            const client = db.addClient();

            await expect(usecase.execute(BRANCH, client.id)).resolves.toBe("deleted");

            expect(db.clients).toHaveLength(0);
        });
    });

    describe("delete", () => {
        it("hard deletes a client without history", async () => {
            const client = db.addClient();

            await expect(usecase.execute(BRANCH, client.id)).resolves.toBe("deleted");

            expect(db.clients).toHaveLength(0);
        });

        it("tombstones a client with history instead of answering CLIENT_RETENTION_BLOCKED", async () => {
            const client = db.addClient();
            db.messageLogClientIds.add(client.id);

            await expect(usecase.execute(BRANCH, client.id)).resolves.toBe("tombstoned");

            expect(db.clients).toHaveLength(1);
            expect(db.clients[0]?.deletedAt).toBeInstanceOf(Date);
        });

        it("keeps the raw phone but clears the normalized key", async () => {
            const client = db.addClient();
            db.addSchedule({ clientId: client.id });

            await usecase.execute(BRANCH, client.id);

            expect(db.clients[0]).toMatchObject({ phone: MOM_PHONE, phoneNormalized: null });
        });

        it("ends only the still-open assignments of that client", async () => {
            const client = db.addClient();
            const other = db.addClient({ phone: "010-9999-0000", phoneNormalized: "01099990000" });
            const open = db.addSchedule({ clientId: client.id });
            const replaced = db.addSchedule({ clientId: client.id, replaced: true });
            const alreadyEnded = db.addSchedule({ clientId: client.id, terminatedAt: new Date("2026-09-01T00:00:00.000Z") });
            const otherClients = db.addSchedule({ clientId: other.id });

            await usecase.execute(BRANCH, client.id);

            expect(open.terminatedAt).toBeInstanceOf(Date);
            expect(replaced.terminatedAt).toBeNull();
            expect(alreadyEnded.terminatedAt).toEqual(new Date("2026-09-01T00:00:00.000Z"));
            expect(otherClients.terminatedAt).toBeNull();
        });

        it("cancels its pending, processing and needs_setup jobs, directly or through a schedule", async () => {
            const client = db.addClient();
            const other = db.addClient({ phone: "010-9999-0000", phoneNormalized: "01099990000" });
            const schedule = db.addSchedule({ clientId: client.id });
            const direct = db.addJob({ clientId: client.id });
            const viaSchedule = db.addJob({ employeeScheduleId: schedule.id });
            const needsSetup = db.addJob({ clientId: client.id, status: "needs_setup" });
            const sent = db.addJob({ clientId: client.id, status: "sent" });
            const othersJob = db.addJob({ clientId: other.id });

            await usecase.execute(BRANCH, client.id);

            for (const job of [direct, viaSchedule, needsSetup]) {
                expect(job).toMatchObject({ status: "canceled", cancelReason: "고객 삭제", claimToken: null });
                expect(job.canceledAt).toBeInstanceOf(Date);
            }
            expect(sent.status).toBe("sent");
            expect(othersJob.status).toBe("pending");
        });

        it("answers 404 when the client is already tombstoned", async () => {
            const client = db.addClient();
            db.addSchedule({ clientId: client.id });
            await usecase.execute(BRANCH, client.id);

            await expect(usecase.execute(BRANCH, client.id)).rejects.toBeInstanceOf(NotFoundException);
        });

        it("rejects a second delete that reaches the repository after the first committed", async () => {
            const client = db.addClient();
            db.addSchedule({ clientId: client.id });
            await repository.delete(BRANCH, client.id);
            const tombstonedAt = db.clients[0]?.deletedAt;

            await expect(repository.delete(BRANCH, client.id)).rejects.toBeInstanceOf(ScopedDeleteNotFoundError);

            expect(db.clients[0]?.deletedAt).toBe(tombstonedAt);
        });

        it("does not touch a client of another branch", async () => {
            const client = db.addClient();
            db.addSchedule({ clientId: client.id });

            await expect(usecase.execute("branch-2", client.id)).rejects.toBeInstanceOf(NotFoundException);

            expect(db.clients[0]?.deletedAt).toBeNull();
        });
    });

    describe("reads", () => {
        let live: Row;
        let tombstone: Row;

        beforeEach(() => {
            live = db.addClient({ name: "산모", phone: "010-3333-4444", phoneNormalized: "01033334444" });
            tombstone = db.addClient({ name: "산모", deletedAt: new Date("2026-10-18T00:00:00.000Z"), phoneNormalized: null });
        });

        it("findById answers null for a tombstone", async () => {
            await expect(repository.findById(BRANCH, tombstone.id)).resolves.toBeNull();
            await expect(repository.findById(BRANCH, live.id)).resolves.not.toBeNull();
        });

        it("findByIdForUpdate answers null for a tombstone", async () => {
            const transaction = db.prisma as never;
            await expect(repository.findByIdForUpdate(BRANCH, tombstone.id, transaction)).resolves.toBeNull();
            await expect(repository.findByIdForUpdate(BRANCH, live.id, transaction)).resolves.not.toBeNull();
        });

        it("findAll lists no tombstone", async () => {
            const all = await repository.findAll(BRANCH);
            expect(all.map((client) => client.id)).toEqual([live.id]);
        });

        it("findAllPaginated lists and counts no tombstone", async () => {
            const page = await repository.findAllPaginated(BRANCH, 1, 10);
            expect(page.data.map((client) => client.id)).toEqual([live.id]);
            expect(page.total).toBe(1);
        });

        it("search never returns a tombstone, plain or by Korean initials", async () => {
            // `contains` is beyond the evaluator, so the plain text search is checked on its predicate.
            db.prisma.client.findMany.mockResolvedValueOnce([live]);
            db.prisma.client.count.mockResolvedValueOnce(1);
            await repository.findAllPaginated(BRANCH, 1, 10, "산모");
            expect(db.prisma.client.findMany.mock.calls.at(-1)?.[0]?.where).toMatchObject({
                branchId: BRANCH,
                deletedAt: null,
            });

            const byInitials = await repository.findAllPaginated(BRANCH, 1, 10, "ㅅㅁ");
            expect(byInitials.data.map((client) => client.id)).toEqual([live.id]);
        });

        it("the list summary counts no tombstone", async () => {
            const summary = await repository.getListSummary(BRANCH);
            expect(summary.total).toBe(1);
        });

        it("the date finders return no tombstone", async () => {
            const day = new Date("2026-10-19T00:00:00.000Z");
            for (const row of [live, tombstone]) {
                row.startDate = day;
                row.endDate = day;
            }

            const byStart = await repository.findByStartDate(BRANCH, day);
            const byEnd = await repository.findByEndDate(BRANCH, day);

            expect(byStart.map((client) => client.id)).toEqual([live.id]);
            expect(byEnd.map((client) => client.id)).toEqual([live.id]);
        });
    });

    describe("phone identity", () => {
        it("lets a new client register the phone of a tombstoned one", async () => {
            const original = db.addClient();
            db.addSchedule({ clientId: original.id });
            await usecase.execute(BRANCH, original.id);

            // The service-level duplicate check (CLIENT_PHONE_ALREADY_REGISTERED) finds nobody...
            const { existingClient } = await findClientByNormalizedPhone(repository, BRANCH, MOM_PHONE);
            expect(existingClient).toBeNull();

            // ...and the branch-unique phone key is free for the insert.
            const replacement = ClientEntity.create({
                name: "다시 등록한 산모",
                address: "서울",
                phone: MOM_PHONE,
                type: null,
                duration: 15,
                fullPrice: null,
                grant: null,
                actualPrice: null,
                startDate: null,
                endDate: null,
                careCenter: false,
                voucherClient: false,
                birthday: null,
                serviceStatus: null,
                breastPump: false,
                eDocId: null,
                dueDate: null,
                birthDate: null,
            }, KR_BUILTIN_CALENDAR);
            const created = await repository.create(BRANCH, replacement);

            expect(created.id).not.toBe(original.id);
            expect(db.clients.filter((client) => client.phoneNormalized === MOM_PHONE_NORMALIZED)).toHaveLength(1);
            const found = await repository.findByPhone(BRANCH, MOM_PHONE_NORMALIZED);
            expect(found?.id).toBe(created.id);
        });

        it("findByPhone ignores a tombstone even if its normalized key were still set", async () => {
            db.addClient({ deletedAt: new Date("2026-10-18T00:00:00.000Z") });

            await expect(repository.findByPhone(BRANCH, MOM_PHONE_NORMALIZED)).resolves.toBeNull();
        });
    });

    describe("employee deletion after the client is tombstoned", () => {
        it("frees an employee whose only open assignment belonged to the deleted client", async () => {
            const client = db.addClient();
            db.addSchedule({ clientId: client.id, primaryEmployeeId: 7 });
            await expect(employeeRepository.hasActiveAssignments(BRANCH, 7)).resolves.toBe(true);

            await usecase.execute(BRANCH, client.id);

            await expect(employeeRepository.hasActiveAssignments(BRANCH, 7)).resolves.toBe(false);
        });

        it("frees a secondary employee too", async () => {
            const client = db.addClient();
            db.addSchedule({ clientId: client.id, primaryEmployeeId: 7, secondaryEmployeeId: 8 });

            await usecase.execute(BRANCH, client.id);

            await expect(employeeRepository.hasActiveAssignments(BRANCH, 8)).resolves.toBe(false);
        });

        it("still holds an employee who has another client's open assignment", async () => {
            const deleted = db.addClient();
            const kept = db.addClient({ phone: "010-9999-0000", phoneNormalized: "01099990000" });
            db.addSchedule({ clientId: deleted.id, primaryEmployeeId: 7 });
            db.addSchedule({ clientId: kept.id, primaryEmployeeId: 7 });

            await usecase.execute(BRANCH, deleted.id);

            await expect(employeeRepository.hasActiveAssignments(BRANCH, 7)).resolves.toBe(true);
        });
    });
});
