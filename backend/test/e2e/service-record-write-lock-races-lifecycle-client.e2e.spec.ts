import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { lockClientForScheduleWrite } from "application/policies/employee-schedule-invariants.policy";
import { ClientService } from "application/services/client.service";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordTokenContext } from "application/services/service-record-token.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    assertApprovedServiceRecordWriteLockDatabaseTarget,
    createApprovedServiceRecordWriteLockClient,
} from "./helpers/service-record-write-lock-order.helper";

const ENABLED = process.env["SERVICE_RECORD_WRITE_LOCK_E2E"] === "1";
const describeE2E = ENABLED ? describe : describe.skip;
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const SIGNATURE =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Fixture = {
    branchId?: string;
    clientIds: number[];
    employeeIds: number[];
    scheduleIds: number[];
    caseIds: string[];
    assignmentIds: string[];
    dayIds: string[];
    documentIds: number[];
};

const fixtures: Fixture[] = [];

async function cleanupFixture(prisma: PrismaClient, f: Fixture): Promise<void> {
    for (const id of f.documentIds) if (id) await prisma.eformsign_doc.deleteMany({ where: { id } });
    for (const id of f.dayIds) if (id) await prisma.service_record_day.deleteMany({ where: { id } });
    for (const id of f.assignmentIds) if (id) await prisma.service_record_assignment.deleteMany({ where: { id } });
    for (const id of f.caseIds) if (id) {
        await prisma.service_record.deleteMany({ where: { serviceRecordCaseId: id } });
        await prisma.service_record_case.deleteMany({ where: { id } });
    }
    for (const id of f.scheduleIds) if (id) await prisma.employee_schedule.deleteMany({ where: { id } });
    for (const id of f.clientIds) if (id) {
        await prisma.client.updateMany({ where: { id }, data: { eDocId: null } });
        await prisma.client.deleteMany({ where: { id } });
    }
    for (const id of f.employeeIds) if (id) await prisma.employee.deleteMany({ where: { id } });
    if (f.branchId) await prisma.branch.deleteMany({ where: { id: f.branchId } });
}

async function addOwner(
    prisma: PrismaClient,
    f: Fixture,
    employeeId: number,
    name: string,
    options: { clientId?: number; caseId?: string; startDate?: string; endDate?: string; completeHeader?: boolean } = {},
): Promise<{ clientId: number; caseId: string; scheduleId: number }> {
    if (!f.branchId) throw new Error("fixture branch missing");
    const startDate = d(options.startDate ?? "2026-09-01");
    const endDate = d(options.endDate ?? "2026-09-30");
    let clientId = options.clientId;
    if (clientId === undefined) {
        const client = await prisma.client.create({
            data: {
                name,
                address: "initial address",
                voucherClient: false,
                branchId: f.branchId,
                duration: 1,
                startDate,
                endDate,
                serviceStatus: "active",
            },
            select: { id: true },
        });
        clientId = client.id;
        f.clientIds.push(client.id);
    }
    let caseId = options.caseId;
    if (caseId === undefined) {
        const serviceRecordCase = await prisma.service_record_case.create({
            data: {
                branchId: f.branchId,
                clientId,
                startDate,
                endDate,
                requiredSessionCount: 1,
                status: "IN_PROGRESS",
                ...(options.completeHeader === true
                    ? {
                        momName: "Task 3 Mom",
                        momBirth: "900101",
                        babyName: "Task 3 Baby",
                        babyBirth: "260901",
                        deliveryType: "자연분만",
                        babyWeight: "3.2",
                    }
                    : {}),
            },
            select: { id: true },
        });
        caseId = serviceRecordCase.id;
        f.caseIds.push(caseId);
    }
    const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: { name: true, phone: true },
    });
    const schedule = await prisma.employee_schedule.create({
        data: {
            branchId: f.branchId,
            clientId,
            primaryEmployeeId: employeeId,
            workAddress: "initial address",
            startDate,
            endDate,
            replaced: false,
        },
        select: { id: true },
    });
    f.scheduleIds.push(schedule.id);
    const assignment = await prisma.service_record_assignment.create({
        data: {
            branchId: f.branchId,
            serviceRecordCaseId: caseId,
            scheduleId: schedule.id,
            employeeId,
            employeeNameSnapshot: employee.name,
            employeePhoneSnapshot: employee.phone,
            startDate,
            endDate,
        },
        select: { id: true },
    });
    f.assignmentIds.push(assignment.id);
    return { clientId, caseId, scheduleId: schedule.id };
}

