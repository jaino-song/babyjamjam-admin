import { Prisma, PrismaClient } from "@prisma/client";

import { ClientService } from "application/services/client.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { LinkMirroredEformsignDocByPhoneUsecase } from "application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import type { HolidayCalendarService } from "application/services/holiday-calendar.service";

/**
 * Real-PostgreSQL regression for BJJ-439 (merge-audit F1): the locked completion fences must
 * refuse a document that was voided AFTER the writer's genuine unlocked document read and BEFORE
 * the writer took its client and document row locks. Each refusal case instruments the writer's
 * transaction client, lets the unchanged writer run through its own unlocked read (which sees a
 * not-voided document), and pauses it right before its first `FOR UPDATE` on `client`. While it is
 * paused (it holds no lock yet) the void commits through `markVoided` on a separate connection;
 * then the writer resumes. A void check made earlier in the transaction therefore cannot satisfy
 * these cases; only a `voided_at IS NULL` predicate evaluated under the lock can. Since
 * merge-audit round 3 `markVoided` takes the owning client's row lock first, so a void can no
 * longer land while a client-first writer holds that lock: the paired cases pause the writer
 * WHILE it holds the client lock, start the void without awaiting it, prove from
 * `pg_stat_activity` that the void is queued behind the writer, and assert that it commits after
 * the writer. The second `describe` (BJJ-439 D3, merge-audit round 2) is NOT race-instrumented: it
 * wires the real `LinkMirroredEformsignDocByPhoneUsecase` and `ClientService` over the same
 * database and proves a voided newest contract keeps ANY phone-link path from promoting an older
 * contract. The third (round 3) races a void of a newer contract against the pointer writers and
 * asserts the event order. Skipped unless HOLIDAY_REVIEW_REAL_DB=1, and then only against a local
 * throwaway database:
 *
 *   createdb throwaway_vf && export DATABASE_URL=postgresql://<user>@localhost/throwaway_vf DIRECT_URL=$DATABASE_URL
 *   npx prisma migrate deploy && HOLIDAY_REVIEW_REAL_DB=1 npx jest test/prisma/eformsign-void-fences.real-db.spec.ts
 */
const ENABLED = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1";
const describeReal = ENABLED ? describe : describe.skip;

