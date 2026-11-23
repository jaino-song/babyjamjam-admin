import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JwtService } from "@nestjs/jwt";
import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { ServiceRecordCaseEventBus } from "application/services/service-record-case-event-bus.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import * as jwtSecret from "infrastructure/auth/jwt-secret";
import { JwtStrategy } from "infrastructure/auth/jwt.strategy";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { TenantContext, TenantGuard } from "infrastructure/tenant";
import { OwnerRecordJsonBearerGuard, OwnerRecordJsonController } from "interface/controllers/owner-record-json.controller";
import { parseOwnerRecordJsonRequest, parseOwnerRecordJsonTarget, type OwnerRecordJsonRequest } from "interface/dto/owner-record-json.dto";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const OTHER_BRANCH = "12121212-1212-4212-8212-121212121212";
const CASE = "22222222-2222-4222-8222-222222222222";
const OTHER_CASE = "23232323-2323-4323-8323-232323232323";
const OWNER = "33333333-3333-4333-8333-333333333333";
const ASSIGNMENT = "44444444-4444-4444-8444-444444444444";
const SESSION = "55555555-5555-4555-8555-555555555555";
const KEY = "66666666-6666-4666-8666-666666666666";
const OTHER_KEY = "67676767-6767-4767-8767-676767676767";
const CLIENT = 115;
const EMPLOYEE = 9;
const SCHEDULE = 55;
const DATES = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"];
const target = { clientId: CLIENT, caseId: CASE };
const principal = { branchId: BRANCH, userId: OWNER, sessionId: SESSION, tokenVersion: 3 };
const startDate = new Date(DATES[0]!);
const endDate = new Date(DATES[3]!);
const plannedSessions = DATES.map((serviceDate, index) => ({
    sessionIndex: index + 1, serviceDate, originalDate: serviceDate, assignmentId: ASSIGNMENT,
    scheduleId: SCHEDULE, employeeId: EMPLOYEE, provenanceVersion: "fixture",
}));

type Row = Record<string, unknown>;
type Operation = OwnerRecordJsonRequest["operations"][number];

function edit(changes: Operation["changes"] = { notes: "corrected" }): Operation {
    return { op: "edit", sessionIndex: 1, serviceDate: DATES[0]!, changes };
}
function fill(index = 2, changes: Operation["changes"] = { notes: "care details" }): Operation {
    return { op: "fill", sessionIndex: index, serviceDate: DATES[index - 1] ?? "2026-09-07", changes };
}
function day(index: number, fields: Row = {}) {
    return {
        id: randomUUID(), branchId: BRANCH, scheduleId: SCHEDULE, serviceRecordCaseId: CASE,
        employeeId: EMPLOYEE, employeeNameSnapshot: "Fixture provider",
        formVersion: 3, caseSessionIndex: index, sessionIndex: index, serviceDate: new Date(DATES[index - 1]!),
        answers: {}, etcService: null, notes: null, paymentConfirmed: false, momApproval: null,
        clientSignature: null, clientSignedAt: null, submittedAt: null, locked: false, ...fields,
    };
}

function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => row[key] === value);
}