async function createFixture(
    prisma: PrismaClient,
    options: { employeeCount?: number; completeHeader?: boolean; address?: string } = {},
): Promise<Fixture> {
    const f: Fixture = {
        clientIds: [], employeeIds: [], scheduleIds: [], caseIds: [], assignmentIds: [], dayIds: [], documentIds: [],
    };
    const tag = `task3-race-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    try {
        const branch = await prisma.branch.create({ data: { name: tag, slug: tag }, select: { id: true } });
        f.branchId = branch.id;
        for (let i = 0; i < (options.employeeCount ?? 1); i += 1) {
            const employee = await prisma.employee.create({
                data: {
                    name: `${tag}-employee-${i}`,
                    phone: `010${String(Date.now()).slice(-8)}${i}`,
                    workArea: ["task3"],
                    grade: "산모신생아 건강관리사",
                    branchId: branch.id,
                    openToNextWork: true,
                },
                select: { id: true },
            });
            f.employeeIds.push(employee.id);
        }
        await addOwner(prisma, f, f.employeeIds[0]!, `${tag}-client`, {
            completeHeader: options.completeHeader,
        });
        if (options.address) {
            await prisma.client.update({ where: { id: f.clientIds[0] }, data: { address: options.address } });
        }
        fixtures.push(f);
        return f;
    } catch (error) {
        await cleanupFixture(prisma, f);
        throw error;
    }
}

async function waitForLock(observer: PrismaClient, pid?: number, attempts = 300): Promise<void> {
    for (let i = 0; i < attempts; i += 1) {
        const rows = await observer.$queryRaw<Array<{ count: number }>>(Prisma.sql`
            SELECT count(*)::int AS count
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              ${pid === undefined ? Prisma.empty : Prisma.sql`AND pid = ${pid}`}
              AND state = 'active'
        `);
        if ((rows[0]?.count ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("timed out waiting for a PostgreSQL lock waiter");
}

function queryText(query: unknown): string {
    if (!query || typeof query !== "object") return "";
    const strings = (query as { strings?: unknown }).strings;
    return Array.isArray(strings) ? strings.join(" ").toLowerCase() : "";
}

function instrumentPrisma(
    prisma: PrismaClient,
    hooks: {
        onTransactionPid?: (pid: number) => void;
        onRootRead?: () => void;
        onCaseLocked?: () => void;
        caseLockHold?: Promise<void>;
    } = {},
): PrismaClient {
    const originalTransaction = prisma.$transaction.bind(prisma);
    return new Proxy(prisma, {
        get(target, property, receiver) {
            if (property === "$transaction") {
                return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: unknown) =>
                    originalTransaction(async (tx) => {
                        if (hooks.onTransactionPid) {
                            const rows = await tx.$queryRaw<Array<{ pid: number }>>(Prisma.sql`SELECT pg_backend_pid() AS pid`);
                            const pid = Number(rows[0]?.pid);
                            if (Number.isInteger(pid)) hooks.onTransactionPid(pid);
                        }
                        const wrapped = hooks.onCaseLocked && hooks.caseLockHold
                            ? pauseAfterCaseLock(tx, hooks.onCaseLocked, hooks.caseLockHold)
                            : tx;
                        return callback(wrapped);
                    }, options as never);
            }
            if (property === "service_record_case" && hooks.onRootRead) {
                const delegate = Reflect.get(target, property, receiver) as object;
                return new Proxy(delegate, {
                    get(delegateTarget, delegateProperty, delegateReceiver) {
                        if (delegateProperty === "findUnique") {
                            return async (args: unknown) => {
                                const result = await (Reflect.get(delegateTarget, delegateProperty, delegateReceiver) as (value: unknown) => Promise<unknown>)(args);
                                if (
                                    args
                                    && typeof args === "object"
                                    && "select" in args
                                    && Boolean((args as { select?: { clientId?: boolean; status?: boolean } }).select?.clientId)
                                    && Boolean((args as { select?: { clientId?: boolean; status?: boolean } }).select?.status)
                                ) {
                                    hooks.onRootRead!();
                                }
                                return result;
                            };
                        }
                        const value = Reflect.get(delegateTarget, delegateProperty, delegateReceiver);
                        return typeof value === "function" ? value.bind(delegateTarget) : value;
                    },
                });
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

function pauseAfterCaseLock(
    tx: Prisma.TransactionClient,
    onCaseLocked: () => void,
    hold: Promise<void>,
): Prisma.TransactionClient {
    let paused = false;
    return new Proxy(tx, {
        get(target, property, receiver) {
            if (property === "$queryRaw") {
                return async (...args: unknown[]) => {
                    const result = await (target.$queryRaw as (...queryArgs: unknown[]) => Promise<unknown>)(...args);
                    const text = queryText(args[0]);
                    if (!paused && text.includes('from "service_record_case"') && text.includes("for update")) {
                        paused = true;
                        onCaseLocked();
                        await hold;
                    }
                    return result;
                };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

function context(f: Fixture): ServiceRecordTokenContext {
    if (!f.branchId || f.clientIds[0] === undefined || f.scheduleIds[0] === undefined || f.employeeIds[0] === undefined || !f.caseIds[0]) {
        throw new Error("fixture is incomplete");
    }
    return {
        tokenId: `task3-token-${randomUUID()}`,
        branchId: f.branchId,
        scheduleId: f.scheduleIds[0],
        employeeId: f.employeeIds[0],
        serviceRecordCaseId: f.caseIds[0],
    };
}

function entryService(prisma: PrismaClient, lifecycle: ServiceRecordLifecycleService): ServiceRecordEntryService {
    return new ServiceRecordEntryService(
        prisma as unknown as PrismaService,
        { extendExpiryForCase: async () => undefined } as never,
        lifecycle,
    );
}

function clientService(
    prisma: PrismaClient,
    lifecycle: ServiceRecordLifecycleService,
    onPreflight?: () => void,
): ClientService {
    const finder = {
        execute: async (branchId: string, id: number) => {
            const result = await prisma.client.findFirst({ where: { id, branchId } });
            onPreflight?.();
            return result as never;
        },
    };
    const repository = {
        findByPhone: async (branchId: string, phone: string) => prisma.client.findFirst({ where: { branchId, phoneNormalized: phone } }) as never,
    };
    return new ClientService(
        undefined as never,
        finder as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        prisma as unknown as PrismaService,
        repository as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        lifecycle,
        undefined as never,
        undefined as never,
    );
}

describeE2E("service-record lifecycle/client lock races (real PostgreSQL)", () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
        assertApprovedServiceRecordWriteLockDatabaseTarget();
        prisma = createApprovedServiceRecordWriteLockClient();
        await prisma.$connect();
    });

    afterEach(async () => {
        for (const f of fixtures.splice(0).reverse()) await cleanupFixture(prisma, f);
    });

    afterAll(async () => { await prisma?.$disconnect(); });

    it("recomputes from a fresh case after a submitted session wins the case lock", async () => {
        const f = await createFixture(prisma, { completeHeader: true });
        const holder = createApprovedServiceRecordWriteLockClient();
        const submitDb = createApprovedServiceRecordWriteLockClient();
        const recomputeDb = createApprovedServiceRecordWriteLockClient();
        await Promise.all([holder.$connect(), submitDb.$connect(), recomputeDb.$connect()]);
        let release!: () => void;
        const hold = new Promise<void>((resolve) => { release = resolve; });
        let ready!: () => void;
        const started = new Promise<void>((resolve) => { ready = resolve; });
        const held = holder.$transaction(async (tx) => {
            await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "service_record_case" WHERE "id" = ${f.caseIds[0]}::uuid FOR UPDATE`);
            ready();
            await hold;
        });
        await started;
        let submitPid!: number;
        let submitPidReady!: () => void;
        const submitPidStarted = new Promise<void>((resolve) => { submitPidReady = resolve; });
        const submitPrisma = instrumentPrisma(submitDb, {
            onTransactionPid: (pid) => { submitPid = pid; submitPidReady(); },
        });
        const submitLifecycle = new ServiceRecordLifecycleService(submitPrisma as unknown as PrismaService);
        const submit = entryService(submitPrisma, submitLifecycle).upsertSession(context(f), 1, {
            serviceDate: "2026-09-01", answers: {}, paymentConfirmed: true, momApproval: "approved", clientSignature: SIGNATURE,
        }, true);
        await submitPidStarted;
        await waitForLock(prisma, submitPid);

        let rootRead!: () => void;
        const rootReadStarted = new Promise<void>((resolve) => { rootRead = resolve; });
        const recomputePrisma = instrumentPrisma(recomputeDb, {
            onRootRead: rootRead,
        });
        const recompute = new ServiceRecordLifecycleService(recomputePrisma as unknown as PrismaService).recompute(f.caseIds[0]!);
        // The old root path has no transaction lock to wait on. Pin its
        // initial stale snapshot before releasing the case holder so an old
        // implementation cannot win by reading the submitted day afterward.
        await rootReadStarted;
        release();
        await expect(submit).resolves.toEqual(expect.objectContaining({ locked: true }));
        await expect(recompute).resolves.toEqual(expect.objectContaining({ status: "READY_TO_FINALIZE" }));
        await expect(held).resolves.toBeUndefined();
        await expect(prisma.service_record_case.findUnique({ where: { id: f.caseIds[0] }, select: { status: true } })).resolves.toEqual({ status: "READY_TO_FINALIZE" });
        await Promise.all([holder.$disconnect(), submitDb.$disconnect(), recomputeDb.$disconnect()]);
    });

    it("rejects a header write when finalization changes the case while the writer waits", async () => {
        const f = await createFixture(prisma);
        const holder = createApprovedServiceRecordWriteLockClient();
        const writer = createApprovedServiceRecordWriteLockClient();
        await Promise.all([holder.$connect(), writer.$connect()]);
        let release!: () => void;
        const hold = new Promise<void>((resolve) => { release = resolve; });
        let ready!: () => void;
        const started = new Promise<void>((resolve) => { ready = resolve; });
        const held = holder.$transaction(async (tx) => {
            await lockClientForScheduleWrite(tx, f.branchId!, f.clientIds[0]!);
            ready();
            await hold;
        });
        await started;
        let writerPid!: number;
        let writerPidReady!: () => void;
        const writerPidStarted = new Promise<void>((resolve) => { writerPidReady = resolve; });
        const writerPrisma = instrumentPrisma(writer, {
            onTransactionPid: (pid) => { writerPid = pid; writerPidReady(); },
        });
        const lifecycle = new ServiceRecordLifecycleService(writerPrisma as unknown as PrismaService);
        const header = entryService(writerPrisma, lifecycle).saveHeader(context(f), {
            momName: "Task 3 Mom", momBirth: "900101", babyName: "Task 3 Baby", babyBirth: "260901", deliveryType: "자연분만", babyWeight: "3.2",
        });
        await writerPidStarted;
        await waitForLock(prisma, writerPid);
        await holder.$transaction((tx) => tx.service_record_case.update({ where: { id: f.caseIds[0] }, data: { status: "FINALIZING" } }));
        release();
        await expect(header).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_FINALIZED" } });
        await expect(held).resolves.toBeUndefined();
        await expect(prisma.service_record_case.findUnique({ where: { id: f.caseIds[0] }, select: { status: true, momName: true } })).resolves.toEqual({ status: "FINALIZING", momName: null });
        await Promise.all([holder.$disconnect(), writer.$disconnect()]);
    });

    it("rejects a date-only client update after a submitted day is visible under the owning lock", async () => {
        const f = await createFixture(prisma, { completeHeader: true });
        const holder = createApprovedServiceRecordWriteLockClient();
        const submitDb = createApprovedServiceRecordWriteLockClient();
        const updateDb = createApprovedServiceRecordWriteLockClient();
        await Promise.all([holder.$connect(), submitDb.$connect(), updateDb.$connect()]);
        let release!: () => void;
        const hold = new Promise<void>((resolve) => { release = resolve; });
        let ready!: () => void;
        const started = new Promise<void>((resolve) => { ready = resolve; });
        const held = holder.$transaction(async (tx) => {
            await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "service_record_case" WHERE "id" = ${f.caseIds[0]}::uuid FOR UPDATE`);
            ready();
            await hold;
        });
        await started;
        let submitPid!: number;
        let submitPidReady!: () => void;
        const submitPidStarted = new Promise<void>((resolve) => { submitPidReady = resolve; });
        const submitPrisma = instrumentPrisma(submitDb, {
            onTransactionPid: (pid) => { submitPid = pid; submitPidReady(); },
        });
        const submitLifecycle = new ServiceRecordLifecycleService(submitPrisma as unknown as PrismaService);
        const submit = entryService(submitPrisma, submitLifecycle).upsertSession(context(f), 1, {
            serviceDate: "2026-09-01", answers: {}, paymentConfirmed: true, momApproval: "approved", clientSignature: SIGNATURE,
        }, true);
        await submitPidStarted;
        await waitForLock(prisma, submitPid);
        let updatePreflight!: () => void;
        const updatePreflightStarted = new Promise<void>((resolve) => { updatePreflight = resolve; });
        let updatePid!: number;
        let updatePidReady!: () => void;
        const updatePidStarted = new Promise<void>((resolve) => { updatePidReady = resolve; });
        const updatePrisma = instrumentPrisma(updateDb, {
            onTransactionPid: (pid) => { updatePid = pid; updatePidReady(); },
        });
        const updateLifecycle = new ServiceRecordLifecycleService(updatePrisma as unknown as PrismaService);
        const update = clientService(updatePrisma, updateLifecycle, updatePreflight).update(f.branchId!, f.clientIds[0]!, { startDate: "2026-09-05" });
        await updatePreflightStarted;
        await updatePidStarted;
        await waitForLock(prisma, updatePid);
        release();
        await expect(submit).resolves.toEqual(expect.objectContaining({ locked: true }));
        await expect(update).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_START_DATE_LOCKED" } });
        await expect(held).resolves.toBeUndefined();
        await expect(prisma.client.findUnique({ where: { id: f.clientIds[0] }, select: { startDate: true } })).resolves.toEqual({ startDate: d("2026-09-01") });
        await Promise.all([holder.$disconnect(), submitDb.$disconnect(), updateDb.$disconnect()]);
    });

    it("uses the freshly locked client address and end date for a replacement", async () => {
        const f = await createFixture(prisma, { completeHeader: true });
        const newEmployee = await prisma.employee.create({
            data: {
                name: `task3-replacement-${randomUUID().slice(0, 8)}`,
                phone: `010${String(Date.now()).slice(-8)}9`,
                workArea: ["task3"], grade: "산모신생아 건강관리사", branchId: f.branchId!, openToNextWork: true,
            },
            select: { id: true },
        });
        f.employeeIds.push(newEmployee.id);
        const holder = createApprovedServiceRecordWriteLockClient();
        const editDb = createApprovedServiceRecordWriteLockClient();
        const replacementDb = createApprovedServiceRecordWriteLockClient();
        await Promise.all([holder.$connect(), editDb.$connect(), replacementDb.$connect()]);
        let release!: () => void;
        const hold = new Promise<void>((resolve) => { release = resolve; });
        let ready!: () => void;
        const started = new Promise<void>((resolve) => { ready = resolve; });
        const held = holder.$transaction(async (tx) => {
            await lockClientForScheduleWrite(tx, f.branchId!, f.clientIds[0]!);
            ready();
            await hold;
        });
        await started;
        let editPreflight!: () => void;
        const editPreflightStarted = new Promise<void>((resolve) => { editPreflight = resolve; });
        let editPid!: number;
        let editPidReady!: () => void;
        const editPidStarted = new Promise<void>((resolve) => { editPidReady = resolve; });
        const editPrisma = instrumentPrisma(editDb, {
            onTransactionPid: (pid) => { editPid = pid; editPidReady(); },
        });
        const edit = clientService(editPrisma, new ServiceRecordLifecycleService(editPrisma as unknown as PrismaService), editPreflight).update(f.branchId!, f.clientIds[0]!, {
            address: "fresh address", endDate: "2027-12-31",
        });
        await editPreflightStarted;
        await editPidStarted;
        await waitForLock(prisma, editPid);
        let replacementPreflight!: () => void;
        const replacementPreflightStarted = new Promise<void>((resolve) => { replacementPreflight = resolve; });
        let replacementPid!: number;
        let replacementPidReady!: () => void;
        const replacementPidStarted = new Promise<void>((resolve) => { replacementPidReady = resolve; });
        const replacementPrisma = instrumentPrisma(replacementDb, {
            onTransactionPid: (pid) => { replacementPid = pid; replacementPidReady(); },
        });
        const replacement = clientService(replacementPrisma, new ServiceRecordLifecycleService(replacementPrisma as unknown as PrismaService), replacementPreflight).requestReplacement(f.branchId!, f.clientIds[0]!, newEmployee.id);
        await replacementPreflightStarted;
        await replacementPidStarted;
        await waitForLock(prisma, replacementPid);
        release();
        await expect(edit).resolves.toEqual(expect.objectContaining({ address: "fresh address" }));
        await expect(replacement).resolves.toEqual(expect.objectContaining({ address: "fresh address" }));
        await expect(held).resolves.toBeUndefined();
        const schedules = await prisma.employee_schedule.findMany({ where: { clientId: f.clientIds[0], branchId: f.branchId }, orderBy: { id: "desc" }, select: { id: true, workAddress: true, endDate: true, replaced: true } });
        expect(schedules[0]).toEqual(expect.objectContaining({ workAddress: "fresh address", endDate: d("2027-12-31"), replaced: false }));
        f.scheduleIds.push(...schedules.map((row) => row.id).filter((id) => !f.scheduleIds.includes(id)));
        await Promise.all([holder.$disconnect(), editDb.$disconnect(), replacementDb.$disconnect()]);
    });

    it("locks historical employees before the case across concurrent client assignment changes", async () => {
        const f = await createFixture(prisma, { employeeCount: 3, completeHeader: true });
        const low = f.employeeIds[0]!;
        const middle = f.employeeIds[1]!;
        const high = f.employeeIds[2]!;
        const historicalScheduleId = f.scheduleIds[0]!;
        await prisma.employee_schedule.update({ where: { id: historicalScheduleId }, data: { replaced: true } });
        await addOwner(prisma, f, middle, "client-a-current", { clientId: f.clientIds[0], caseId: f.caseIds[0] });
        const b = await addOwner(prisma, f, low, "client-b");
        const aDb = createApprovedServiceRecordWriteLockClient();
        const bDb = createApprovedServiceRecordWriteLockClient();
        await Promise.all([aDb.$connect(), bDb.$connect()]);
        let releaseA!: () => void;
        const holdA = new Promise<void>((resolve) => { releaseA = resolve; });
        let aCaseLocked!: () => void;
        const aCase = new Promise<void>((resolve) => { aCaseLocked = resolve; });
        let bPid!: number;
        let aPidReady!: () => void;
        let bPidReady!: () => void;
        const aPidStarted = new Promise<void>((resolve) => { aPidReady = resolve; });
        const bPidStarted = new Promise<void>((resolve) => { bPidReady = resolve; });
        const aPrisma = instrumentPrisma(aDb, {
            onTransactionPid: () => { aPidReady(); },
            onCaseLocked: aCaseLocked,
            caseLockHold: holdA,
        });
        const bPrisma = instrumentPrisma(bDb, {
            onTransactionPid: (pid) => { bPid = pid; bPidReady(); },
        });
        const aService = clientService(aPrisma, new ServiceRecordLifecycleService(aPrisma as unknown as PrismaService));
        const bService = clientService(bPrisma, new ServiceRecordLifecycleService(bPrisma as unknown as PrismaService));
        const aUpdate = aService.update(f.branchId!, f.clientIds[0]!, { primaryEmployeeId: high });
        await aCase;
        const bUpdate = bService.update(f.branchId!, b.clientId, { primaryEmployeeId: middle });
        await aPidStarted;
        await bPidStarted;
        await waitForLock(prisma, bPid);
        releaseA();
        await expect(aUpdate).resolves.toEqual(expect.objectContaining({ id: f.clientIds[0] }));
        await expect(bUpdate).resolves.toEqual(expect.objectContaining({ id: b.clientId }));
        await expect(prisma.employee_schedule.findFirst({ where: { clientId: f.clientIds[0], branchId: f.branchId, replaced: false }, orderBy: { id: "desc" }, select: { primaryEmployeeId: true } })).resolves.toEqual({ primaryEmployeeId: high });
        await expect(prisma.employee_schedule.findFirst({ where: { clientId: b.clientId, branchId: f.branchId, replaced: false }, orderBy: { id: "desc" }, select: { primaryEmployeeId: true } })).resolves.toEqual({ primaryEmployeeId: middle });
        await Promise.all([aDb.$disconnect(), bDb.$disconnect()]);
    });
});