// Same guard as holiday-review.real-db.spec.ts (a spec cannot be imported without running it).
const THROWAWAY_URL = /^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/;
function assertThrowawayTarget(): void {
    const url = process.env["DATABASE_URL"];
    if (!url || url !== process.env["DIRECT_URL"] || !THROWAWAY_URL.test(url)) {
        throw new Error("Refusing real-DB spec: DATABASE_URL and DIRECT_URL must be the same local throwaway database");
    }
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ACTOR = "22222222-2222-4222-8222-222222222222";

// `FROM eformsign_doc` / `FROM "eformsign_doc"`, but not `eformsign_doc_file`.
const DOCUMENT_TABLE = /FROM\s+"?eformsign_doc"?(?![A-Za-z0-9_])/i;
const ROW_LOCK = /FOR\s+UPDATE/i;
const CLIENT_TABLE = /FROM\s+"?client"?(?![A-Za-z0-9_])/i;
/** The statement a void is waiting on when it queues behind a writer's client row lock. */
const CLIENT_LOCK_STATEMENT = /FROM\s+"?client"?(?![A-Za-z0-9_])[\s\S]*FOR\s+UPDATE/i;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Raw SQL arrives as a Prisma `Sql` object, whose `.sql` is the statement text. */
const sqlOf = (query: unknown): string => {
    const sql = (query as { sql?: unknown } | null)?.sql;
    return typeof sql === "string" ? sql : "";
};

/**
 * Proves, from the database's own state, that some backend is queued on a heavyweight lock in a
 * statement matching `statement`. A void that is merely slow proves nothing; this does. Bounded,
 * so a deadlock fails the test instead of hanging it.
 */
async function waitUntilBlocked(raw: PrismaClient, statement: RegExp, timeoutMs = 3_500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let waiting: string[] = [];
    for (;;) {
        const rows = await raw.$queryRaw<Array<{ query: string }>>(Prisma.sql`
            SELECT query
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
        `);
        waiting = rows.map((row) => row.query);
        if (waiting.some((query) => statement.test(query))) return;
        if (Date.now() > deadline) {
            throw new Error(`no backend was blocked on ${statement}; waiting statements: ${JSON.stringify(waiting)}`);
        }
        await sleep(20);
    }
}

/** Rejects (and clears its timer) instead of waiting forever for `promise`. */
async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/** Every named event happened, in exactly this relative order. */
function expectInOrder(events: readonly string[], expected: readonly string[]): void {
    const positions = expected.map((name) => events.indexOf(name));
    expect({ events, missing: expected.filter((_, index) => positions[index] === -1) })
        .toEqual({ events, missing: [] });
    expect({ events, positions }).toEqual({
        events,
        positions: [...positions].sort((left, right) => left - right),
    });
}

describeReal("voided contract fences under the document row lock (real PostgreSQL)", () => {
    let raw: PrismaClient;
    let repository: SbEformsignDocRepository;
    let branchId: string;
    let sequence = 0;

    beforeAll(async () => {
        assertThrowawayTarget();
        raw = new PrismaClient();
        await raw.$connect();
        branchId = (await raw.branch.create({
            data: { name: "void fences", slug: `throwaway-void-fences-${Date.now().toString(36)}` },
        })).id;
        repository = new SbEformsignDocRepository(raw as unknown as PrismaService);
    });

    afterAll(async () => {
        await raw.service_record_case.deleteMany({ where: { branchId } });
        await raw.client.deleteMany({ where: { branchId } });
        await raw.eformsign_doc.deleteMany({ where: { branchId } });
        await raw.branch.deleteMany({ where: { id: branchId } });
        await raw.$disconnect();
    });

    async function makeClient(eDocId: string | null) {
        return raw.client.create({
            data: {
                name: `void-fence-${++sequence}`,
                voucherClient: false,
                branchId,
                startDate: d("2026-10-01"),
                endDate: d("2026-10-16"),
                duration: 12,
                eDocId,
            },
        });
    }

    async function makeDocument(
        label: string,
        clientId: number,
        overrides: { updatedDate?: Date; voided?: boolean; ready?: boolean } = {},
    ) {
        const documentId = `void-fence-${label}-${++sequence}-${Date.now().toString(36)}`;
        const updatedDate = overrides.updatedDate ?? new Date("2026-10-10T00:00:00.000Z");
        const row = await raw.eformsign_doc.create({
            data: {
                documentId,
                createdDate: updatedDate,
                updatedDate,
                statusType: "050",
                statusDetail: "Complete",
                stepType: "reviewer",
                stepIndex: "1",
                stepName: "reviewer",
                stepRecipientType: "client",
                stepRecipientName: "Fixture",
                stepRecipientSms: "01000000000",
                expiredDate: new Date("2099-01-01T00:00:00.000Z"),
                clientId,
                branchId,
                documentKind: "contract",
                ...(overrides.voided ? { voidedAt: new Date("2026-10-11T00:00:00.000Z"), voidedBy: ACTOR } : {}),
                ...(overrides.ready
                    ? {
                        syncStatus: "ready",
                        detailSourceUpdatedDate: new Date("2026-10-10T01:00:00.000Z"),
                        detailSyncedAt: new Date("2026-10-10T01:01:00.000Z"),
                    }
                    : {}),
            },
        });
        if (overrides.ready) {
            for (const fileType of ["document", "audit_trail"]) {
                await raw.eformsign_doc_file.create({
                    data: {
                        eformsignDocId: row.id,
                        fileType,
                        content: Buffer.from("x"),
                        contentType: "application/pdf",
                        byteSize: 1,
                        sha256: "0".repeat(64),
                        sourceUpdatedDate: new Date("2026-10-10T01:00:00.000Z"),
                    },
                });
            }
        }
        return { id: row.id, documentId };
    }

    type VoidTiming = "writer-holds-client-lock" | "before-writer-locks-client";

    /**
     * Runs `writer` against a Prisma whose transaction client is instrumented, and commits a void of
     * `documentId` (through the production `markVoided`, on its own connection) at one of two moments
     * of the writer's own transaction. The writer first runs its genuine unlocked document read
     * (recorded as UNLOCKED_DOCUMENT_READ once a row is found).
     *
     * - `before-writer-locks-client`: the writer is held right before its first `FOR UPDATE` on
     *   `client`. It holds no client lock yet, so the void is awaited to its commit inside the pause
     *   (VOID_COMMITTED). The writer then takes the client and document locks and must refuse the
     *   voided document through the `voided_at IS NULL` predicate under the lock.
     * - `writer-holds-client-lock`: the writer is held right before its first locked read of
     *   `eformsign_doc`, i.e. while it already holds the client row lock. The void is started
     *   WITHOUT being awaited (a void awaited here could never finish: it needs the lock the writer
     *   is paused holding), and the pause only ends once the void is proven to be waiting on that
     *   lock in `pg_stat_activity` (VOID_BLOCKED). The writer then runs to its commit
     *   (WRITER_COMMITTED) and the void lands after it (VOID_COMMITTED).
     *
     * No timers decide the order: the wait is a bounded poll of the database's own lock state.
     */
    async function raceVoid<T>(
        documentId: string,
        timing: VoidTiming,
        writer: (instrumented: PrismaService) => Promise<T>,
    ): Promise<{ result: T; events: string[] }> {
        const events: string[] = [];
        let paused = false;
        let voiding: Promise<boolean> | undefined;

        const startVoid = () =>
            repository.markVoided(branchId, documentId, new Date(), ACTOR).then((voided) => {
                events.push("VOID_COMMITTED");
                return voided;
            });

        const pause = async (marker: string) => {
            paused = true;
            expect(events).toContain("UNLOCKED_DOCUMENT_READ");
            // Nothing else writes this fixture, so a not-voided row here is exactly what the
            // writer's earlier unlocked read observed.
            const before = await raw.eformsign_doc.findUniqueOrThrow({ where: { documentId } });
            expect(before.voidedAt).toBeNull();
            if (timing === "before-writer-locks-client") {
                await expect(startVoid()).resolves.toBe(true);
            } else {
                // A writer that is not client-first would make this whole scenario vacuous.
                expect(events).toContain("CLIENT_LOCKED");
                events.push("VOID_STARTED");
                voiding = startVoid();
                await waitUntilBlocked(raw, CLIENT_LOCK_STATEMENT);
                events.push("VOID_BLOCKED");
            }
            events.push(marker);
        };

        const instrumentTransaction = (tx: Prisma.TransactionClient): Prisma.TransactionClient =>
            new Proxy(tx, {
                get(target, key) {
                    if (key === "$queryRaw") {
                        return async (...args: unknown[]) => {
                            const text = sqlOf(args[0]);
                            const readsDocument = DOCUMENT_TABLE.test(text);
                            const readsClient = CLIENT_TABLE.test(text);
                            const locks = ROW_LOCK.test(text);
                            if (!paused && timing === "before-writer-locks-client" && readsClient && locks) {
                                await pause("CLIENT_LOCK_QUERY");
                            } else if (!paused && timing === "writer-holds-client-lock" && readsDocument && locks) {
                                await pause("LOCKED_DOCUMENT_QUERY");
                            }
                            const rows = await (target.$queryRaw as (...inner: unknown[]) => Promise<unknown>)
                                .apply(target, args);
                            if (readsClient && locks && Array.isArray(rows) && rows.length > 0 && !paused) {
                                events.push("CLIENT_LOCKED");
                            }
                            if (readsDocument && !locks && Array.isArray(rows) && rows.length > 0 && !paused) {
                                events.push("UNLOCKED_DOCUMENT_READ");
                            }
                            return rows;
                        };
                    }
                    if (key === "eformsign_doc") {
                        const delegate = Reflect.get(target, key, target) as unknown as Record<string, unknown>;
                        return new Proxy(delegate, {
                            get(inner, method) {
                                const value = Reflect.get(inner, method, inner);
                                if (method !== "findFirst" || typeof value !== "function") {
                                    return typeof value === "function" ? value.bind(inner) : value;
                                }
                                return async (...args: unknown[]) => {
                                    const row = await (value as (...inner: unknown[]) => Promise<unknown>)
                                        .apply(inner, args);
                                    if (row && !paused) events.push("UNLOCKED_DOCUMENT_READ");
                                    return row;
                                };
                            },
                        });
                    }
                    const value = Reflect.get(target, key, target);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            });

        const instrumented = new Proxy(raw, {
            get(target, key) {
                if (key === "$transaction") {
                    return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, ...rest: unknown[]) => {
                        const wasPaused = paused;
                        const outcome = await (target.$transaction as (...inner: unknown[]) => Promise<unknown>)(
                            (tx: Prisma.TransactionClient) => callback(instrumentTransaction(tx)),
                            ...rest,
                        );
                        if (paused && !wasPaused) events.push("WRITER_COMMITTED");
                        return outcome;
                    };
                }
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        }) as unknown as PrismaService;

        let result: T;
        try {
            result = await writer(instrumented);
        } finally {
            // Never leave a blocked void behind for the next case to trip over.
            await voiding?.catch(() => undefined);
        }
        if (voiding) await expect(voiding).resolves.toBe(true);

        // The void is committed only inside or after the pause, so a writer that never reached
        // its pause point would otherwise pass vacuously.
        expect(paused).toBe(true);
        expectInOrder(
            events,
            timing === "before-writer-locks-client"
                ? ["UNLOCKED_DOCUMENT_READ", "VOID_COMMITTED", "CLIENT_LOCK_QUERY"]
                : [
                    "UNLOCKED_DOCUMENT_READ", "CLIENT_LOCKED", "VOID_STARTED", "VOID_BLOCKED",
                    "LOCKED_DOCUMENT_QUERY", "WRITER_COMMITTED", "VOID_COMMITTED",
                ],
        );
        return { result, events };
    }

    const calendar = { forBranch: async () => KR_BUILTIN_CALENDAR } as unknown as HolidayCalendarService;
    const lifecycleFor = (prisma: PrismaService) => new ServiceRecordLifecycleService(prisma, calendar);

    async function clientRow(id: number) {
        return raw.client.findUniqueOrThrow({ where: { id } });
    }

    async function voidedRow(documentId: string) {
        const row = await raw.eformsign_doc.findUniqueOrThrow({ where: { documentId } });
        expect(row.voidedAt).not.toBeNull();
        expect(row.voidedBy).toBe(ACTOR);
    }

    it("linkClientIfActive writes no pointer for a document voided after the unlocked read and before the client lock, and records the void", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("link", client.id);

        const { result: linked } = await raceVoid(documentId, "before-writer-locks-client", (suspended) =>
            new SbEformsignDocRepository(suspended).linkClientIfActive(branchId, documentId, client.id));

        expect(linked).toBe(false);
        expect((await clientRow(client.id)).eDocId).toBeNull();
        await voidedRow(documentId);
    });

    it("linkClientIfActive: a void that arrives while the link holds the client lock waits for it and lands after the pointer write", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("link-held", client.id);

        const { result: linked } = await raceVoid(documentId, "writer-holds-client-lock", (suspended) =>
            new SbEformsignDocRepository(suspended).linkClientIfActive(branchId, documentId, client.id));

        // The link was serialised before the void, so it saw an unvoided document and linked it;
        // the void then recorded itself on the pointed document (markVoided never clears the pointer).
        expect(linked).toBe(true);
        expect((await clientRow(client.id)).eDocId).toBe(documentId);
        await voidedRow(documentId);
    });

    it("linkClientIfActive still links a document that is not voided", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("link-ok", client.id);

        await expect(repository.linkClientIfActive(branchId, documentId, client.id)).resolves.toBe(true);
        expect((await clientRow(client.id)).eDocId).toBe(documentId);
    });

    it("a newer contract still relinks when the client's pointer is a voided document", async () => {
        const client = await makeClient(null);
        const older = await makeDocument("older", client.id, {
            updatedDate: new Date("2026-10-01T00:00:00.000Z"),
            voided: true,
        });
        await raw.client.update({ where: { id: client.id }, data: { eDocId: older.documentId } });
        const newer = await makeDocument("newer", client.id, { updatedDate: new Date("2026-10-12T00:00:00.000Z") });

        await expect(repository.linkClientIfActive(branchId, newer.documentId, client.id)).resolves.toBe(true);
        expect((await clientRow(client.id)).eDocId).toBe(newer.documentId);
        // An older document still loses the newer-than comparison against the voided pointer.
        const stale = await makeDocument("stale", client.id, { updatedDate: new Date("2026-09-01T00:00:00.000Z") });
        await expect(repository.linkClientIfActive(branchId, stale.documentId, client.id)).resolves.toBe(false);
        expect((await clientRow(client.id)).eDocId).toBe(newer.documentId);
    });

    it("isCurrentContractDocument is false for a document voided after the unlocked read and before the client lock, true otherwise", async () => {
        const voidedClient = await makeClient(null);
        const voided = await makeDocument("current-voided", voidedClient.id);
        await raw.client.update({ where: { id: voidedClient.id }, data: { eDocId: voided.documentId } });

        const { result: voidedAnswer } = await raceVoid(voided.documentId, "before-writer-locks-client", (suspended) =>
            new SbEformsignDocRepository(suspended).isCurrentContractDocument(branchId, voided.documentId));
        expect(voidedAnswer).toBe(false);
        await voidedRow(voided.documentId);

        const liveClient = await makeClient(null);
        const live = await makeDocument("current-live", liveClient.id);
        await raw.client.update({ where: { id: liveClient.id }, data: { eDocId: live.documentId } });
        await expect(repository.isCurrentContractDocument(branchId, live.documentId)).resolves.toBe(true);
    });

    it("isCurrentContractDocument: a void that arrives while the check holds the client lock waits for it and lands after the answer", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("current-held", client.id);
        await raw.client.update({ where: { id: client.id }, data: { eDocId: documentId } });

        const { result: answer } = await raceVoid(documentId, "writer-holds-client-lock", (suspended) =>
            new SbEformsignDocRepository(suspended).isCurrentContractDocument(branchId, documentId));

        expect(answer).toBe(true);
        await voidedRow(documentId);
    });

    it("syncEndDateFromCurrentContract moves no end date for a document voided after the unlocked read and before the client lock", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("sync-current", client.id);
        await raw.client.update({ where: { id: client.id }, data: { eDocId: documentId } });

        const { result: applied } = await raceVoid(documentId, "before-writer-locks-client", (suspended) =>
            lifecycleFor(suspended).syncEndDateFromCurrentContract({
                branchId,
                clientId: client.id,
                documentId,
                endDate: d("2026-10-30"),
            }));

        expect(applied).toBe(false);
        expect((await clientRow(client.id)).endDate).toEqual(d("2026-10-16"));
        await voidedRow(documentId);
    });

    it("syncEndDateFromCurrentContract: a void that arrives while the sync holds the client lock waits for it and lands after the end-date write", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("sync-current-held", client.id);
        await raw.client.update({ where: { id: client.id }, data: { eDocId: documentId } });

        const { result: applied } = await raceVoid(documentId, "writer-holds-client-lock", (suspended) =>
            lifecycleFor(suspended).syncEndDateFromCurrentContract({
                branchId,
                clientId: client.id,
                documentId,
                endDate: d("2026-10-30"),
            }));

        expect(applied).toBe(true);
        expect((await clientRow(client.id)).endDate).toEqual(d("2026-10-30"));
        await voidedRow(documentId);
    });

    it("syncEndDateFromCurrentContract still moves the end date for a document that is not voided", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("sync-current-ok", client.id);
        await raw.client.update({ where: { id: client.id }, data: { eDocId: documentId } });

        await expect(lifecycleFor(raw as unknown as PrismaService).syncEndDateFromCurrentContract({
            branchId,
            clientId: client.id,
            documentId,
            endDate: d("2026-10-30"),
        })).resolves.toBe(true);
        expect((await clientRow(client.id)).endDate).toEqual(d("2026-10-30"));
    });

    const mirroredSync = (clientId: number, documentId: string) => ({
        branchId,
        clientId,
        documentId,
        endDate: d("2026-10-30"),
        detailSourceUpdatedDate: new Date("2026-10-10T01:00:00.000Z"),
        detailSyncedAt: new Date("2026-10-10T01:01:00.000Z"),
    });

    it("syncEndDateFromMirroredContract moves no end date for a ready mirror voided after the unlocked read and before the client lock", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("sync-mirror", client.id, { ready: true });
        await raw.client.update({ where: { id: client.id }, data: { eDocId: documentId } });

        const { result: applied } = await raceVoid(documentId, "before-writer-locks-client", (suspended) =>
            lifecycleFor(suspended).syncEndDateFromMirroredContract(mirroredSync(client.id, documentId)));

        expect(applied).toBe(false);
        expect((await clientRow(client.id)).endDate).toEqual(d("2026-10-16"));
        await voidedRow(documentId);
    });

    it("syncEndDateFromMirroredContract: a void that arrives while the sync holds the client lock waits for it and lands after the end-date write", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("sync-mirror-held", client.id, { ready: true });
        await raw.client.update({ where: { id: client.id }, data: { eDocId: documentId } });

        const { result: applied } = await raceVoid(documentId, "writer-holds-client-lock", (suspended) =>
            lifecycleFor(suspended).syncEndDateFromMirroredContract(mirroredSync(client.id, documentId)));

        expect(applied).toBe(true);
        expect((await clientRow(client.id)).endDate).toEqual(d("2026-10-30"));
        await voidedRow(documentId);
    });

    it("syncEndDateFromMirroredContract still moves the end date for a ready mirror that is not voided", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("sync-mirror-ok", client.id, { ready: true });
        await raw.client.update({ where: { id: client.id }, data: { eDocId: documentId } });

        await expect(lifecycleFor(raw as unknown as PrismaService).syncEndDateFromMirroredContract(
            mirroredSync(client.id, documentId),
        )).resolves.toBe(true);
        expect((await clientRow(client.id)).endDate).toEqual(d("2026-10-30"));
    });
});