function harness() {
    const signed = day(1, {
        answers: { stool_color: "original", breast_count: 1 }, notes: "existing", paymentConfirmed: true,
        locked: true, momApproval: "approved", clientSignature: "fixture-signature",
        clientSignedAt: startDate, submittedAt: startDate,
    });
    const firstCase = {
        id: CASE, branchId: BRANCH, branch: { name: "Fixture branch" }, clientId: CLIENT, version: 7,
        formVersion: 3, status: "IN_PROGRESS", startDate, endDate, requiredSessionCount: DATES.length,
        completedAt: null, finalizationDueAt: null, finalizationStartedAt: null, finalizedAt: null,
        documentsCompletedAt: null, currentRevisionId: null as string | null, currentUsableRevisionId: null,
        currentUsableDocumentVersion: null, momName: null, momBirth: null, babyName: null, babyBirth: null,
        deliveryType: null, babyWeight: null, plannedSessions: [...plannedSessions] as unknown, days: [signed, day(3)],
    };
    let db = {
        cases: [firstCase],
        clients: [
            { id: CLIENT, branchId: BRANCH, startDate, endDate, name: "Fixture client", duration: 4, eDocId: null, serviceStatus: null },
            { id: CLIENT + 1, branchId: BRANCH, startDate, endDate, name: "Fixture other client", duration: 4, eDocId: null, serviceStatus: null },
            { id: CLIENT + 2, branchId: OTHER_BRANCH, startDate, endDate, name: "Fixture other branch", duration: 4, eDocId: null, serviceStatus: null },
        ],
        schedules: [{
            id: SCHEDULE, branchId: BRANCH, clientId: CLIENT, startDate, endDate, primaryEmployeeId: EMPLOYEE,
            secondaryEmployeeId: null, primaryEmployee: { name: "Fixture provider" }, replaced: false, terminatedAt: null,
            serviceRecordAssignment: {
                id: ASSIGNMENT, branchId: BRANCH, serviceRecordCaseId: CASE, startDate, endDate,
                scheduleId: SCHEDULE, employeeId: EMPLOYEE, employeeNameSnapshot: "Fixture provider",
            },
        }],
        drafts: [] as Row[],
        revisions: [] as Row[],
        documentOperations: [] as string[],
    };
    type State = typeof db;
    const controls = {
        authorized: true, legacyCollision: false, failDocumentWrite: false, blockDocument: false,
        expireDuringWrite: false,
        whileWaitingForCaseLock: undefined as ((state: State) => void) | undefined,
    };
    const trace: string[] = [];
    const caseWrite = jest.fn();
    const dayWrite = jest.fn();
    const dayInsert = jest.fn();
    const periodWrite = jest.fn();
    const draftLookup = (data: State, { where }: { where: Row }) => {
        trace.push(where["status"] === "ACTIVE" ? "active-draft" : "draft-by-id");
        return data.drafts.find((row) => matches(row, where)) ?? null;
    };

    // The real repository owns lock acquisition and persistence decisions. This
    // fake provides read-committed state and only publishes a successful transaction.
    let queue: Promise<unknown> = Promise.resolve();
    const prisma = {
        service_record_edit_draft: { findFirst: jest.fn((args) => draftLookup(db, args)) },
        $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => {
            const work = queue.then(async () => {
                const working = structuredClone(db);
                const tx = {
                    $executeRaw: jest.fn(async ({ sql }: Prisma.Sql) => {
                        if (sql.includes("pg_advisory_xact_lock")) trace.push("idempotency-lock");
                        return 1;
                    }),
                    $queryRaw: jest.fn(async ({ sql, values }: Prisma.Sql) => {
                        if (sql.includes('FROM "auth_session"')) {
                            trace.push("owner-recheck");
                            const expired = controls.expireDuringWrite && trace.includes("close-draft");
                            return controls.authorized && !expired && values[2] === BRANCH ? [{ id: SESSION }] : [];
                        }
                        if (sql.includes("IS DISTINCT FROM")) return controls.legacyCollision ? [{ id: "legacy-day" }] : [];
                        if (sql.includes('FROM "service_record_revision_document_state"')) {
                            return controls.blockDocument
                                ? [{ id: randomUUID(), operation: "record_snapshot", status: "pending", step: "pending", lastErrorCode: null }]
                                : [];
                        }
                        if (sql.includes('INSERT INTO "service_record_revision_document_state"')) {
                            trace.push("write-document");
                            if (controls.failDocumentWrite) throw new Error("synthetic document write failure");
                            const [branchId, clientId, serviceRecordCaseId, revisionId, operation, generation, json, inputFingerprint]
                                = values;
                            working.documentOperations.push(String(operation));
                            return [{
                                id: randomUUID(), branchId, clientId, serviceRecordCaseId, revisionId, operation, generation,
                                immutableInput: JSON.parse(String(json)), inputFingerprint,
                                workflowScope: null, outputProof: null, step: values.at(-5), status: values.at(-4),
                                nextAttemptAt: null, version: 1, createdAt: startDate, updatedAt: startDate,
                            }];
                        }
                        const table = sql.match(/FROM "?([a-z_]+)"?/)?.[1];
                        if (table && sql.includes("FOR UPDATE")) trace.push(`lock:${table}`);
                        if (table === "service_record_case") {
                            const concurrentWrite = controls.whileWaitingForCaseLock;
                            if (concurrentWrite) {
                                controls.whileWaitingForCaseLock = undefined;
                                concurrentWrite(db);
                                concurrentWrite(working);
                            }
                            return [{ id: values.includes(OTHER_CASE) ? OTHER_CASE : CASE }];
                        }
                        return [];
                    }),
                    client: {
                        findFirst: jest.fn(async ({ where }) => working.clients.find((row) => matches(row, where)) ?? null),
                        updateMany: periodWrite,
                    },
                    employee: { findMany: jest.fn(async ({ where }) => (where.branchId === BRANCH ? [{ id: EMPLOYEE }] : [])) },
                    employee_schedule: {
                        findMany: jest.fn(async ({ where }) => working.schedules.filter((row) => matches(row, where))),
                        updateMany: periodWrite,
                    },
                    service_record_case: {
                        findFirst: jest.fn(async ({ where }) => working.cases.find((row) => matches(row, where)) ?? null),
                        update: jest.fn(async ({ where, data }) => {
                            caseWrite(data);
                            const row = working.cases.find((item) => matches(item, where))!;
                            Object.assign(row, { ...data, version: row.version + data.version.increment });
                            return { version: row.version };
                        }),
                    },
                    service_record_day: {
                        updateMany: jest.fn(async ({ where, data }) => {
                            dayWrite(data);
                            const row = working.cases.flatMap((item) => item.days).find((item) => matches(item, where));
                            if (!row) return { count: 0 };
                            Object.assign(row, data);
                            return { count: 1 };
                        }),
                        create: jest.fn(async ({ data }) => {
                            dayInsert(data);
                            working.cases.find((item) => item.id === data.serviceRecordCaseId)!.days.push(data);
                            return data;
                        }),
                    },
                    service_record_assignment: { updateMany: periodWrite },
                    service_record_token: { updateMany: periodWrite },
                    eformsign_doc: { findMany: jest.fn(async () => []) },
                    service_record_revision: {
                        findMany: jest.fn(async ({ where }) => working.revisions.filter((row) => where.id.in.includes(row["id"]))),
                        findFirst: jest.fn(async ({ where }) => working.revisions.filter((row) => matches(row, where)).at(-1) ?? null),
                        create: jest.fn(async ({ data }) => {
                            const row = { ...data, id: randomUUID(), confirmedAt: new Date() };
                            working.revisions.push(row);
                            return row;
                        }),
                    },
                    service_record_edit_draft: {
                        findFirst: jest.fn(async (args) => draftLookup(working, args)),
                        create: jest.fn(async ({ data }) => {
                            trace.push("create-draft");
                            const row = { confirmationResponse: null, ...data, createdAt: new Date(), updatedAt: new Date() };
                            working.drafts.push(row);
                            return row;
                        }),
                        updateMany: jest.fn(async ({ where, data }) => {
                            trace.push("close-draft");
                            const row = working.drafts.find((item) => matches(item, where));
                            if (!row) return { count: 0 };
                            Object.assign(row, { ...data, draftVersion: Number(row["draftVersion"]) + data.draftVersion.increment });
                            return { count: 1 };
                        }),
                    },
                };
                const result = await callback(tx);
                db = working;
                trace.push("commit");
                return result;
            });
            queue = work.catch(() => undefined);
            return work;
        }),
    };
    const repository = new ServiceRecordEditRepository(prisma as never);
    const bus = new ServiceRecordCaseEventBus();
    const emit = jest.spyOn(bus, "emit").mockImplementation(() => { trace.push("emit"); });
    const editor = new AdminServiceRecordEditService(repository, createHolidayCalendarStub(), bus);
    async function request(operations: Operation[], idempotencyKey = KEY): Promise<OwnerRecordJsonRequest> {
        const { sourceCaseVersion, sourceFingerprint } = await editor.getDraft(BRANCH, CLIENT);
        trace.length = 0;
        return parseOwnerRecordJsonRequest({
            operations, idempotencyKey, expectedCaseVersion: sourceCaseVersion, expectedSourceFingerprint: sourceFingerprint,
        });
    }
    return { editor, request, controls, trace, emit, caseWrite, dayWrite, dayInsert, periodWrite, get db() { return db; } };
}

