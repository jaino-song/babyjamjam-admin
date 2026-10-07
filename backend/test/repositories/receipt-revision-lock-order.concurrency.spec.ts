import { Prisma, PrismaClient } from "@prisma/client";

import type { PromoteReceiptLinkRevisionArtifactInput } from "domain/repositories/receipt-link-token.repository.interface";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { lockClientOwnedContractDocuments } from "infrastructure/database/repositories/service-record-edit.repository";

/**
 * Real-PostgreSQL concurrency specs for the lock order shared by service-record confirmation,
 * receipt promotion and document linking. They cannot be proven with mocked transactions, so they
 * only run when `G3_CONCURRENCY_DATABASE_URL` points at a DISPOSABLE local database:
 *
 *   initdb -D "$DIR" -U postgres --auth=trust
 *   pg_ctl -D "$DIR" -o "-p 62301 -c listen_addresses=127.0.0.1 -k /tmp/g3sock" -w start
 *   psql -h 127.0.0.1 -p 62301 -U postgres -c "create database g3_concurrency_fix1"
 *   G3_CONCURRENCY_DATABASE_URL="postgresql://postgres@127.0.0.1:62301/g3_concurrency_fix1" \
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

    beforeAll(async () => {
        assertDisposable(DATABASE_URL!);
        db = new PrismaClient({ datasources: { db: { url: DATABASE_URL! } } });
        other = new PrismaClient({ datasources: { db: { url: DATABASE_URL! } } });
        const statements = [
            `DROP TABLE IF EXISTS receipt_link_token, service_record_revision_document_state, service_record_revision,
                service_record_case, eformsign_doc, client CASCADE`,
            `CREATE TABLE client (id int PRIMARY KEY, branch_id uuid, e_doc_id text, updated_at timestamptz)`,
            `CREATE TABLE eformsign_doc (
                id int PRIMARY KEY, document_id text UNIQUE, client_id int REFERENCES client(id), branch_id uuid,
                document_kind text, service_record_case_id uuid, revision_id uuid, template_id text,
                created_date timestamptz, updated_date timestamptz, status_type text,
                permanent_purge_requested_at timestamptz, auto_registered_client boolean)`,
            `CREATE TABLE service_record_case (id uuid PRIMARY KEY, branch_id uuid, client_id int,
                current_revision_id uuid, current_usable_revision_id uuid, current_usable_document_version int)`,
            `CREATE TABLE service_record_revision (id uuid PRIMARY KEY, branch_id uuid, service_record_case_id uuid)`,
            `CREATE TABLE service_record_revision_document_state (id uuid PRIMARY KEY, branch_id uuid, client_id int,
                service_record_case_id uuid, revision_id uuid, generation text, version int, operation text,
                source_document_id text, target_document_id text, document_version int, template_id text,
                template_version text, mirror_generation text, output_proof jsonb, status text, step text,
                last_error_code text, updated_at timestamptz)`,
            `CREATE TABLE receipt_link_token (id uuid PRIMARY KEY, eformsign_doc_id int, branch_id uuid,
                client_id int, active boolean, expires_at timestamptz, storage_path text, content_sha256 text, byte_size int)`,
        ];
        for (const statement of statements) await db.$executeRawUnsafe(statement);
    });

    afterAll(async () => {
        await db?.$disconnect();
        await other?.$disconnect();
    });

    beforeEach(async () => {
        await db.$executeRawUnsafe(
            "TRUNCATE receipt_link_token, service_record_revision_document_state, service_record_revision, service_record_case, eformsign_doc, client CASCADE",
        );
        // The client's pointer lags: it still points at A while B is the newest contract.
        await db.$executeRaw(Prisma.sql`INSERT INTO client VALUES (${CLIENT_ID}, ${BRANCH}::uuid, 'doc-A', now())`);
        await db.$executeRaw(Prisma.sql`INSERT INTO eformsign_doc
            (id, document_id, client_id, branch_id, document_kind, template_id, created_date, updated_date, status_type)
            VALUES (10, 'doc-A', ${CLIENT_ID}, ${BRANCH}::uuid, 'contract', 'template-1', '2026-08-01', '2026-09-01', '070'),
                   (20, 'doc-B', ${CLIENT_ID}, ${BRANCH}::uuid, 'contract', 'template-1', '2026-08-10', '2026-09-01', '070'),
                   (30, 'doc-C', ${CLIENT_ID}, ${BRANCH}::uuid, 'contract', 'template-1', '2026-08-05', '2026-09-01', '070'),
                   (50, 'doc-S', ${CLIENT_ID}, ${BRANCH}::uuid, 'service_record_snapshot', 'template-1', '2026-08-25', '2026-09-01', '070')`);
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

        it("promotes B (not the token's own document A) while the pointer lags and nothing else changes", async () => {
            const result = await new SbReceiptLinkTokenRepository(db as never).promoteReceiptRevisionArtifact(input);

            expect(result.disposition).toBe("promoted");
            expect(await tokenPath()).toBe("receipts/new.png");
        }, 30000);
    });
});
