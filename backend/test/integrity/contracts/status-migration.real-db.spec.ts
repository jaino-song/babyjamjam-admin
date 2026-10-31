import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";

import { createContractDoc, d } from "./contracts-fixture";
import { createBranch } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";

const migration = resolve(__dirname, "../../../prisma/migrations/20261031000100_eformsign_doc_status_type_check/migration.sql");
const aliases = [
    "doc_tempsave", "doc_create", "doc_complete", "doc_request_approval",
    "doc_reject_approval", "doc_accept_approval", "doc_request_reception",
    "doc_reject_reception", "doc_accept_reception", "doc_request_outsider",
    "doc_reject_outsider", "doc_accept_outsider", "doc_request_revoke",
    "doc_refuse_revoke", "doc_revoke", "doc_update", "doc_request_reject",
    "doc_request_delete", "doc_delete", "doc_request_participant",
    "doc_reject_participant", "doc_accept_participant", "doc_rerequest_participant",
    "doc_open_participant", "doc_request_reviewer", "doc_reject_reviewer",
    "doc_accept_reviewer", "doc_expired", "face_signature_complete",
    "50", "7", "999", "000", "", " \t50\n", "\uFEFF DOC_COMPLETE \u00A0",
    "v50", "50v", "\v50",
    // Every ECMAScript trim code point, plus non-trim Unicode controls.
    ...[0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680,
        0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
        0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
        0x205f, 0x3000, 0xfeff, 0x85, 0x180e, 0x200b].map(code => `${String.fromCodePoint(code)}50${String.fromCodePoint(code)}`),
];

