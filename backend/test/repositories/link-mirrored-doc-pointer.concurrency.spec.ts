import { Prisma, PrismaClient } from "@prisma/client";
import { LinkMirroredEformsignDocByPhoneUsecase } from "application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase";
import { ClientService } from "application/services/client.service";
import { ClientEntity } from "domain/entities/client.entity";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";

/**
 * Real-PostgreSQL specs for `LinkMirroredEformsignDocByPhoneUsecase` when another client still points
 * at the mirrored document (unique `client.e_doc_id`). Runs only when `B6_CONCURRENCY_DATABASE_URL`
 * names a DISPOSABLE loopback database called `g3_concurrency_*` (the spec DROPS the tables it uses):
 *
 *   initdb -D "$DIR" -U postgres --auth=trust
 *   pg_ctl -D "$DIR" -o "-p 62324 -c listen_addresses=127.0.0.1 -c unix_socket_directories=" -w start
 *   psql -h 127.0.0.1 -p 62324 -U postgres -c "create database g3_concurrency_b6"
 *   B6_CONCURRENCY_DATABASE_URL="postgresql://postgres@127.0.0.1:62324/g3_concurrency_b6" \
 *     NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand \
 *     test/repositories/link-mirrored-doc-pointer.concurrency.spec.ts
 *
 * Without the variable the suite is skipped (CI has no such database).
 */
