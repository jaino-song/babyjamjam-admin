import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";

import { createContractDoc, d } from "./contracts-fixture";
import { applyStatusMigration } from "./status-migration-fixture";
import { createBranch } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";

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

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
    });

    beforeEach(() => { tracker = new RowTracker(); });

    afterEach(async () => {
        await tracker.cleanup(handle.raw);
    });

    afterAll(async () => { if (handle) await closeIntegrityPrisma(handle); });

    invariant("SI-CONTRACT-07", "the backfill matches normalizer aliases and trim without changing CAS timestamps", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const docs: Array<{ id: number; input: string }> = [];
        for (const input of aliases) {
            const doc = await createContractDoc(handle, tracker, branch.id, {
                statusType: input, createdDate: d("2026-10-01"), updatedDate: d("2026-10-05"),
            });
            docs.push({ id: doc.id, input });
        }
        expect(applyStatusMigration().status).toBe(0);
        const rows = await handle.raw.eformsign_doc.findMany({ where: { id: { in: docs.map(doc => doc.id) } } });
        const byId = new Map(rows.map(row => [row.id, row]));
        for (const doc of docs) {
            const row = byId.get(doc.id)!; // Every inserted fixture must still exist.
            expect(row.statusType).toBe(normalizeEformsignStatusCode(doc.input));
            expect(row.createdDate).toEqual(d("2026-10-01"));
            expect(row.updatedDate).toEqual(d("2026-10-05"));
        }
    });

    invariant("SI-CONTRACT-07", "unfixable values are left as is and the migration succeeds", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const docs: Array<{ id: number; input: string }> = [];
        for (const input of ["50", "doc_complete", "zz", "zz", "provider_new_status", "1000"]) {
            const doc = await createContractDoc(handle, tracker, branch.id, {
                statusType: input, createdDate: d("2026-10-01"), updatedDate: d("2026-10-05"),
            });
            docs.push({ id: doc.id, input });
        }
        expect(applyStatusMigration().status).toBe(0);
        for (const doc of docs) {
            const expected = doc.input === "50" ? "050" : doc.input === "doc_complete" ? "003" : doc.input;
            expect(await handle.raw.eformsign_doc.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({
                statusType: expected,
                createdDate: d("2026-10-01"),
                updatedDate: d("2026-10-05"),
            });
        }
        await expect(handle.raw.$queryRaw`SELECT convalidated FROM pg_constraint WHERE conrelid = 'eformsign_doc'::regclass AND conname = 'eformsign_doc_status_type_check'`)
            .resolves.toEqual([]);
        const firstRun = await handle.raw.eformsign_doc.findMany({ where: { id: { in: docs.map(doc => doc.id) } }, orderBy: { id: "asc" } });
        expect(applyStatusMigration().status).toBe(0);
        await expect(handle.raw.eformsign_doc.findMany({ where: { id: { in: docs.map(doc => doc.id) } }, orderBy: { id: "asc" } }))
            .resolves.toEqual(firstRun);
    });

    invariant("SI-CONTRACT-07", "unknown values beyond the former diagnostic cap all survive the migration", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const values = Array.from({ length: 22 }, (_, index) => `zz${String(index).padStart(2, "0")}`);
        const docs: Array<{ id: number; input: string }> = [];
        for (const input of [...values, values[0]!]) { // Duplicate must count as a row, not another value.
            const doc = await createContractDoc(handle, tracker, branch.id, { statusType: input });
            docs.push({ id: doc.id, input });
        }
        expect(applyStatusMigration().status).toBe(0);
        const rows = await handle.raw.eformsign_doc.findMany({ where: { id: { in: docs.map(doc => doc.id) } } });
        expect(rows).toHaveLength(docs.length);
        const byId = new Map(rows.map(row => [row.id, row.statusType]));
        for (const doc of docs) expect(byId.get(doc.id)).toBe(doc.input);
    });
});