/**
 * BJJ-439 D3 (merge-audit round 2): once a client's newest contract document is voided, the
 * client has no live contract, so no phone-link path may point `client.e_doc_id` at an OLDER
 * document; a contract created AFTER the voided one still takes the pointer. Real
 * `LinkMirroredEformsignDocByPhoneUsecase` and `ClientService` over the real database; only the
 * non-database collaborators (calendar, config, snapshot bumps) are stubbed. Not race-instrumented.
 */
describeReal("a voided newest contract keeps phone links from promoting an older contract (real PostgreSQL)", () => {
    let raw: PrismaClient;
    let branchId: string;
    let service: ClientService;
    let sequence = 0;

    const calendar = { forBranch: async () => KR_BUILTIN_CALENDAR } as unknown as HolidayCalendarService;

    beforeAll(async () => {
        assertThrowawayTarget();
        raw = new PrismaClient();
        await raw.$connect();
        branchId = (await raw.branch.create({
            data: { name: "d3 phone link", slug: `throwaway-d3-phone-link-${Date.now().toString(36)}` },
        })).id;
        const prisma = raw as unknown as PrismaService;
        const config = { get: () => undefined };
        const snapshots = { bumpVersion: async () => undefined, bumpCompanyEpoch: async () => undefined };
        const readClient = {
            execute: async (_branch: string, id: number) =>
                ClientMapper.toDomain(await raw.client.findUniqueOrThrow({ where: { id } })),
        };
        const linker = new LinkMirroredEformsignDocByPhoneUsecase(
            prisma,
            config as never,
            {} as never,
            calendar,
        );
        service = new ClientService(
            {} as never, readClient as never, {} as never, {} as never, {} as never, {} as never,
            prisma, {} as never, {} as never, snapshots as never, {} as never, calendar,
            undefined, undefined, undefined, config as never, linker,
        );
    });

    afterAll(async () => {
        await raw.client.deleteMany({ where: { branchId } });
        await raw.eformsign_doc.deleteMany({ where: { branchId } });
        await raw.branch.deleteMany({ where: { id: branchId } });
        await raw.$disconnect();
    });

    /** A client with its own phone, so no other test's documents can match it. */
    async function makeClient() {
        const phone = `010${String(10_000_000 + (++sequence * 7919) % 89_999_999).padStart(8, "0")}`;
        const client = await raw.client.create({
            data: {
                name: `d3-phone-${sequence}`,
                voucherClient: false,
                branchId,
                phone,
                startDate: d("2026-10-01"),
                endDate: d("2026-10-16"),
                duration: 12,
            },
        });
        return { id: client.id, phone };
    }

    async function makeDocument(
        label: string,
        owner: { id: number; phone: string },
        options: { createdDate: string; ready: boolean; voided?: boolean; statusType?: string },
    ) {
        const documentId = `d3-phone-${label}-${++sequence}-${Date.now().toString(36)}`;
        const createdDate = new Date(options.createdDate);
        const row = await raw.eformsign_doc.create({
            data: {
                documentId,
                createdDate,
                updatedDate: createdDate,
                statusType: options.statusType ?? "050",
                statusDetail: "Complete",
                stepType: "reviewer",
                stepIndex: "1",
                stepName: "reviewer",
                stepRecipientType: "client",
                stepRecipientName: "Fixture",
                stepRecipientSms: owner.phone,
                customerPhone: owner.phone,
                expiredDate: new Date("2099-01-01T00:00:00.000Z"),
                clientId: owner.id,
                branchId,
                documentKind: "contract",
                syncStatus: options.ready ? "ready" : "pending",
                ...(options.voided ? { voidedAt: new Date("2026-10-13T00:00:00.000Z"), voidedBy: ACTOR } : {}),
                ...(options.ready
                    ? {
                        detailPayload: { document: { id: documentId } },
                        detailSourceUpdatedDate: createdDate,
                        detailSyncedAt: createdDate,
                    }
                    : {}),
            },
        });
        if (options.ready) {
            for (const fileType of ["document", "audit_trail"]) {
                await raw.eformsign_doc_file.create({
                    data: {
                        eformsignDocId: row.id,
                        fileType,
                        content: Buffer.from("x"),
                        contentType: "application/pdf",
                        byteSize: 1,
                        sha256: "0".repeat(64),
                        sourceUpdatedDate: createdDate,
                    },
                });
            }
        }
        return documentId;
    }

    async function pointerOf(clientId: number) {
        return (await raw.client.findUniqueOrThrow({ where: { id: clientId } })).eDocId;
    }

    it("(a) a voided newest READY contract does not let an older PENDING contract take the pointer", async () => {
        const client = await makeClient();
        await makeDocument("a-newest", client, { createdDate: "2026-10-12T00:00:00.000Z", ready: true, voided: true });
        await makeDocument("a-older", client, { createdDate: "2026-10-05T00:00:00.000Z", ready: false });

        const updated = await service.update(branchId, client.id, {});

        expect(await pointerOf(client.id)).toBeNull();
        expect(updated.eDocId).toBeNull();
    });

    it("(b) a voided newest NOT-ready contract (status 049) does not let an older READY contract take the pointer", async () => {
        const client = await makeClient();
        await makeDocument("b-newest", client, {
            createdDate: "2026-10-12T00:00:00.000Z", ready: false, voided: true, statusType: "049",
        });
        await makeDocument("b-older", client, { createdDate: "2026-10-05T00:00:00.000Z", ready: true });

        const updated = await service.update(branchId, client.id, {});

        expect(await pointerOf(client.id)).toBeNull();
        expect(updated.eDocId).toBeNull();
    });

    it("keeps an existing pointer when the newest contract is voided and a newer-than-pointer contract is linkable", async () => {
        const client = await makeClient();
        const existing = await makeDocument("keep-pointer", client, { createdDate: "2026-10-01T00:00:00.000Z", ready: true });
        await raw.client.update({ where: { id: client.id }, data: { eDocId: existing } });
        await makeDocument("keep-newest", client, { createdDate: "2026-10-12T00:00:00.000Z", ready: true, voided: true });
        await makeDocument("keep-older", client, { createdDate: "2026-10-05T00:00:00.000Z", ready: false });

        await service.update(branchId, client.id, {});

        expect(await pointerOf(client.id)).toBe(existing);
    });

    it("(c) control: a READY contract created after the voided one is linked and takes the pointer", async () => {
        const client = await makeClient();
        await makeDocument("c-voided", client, { createdDate: "2026-10-05T00:00:00.000Z", ready: true, voided: true });
        const newer = await makeDocument("c-newer", client, { createdDate: "2026-10-12T00:00:00.000Z", ready: true });

        const updated = await service.update(branchId, client.id, {});

        expect(await pointerOf(client.id)).toBe(newer);
        expect(updated.eDocId).toBe(newer);
    });

    it("(c) control: a PENDING contract created after the voided one is linked through the existing-only path", async () => {
        const client = await makeClient();
        await makeDocument("c2-voided", client, { createdDate: "2026-10-05T00:00:00.000Z", ready: true, voided: true });
        const newer = await makeDocument("c2-newer", client, { createdDate: "2026-10-12T00:00:00.000Z", ready: false });

        await service.update(branchId, client.id, {});

        expect(await pointerOf(client.id)).toBe(newer);
    });

    it("control: a voided contract of ANOTHER client never blocks this client", async () => {
        const client = await makeClient();
        const other = await makeClient();
        await makeDocument("other-voided", other, { createdDate: "2026-10-12T00:00:00.000Z", ready: true, voided: true });
        const own = await makeDocument("own", client, { createdDate: "2026-10-05T00:00:00.000Z", ready: true });

        await service.update(branchId, client.id, {});

        expect(await pointerOf(client.id)).toBe(own);
    });

    it("control: a client without a voided contract is linked as before", async () => {
        const client = await makeClient();
        const own = await makeDocument("plain", client, { createdDate: "2026-10-05T00:00:00.000Z", ready: true });

        await service.update(branchId, client.id, {});

        expect(await pointerOf(client.id)).toBe(own);
    });
});