describeReal("eformsign status migration (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;

    const applyPatch = () => {
        assertThrowawayTarget();
        const result = spawnSync("pnpm", [
            "exec", "prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", migration,
        ], { cwd: resolve(__dirname, "../../.."), encoding: "utf8", stdio: "pipe" });
        if (result.error) throw result.error;
        return result;
    };

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
    });

    beforeEach(() => { tracker = new RowTracker(); });

    afterEach(async () => {
        await tracker.cleanup(handle.raw);
        expect(applyPatch().status).toBe(0);
    });

    afterAll(async () => { if (handle) await closeIntegrityPrisma(handle); });

    invariant("SI-CONTRACT-07", "the backfill matches normalizer aliases and trim without changing CAS timestamps", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const docs: Array<{ id: number; input: string }> = [];
        for (const input of aliases) {
            const doc = await createContractDoc(handle, tracker, branch.id, {
                statusType: "060", createdDate: d("2026-10-01"), updatedDate: d("2026-10-05"),
            });
            docs.push({ id: doc.id, input });
        }
        // Exercise the actual backfill separately: invalid aliases must remain invalid,
        // while the full patch below must reject them and roll back all changes.
        const sql = readFileSync(migration, "utf8");
        const backfill = sql.slice(sql.indexOf("WITH aliases"), sql.indexOf("DO $$"));
        await handle.raw.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("ALTER TABLE eformsign_doc DROP CONSTRAINT eformsign_doc_status_type_check");
            for (const doc of docs) {
                await tx.$executeRaw`UPDATE eformsign_doc SET status_type = ${doc.input} WHERE id = ${doc.id}`;
            }
            await tx.$executeRawUnsafe(backfill);
            const rows = await tx.eformsign_doc.findMany({ where: { id: { in: docs.map(doc => doc.id) } } });
            const byId = new Map(rows.map(row => [row.id, row]));
            for (const doc of docs) {
                const row = byId.get(doc.id)!; // Every inserted fixture must still exist.
                expect(row.statusType).toBe(normalizeEformsignStatusCode(doc.input));
                expect(row.createdDate).toEqual(d("2026-10-01"));
                expect(row.updatedDate).toEqual(d("2026-10-05"));
            }
            await tx.eformsign_doc.deleteMany({ where: { id: { in: docs.map(doc => doc.id) } } });
            await tx.$executeRawUnsafe("ALTER TABLE eformsign_doc ADD CONSTRAINT eformsign_doc_status_type_check CHECK (status_type ~ '^[0-9]{3}$')");
        });
    });

    invariant("SI-CONTRACT-07", "prisma db execute fails visibly and rolls back every rewrite and constraint until unfixable rows are removed", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const docs: Array<{ id: number; input: string }> = [];
        for (const input of ["50", "doc_complete", "zz", "zz", "provider_new_status", "1000"]) {
            const doc = await createContractDoc(handle, tracker, branch.id);
            docs.push({ id: doc.id, input });
        }
        await handle.raw.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("ALTER TABLE eformsign_doc DROP CONSTRAINT eformsign_doc_status_type_check");
            for (const doc of docs) {
                await tx.$executeRaw`UPDATE eformsign_doc SET status_type = ${doc.input} WHERE id = ${doc.id}`;
            }
        });
        const before = await handle.raw.eformsign_doc.findMany({ where: { id: { in: docs.map(doc => doc.id) } }, orderBy: { id: "asc" } });
        const failed = applyPatch();
        expect(failed.status).not.toBe(0);
        expect(failed.stderr).toContain("4 invalid rows");
        expect(failed.stderr).toContain('["1000", "provider_new_status", "zz"]');
        await expect(handle.raw.eformsign_doc.findMany({ where: { id: { in: docs.map(doc => doc.id) } }, orderBy: { id: "asc" } }))
            .resolves.toEqual(before);
        await expect(handle.raw.$queryRaw`SELECT convalidated FROM pg_constraint WHERE conrelid = 'eformsign_doc'::regclass AND conname = 'eformsign_doc_status_type_check'`)
            .resolves.toEqual([]);

        await handle.raw.eformsign_doc.deleteMany({
            where: { id: { in: docs.filter(doc => !/^[0-9]{3}$/.test(normalizeEformsignStatusCode(doc.input))).map(doc => doc.id) } },
        });
        expect(applyPatch().status).toBe(0);
        expect(applyPatch().status).toBe(0);
        for (const doc of docs.filter(doc => /^[0-9]{3}$/.test(normalizeEformsignStatusCode(doc.input)))) {
            await expect(handle.raw.eformsign_doc.findUniqueOrThrow({ where: { id: doc.id } }))
                .resolves.toMatchObject({ statusType: normalizeEformsignStatusCode(doc.input) });
        }
        await expect(handle.raw.$queryRaw`SELECT convalidated FROM pg_constraint WHERE conrelid = 'eformsign_doc'::regclass AND conname = 'eformsign_doc_status_type_check'`)
            .resolves.toEqual([{ convalidated: true }]);

        await handle.raw.$executeRawUnsafe("ALTER TABLE eformsign_doc DROP CONSTRAINT eformsign_doc_status_type_check");
        await handle.raw.$executeRawUnsafe("ALTER TABLE eformsign_doc ADD CONSTRAINT eformsign_doc_status_type_check CHECK (status_type ~ '^[0-9]{3}$') NOT VALID");
        expect(applyPatch().status).toBe(0);
        await expect(handle.raw.$queryRaw`SELECT convalidated FROM pg_constraint WHERE conrelid = 'eformsign_doc'::regclass AND conname = 'eformsign_doc_status_type_check'`)
            .resolves.toEqual([{ convalidated: true }]);
    });

    invariant("SI-CONTRACT-07", "failure diagnostics count all rows but cap distinct offending values at twenty", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const values = Array.from({ length: 22 }, (_, index) => `zz${String(index).padStart(2, "0")}`);
        const docs: Array<{ id: number; input: string }> = [];
        for (const input of [...values, values[0]!]) { // Duplicate must count as a row, not another value.
            const doc = await createContractDoc(handle, tracker, branch.id);
            docs.push({ id: doc.id, input });
        }
        await handle.raw.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("ALTER TABLE eformsign_doc DROP CONSTRAINT eformsign_doc_status_type_check");
            for (const doc of docs) {
                await tx.$executeRaw`UPDATE eformsign_doc SET status_type = ${doc.input} WHERE id = ${doc.id}`;
            }
        });
        const failed = applyPatch();
        expect(failed.status).not.toBe(0);
        expect(failed.stderr).toContain("23 invalid rows");
        const diagnostic = failed.stderr.match(/offending values \(up to 20\): (\[[^\n]+\])/);
        expect(diagnostic).not.toBeNull();
        expect(JSON.parse(diagnostic![1]!)).toEqual(values.slice(0, 20)); // The match above must contain the JSON list.
    });
});
