import { Prisma, PrismaClient } from "@prisma/client";

import type { PromoteReceiptLinkRevisionArtifactInput } from "domain/repositories/receipt-link-token.repository.interface";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbEformsignDocumentMirrorRepository } from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { lockClientOwnedContractDocuments } from "infrastructure/database/repositories/service-record-edit.repository";

/**
 * Real-PostgreSQL concurrency specs for the lock order shared by service-record confirmation,
 * receipt promotion and document linking. They cannot be proven with mocked transactions, so they
 * only run when `G3_CONCURRENCY_DATABASE_URL` points at a DISPOSABLE local database:
 *
 *   initdb -D "$DIR" -U postgres --auth=trust
 *   pg_ctl -D "$DIR" -o "-p 62301 -c listen_addresses=127.0.0.1 -k /tmp/g3sock" -w start
 *   psql -h 127.0.0.1 -p 62301 -U postgres -c "create database g3_concurrency_fix2"
 *   G3_CONCURRENCY_DATABASE_URL="postgresql://postgres@127.0.0.1:62301/g3_concurrency_fix2" \
 *     NODE_OPTIONS=--experimental-vm-modules pnpm exec jest \
 *     test/repositories/receipt-revision-lock-order.concurrency.spec.ts
 *
 * The spec DROPS and recreates the handful of tables it uses, so it refuses anything that is not a
 * loopback host and a database named `g3_concurrency_*`. Without the variable the suite is skipped
 * (CI has no such database).
 */

const DATABASE_URL = process.env["G3_CONCURRENCY_DATABASE_URL"];
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

const BRANCH = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const REVISION = "33333333-3333-4333-8333-333333333333";
const STATE = "44444444-4444-4444-8444-444444444444";
const TOKEN = "55555555-5555-4555-8555-555555555555";
const CLIENT_ID = 7;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}

function assertDisposable(url: string): void {
    const parsed = new URL(url);
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)
        || !parsed.pathname.startsWith("/g3_concurrency_")) {
        throw new Error("G3_CONCURRENCY_DATABASE_URL must be a loopback database named g3_concurrency_*");
    }
}