/**
 * BJJ-439 D3 (merge-audit round 3): the voiding of a client's newer contract must be serialised
 * with every phone-link pointer write through the client row lock. The pointer writers read "is
 * there a newer voided contract" under that lock and then point `client.e_doc_id` at an older
 * contract; a void that did not take the same lock could commit between the read and the write
 * (pointer D with a durable voided N). The accepted end state of a link that wins the lock and a
 * void that lands afterwards is identical to the defect's end state (pointer D, N voided), so every
 * case records the ORDER of events and asserts it; the order is the proof.
 *
 * Real `ClientService` / `LinkMirroredEformsignDocByPhoneUsecase` / `SbEformsignDocRepository`
 * over the real database. Bounded waits throughout: a lock-order bug fails a case, never hangs it.
 */
describeReal("voiding a newer contract is serialised with phone-link pointer writes (real PostgreSQL)", () => {
    let raw: PrismaClient;
    let branchId: string;
    let repository: SbEformsignDocRepository;
    let sequence = 0;

    const calendar = { forBranch: async () => KR_BUILTIN_CALENDAR } as unknown as HolidayCalendarService;
    const config = { get: () => undefined };
    const CASE_TIMEOUT_MS = 30_000;

    beforeAll(async () => {
        assertThrowawayTarget();
        raw = new PrismaClient();
        await raw.$connect();
        branchId = (await raw.branch.create({
            data: { name: "d3 void serialisation", slug: `throwaway-d3-void-lock-${Date.now().toString(36)}` },
        })).id;
        repository = new SbEformsignDocRepository(raw as unknown as PrismaService);
    });

    afterAll(async () => {
        await raw.client.deleteMany({ where: { branchId } });
        await raw.eformsign_doc.deleteMany({ where: { branchId } });
        await raw.branch.deleteMany({ where: { id: branchId } });
        await raw.$disconnect();
    });

    /** The usecase under test, over the given Prisma (instrumented or not). */
    const linkerFor = (prisma: PrismaService) =>
        new LinkMirroredEformsignDocByPhoneUsecase(prisma, config as never, {} as never, calendar);

    /**
     * `ClientService` WITHOUT the usecase, so its ready-contract link (Read Committed) is the only
     * writer: the not-ready follow-up pass would otherwise link the pending newer contract too.
     */
    const readyLinkServiceFor = (prisma: PrismaService) => {
        const snapshots = { bumpVersion: async () => undefined, bumpCompanyEpoch: async () => undefined };
        const readClient = {
            execute: async (_branch: string, id: number) =>
                ClientMapper.toDomain(await raw.client.findUniqueOrThrow({ where: { id } })),
        };
        return new ClientService(
            {} as never, readClient as never, {} as never, {} as never, {} as never, {} as never,
            prisma, {} as never, {} as never, snapshots as never, {} as never, calendar,
            undefined, undefined, undefined, config as never, undefined,
        );
    };

    /** A client the contract details below identify (name and birthday), with its own phone. */
    async function makeClient() {
        const phone = `010${String(20_000_000 + (++sequence * 7919) % 69_999_999).padStart(8, "0")}`;
        const client = await raw.client.create({
            data: {
                name: "김고객",
                birthday: "1992-03-04",
                voucherClient: false,
                branchId,
                phone,
                startDate: d("2026-10-01"),
                endDate: d("2026-10-16"),
                duration: 12,
            },
        });
        return { id: client.id, phone };
    }

    const contractDetail = (phone: string) => ({
        document: { id: "fixture" },
        fields: [
            { id: "이용자 성명", value: "김고객", type: "text" },
            { id: "이용자 생년월일", value: "920304", type: "text" },
            { id: "이용자 연락처", value: phone, type: "text" },
        ],
        recipients: [{ recipient_type: "02", name: "김고객", sms: phone }],
    });

    /**
     * `owner: null` makes an unassigned mirror (claimed by the usecase's phone match); otherwise the
     * document already belongs to that client. `ready: true` adds the mirror files the ready link needs.
     */
    async function makeDocument(
        label: string,
        client: { id: number; phone: string },
        options: { createdDate: string; ready: boolean; owner: "client" | null },
    ) {
        const documentId = `d3-lock-${label}-${++sequence}-${Date.now().toString(36)}`;
        const createdDate = new Date(options.createdDate);
        const row = await raw.eformsign_doc.create({
            data: {
                documentId,
                createdDate,
                updatedDate: createdDate,
                statusType: "050",
                statusDetail: "Complete",
                stepType: "reviewer",
                stepIndex: "1",
                stepName: "reviewer",
                stepRecipientType: "client",
                stepRecipientName: "Fixture",
                stepRecipientSms: client.phone,
                customerPhone: client.phone,
                expiredDate: new Date("2099-01-01T00:00:00.000Z"),
                clientId: options.owner === "client" ? client.id : null,
                branchId,
                documentKind: "contract",
                syncStatus: options.ready ? "ready" : "pending",
                detailPayload: options.owner === null ? contractDetail(client.phone) : { document: { id: documentId } },
                ...(options.ready
                    ? { detailSourceUpdatedDate: createdDate, detailSyncedAt: createdDate }
                    : {}),
            },
        });
        if (options.ready) {
            for (const fileType of ["document", "audit_trail"]) {
                await raw.eformsign_doc_file.create({
                    data: {
                        eformsignDocId: row.id,
                        fileType,
                        content: Buffer.from("x"),
                        contentType: "application/pdf",
                        byteSize: 1,
                        sha256: "0".repeat(64),
                        sourceUpdatedDate: createdDate,
                    },
                });
            }
        }
        return documentId;
    }

    const pointerOf = async (clientId: number) =>
        (await raw.client.findUniqueOrThrow({ where: { id: clientId } })).eDocId;
    const documentRow = (documentId: string) =>
        raw.eformsign_doc.findUniqueOrThrow({ where: { documentId } });

    const isBlockerRead = (args: unknown[]): boolean => {
        const voidedAt = (args[0] as { where?: { voidedAt?: unknown } } | undefined)?.where?.voidedAt;
        return typeof voidedAt === "object" && voidedAt !== null && "not" in voidedAt
            && (voidedAt as { not?: unknown }).not === null;
    };

    /**
     * A Prisma whose transaction client calls `onBlockerRead` (once) right after the D3 blocker read
     * (`eformsign_doc.findFirst` for a voided newer contract) returned, i.e. at the moment between
     * "no blocker" and the pointer write, and records OLDER_POINTER_WRITE for a pointer write of
     * `pointerDocumentId` and LINK_COMMITTED once the transaction that hit the hook committed.
     */
    function instrumentBlockerRead(
        events: string[],
        pointerDocumentId: string,
        onBlockerRead: (blocker: unknown, tx: Prisma.TransactionClient) => Promise<void>,
    ): PrismaService {
        let fired = false;
        return new Proxy(raw, {
            get(target, key) {
                if (key === "$transaction") {
                    return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, ...rest: unknown[]) => {
                        let hit = false;
                        const wrap = (tx: Prisma.TransactionClient): Prisma.TransactionClient => new Proxy(tx, {
                            get(inner, innerKey) {
                                if (innerKey === "eformsign_doc") {
                                    const delegate = Reflect.get(inner, innerKey, inner) as unknown as Record<string, unknown>;
                                    return new Proxy(delegate, {
                                        get(model, method) {
                                            const value = Reflect.get(model, method, model);
                                            if (method !== "findFirst" || typeof value !== "function") {
                                                return typeof value === "function" ? value.bind(model) : value;
                                            }
                                            return async (...args: unknown[]) => {
                                                const row = await (value as (...a: unknown[]) => Promise<unknown>)
                                                    .apply(model, args);
                                                if (!fired && isBlockerRead(args)) {
                                                    fired = true;
                                                    hit = true;
                                                    await onBlockerRead(row, inner);
                                                }
                                                return row;
                                            };
                                        },
                                    });
                                }
                                if (innerKey === "client") {
                                    const delegate = Reflect.get(inner, innerKey, inner) as unknown as Record<string, unknown>;
                                    return new Proxy(delegate, {
                                        get(model, method) {
                                            const value = Reflect.get(model, method, model);
                                            if (method !== "updateMany" || typeof value !== "function") {
                                                return typeof value === "function" ? value.bind(model) : value;
                                            }
                                            return async (...args: unknown[]) => {
                                                const data = (args[0] as { data?: { eDocId?: unknown } } | undefined)?.data;
                                                if (data?.eDocId === pointerDocumentId) events.push("OLDER_POINTER_WRITE");
                                                return (value as (...a: unknown[]) => Promise<unknown>).apply(model, args);
                                            };
                                        },
                                    });
                                }
                                const value = Reflect.get(inner, innerKey, inner);
                                return typeof value === "function" ? value.bind(inner) : value;
                            },
                        });
                        const outcome = await (target.$transaction as (...a: unknown[]) => Promise<unknown>)
                            .call(target, (tx: Prisma.TransactionClient) => callback(wrap(tx)), ...rest);
                        if (hit) events.push("LINK_COMMITTED");
                        return outcome;
                    };
                }
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        }) as unknown as PrismaService;
    }

    const isolationOf = async (tx: Prisma.TransactionClient) =>
        (await tx.$queryRaw<Array<{ transaction_isolation: string }>>(Prisma.sql`SHOW transaction_isolation`))[0]!
            .transaction_isolation;

    /**
     * Link first: the link pauses right after its blocker read returned nothing; a void of the newer
     * contract is started (NOT awaited - it cannot finish) and proven to be queued behind the link's
     * client row lock; the link then writes the pointer and commits, and only then does the void commit.
     */
    async function linkFirst(
        linkerOrService: "ready-link" | "existing-only-link",
        isolation: "read committed" | "serializable",
    ) {
        const client = await makeClient();
        const older = await makeDocument("older", client, {
            createdDate: "2026-10-05T00:00:00.000Z",
            ready: linkerOrService === "ready-link",
            owner: linkerOrService === "ready-link" ? "client" : null,
        });
        const newer = await makeDocument("newer", client, {
            createdDate: "2026-10-12T00:00:00.000Z", ready: false, owner: "client",
        });
        const events: string[] = [];
        let voiding: Promise<boolean> | undefined;
        const prisma = instrumentBlockerRead(events, older, async (blocker, tx) => {
            expect(blocker).toBeNull();
            expect(await isolationOf(tx)).toBe(isolation);
            events.push("BLOCKER_READ_EMPTY");
            events.push("VOID_STARTED");
            voiding = repository.markVoided(branchId, newer, new Date(), ACTOR).then((voided) => {
                events.push("VOID_COMMITTED");
                return voided;
            });
            await waitUntilBlocked(raw, CLIENT_LOCK_STATEMENT);
            events.push("VOID_BLOCKED");
        });

        try {
            if (linkerOrService === "ready-link") {
                await readyLinkServiceFor(prisma).update(branchId, client.id, {});
            } else {
                await expect(linkerFor(prisma).execute(older, {
                    linkExistingOnly: true,
                    existingClientId: client.id,
                    existingClientBranchId: branchId,
                })).resolves.toBe("linked");
            }
        } finally {
            await voiding?.catch(() => undefined);
        }
        expect(voiding).toBeDefined();
        await expect(voiding).resolves.toBe(true);

        expectInOrder(events, [
            "BLOCKER_READ_EMPTY", "VOID_STARTED", "VOID_BLOCKED", "OLDER_POINTER_WRITE",
            "LINK_COMMITTED", "VOID_COMMITTED",
        ]);
        // The link was serialised before the void: it legitimately took the pointer, and the void
        // then recorded itself. Same end state as the defect; the order above is what differs.
        expect(await pointerOf(client.id)).toBe(older);
        expect((await documentRow(newer)).voidedAt).not.toBeNull();
        expect((await documentRow(newer)).voidedBy).toBe(ACTOR);
    }

    it("1. link first, Read Committed (ClientService ready link): the void waits and commits after the link", async () => {
        await linkFirst("ready-link", "read committed");
    }, CASE_TIMEOUT_MS);

    it("2. link first, Serializable (usecase linkExistingOnly): the void waits and commits after the link", async () => {
        await linkFirst("existing-only-link", "serializable");
    }, CASE_TIMEOUT_MS);

    it("3. void first, Serializable: a link that waited on the client row retries on a fresh snapshot, sees the void, and does not point at the older contract", async () => {
        const client = await makeClient();
        const older = await makeDocument("older", client, {
            createdDate: "2026-10-05T00:00:00.000Z", ready: false, owner: null,
        });
        const newer = await makeDocument("newer", client, {
            createdDate: "2026-10-12T00:00:00.000Z", ready: false, owner: "client",
        });
        const events: string[] = [];

        // The void is held after its client lock, its no-op client write and its document write,
        // right before its commit.
        let releaseVoid!: () => void;
        const gate = new Promise<void>((resolve) => { releaseVoid = resolve; });
        let voidHeld!: () => void;
        const voidIsHeld = new Promise<void>((resolve) => { voidHeld = resolve; });
        const holdingPrisma = new Proxy(raw, {
            get(target, key) {
                if (key === "$transaction") {
                    return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, ...rest: unknown[]) =>
                        (target.$transaction as (...a: unknown[]) => Promise<unknown>).call(
                            target,
                            async (tx: Prisma.TransactionClient) => {
                                const outcome = await callback(tx);
                                events.push("VOID_HOLDS_CLIENT_LOCK");
                                voidHeld();
                                await gate;
                                return outcome;
                            },
                            ...rest,
                        );
                }
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        }) as unknown as PrismaService;

        // Every transaction attempt of the link, with the error that ended it (if any).
        const attempts: Array<{ error?: { code?: unknown; meta?: { code?: unknown } } }> = [];
        const linkingPrisma = new Proxy(raw, {
            get(target, key) {
                if (key === "$transaction") {
                    return async (...args: unknown[]) => {
                        const attempt: (typeof attempts)[number] = {};
                        attempts.push(attempt);
                        try {
                            return await (target.$transaction as (...a: unknown[]) => Promise<unknown>).apply(target, args);
                        } catch (error) {
                            attempt.error = error as typeof attempt.error;
                            throw error;
                        }
                    };
                }
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        }) as unknown as PrismaService;

        let voiding: Promise<boolean> | undefined;
        let linking: Promise<unknown> | undefined;
        try {
            voiding = new SbEformsignDocRepository(holdingPrisma)
                .markVoided(branchId, newer, new Date(), ACTOR)
                .then((voided) => {
                    events.push("VOID_COMMITTED");
                    return voided;
                });
            await withDeadline(voidIsHeld, 3_500, "the void never reached its commit point");

            // The link's snapshot is fixed by its first statement, before it waits for the client row.
            linking = linkerFor(linkingPrisma).execute(older, {
                linkExistingOnly: true,
                existingClientId: client.id,
                existingClientBranchId: branchId,
            });
            await waitUntilBlocked(raw, CLIENT_LOCK_STATEMENT);
            events.push("LINK_BLOCKED_ON_CLIENT_ROW");
        } finally {
            releaseVoid();
        }
        await expect(voiding).resolves.toBe(true);
        await expect(linking).resolves.toBe("linked");

        expectInOrder(events, ["VOID_HOLDS_CLIENT_LOCK", "LINK_BLOCKED_ON_CLIENT_ROW", "VOID_COMMITTED"]);
        // The outcome that matters: the voided newer contract keeps the older one from the pointer.
        // Only the pointer is skipped: the older contract is still claimed by the client.
        expect(await pointerOf(client.id)).toBeNull();
        expect((await documentRow(older)).clientId).toBe(client.id);
        expect((await documentRow(newer)).voidedAt).not.toBeNull();
        // How: the blocked Serializable attempt failed with a serialization failure (the void's
        // no-op client write is what raises it), and the retry - a fresh snapshot - saw the void.
        expect(attempts.length).toBeGreaterThanOrEqual(2);
        const first = attempts[0]!.error;
        expect(first).toBeDefined();
        expect(first?.code === "P2034" || (first?.code === "P2010" && first?.meta?.code === "40001")).toBe(true);
        expect(attempts[attempts.length - 1]!.error).toBeUndefined();
    }, CASE_TIMEOUT_MS);

    it("4. control: with no concurrent void the ready link takes the older contract's pointer", async () => {
        const client = await makeClient();
        const older = await makeDocument("older", client, {
            createdDate: "2026-10-05T00:00:00.000Z", ready: true, owner: "client",
        });
        await makeDocument("newer", client, {
            createdDate: "2026-10-12T00:00:00.000Z", ready: false, owner: "client",
        });

        await readyLinkServiceFor(raw as unknown as PrismaService).update(branchId, client.id, {});

        expect(await pointerOf(client.id)).toBe(older);
    }, CASE_TIMEOUT_MS);

    it("4. control: with no concurrent void the Serializable existing-only link takes the older contract's pointer", async () => {
        const client = await makeClient();
        const older = await makeDocument("older", client, {
            createdDate: "2026-10-05T00:00:00.000Z", ready: false, owner: null,
        });
        await makeDocument("newer", client, {
            createdDate: "2026-10-12T00:00:00.000Z", ready: false, owner: "client",
        });

        await expect(linkerFor(raw as unknown as PrismaService).execute(older, {
            linkExistingOnly: true,
            existingClientId: client.id,
            existingClientBranchId: branchId,
        })).resolves.toBe("linked");

        expect(await pointerOf(client.id)).toBe(older);
    }, CASE_TIMEOUT_MS);
});