const DATABASE_URL = process.env["B6_CONCURRENCY_DATABASE_URL"];
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;
const URL = DATABASE_URL ?? "";
if (DATABASE_URL) {
    const parsed = new globalThis.URL(DATABASE_URL);
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)
        || !parsed.pathname.startsWith("/g3_concurrency_")) {
        throw new Error("B6_CONCURRENCY_DATABASE_URL must be a loopback database named g3_concurrency_*");
    }
}
const BRANCH = "11111111-1111-4111-8111-111111111111";
const OTHER_BRANCH = "99999999-9999-4999-8999-999999999999";
const PHONE = "01012345678";
const generation = { detailSourceUpdatedDate: new Date("2026-09-01T00:00:00Z"), detailSyncedAt: new Date("2026-09-01T00:00:10Z") };
const options = { linkExistingOnly: true, existingClientId: 8, existingClientBranchId: BRANCH };
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { resolve, promise };
}
describeWithDatabase("mirrored phone link with another client pointing at the document (real PostgreSQL)", () => {
    let db!: PrismaClient;
    let other!: PrismaClient;
    let observer!: PrismaClient;
    beforeAll(async () => {
        db = new PrismaClient({ datasources: { db: { url: URL } } });
        other = new PrismaClient({ datasources: { db: { url: URL } } });
        observer = new PrismaClient({ datasources: { db: { url: URL } } });
        await db.$executeRawUnsafe("DROP TABLE IF EXISTS eformsign_doc_file, employee_schedule, service_record_case, eformsign_doc, client CASCADE");
        for (const sql of [
            `CREATE TABLE client (id int PRIMARY KEY, branch_id uuid, phone text, phone_normalized text, e_doc_id text UNIQUE, name text DEFAULT 'Client', UNIQUE(branch_id, phone_normalized))`,
            `CREATE TABLE eformsign_doc (id int PRIMARY KEY, document_id text UNIQUE, client_id int REFERENCES client(id), branch_id uuid, document_kind text, service_record_case_id uuid, revision_id uuid, template_id text, template_name text, step_recipient_sms text, customer_phone text, detail_payload jsonb, status_type text, created_date timestamptz, detail_source_updated_date timestamptz, detail_synced_at timestamptz, sync_status text, permanent_purge_requested_at timestamptz, auto_registered_client boolean DEFAULT false, updated_date timestamptz)`,
            `ALTER TABLE client ADD FOREIGN KEY (e_doc_id) REFERENCES eformsign_doc(document_id)`,
            `CREATE TABLE eformsign_doc_file (id int PRIMARY KEY, eformsign_doc_id int REFERENCES eformsign_doc(id), file_type text, source_updated_date timestamptz)`,
            `CREATE TABLE employee_schedule (id int PRIMARY KEY, branch_id uuid, client_id int, primary_employee_id int, secondary_employee_id int)`,
            `CREATE TABLE service_record_case (id uuid PRIMARY KEY, branch_id uuid, client_id int UNIQUE, current_revision_id uuid, current_usable_revision_id uuid, current_usable_document_version int)`,
        ]) await db.$executeRawUnsafe(sql);
    });
    beforeEach(async () => {
        await db.$executeRawUnsafe("TRUNCATE eformsign_doc_file, eformsign_doc, client, employee_schedule, service_record_case CASCADE");
        await db.$executeRaw(Prisma.sql`INSERT INTO client(id, branch_id, phone, phone_normalized) VALUES (7, ${BRANCH}::uuid, '010-9999-9999', '01099999999'), (8, ${BRANCH}::uuid, '010-1234-5678', ${PHONE})`);
        await db.$executeRaw(Prisma.sql`INSERT INTO eformsign_doc(id, document_id, branch_id, document_kind, template_id, step_recipient_sms, customer_phone, detail_payload, status_type, created_date, updated_date, detail_source_updated_date, detail_synced_at, sync_status) VALUES (20, 'doc-B', ${BRANCH}::uuid, 'contract', 'template-1', '010-1234-5678', ${PHONE}, '{}'::jsonb, '070', '2026-08-10', '2026-09-01', ${generation.detailSourceUpdatedDate}, ${generation.detailSyncedAt}, 'ready')`);
        await db.$executeRawUnsafe("INSERT INTO eformsign_doc_file VALUES (201, 20, 'document', '2026-09-01T00:00:00Z'), (202, 20, 'audit_trail', '2026-09-01T00:00:00Z')");
        await db.$executeRawUnsafe("UPDATE client SET e_doc_id = 'doc-B' WHERE id = 7");
    });
    afterAll(async () => { await Promise.all([db?.$disconnect(), other?.$disconnect(), observer?.$disconnect()]); });
    function shim(client: PrismaClient, hook: (q: Prisma.Sql) => Promise<void> | void = () => undefined) {
        return new Proxy(client, {
            get(target, key) {
                if (key === "$transaction") return (work: (tx: Prisma.TransactionClient) => Promise<unknown>, opts?: object) => target.$transaction(async (tx) => {
                    await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout = '200ms'");
                    const wrapped = new Proxy(tx, {
                        get(t, k) {
                            if (k === "$queryRaw") return async (q: Prisma.Sql) => {
                                const rows = await tx.$queryRaw(q);
                                await hook(q);
                                return rows;
                            };
                            return Reflect.get(t, k);
                        },
                    });
                    return work(wrapped);
                }, { ...opts, timeout: 12000 });
                return Reflect.get(target, key);
            },
        });
    }
    function mirror(prisma = shim(db)) {
        return new LinkMirroredEformsignDocByPhoneUsecase(prisma as never, { get: () => undefined } as never, { getClientAutoRegistrationEnabled: async () => false } as never, { forBranch: async () => KR_BUILTIN_CALENDAR } as never);
    }
    async function pointers() { return db.$queryRaw(Prisma.sql`SELECT id, e_doc_id FROM client ORDER BY id`); }
    async function waitForWaiter() {
        for (let i = 0; i < 150; i++) {
            const rows = await observer.$queryRaw<Array<{ pid: number }>>(Prisma.sql`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
            if (rows.length > 0) return;
            await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error("No real lock waiter");
    }
    it("unassigned same-branch mirror: client rows (id order) precede document rows and the pointer transfers", async () => {
        const queries: Prisma.Sql[] = [];
        expect(await mirror(shim(db, (q) => { queries.push(q); })).execute("doc-B", options, generation)).toBe("linked");
        expect(await pointers()).toEqual([{ id: 7, e_doc_id: null }, { id: 8, e_doc_id: "doc-B" }]);
        const locks = queries.filter((q) => /FOR UPDATE/.test(q.text));
        expect(locks[0]!.values).toEqual([7, 8]);
        const firstDocumentLock = locks.findIndex((q) => /eformsign_doc/.test(q.text));
        expect(firstDocumentLock).toBeGreaterThan(0);
        expect(locks.slice(firstDocumentLock + 1).some((q) => /FROM\s+"?client"?\b/.test(q.text))).toBe(false);
    });
    it("F2: a document already assigned to the target is repaired without P2002 and releases the other holder", async () => {
        await db.$executeRawUnsafe("UPDATE eformsign_doc SET client_id = 8 WHERE document_id = 'doc-B'");
        await expect(mirror().execute("doc-B", options, generation)).resolves.toBe("linked");
        expect(await pointers()).toEqual([{ id: 7, e_doc_id: null }, { id: 8, e_doc_id: "doc-B" }]);
    });
    it("F1: an older unassigned mirror moves to the target, the old holder is released and the target keeps its newer pointer", async () => {
        await db.$executeRaw(Prisma.sql`INSERT INTO eformsign_doc(id, document_id, client_id, branch_id, document_kind, created_date) VALUES (30, 'doc-C', 8, ${BRANCH}::uuid, 'contract', '2026-09-01')`);
        await db.$executeRawUnsafe("UPDATE client SET e_doc_id = 'doc-C' WHERE id = 8");
        expect(await mirror().execute("doc-B", options, generation)).toBe("linked");
        expect(await db.$queryRaw(Prisma.sql`SELECT client_id FROM eformsign_doc WHERE document_id = 'doc-B'`)).toEqual([{ client_id: 8 }]);
        expect(await pointers()).toEqual([{ id: 7, e_doc_id: null }, { id: 8, e_doc_id: "doc-C" }]);
    });
    it("cross-branch pointer holder: the link fails and the unauthorized pointer is not cleared", async () => {
        await db.$executeRaw(Prisma.sql`UPDATE client SET branch_id = ${OTHER_BRANCH}::uuid WHERE id = 7`);
        await expect(mirror().execute("doc-B", options, generation)).rejects.toMatchObject({ code: "P2002" });
        expect(await pointers()).toEqual([{ id: 7, e_doc_id: "doc-B" }, { id: 8, e_doc_id: null }]);
    });
    it("cross-branch pointer holder: the ready phone link fails and the unauthorized pointer is not cleared", async () => {
        await db.$executeRaw(Prisma.sql`UPDATE client SET branch_id = ${OTHER_BRANCH}::uuid WHERE id = 7`);
        const failures: unknown[] = [];
        const servicePrisma = new Proxy(shim(db), {
            get(t, k) {
                if (k === "$transaction") return async (...args: Parameters<typeof t.$transaction>) => {
                    try { return await Reflect.get(t, k)(...args); }
                    catch (e) { failures.push(e); throw e; }
                };
                return Reflect.get(t, k);
            },
        });
        const n = {} as never;
        const service = new ClientService(n, n, n, n, n, n, servicePrisma as never, n, n, { bumpVersion: async () => undefined, bumpCompanyEpoch: async () => undefined } as never, n, { forBranch: async () => KR_BUILTIN_CALENDAR } as never);
        const target = new ClientEntity(8, "Client", "address", "010-1234-5678", "A", 15, "100000", "50000", "50000", new Date("2024-01-01"), new Date("2024-06-01"), false, true, "900101", "pending", false, null);
        await (service as unknown as { linkContractDocumentsByPhone(b: string, c: ClientEntity, p: string): Promise<void> }).linkContractDocumentsByPhone(BRANCH, target, PHONE);
        expect(failures).toEqual([expect.objectContaining({ code: "P2002" })]);
        expect(await pointers()).toEqual([{ id: 7, e_doc_id: "doc-B" }, { id: 8, e_doc_id: null }]);
    });
    it.each(["mirror-first", "linker-first"])("mirror vs real linker, %s: actual contention, both complete", async (order) => {
        const held = deferred();
        const release = deferred();
        let paused = false;
        const hook = async (q: Prisma.Sql) => {
            if (!paused && /FROM\s+"?eformsign_doc"?\b/.test(q.text) && /FOR UPDATE/.test(q.text)) {
                paused = true;
                held.resolve();
                await release.promise;
            }
        };
        const first = order === "mirror-first"
            ? mirror(shim(db, hook)).execute("doc-B", options, generation)
            : new SbEformsignDocRepository(shim(other, hook) as never).linkClientIfActive(BRANCH, "doc-B", 7);
        await held.promise;
        const second = order === "mirror-first"
            ? new SbEformsignDocRepository(shim(other) as never).linkClientIfActive(BRANCH, "doc-B", 7)
            : mirror().execute("doc-B", options, generation);
        try { await waitForWaiter(); } finally { release.resolve(); }
        const outcomes = await Promise.allSettled([first, second]);
        expect(outcomes.every((x) => x.status === "fulfilled")).toBe(true);
        expect(await pointers()).toEqual([{ id: 7, e_doc_id: "doc-B" }, { id: 8, e_doc_id: null }]);
    }, 20000);
});