describe("owner record JSON contract", () => {
    const valid = {
        expectedCaseVersion: 0, expectedSourceFingerprint: "a".repeat(64), idempotencyKey: KEY, operations: [edit(), fill()],
    };
    it("parses strict targets and valid answer patches", () => {
        expect(parseOwnerRecordJsonTarget({ clientId: String(CLIENT), caseId: CASE })).toEqual(target);
        expect(parseOwnerRecordJsonRequest({ ...valid, operations: [edit({ answers: { stool_color: "yellow" } })] }))
            .toMatchObject({ operations: [{ changes: { answers: { stool_color: "yellow" } } }] });
    });

    it.each([
        { branchId: BRANCH }, { expectedCaseVersion: "0" }, { expectedSourceFingerprint: null }, { operations: [] },
        { operations: Array.from({ length: 101 }, () => edit()) }, { operations: [edit(), edit()] },
        { operations: [edit(), { ...fill(), serviceDate: edit().serviceDate }] },
        { operations: [{ ...edit(), serviceDate: "2026-02-30" }] },
        { operations: [{ ...edit(), serviceDate: "0000-01-01" }] },
        { operations: [{ ...edit(), op: "update" }] },
        { operations: [{ ...edit(), scheduleId: SCHEDULE }] },
        { operations: [{ ...edit(), changes: {} }] },
        ...["header", "paymentConfirmed", "submittedAt", "clientSignature", "status", "serviceDate", "sessionIndex",
            "clientId", "caseId", "requiredSessionCount", "assignmentId"].map((key) => ({
            operations: [{ ...edit(), changes: { notes: "new", [key]: "unexpected" } }],
        })),
        { operations: [edit({ notes: "a".repeat(81) })] },
        { operations: [edit({ notes: "invalid\u0000text" })] },
        { operations: [edit({ answers: { employeeId: 9 } })] },
        { operations: [edit({ answers: { stool_color: { clientId: CLIENT } } })] },
        { operations: [edit({ answers: JSON.parse('{"__proto__":{}}') })] },
    ])("rejects invalid request %#", (partial) => {
        expect(() => parseOwnerRecordJsonRequest({ ...valid, ...partial })).toThrow(BadRequestException);
    });

    it("requires bearer, verified tenant, and global owner in route order", async () => {
        expect(Reflect.getMetadata(GUARDS_METADATA, OwnerRecordJsonController)).toEqual([
            OwnerRecordJsonBearerGuard, JwtGuard, TenantGuard, OwnerGuard,
        ]);
        const req = { headers: {} as { authorization?: string }, cookies: { auth_token: "fixture" },
            user: { role: "owner", userId: OWNER, branchId: BRANCH } };
        const context = { switchToHttp: () => ({ getRequest: () => req }) } as ExecutionContext;
        expect(() => new OwnerRecordJsonBearerGuard().canActivate(context)).toThrow(UnauthorizedException);
        req.headers.authorization = "Bearer malformed";
        expect(() => new OwnerRecordJsonBearerGuard().canActivate(context)).toThrow(UnauthorizedException);
        req.headers.authorization = "Bearer fixture.jwt.token";
        expect(new OwnerRecordJsonBearerGuard().canActivate(context)).toBe(true);
        const tenantGuard = new TenantGuard({
            branch: { findUnique: jest.fn(async () => ({ id: BRANCH, isActive: false })) },
        } as never, new TenantContext());
        await expect(tenantGuard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
        req.user.role = "admin";
        expect(new OwnerGuard().canActivate(context)).toBe(false);
        req.user.role = "owner";
        expect(new OwnerGuard().canActivate(context)).toBe(true);
    });

    it("passes the verified actor and accepts only application/json", async () => {
        const fakeEditor = { confirmOwnerRecordJson: jest.fn() };
        const jwt = new JwtService({ secret: "fixture" });
        const controller = new OwnerRecordJsonController(fakeEditor as never, jwt);
        const req = {
            headers: { authorization: `Bearer ${jwt.sign({ tokenVersion: 3 })}` },
            user: { sessionId: SESSION }, is: jest.fn().mockReturnValue(false),
        } as unknown as Request & { user: { sessionId: string } };
        const tenant = { userId: OWNER, branchId: BRANCH, globalRole: "owner", branchRole: "owner" };
        const params = { clientId: String(CLIENT), caseId: CASE };
        expect(() => controller.writeSessions(tenant, req, params, valid)).toThrow(BadRequestException);
        (req.is as jest.Mock).mockReturnValue("application/json");
        await controller.writeSessions(tenant, req, params, valid);
        expect(fakeEditor.confirmOwnerRecordJson).toHaveBeenCalledWith(principal, target, valid);
    });

    it("verifies the bearer even with a valid cookie and uses the live global role", async () => {
        const jwt = new JwtService({ secret: "fixture-signing-key" });
        const cookieToken = jwt.sign({ sub: OWNER, sid: SESSION, role: "owner", branchId: BRANCH, type: "access", tokenVersion: 3 });
        const storedUser = { tokenVersion: 3, role: "admin", approvalStatus: "approved" };
        const secret = jest.spyOn(jwtSecret, "getJwtSecret").mockReturnValue("fixture-signing-key");
        try {
            new JwtStrategy({ auth_session: { findUnique: jest.fn(async () => ({
                userId: OWNER, selectedBranchId: BRANCH, expiresAt: new Date(Date.now() + 60000), revokedAt: null, user: storedUser,
            })) } } as never);
            const req = { headers: { authorization: "Bearer invalid.jwt.token" }, cookies: { auth_token: cookieToken } };
            const context = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }) } as ExecutionContext;
            const guard = new JwtGuard();
            expect(new OwnerRecordJsonBearerGuard().canActivate(context)).toBe(true);
            await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
            req.headers.authorization = `Bearer ${cookieToken}`;
            await expect(guard.canActivate(context)).resolves.toBe(true);
            expect(new OwnerGuard().canActivate(context)).toBe(false);
            storedUser.role = "owner";
            await expect(guard.canActivate(context)).resolves.toBe(true);
            expect(new OwnerGuard().canActivate(context)).toBe(true);
        } finally {
            secret.mockRestore();
        }
    });
});

