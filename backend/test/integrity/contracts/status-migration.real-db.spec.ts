import { spawnSync } from "node:child_process";
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
];

describeReal("eformsign status migration (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;

    const applyPatch = () => {
        assertThrowawayTarget();
        const result = spawnSync("psql", [
            process.env["DIRECT_URL"]!, "-X", "-v", "ON_ERROR_STOP=1", "-f", migration,
        ], { encoding: "utf8", stdio: "pipe" }); // The guard above validates both URLs.
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(result.stderr);
        return result.stderr;
    };

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) {
            applyPatch();
            await closeIntegrityPrisma(handle);
        }
    });

    invariant("SI-CONTRACT-07", "the repeatable patch backfills aliases without changing CAS timestamps and defers validation for unknown legacy values", async () => {
        const branch = await createBranch(handle.raw, tracker);
        const values = [...aliases, "provider_new_status", "1000"];
        const docs: Array<{ id: number; input: string }> = [];
        for (const input of values) {
            const doc = await createContractDoc(handle, tracker, branch.id, {
                statusType: "060", createdDate: d("2026-10-01"), updatedDate: d("2026-10-05"),
            });
            docs.push({ id: doc.id, input });
        }
        // Emulate pre-patch historical data atomically; leave the CHECK enforcing new writes.
        await handle.raw.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("ALTER TABLE eformsign_doc DROP CONSTRAINT eformsign_doc_status_type_check");
            for (const doc of docs) {
                await tx.$executeRaw`UPDATE eformsign_doc SET status_type = ${doc.input} WHERE id = ${doc.id}`;
            }
            await tx.$executeRawUnsafe("ALTER TABLE eformsign_doc ADD CONSTRAINT eformsign_doc_status_type_check CHECK (status_type ~ '^[0-9]{3}$') NOT VALID");
        });

        for (let run = 0; run < 2; run += 1) {
            expect(applyPatch()).toContain("remains NOT VALID: 2 invalid rows");
            const rows = await handle.raw.eformsign_doc.findMany({ where: { id: { in: docs.map(doc => doc.id) } } });
            const byId = new Map(rows.map(row => [row.id, row]));
            for (const doc of docs) {
                const row = byId.get(doc.id)!; // Every inserted fixture must still exist.
                expect(row.statusType).toBe(normalizeEformsignStatusCode(doc.input));
                expect(row.createdDate).toEqual(d("2026-10-01"));
                expect(row.updatedDate).toEqual(d("2026-10-05"));
            }
            await expect(handle.raw.$queryRaw`SELECT convalidated FROM pg_constraint WHERE conrelid = 'eformsign_doc'::regclass AND conname = 'eformsign_doc_status_type_check'`)
                .resolves.toEqual([{ convalidated: false }]);
        }

        await handle.raw.eformsign_doc.deleteMany({
            where: { id: { in: docs.filter(doc => !/^[0-9]{3}$/.test(normalizeEformsignStatusCode(doc.input))).map(doc => doc.id) } },
        });
        applyPatch();
        applyPatch();
        await expect(handle.raw.$queryRaw`SELECT convalidated FROM pg_constraint WHERE conrelid = 'eformsign_doc'::regclass AND conname = 'eformsign_doc_status_type_check'`)
            .resolves.toEqual([{ convalidated: true }]);
    });
});
