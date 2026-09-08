import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordTokenContext } from "application/services/service-record-token.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
    ORIGINAL_THIRTEEN_DATES,
    serviceRecordConfirmBarrier,
    SHIFTED_THIRTEEN_DATES,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

type Fixture = Awaited<ReturnType<typeof createServiceRecordConfirmFixture>>;
type LockHooks = {
    onClientLockAttempt?: () => void;
    onClientLockAcquired?: () => void;
    holdAfterClientLock?: Promise<void>;
};

function queryText(query: unknown): string {
    if (!query || typeof query !== "object") return "";
    const strings = (query as { strings?: unknown }).strings;
    return Array.isArray(strings) ? strings.join(" ").toLowerCase() : "";
}

/**
 * Observe the real lock boundary without replacing any service/repository
 * writer. The callback runs before PostgreSQL is awaited; the acquired hook
 * runs after the row lock has been granted and before the transaction can
 * proceed to its next query.
 */
function wrapTransaction(tx: Prisma.TransactionClient, hooks: LockHooks): Prisma.TransactionClient {
    const queryRaw = tx.$queryRaw as unknown as (...args: unknown[]) => Promise<unknown>;
    let clientLockObserved = false;
    return new Proxy(tx, {
        get(target, property, receiver) {
            if (property === "$queryRaw") {
                return async (...args: unknown[]) => {
                    const text = queryText(args[0]);
                    const clientLock = !clientLockObserved
                        && text.includes('from "client"')
                        && text.includes("for update");
                    if (clientLock) {
                        clientLockObserved = true;
                        hooks.onClientLockAttempt?.();
                    }
                    const result = await queryRaw(...args);
                    if (clientLock) {
                        hooks.onClientLockAcquired?.();
                        if (hooks.holdAfterClientLock) await hooks.holdAfterClientLock;
                    }
                    return result;
                };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

function instrumentPrisma(prisma: PrismaClient, hooks: LockHooks = {}): PrismaClient {
    const transaction = prisma.$transaction.bind(prisma);
    return new Proxy(prisma, {
        get(target, property, receiver) {
            if (property === "$transaction") {
                return (
                    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
                    options?: unknown,
                ) => transaction(
                    async (tx) => callback(wrapTransaction(tx, hooks)),
                    options as never,
                );
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

function adminService(prisma: PrismaClient): AdminServiceRecordEditService {
    return new AdminServiceRecordEditService(
        new ServiceRecordEditRepository(prisma as unknown as PrismaService),
    );
}

function providerService(prisma: PrismaClient): ServiceRecordEntryService {
    return new ServiceRecordEntryService(
        prisma as unknown as PrismaService,
        { extendExpiryForCase: async () => undefined } as never,
        new ServiceRecordLifecycleService(prisma as unknown as PrismaService),
    );
}

function providerContext(fixture: Fixture): ServiceRecordTokenContext {
    return {
        tokenId: `task4-provider-race-${randomUUID()}`,
        branchId: fixture.branch.id,
        scheduleId: fixture.schedule.id,
        employeeId: fixture.employee.id,
        serviceRecordCaseId: fixture.record.id,
    };
}

async function prepareDraft(
    prisma: PrismaClient,
    fixture: Fixture,
): Promise<{
    draft: NonNullable<Awaited<ReturnType<AdminServiceRecordEditService["startDraft"]>>["draft"]>;
    request: {
        expectedDraftVersion: number;
        previewId: string;
        idempotencyKey: string;
    };
}> {
    const service = adminService(prisma);
    const started = await service.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
    const initial = started.draft;
    if (!initial) throw new Error("Fixture draft was not created");
    const changed = await service.updateDraft(fixture.branch.id, initial.id, fixture.actorUserId, {
        expectedDraftVersion: initial.draftVersion,
        changes: { sessions: [{ sessionIndex: 3, notes: "Confirmed content" }] },
        dateMove: { sessionIndex: 3, toDate: "2026-09-11" },
    });
    const draft = changed.draft;
    if (!draft) throw new Error("Fixture draft update was not persisted");
    const preview = await service.previewDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
        expectedDraftVersion: draft.draftVersion,
    });
    expect(preview.blockingReasons).toEqual([]);
    return {
        draft,
        request: {
            expectedDraftVersion: draft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: randomUUID(),
        },
    };
}

function conflictCode(error: unknown): unknown {
    if (!(error instanceof ConflictException)) return undefined;
    const response = error.getResponse();
    return typeof response === "object" && response !== null && "code" in response
        ? (response as { code?: unknown }).code
        : undefined;
}

async function readCaseState(prisma: PrismaClient, fixture: Fixture) {
    const [client, record, schedule, assignment, days, revisions, draft] = await Promise.all([
        prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }),
        prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }),
        prisma.employee_schedule.findUniqueOrThrow({ where: { id: fixture.schedule.id } }),
        prisma.service_record_assignment.findUniqueOrThrow({ where: { id: fixture.assignment.id } }),
        prisma.service_record_day.findMany({
            where: { serviceRecordCaseId: fixture.record.id },
            orderBy: { caseSessionIndex: "asc" },
        }),
        prisma.service_record_revision.findMany({
            where: { serviceRecordCaseId: fixture.record.id },
            orderBy: { revisionNumber: "asc" },
        }),
        prisma.service_record_edit_draft.findFirstOrThrow({
            where: { serviceRecordCaseId: fixture.record.id },
            orderBy: { createdAt: "desc" },
        }),
    ]);
    return { client, record, schedule, assignment, days, revisions, draft };
}

describeE2E("service-record confirmation/provider lock races (real disposable PostgreSQL)", () => {
    let prisma: PrismaClient;
    const testClients: PrismaClient[] = [];

    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
    });

    afterEach(async () => {
        await Promise.all(testClients.splice(0).map((client) => client.$disconnect()));
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    async function openRaceClients(): Promise<{ confirm: PrismaClient; provider: PrismaClient }> {
        const confirm = createApprovedServiceRecordConfirmClient();
        const provider = createApprovedServiceRecordConfirmClient();
        testClients.push(confirm, provider);
        await Promise.all([confirm.$connect(), provider.$connect()]);
        return { confirm, provider };
    }

    it("lets admin confirmation win, rejects stale provider input, then accepts refreshed input", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const prepared = await prepareDraft(prisma, fixture);
        const { confirm, provider } = await openRaceClients();
        const confirmAcquired = serviceRecordConfirmBarrier();
        const confirmHold = serviceRecordConfirmBarrier();
        const providerAttempt = serviceRecordConfirmBarrier();
        let confirmReleased = false;
        let providerAttemptedBeforeConfirmRelease = false;
        let confirmPromise: Promise<unknown> | undefined;
        let providerPromise: Promise<unknown> | undefined;

        try {
            const confirmDb = instrumentPrisma(confirm, {
                onClientLockAcquired: () => confirmAcquired.release(),
                holdAfterClientLock: confirmHold.entered,
            });
            const providerDb = instrumentPrisma(provider, {
                onClientLockAttempt: () => {
                    providerAttemptedBeforeConfirmRelease = !confirmReleased;
                    providerAttempt.release();
                },
            });

            confirmPromise = adminService(confirmDb).confirmDraft(
                fixture.branch.id,
                prepared.draft.id,
                fixture.actorUserId,
                prepared.request,
            );
            await confirmAcquired.entered;

            providerPromise = providerService(providerDb).upsertSession(
                providerContext(fixture),
                4,
                { serviceDate: "2026-09-10", notes: "stale provider" },
                false,
            );
            await providerAttempt.entered;
            expect(providerAttemptedBeforeConfirmRelease).toBe(true);

            confirmReleased = true;
            confirmHold.release();
            await expect(confirmPromise).resolves.toMatchObject({
                status: "confirmed",
                caseId: fixture.record.id,
                clientId: fixture.client.id,
            });
            const staleProviderError = await providerPromise.then(() => undefined, (error) => error);
            expect(staleProviderError).toBeInstanceOf(ConflictException);
            expect(conflictCode(staleProviderError)).toBe("SERVICE_RECORD_PLANNED_DATE_STALE");

            const beforeRefresh = await readCaseState(prisma, fixture);
            expect(beforeRefresh.days).toHaveLength(3);
            expect(beforeRefresh.days.map((day) => day.serviceDate.toISOString().slice(0, 10)))
                .toEqual(SHIFTED_THIRTEEN_DATES.slice(0, 3));
            expect(beforeRefresh.days[2]?.notes).toBe("Confirmed content");
            expect(beforeRefresh.client.endDate).toEqual(d("2026-09-29"));
            expect(beforeRefresh.record.endDate).toEqual(d("2026-09-29"));
            expect(beforeRefresh.schedule.endDate).toEqual(d("2026-09-29"));
            expect(beforeRefresh.assignment.endDate).toEqual(d("2026-09-29"));
            expect(beforeRefresh.revisions).toHaveLength(1);
            expect(beforeRefresh.draft.status).toBe("CONFIRMED");

            const refreshed = await providerService(provider).upsertSession(
                providerContext(fixture),
                4,
                { serviceDate: "2026-09-14", notes: "refreshed provider" },
                false,
            );
            expect(refreshed).toMatchObject({
                caseSessionIndex: 4,
                notes: "refreshed provider",
                locked: false,
            });

            const afterRefresh = await readCaseState(prisma, fixture);
            expect(afterRefresh.days).toHaveLength(4);
            expect(afterRefresh.days[3]?.serviceDate).toEqual(d("2026-09-14"));
            expect(afterRefresh.days[3]?.notes).toBe("refreshed provider");
            expect(afterRefresh.record.endDate).toEqual(d("2026-09-29"));
            expect(afterRefresh.revisions).toHaveLength(1);
            expect(afterRefresh.revisions[0]?.id).toBe(beforeRefresh.revisions[0]?.id);
        } finally {
            confirmHold.release();
            await Promise.all([
                ...(confirmPromise ? [confirmPromise] : []),
                ...(providerPromise ? [providerPromise] : []),
            ].map((promise) => promise.then(() => undefined, () => undefined)));
        }
    });

    it("lets a provider write win, then rejects the stale admin confirmation without period damage", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const prepared = await prepareDraft(prisma, fixture);
        const { confirm, provider } = await openRaceClients();
        const providerAcquired = serviceRecordConfirmBarrier();
        const providerHold = serviceRecordConfirmBarrier();
        const confirmAttempt = serviceRecordConfirmBarrier();
        let confirmAttemptedBeforeProviderRelease = false;
        let confirmPromise: Promise<unknown> | undefined;
        let providerPromise: Promise<unknown> | undefined;

        try {
            const providerDb = instrumentPrisma(provider, {
                onClientLockAcquired: () => providerAcquired.release(),
                holdAfterClientLock: providerHold.entered,
            });
            const confirmDb = instrumentPrisma(confirm, {
                onClientLockAttempt: () => {
                    confirmAttemptedBeforeProviderRelease = true;
                    confirmAttempt.release();
                },
            });

            providerPromise = providerService(providerDb).upsertSession(
                providerContext(fixture),
                4,
                { serviceDate: "2026-09-10", notes: "provider wins" },
                false,
            );
            await providerAcquired.entered;

            confirmPromise = adminService(confirmDb).confirmDraft(
                fixture.branch.id,
                prepared.draft.id,
                fixture.actorUserId,
                prepared.request,
            );
            await confirmAttempt.entered;
            expect(confirmAttemptedBeforeProviderRelease).toBe(true);
            providerHold.release();

            await expect(providerPromise).resolves.toMatchObject({
                caseSessionIndex: 4,
                serviceDate: d("2026-09-10"),
                notes: "provider wins",
                locked: false,
            });
            const staleConfirmError = await confirmPromise.then(() => undefined, (error) => error);
            expect(staleConfirmError).toBeInstanceOf(ConflictException);
            expect(conflictCode(staleConfirmError)).toBe("SERVICE_RECORD_SOURCE_CHANGED");

            const state = await readCaseState(prisma, fixture);
            expect(state.days).toHaveLength(4);
            expect(state.days.map((day) => day.serviceDate.toISOString().slice(0, 10)))
                .toEqual([...ORIGINAL_THIRTEEN_DATES.slice(0, 3), "2026-09-10"]);
            expect(state.days[3]?.notes).toBe("provider wins");
            expect(state.client.endDate).toEqual(d("2026-09-23"));
            expect(state.record.endDate).toEqual(d("2026-09-23"));
            expect(state.schedule.endDate).toEqual(d("2026-09-23"));
            expect(state.assignment.endDate).toEqual(d("2026-09-23"));
            expect(state.revisions).toHaveLength(0);
            expect(state.draft.status).toBe("ACTIVE");
            expect(state.draft.draftVersion).toBe(prepared.draft.draftVersion);
        } finally {
            providerHold.release();
            await Promise.all([
                ...(confirmPromise ? [confirmPromise] : []),
                ...(providerPromise ? [providerPromise] : []),
            ].map((promise) => promise.then(() => undefined, () => undefined)));
        }
    });
});