describe("owner record JSON confirmation", () => {
    it("commits edit, missing fill, and default placeholder fill in one revision", async () => {
        const h = harness();
        const original = structuredClone(h.db.cases[0]!);
        const req = await h.request([edit({ notes: "corrected", answers: { stool_color: "new" } }), fill(), fill(3)]);
        const result = await h.editor.confirmOwnerRecordJson(principal, target, req);
        expect(result).toMatchObject({
            status: "confirmed", clientId: CLIENT, caseId: CASE, caseVersion: 8, revisionNumber: 1,
            documentStatus: "waiting_for_completion",
        });
        expect(h.caseWrite).toHaveBeenCalledWith({ version: { increment: 1 }, currentRevisionId: result.revisionId });
        expect(h.periodWrite).not.toHaveBeenCalled();
        expect(h.dayWrite).toHaveBeenCalledTimes(2);
        expect(h.dayWrite).toHaveBeenCalledWith({
            notes: "corrected", etcService: null, answers: { stool_color: "new", breast_count: 1 },
        });
        expect(h.dayInsert).toHaveBeenCalledWith(expect.objectContaining({
            branchId: BRANCH, serviceRecordCaseId: CASE, caseSessionIndex: 2, scheduleId: SCHEDULE,
            employeeId: EMPLOYEE, serviceDate: new Date(DATES[1]!), notes: "care details",
            paymentConfirmed: false, momApproval: null, clientSignature: null, clientSignedAt: null,
            locked: false, submittedAt: null,
        }));
        const state = h.db.cases[0]!;
        expect(state).toMatchObject({
            requiredSessionCount: original.requiredSessionCount, startDate, endDate, plannedSessions,
            status: original.status, finalizationDueAt: original.finalizationDueAt,
        });
        expect(state.days[0]).toMatchObject({
            ...original.days[0], notes: "corrected", answers: { stool_color: "new", breast_count: 1 },
        });
        expect(state.days[1]).toMatchObject({ ...original.days[1], notes: "care details" });
        expect(h.db.drafts).toEqual([expect.objectContaining({ status: "CONFIRMED", confirmedByUserId: OWNER })]);
        expect(h.db.revisions).toEqual([expect.objectContaining({ confirmedByUserId: OWNER })]);
        expect(h.db.documentOperations).toContain("record_snapshot");

        const order = ["idempotency-lock", "draft-by-id", "lock:client", "lock:employee", "lock:service_record_case",
            "lock:employee_schedule", "lock:service_record_assignment", "lock:service_record_day",
            "lock:eformsign_doc", "owner-recheck", "active-draft", "create-draft",
            "lock:service_record_edit_draft", "lock:service_record_revision", "write-document", "close-draft", "commit", "emit"];
        expect(h.trace.filter((entry, index, all) => order.includes(entry) && all.indexOf(entry) === index)).toEqual(order);
        expect(h.emit).toHaveBeenCalledWith({ branchId: BRANCH, clientId: CLIENT, caseId: CASE, caseVersion: 8 });
    });

    it.each([edit(), fill(), fill(3)])("commits a single $op at index $sessionIndex", async (operation) => {
        const h = harness();
        const req = await h.request([operation]);
        await expect(h.editor.confirmOwnerRecordJson(principal, target, req)).resolves.toMatchObject({ caseVersion: 8 });
    });

    it.each([
        [{ ...principal, branchId: OTHER_BRANCH }, target],
        [principal, { ...target, clientId: CLIENT + 1 }],
        [principal, { ...target, clientId: CLIENT + 2 }],
        [principal, { ...target, caseId: OTHER_CASE }],
    ])("denies a mismatched branch, client, or case %#", async (actor, resource) => {
        const h = harness();
        const req = await h.request([edit()]);
        await expect(h.editor.confirmOwnerRecordJson(actor, resource, req)).rejects.toBeInstanceOf(NotFoundException);
        expect(h.db.drafts).toHaveLength(0);
    });

    it("checks owner and branch again under the case write locks", async () => {
        const h = harness();
        const req = await h.request([edit()]);
        h.controls.authorized = false;
        await expect(h.editor.confirmOwnerRecordJson(principal, target, req)).rejects.toBeInstanceOf(ForbiddenException);
        expect(h.trace.indexOf("owner-recheck")).toBeGreaterThan(h.trace.indexOf("lock:service_record_day"));
        expect(h.db.drafts).toHaveLength(0);
    });

    it.each([
        [fill(1), ConflictException],
        [{ ...fill(2), op: "edit" } as Operation, ConflictException],
        [{ ...fill(3), op: "edit" } as Operation, ConflictException],
        [{ ...fill(2), serviceDate: "2026-09-08" }, ConflictException],
        [fill(2, { notes: "  ", answers: { stool_color: "   " } }), ConflictException],
        [fill(2, { answers: {} }), ConflictException],
        [edit({ notes: "existing", answers: { stool_color: "original" } }), ConflictException],
        [fill(5), BadRequestException],
    ])("rejects bad or no-op target %# without committing either operation", async (operation, errorType) => {
        const h = harness();
        const req = await h.request([fill(4), operation]);
        await expect(h.editor.confirmOwnerRecordJson(principal, target, req)).rejects.toBeInstanceOf(errorType);
        expect(h.db.drafts).toHaveLength(0);
        expect(h.db.revisions).toHaveLength(0);
        expect(h.dayInsert).not.toHaveBeenCalled();
        expect(h.dayWrite).not.toHaveBeenCalled();
        expect(h.emit).not.toHaveBeenCalled();
    });

    it.each([{ answers: { stool_color: "" } }, { notes: "" }, { clientSignedAt: startDate }, { locked: true }, { momApproval: "approved" }])(
        "treats ambiguous, partial, or submitted placeholders as occupied %#", async (content) => {
            const h = harness();
            Object.assign(h.db.cases[0]!.days[1]!, content);
            await expect(h.editor.confirmOwnerRecordJson(principal, target, await h.request([fill(3)])))
                .rejects.toBeInstanceOf(ConflictException);
        },
    );

    it("allows a legacy edit with authoritative existing dates and rejects creating an inferred slot", async () => {
        const h = harness();
        h.db.cases[0]!.plannedSessions = null;
        await expect(h.editor.confirmOwnerRecordJson(principal, target, await h.request([fill()])))
            .rejects.toBeInstanceOf(ConflictException);
        await expect(h.editor.confirmOwnerRecordJson(principal, target, await h.request([edit()])))
            .resolves.toMatchObject({ caseVersion: 8 });
        expect(h.db.cases[0]!.plannedSessions).toBeNull();
    });

    it.each(["case end", "client end", "assignment", "stored vector"])("rejects %s schedule drift", async (kind) => {
        const h = harness();
        const record = h.db.cases[0]!;
        const shortened = new Date(DATES[2]!);
        if (kind === "case end") record.endDate = shortened;
        if (kind === "client end") h.db.clients[0]!.endDate = shortened;
        if (kind === "assignment") h.db.schedules[0]!.endDate = shortened;
        if (kind === "stored vector") record.plannedSessions = plannedSessions.slice(0, 3);
        const req = await h.request([edit()]);
        await expect(h.editor.confirmOwnerRecordJson(principal, target, req)).rejects.toBeInstanceOf(ConflictException);
        expect(h.db.drafts).toHaveLength(0);
        expect(h.caseWrite).not.toHaveBeenCalled();
    });

    it("rejects legacy collisions and keeps the case's existing active draft intact", async () => {
        const h = harness();
        const req = await h.request([fill()]);
        h.controls.legacyCollision = true;
        await expect(h.editor.confirmOwnerRecordJson(principal, target, req)).rejects.toBeInstanceOf(ConflictException);
        h.controls.legacyCollision = false;
        const existing = { id: randomUUID(), branchId: BRANCH, serviceRecordCaseId: CASE, status: "ACTIVE", changes: { notes: "fixture" } };
        h.db.drafts.push(existing);
        await expect(h.editor.confirmOwnerRecordJson(principal, target, req)).rejects.toBeInstanceOf(ConflictException);
        expect(h.db.drafts).toEqual([existing]);
        expect(h.trace).not.toContain("create-draft");
    });

    it.each([true, false])("rereads version and occupancy after waiting for the case lock %#", async (versionChange) => {
        const h = harness();
        const req = await h.request([fill()]);
        h.controls.whileWaitingForCaseLock = (state) => {
            const record = state.cases[0]!;
            if (versionChange) record.version++;
            else record.days.push(day(2, { notes: "concurrent caregiver save" }));
        };
        await expect(h.editor.confirmOwnerRecordJson(principal, target, req)).rejects.toBeInstanceOf(ConflictException);
        expect(h.db.drafts).toHaveLength(0);
        expect(h.dayInsert).not.toHaveBeenCalled();
    });

    it("returns a single same-key receipt and binds its entire request", async () => {
        const h = harness();
        const req = await h.request([edit({ notes: "corrected", etcService: "done" }), fill()]);
        const same = { ...req, operations: [edit({ etcService: "done", notes: "corrected" }), fill()] };
        const results = await Promise.all([
            h.editor.confirmOwnerRecordJson(principal, target, req),
            h.editor.confirmOwnerRecordJson(principal, target, same),
        ]);
        expect(results[0]).toEqual(results[1]);
        expect(h.db.revisions).toHaveLength(1);
        expect(h.emit).toHaveBeenCalledTimes(1);

        for (const changed of [
            { ...req, operations: [edit({ notes: "different" }), fill()] },
            { ...req, operations: [...req.operations].reverse() },
            { ...req, expectedCaseVersion: req.expectedCaseVersion + 1 },
            { ...req, expectedSourceFingerprint: "c".repeat(64) },
        ]) {
            h.trace.length = 0;
            await expect(h.editor.confirmOwnerRecordJson(principal, target, changed)).rejects.toBeInstanceOf(ConflictException);
            expect(h.trace).toEqual(["idempotency-lock", "draft-by-id"]);
        }
        const other = { ...h.db.cases[0]!, id: OTHER_CASE, clientId: CLIENT + 1, days: [] };
        h.db.cases.push(other);
        await expect(h.editor.confirmOwnerRecordJson(principal, { clientId: other.clientId, caseId: other.id }, req))
            .rejects.toBeInstanceOf(ConflictException);
        await expect(h.editor.confirmOwnerRecordJson({ ...principal, userId: randomUUID() }, target, req))
            .rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects a different key racing for an occupied date", async () => {
        const h = harness();
        const req = await h.request([fill()]);
        const results = await Promise.allSettled([
            h.editor.confirmOwnerRecordJson(principal, target, req),
            h.editor.confirmOwnerRecordJson(principal, target, { ...req, idempotencyKey: OTHER_KEY }),
        ]);
        expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
        expect(h.db.revisions).toHaveLength(1);
        expect(h.dayInsert).toHaveBeenCalledTimes(1);
    });

    it("rolls back day, version, revision, and ephemeral draft if a shared document write fails", async () => {
        const h = harness();
        const req = await h.request([edit(), fill()]);
        const before = structuredClone(h.db);
        h.controls.failDocumentWrite = true;
        await expect(h.editor.confirmOwnerRecordJson(principal, target, req)).rejects.toThrow("synthetic document write failure");
        expect(h.dayWrite).toHaveBeenCalledTimes(1);
        expect(h.dayInsert).toHaveBeenCalledTimes(1);
        expect(h.db).toEqual(before);
        expect(h.emit).not.toHaveBeenCalled();
        h.controls.failDocumentWrite = false;
        await expect(h.editor.confirmOwnerRecordJson(principal, target, req)).resolves.toMatchObject({ caseVersion: 8 });
    });

    it("uses the existing revision document fence before writing sessions", async () => {
        const h = harness();
        const req = await h.request([edit()]);
        h.controls.blockDocument = true;
        await expect(h.editor.confirmOwnerRecordJson(principal, target, req)).rejects.toBeInstanceOf(ConflictException);
        expect(h.db.drafts).toHaveLength(0);
        expect(h.dayWrite).not.toHaveBeenCalled();
    });

    it("rolls back the whole batch if the session expires before commit", async () => {
        const h = harness();
        const req = await h.request([edit(), fill()]);
        const before = structuredClone(h.db);
        h.controls.expireDuringWrite = true;
        await expect(h.editor.confirmOwnerRecordJson(principal, target, req)).rejects.toBeInstanceOf(ForbiddenException);
        expect(h.trace).toContain("close-draft");
        expect(h.db).toEqual(before);
        expect(h.emit).not.toHaveBeenCalled();
    });
});