describeWithDatabase("receipt revision lock order (real PostgreSQL)", () => {
    let db: PrismaClient;
    let other: PrismaClient;
    let observer: PrismaClient;

    beforeAll(async () => {
        assertDisposable(DATABASE_URL!);
        db = new PrismaClient({ datasources: { db: { url: DATABASE_URL! } } });
        other = new PrismaClient({ datasources: { db: { url: DATABASE_URL! } } });
        const statements = [
            `DROP TABLE IF EXISTS receipt_link_token, service_record_revision_document_state, service_record_revision,
                service_record_case, eformsign_doc_file, eformsign_doc, client CASCADE`,
            `CREATE TABLE client (id int PRIMARY KEY, branch_id uuid, e_doc_id text UNIQUE, updated_at timestamptz)`,
            `CREATE TABLE eformsign_doc (
                id int PRIMARY KEY, document_id text UNIQUE, client_id int REFERENCES client(id) ON DELETE SET NULL,
                branch_id uuid, document_kind text, service_record_case_id uuid, revision_id uuid, template_id text,
                created_date timestamptz, updated_date timestamptz, status_type text,
                permanent_purge_requested_at timestamptz, auto_registered_client boolean DEFAULT false,
                document_name text, document_number text, template_name text, customer_name text, customer_phone text, creator_name text,
                last_editor_name text, step_recipient_types text, status_detail text DEFAULT '-', step_type text DEFAULT '-', step_index text DEFAULT '-',
                step_name text DEFAULT '-', step_recipient_type text DEFAULT '-', step_recipient_name text DEFAULT '-', step_recipient_sms text DEFAULT '-', expired boolean DEFAULT false,
                employee_schedule_id int, snapshot_version int, snapshot_chunk_index int, detail_payload jsonb,
                detail_source_updated_date timestamptz, detail_synced_at timestamptz, sync_status text DEFAULT 'ready',
                sync_error text, sync_error_at timestamptz, expired_date timestamptz DEFAULT '2030-01-01',
                auto_finalize_attempts int DEFAULT 0, auto_finalize_last_attempt_at timestamptz, auto_finalize_last_error text)`,
            `ALTER TABLE client ADD FOREIGN KEY (e_doc_id) REFERENCES eformsign_doc(document_id)`,
            `CREATE TABLE eformsign_doc_file (id int PRIMARY KEY, eformsign_doc_id int REFERENCES eformsign_doc(id))`,
            `CREATE TABLE service_record_case (id uuid PRIMARY KEY, branch_id uuid, client_id int,
                current_revision_id uuid, current_usable_revision_id uuid, current_usable_document_version int)`,
            `CREATE TABLE service_record_revision (id uuid PRIMARY KEY, branch_id uuid, service_record_case_id uuid)`,
            `CREATE TABLE service_record_revision_document_state (id uuid PRIMARY KEY, branch_id uuid, client_id int,
                service_record_case_id uuid, revision_id uuid, generation text, version int, operation text,
                source_document_id text, target_document_id text, document_version int, template_id text,
                template_version text, mirror_generation text, output_proof jsonb, status text, step text,
                last_error_code text, updated_at timestamptz)`,
            `CREATE TABLE receipt_link_token (id uuid PRIMARY KEY, eformsign_doc_id int REFERENCES eformsign_doc(id),
                branch_id uuid, client_id int REFERENCES client(id), active boolean, expires_at timestamptz,
                storage_path text, content_sha256 text, byte_size int)`,
        ];
        for (const statement of statements) await db.$executeRawUnsafe(statement);
        // Only the purge's `autoRegisteredClient` rollback path reads these (none of the scenarios
        // reaches it, the pointer is not at the purged document), but Prisma needs the tables to plan.
        for (const table of ["employee_schedule", "call_record", "client_draft", "schedule_change_request", "message_log", "eformsign_document_job"]) {
            await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${table} (id int PRIMARY KEY, client_id int)`);
        }
        await db.$executeRawUnsafe("ALTER TABLE call_record ADD COLUMN IF NOT EXISTS matched_client_id int");
        observer = new PrismaClient({ datasources: { db: { url: DATABASE_URL! } } });
    });

    afterAll(async () => {
        await db?.$disconnect();
        await other?.$disconnect();
        await observer?.$disconnect();
    });

    beforeEach(async () => {
        await db.$executeRawUnsafe(
            "TRUNCATE receipt_link_token, service_record_revision_document_state, service_record_revision, service_record_case, eformsign_doc_file, eformsign_doc, client CASCADE",
        );
        // The client's pointer lags: it still points at A while B is the newest contract.
        await db.$executeRaw(Prisma.sql`INSERT INTO client VALUES (${CLIENT_ID}, ${BRANCH}::uuid, NULL, now())`);
        await db.$executeRaw(Prisma.sql`INSERT INTO eformsign_doc
            (id, document_id, client_id, branch_id, document_kind, template_id, created_date, updated_date, status_type)
            VALUES (10, 'doc-A', ${CLIENT_ID}, ${BRANCH}::uuid, 'contract', 'template-1', '2026-08-01', '2026-09-01', '070'),
                   (20, 'doc-B', ${CLIENT_ID}, ${BRANCH}::uuid, 'contract', 'template-1', '2026-08-10', '2026-09-01', '070'),
                   (30, 'doc-C', ${CLIENT_ID}, ${BRANCH}::uuid, 'contract', 'template-1', '2026-08-05', '2026-09-01', '070'),
                   (50, 'doc-S', ${CLIENT_ID}, ${BRANCH}::uuid, 'service_record_snapshot', 'template-1', '2026-08-25', '2026-09-01', '070')`);
        await db.$executeRawUnsafe(`UPDATE client SET e_doc_id = 'doc-A' WHERE id = ${CLIENT_ID}`);
        await db.$executeRaw(Prisma.sql`INSERT INTO service_record_case VALUES (${CASE}::uuid, ${BRANCH}::uuid, ${CLIENT_ID}, NULL, NULL, NULL)`);
    });

    /** A repository-facing client whose transactions run on `client` and call `onQuery` after every raw query. */
    function shimFor(
        client: PrismaClient,
        onQuery: (query: Prisma.Sql) => Promise<void> | void,
        options: { deadlockTimeout?: boolean } = {},
    ) {
        return {
            $transaction: (fn: (tx: unknown) => unknown) => client.$transaction(async (tx) => {
                if (options.deadlockTimeout) await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout = '200ms'");
                const wrapped = new Proxy(tx, {
                    get(target, key) {
                        if (key === "$queryRaw") {
                            return async (query: Prisma.Sql) => {
                                const rows = await tx.$queryRaw(query);
                                await onQuery(query);
                                return rows;
                            };
                        }
                        return Reflect.get(target, key);
                    },
                });
                return fn(wrapped);
            }, { timeout: 20000 }),
        };
    }

    const isDocumentLock = (query: Prisma.Sql) =>
        query.text.includes("FROM eformsign_doc")
        && query.text.includes("FOR UPDATE")
        && query.text.includes("permanent_purge_requested_at IS NULL");

    /** What service-record confirmation does with these tables: client row first, then the contract documents. */
    async function confirmLockSequence(
        tx: Prisma.TransactionClient,
        afterClientLock?: () => Promise<void>,
    ): Promise<void> {
        await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout = '200ms'");
        await tx.$queryRaw(Prisma.sql`SELECT id FROM client WHERE id = ${CLIENT_ID} AND branch_id = ${BRANCH}::uuid FOR UPDATE`);
        await afterClientLock?.();
        await lockClientOwnedContractDocuments(tx, BRANCH, CLIENT_ID);
    }

    function expectBothCompleted(outcomes: Array<PromiseSettledResult<unknown>>): void {
        const failures = outcomes
            .filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")
            .map((outcome) => String(outcome.reason));
        expect(failures).toEqual([]);
    }

    /** Waits until some other session is blocked on a row lock (proves the two paths really contend). */
    async function waitForLockWaiter(): Promise<void> {
        for (let attempt = 0; attempt < 150; attempt += 1) {
            const rows = await observer.$queryRaw<Array<{ pid: number }>>(Prisma.sql`
                SELECT pid FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock'`);
            if (rows.length > 0) return;
            await sleep(20);
        }
        throw new Error("Expected one session to be waiting on a lock");
    }

    /** True for a `SELECT ... FROM eformsign_doc ... FOR UPDATE` (a document row lock). */
    const isAnyDocumentLock = (query: Prisma.Sql) =>
        query.text.includes("FROM eformsign_doc") && query.text.includes("FOR UPDATE");
    const isClientLock = (query: Prisma.Sql) =>
        query.text.includes("FROM client") && query.text.includes("FOR UPDATE");

    describe("document linking vs confirmation (F3)", () => {
        it("link holds the document first, confirmation arrives second: both complete, no deadlock", async () => {
            const linkHoldsLocks = deferred();
            const releaseLink = deferred();
            let paused = false;
            const link = new SbEformsignDocRepository(shimFor(other, async (query) => {
                if (!paused && isDocumentLock(query)) {
                    paused = true;
                    linkHoldsLocks.resolve();
                    await releaseLink.promise;
                }
            }, { deadlockTimeout: true }) as never).linkClientIfActive(BRANCH, "doc-B", CLIENT_ID);

            await linkHoldsLocks.promise;
            const confirm = db.$transaction((tx) => confirmLockSequence(tx), { timeout: 20000 });
            await sleep(600);
            releaseLink.resolve();

            const outcomes = await Promise.allSettled([link, confirm]);
            expectBothCompleted(outcomes);
            const pointer = await db.$queryRaw<Array<{ e_doc_id: string }>>(Prisma.sql`SELECT e_doc_id FROM client WHERE id = ${CLIENT_ID}`);
            expect(pointer[0]?.e_doc_id).toBe("doc-B");
        }, 30000);

        it("confirmation holds the client first, link arrives second: both complete, no deadlock", async () => {
            const confirmHoldsClient = deferred();
            const releaseConfirm = deferred();
            const confirm = db.$transaction((tx) => confirmLockSequence(tx, async () => {
                confirmHoldsClient.resolve();
                await releaseConfirm.promise;
            }), { timeout: 20000 });

            await confirmHoldsClient.promise;
            const link = new SbEformsignDocRepository(shimFor(other, () => undefined, { deadlockTimeout: true }) as never)
                .linkClientIfActive(BRANCH, "doc-B", CLIENT_ID);
            await sleep(600);
            releaseConfirm.resolve();

            const outcomes = await Promise.allSettled([link, confirm]);
            expectBothCompleted(outcomes);
            const pointer = await db.$queryRaw<Array<{ e_doc_id: string }>>(Prisma.sql`SELECT e_doc_id FROM client WHERE id = ${CLIENT_ID}`);
            expect(pointer[0]?.e_doc_id).toBe("doc-B");
        }, 30000);
    });

    describe("receipt promotion currency (F2)", () => {
        const proof = {
            officialPdfSha256: "a".repeat(64), verifiedAt: "2026-09-08T03:00:00.000Z", pageCount: 1,
            scope: {
                branchId: BRANCH, clientId: CLIENT_ID, revisionId: REVISION, documentId: "doc-B",
                generation: "generation-1", mirrorGeneration: "mirror-1", templateId: "template-1", templateVersion: "v3",
            },
            expected: { serviceStartDate: "2026-08-01", serviceEndDate: "2026-08-14", receivedDate: "2026-08-02", amount: "123000" },
            artifact: { storagePath: "receipts/new.png", contentSha256: "b".repeat(64), byteSize: 9 },
        };

        const input: PromoteReceiptLinkRevisionArtifactInput = {
            branchId: BRANCH, clientId: CLIENT_ID, serviceRecordCaseId: CASE, revisionId: REVISION, documentStateId: STATE,
            expectedGeneration: "generation-1", expectedStateVersion: 1, targetDocumentId: "doc-B", documentVersion: 3,
            templateId: "template-1", templateVersion: "v3", mirrorGeneration: "mirror-1", serviceRecordTemplateIds: [],
            // The token is attached to the OLDER contract A (stable link) and is refreshed with B's receipt.
            eformsignDocId: 10, tokenIds: [TOKEN], storagePath: "receipts/new.png", contentSha256: "b".repeat(64), byteSize: 9,
            proof, now: new Date("2026-09-08T03:00:00.000Z"),
        };

        beforeEach(async () => {
            await db.$executeRaw(Prisma.sql`UPDATE service_record_case SET current_revision_id = ${REVISION}::uuid`);
            await db.$executeRaw(Prisma.sql`INSERT INTO service_record_revision VALUES (${REVISION}::uuid, ${BRANCH}::uuid, ${CASE}::uuid)`);
            await db.$executeRaw(Prisma.sql`INSERT INTO service_record_revision_document_state
                (id, branch_id, client_id, service_record_case_id, revision_id, generation, version, operation, source_document_id,
                 target_document_id, document_version, template_id, template_version, mirror_generation, output_proof, status)
                VALUES (${STATE}::uuid, ${BRANCH}::uuid, ${CLIENT_ID}, ${CASE}::uuid, ${REVISION}::uuid, 'generation-1', 1, 'receipt_refresh',
                        'doc-A', 'doc-B', 3, 'template-1', 'v3', 'mirror-1', ${JSON.stringify(proof)}::jsonb, 'processing')`);
            await db.$executeRaw(Prisma.sql`INSERT INTO receipt_link_token VALUES
                (${TOKEN}::uuid, 10, ${BRANCH}::uuid, ${CLIENT_ID}, true, '2030-09-30', 'receipts/old.png', ${"c".repeat(64)}, 9)`);
        });

        /**
         * Runs one promotion and, right after its currency query (the "ORDER BY created_date DESC, id DESC"
         * candidate read), starts `writer` from another connection WITHOUT awaiting it. After a pause the
         * writer is checked: if it finished while the promotion transaction was still open it was not
         * serialised with it.
         */
        async function promoteWhileWriting(writer: () => Promise<unknown>) {
            let writerDone = false;
            let writerError: unknown = null;
            let writerPromise: Promise<unknown> | null = null;
            const repository = new SbReceiptLinkTokenRepository(shimFor(db, async (query) => {
                if (writerPromise || !query.text.includes("ORDER BY created_date DESC, id DESC")) return;
                writerPromise = writer().then(() => { writerDone = true; }, (error) => { writerDone = true; writerError = error; });
                await sleep(700);
            }) as never);
            const result = await repository.promoteReceiptRevisionArtifact(input);
            const doneBeforeCommit = writerDone;
            await writerPromise;
            expect(writerError).toBeNull();
            return { result, writerCompletedBeforePromotionEnded: doneBeforeCommit };
        }

        const tokenPath = async () => (await db.$queryRaw<Array<{ storage_path: string }>>(
            Prisma.sql`SELECT storage_path FROM receipt_link_token WHERE id = ${TOKEN}::uuid`))[0]?.storage_path;

        it("created-date repair making C current mid-promotion waits for the promotion instead of racing it", async () => {
            // Mirrors the metadata-only repair at sb.eformsign-doc.repository.ts (updateMany of created_date).
            const { result, writerCompletedBeforePromotionEnded } = await promoteWhileWriting(() =>
                other.$executeRawUnsafe("UPDATE eformsign_doc SET created_date = '2026-08-20' WHERE document_id = 'doc-C'"));

            // Either serialisation is correct (promote-then-repair, or repair-then-stale), but publishing B
            // while the repair finished DURING the transaction is the bug.
            expect(result.disposition === "promoted" && writerCompletedBeforePromotionEnded).toBe(false);
            expect(writerCompletedBeforePromotionEnded).toBe(false);
            expect(result.disposition).toBe("promoted");
            expect(await tokenPath()).toBe("receipts/new.png");
            const created = await db.$queryRaw<Array<{ created: string }>>(
                Prisma.sql`SELECT to_char(created_date, 'YYYY-MM-DD') AS created FROM eformsign_doc WHERE document_id = 'doc-C'`);
            expect(created[0]?.created).toBe("2026-08-20");
        }, 30000);

        it("a new contract inserted for the client mid-promotion waits for the promotion", async () => {
            const { result, writerCompletedBeforePromotionEnded } = await promoteWhileWriting(() =>
                other.$executeRawUnsafe(`INSERT INTO eformsign_doc
                    (id, document_id, client_id, branch_id, document_kind, template_id, created_date, updated_date, status_type)
                    VALUES (40, 'doc-D', ${CLIENT_ID}, '${BRANCH}'::uuid, 'contract', 'template-1', '2026-08-25', '2026-09-01', '070')`));

            expect(result.disposition === "promoted" && writerCompletedBeforePromotionEnded).toBe(false);
            expect(writerCompletedBeforePromotionEnded).toBe(false);
            expect(result.disposition).toBe("promoted");
            expect(await tokenPath()).toBe("receipts/new.png");
            const inserted = await db.$queryRaw<Array<{ document_id: string }>>(
                Prisma.sql`SELECT document_id FROM eformsign_doc WHERE id = 40`);
            expect(inserted[0]?.document_id).toBe("doc-D");
        }, 30000);

        it("a non-candidate row of the client turning into a newer contract mid-promotion waits for the promotion", async () => {
            const { result, writerCompletedBeforePromotionEnded } = await promoteWhileWriting(() =>
                other.$executeRawUnsafe("UPDATE eformsign_doc SET document_kind = 'contract' WHERE document_id = 'doc-S'"));

            expect(result.disposition === "promoted" && writerCompletedBeforePromotionEnded).toBe(false);
            expect(writerCompletedBeforePromotionEnded).toBe(false);
            expect(result.disposition).toBe("promoted");
            expect(await tokenPath()).toBe("receipts/new.png");
        }, 30000);

        describe("webhook completion guard vs promotion (F5)", () => {
            // Pointer + revision evidence: C is the client's pointed document and belongs to the case's
            // current revision, so the completion guard answers `true` for it. (The receipt-facts
            // path keeps targeting B, the newest contract; the two are independent by design.)
            beforeEach(async () => {
                await db.$executeRawUnsafe(`UPDATE client SET e_doc_id = 'doc-C' WHERE id = ${CLIENT_ID}`);
                await db.$executeRaw(Prisma.sql`UPDATE eformsign_doc SET revision_id = ${REVISION}::uuid,
                    service_record_case_id = ${CASE}::uuid WHERE document_id = 'doc-C'`);
            });

            it("guard holds its locks first, promotion arrives second: both complete, guard answers true", async () => {
                const guardHasDocument = deferred();
                const releaseGuard = deferred();
                let paused = false;
                const guard = new SbEformsignDocRepository(shimFor(other, async (query) => {
                    if (!paused && isAnyDocumentLock(query)) {
                        paused = true;
                        guardHasDocument.resolve();
                        await releaseGuard.promise;
                    }
                }, { deadlockTimeout: true }) as never).isCurrentContractDocument(BRANCH, "doc-C");

                await guardHasDocument.promise;
                const promotion = new SbReceiptLinkTokenRepository(shimFor(db, () => undefined, { deadlockTimeout: true }) as never)
                    .promoteReceiptRevisionArtifact(input);
                await waitForLockWaiter();
                await sleep(500);
                releaseGuard.resolve();

                const outcomes = await Promise.allSettled([guard, promotion]);
                expectBothCompleted(outcomes);
                expect(outcomes[0]).toEqual({ status: "fulfilled", value: true });
                expect((outcomes[1] as PromiseFulfilledResult<{ disposition: string }>).value.disposition).toBe("promoted");
                expect(await tokenPath()).toBe("receipts/new.png");
            }, 30000);

            it("promotion holds the client first, guard arrives second: both complete, guard answers true", async () => {
                const promotionHasClient = deferred();
                const releasePromotion = deferred();
                let paused = false;
                const promotion = new SbReceiptLinkTokenRepository(shimFor(db, async (query) => {
                    if (!paused && isClientLock(query)) {
                        paused = true;
                        promotionHasClient.resolve();
                        await releasePromotion.promise;
                    }
                }, { deadlockTimeout: true }) as never).promoteReceiptRevisionArtifact(input);

                await promotionHasClient.promise;
                const guard = new SbEformsignDocRepository(shimFor(other, () => undefined, { deadlockTimeout: true }) as never)
                    .isCurrentContractDocument(BRANCH, "doc-C");
                await waitForLockWaiter();
                await sleep(500);
                releasePromotion.resolve();

                const outcomes = await Promise.allSettled([guard, promotion]);
                expectBothCompleted(outcomes);
                expect(outcomes[0]).toEqual({ status: "fulfilled", value: true });
                expect((outcomes[1] as PromiseFulfilledResult<{ disposition: string }>).value.disposition).toBe("promoted");
            }, 30000);

            it("the guard still answers false for a document that is not the client's pointer", async () => {
                const guard = new SbEformsignDocRepository(db as never);
                expect(await guard.isCurrentContractDocument(BRANCH, "doc-B")).toBe(false);
                expect(await guard.isCurrentContractDocument(BRANCH, "doc-C")).toBe(true);
                expect(await guard.isCurrentContractDocument(BRANCH, "doc-missing")).toBe(false);
            }, 30000);
        });

        it("promotes B (not the token's own document A) while the pointer lags and nothing else changes", async () => {
            const result = await new SbReceiptLinkTokenRepository(db as never).promoteReceiptRevisionArtifact(input);

            expect(result.disposition).toBe("promoted");
            expect(await tokenPath()).toBe("receipts/new.png");
        }, 30000);
    });

    describe("document purge vs linking (F4)", () => {
        // Supersede: the replacement B is the client's pointer and the old auto-registered A is purged
        // locally. A supersede records NO purge intent (eformsign.controller.ts), so a purge that is
        // aborted by a deadlock is never retried and A's customer data would stay.
        beforeEach(async () => {
            await db.$executeRawUnsafe(`UPDATE client SET e_doc_id = 'doc-B' WHERE id = ${CLIENT_ID}`);
            await db.$executeRawUnsafe(`UPDATE eformsign_doc SET auto_registered_client = true, status_type = '012',
                customer_name = 'fake-customer', customer_phone = '01099990000' WHERE document_id = 'doc-A'`);
        });

        const docA = async () => (await db.$queryRaw<Array<{
            customerName: string | null; statusType: string; clientId: number | null; kind: string | null;
        }>>(Prisma.sql`SELECT customer_name AS "customerName", status_type AS "statusType", client_id AS "clientId",
            document_kind AS kind FROM eformsign_doc WHERE document_id = 'doc-A'`))[0];
        const pointer = async () => (await db.$queryRaw<Array<{ e_doc_id: string | null }>>(
            Prisma.sql`SELECT e_doc_id FROM client WHERE id = ${CLIENT_ID}`))[0]?.e_doc_id;

        it("link holds the client first, purge arrives second: both complete, A is purged", async () => {
            const linkHasClient = deferred();
            const releaseLink = deferred();
            let paused = false;
            const link = new SbEformsignDocRepository(shimFor(other, async (query) => {
                if (!paused && isClientLock(query)) {
                    paused = true;
                    linkHasClient.resolve();
                    await releaseLink.promise;
                }
            }, { deadlockTimeout: true }) as never).linkClientIfActive(BRANCH, "doc-A", CLIENT_ID);

            await linkHasClient.promise;
            const purge = new SbEformsignDocumentMirrorRepository(shimFor(db, () => undefined, { deadlockTimeout: true }) as never)
                .purgeContent(["doc-A"], new Date("2026-09-08T00:00:00.000Z"));
            await waitForLockWaiter();
            await sleep(500);
            releaseLink.resolve();

            const outcomes = await Promise.allSettled([link, purge]);
            expectBothCompleted(outcomes);
            // B is newer than A, so the link refuses A; whichever order, A ends purged.
            expect(outcomes[0]).toEqual({ status: "fulfilled", value: false });
            expect(await docA()).toEqual({ customerName: null, statusType: "049", clientId: null, kind: null });
            expect(await pointer()).toBe("doc-B");
        }, 30000);

        it("purge holds the document first, link arrives second: both complete, A is purged and not linkable", async () => {
            const purgeHasDocument = deferred();
            const releasePurge = deferred();
            let paused = false;
            const purge = new SbEformsignDocumentMirrorRepository(shimFor(db, async (query) => {
                if (!paused && isAnyDocumentLock(query)) {
                    paused = true;
                    purgeHasDocument.resolve();
                    await releasePurge.promise;
                }
            }, { deadlockTimeout: true }) as never).purgeContent(["doc-A"], new Date("2026-09-08T00:00:00.000Z"));

            await purgeHasDocument.promise;
            const link = new SbEformsignDocRepository(shimFor(other, () => undefined, { deadlockTimeout: true }) as never)
                .linkClientIfActive(BRANCH, "doc-A", CLIENT_ID);
            await waitForLockWaiter();
            await sleep(500);
            releasePurge.resolve();

            const outcomes = await Promise.allSettled([link, purge]);
            expectBothCompleted(outcomes);
            expect(outcomes[0]).toEqual({ status: "fulfilled", value: false });
            expect(await docA()).toEqual({ customerName: null, statusType: "049", clientId: null, kind: null });
            expect(await pointer()).toBe("doc-B");
        }, 30000);

        it("a purge of a document pointed at by another client than its owner locks both clients first", async () => {
            // A is owned by client 7 but client 8's eDocId points at it: both client rows have to be
            // locked before the document or a link to client 8 could invert the order.
            await db.$executeRaw(Prisma.sql`INSERT INTO client VALUES (8, ${BRANCH}::uuid, NULL, now())`);
            await db.$executeRawUnsafe(`UPDATE client SET e_doc_id = NULL WHERE id = ${CLIENT_ID}`);
            await db.$executeRawUnsafe("UPDATE client SET e_doc_id = 'doc-A' WHERE id = 8");
            const linkHasClients = deferred();
            const releaseLink = deferred();
            let paused = false;
            const link = new SbEformsignDocRepository(shimFor(other, async (query) => {
                if (!paused && isClientLock(query)) {
                    paused = true;
                    linkHasClients.resolve();
                    await releaseLink.promise;
                }
            }, { deadlockTimeout: true }) as never).linkClientIfActive(BRANCH, "doc-A", 8);

            await linkHasClients.promise;
            const purge = new SbEformsignDocumentMirrorRepository(shimFor(db, () => undefined, { deadlockTimeout: true }) as never)
                .purgeContent(["doc-A"], new Date("2026-09-08T00:00:00.000Z"));
            await waitForLockWaiter();
            await sleep(500);
            releaseLink.resolve();

            expectBothCompleted(await Promise.allSettled([link, purge]));
            expect((await docA())?.statusType).toBe("049");
            // the purge clears every pointer at the purged document
            const pointers = await db.$queryRaw<Array<{ e_doc_id: string | null }>>(
                Prisma.sql`SELECT e_doc_id FROM client WHERE id IN (7, 8) AND e_doc_id = 'doc-A'`);
            expect(pointers).toEqual([]);
        }, 30000);

        it("a link that read the document before the delete's purge intent and the whole purge both complete", async () => {
            // The linker's first read of the document is unlocked, so the persisted intent and the
            // purge do not have to wait for it. Once released, the linker takes the client lock the
            // finished purge no longer holds and finds the document gone.
            const linkReadDocument = deferred();
            const releaseLink = deferred();
            let paused = false;
            const link = new SbEformsignDocRepository(shimFor(other, async (query) => {
                if (!paused && query.text.includes("FROM eformsign_doc")) {
                    paused = true;
                    linkReadDocument.resolve();
                    await releaseLink.promise;
                }
            }, { deadlockTimeout: true }) as never).linkClientIfActive(BRANCH, "doc-A", CLIENT_ID);

            await linkReadDocument.promise;
            const mirror = new SbEformsignDocumentMirrorRepository(db as never);
            expect(await mirror.requestPermanentPurge(["doc-A"])).toHaveLength(1);
            await mirror.purgeContent(["doc-A"], new Date("2026-09-08T00:00:00.000Z"));
            releaseLink.resolve();

            expect(await link).toBe(false);
            expect((await docA())?.statusType).toBe("049");
            expect(await pointer()).toBe("doc-B");
        }, 30000);

        it("a delete-origin purge with a persisted intent still completes next to a linker (existing behaviour)", async () => {
            const requests = await new SbEformsignDocumentMirrorRepository(db as never).requestPermanentPurge(["doc-A"]);
            expect(requests).toHaveLength(1);
            const link = new SbEformsignDocRepository(shimFor(other, () => undefined, { deadlockTimeout: true }) as never)
                .linkClientIfActive(BRANCH, "doc-A", CLIENT_ID);
            const purge = new SbEformsignDocumentMirrorRepository(shimFor(db, () => undefined, { deadlockTimeout: true }) as never)
                .purgeContent(["doc-A"], new Date("2026-09-08T00:00:00.000Z"));

            const outcomes = await Promise.allSettled([link, purge]);
            expectBothCompleted(outcomes);
            // the intent makes the document non-linkable
            expect(outcomes[0]).toEqual({ status: "fulfilled", value: false });
            expect((await docA())?.statusType).toBe("049");
        }, 30000);
    });
});
