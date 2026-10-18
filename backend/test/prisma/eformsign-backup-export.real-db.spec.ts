import { PrismaClient } from "@prisma/client";

function assertTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"]): void {
    if (!databaseUrl || !directUrl || databaseUrl !== directUrl
        || !/^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/.test(databaseUrl)) {
        throw new Error("Refusing export real-DB spec: matching local throwaway targets required");
    }
}
describe("export real-DB target guard", () => {
    it("refuses missing, mismatched and non-disposable targets", () => {
        const url = "postgresql://test@localhost/throwaway_export";
        expect(() => assertTarget(url, url)).not.toThrow();
        for (const [a, b] of [["", ""], [url, "other"], ["postgresql://test@remote/throwaway_export", "postgresql://test@remote/throwaway_export"],
            ["postgresql://test@localhost/production", "postgresql://test@localhost/production"]]) {
            expect(() => assertTarget(a, b)).toThrow("Refusing");
        }
    });
});

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const HEX_D = "d".repeat(64);
const TABLES = [
    "eformsign_backup_export_credential",
    "eformsign_backup_export_snapshot",
    "eformsign_backup_export_candidate",
];
// Synthetic principal: every row this spec writes carries it, so cleanup never
// touches rows another spec left in the shared CI database.
const PRINCIPAL = "u31-schema-spec";

const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;
describeReal("backup export tables (real PostgreSQL; requires generated additive migration)", () => {
    let prisma: PrismaClient;
    let keySeq = 0;
    const nextKey = (): string => `u31-key-${process.pid}-${keySeq++}`;

    const newSnapshot = (data: Record<string, unknown> = {}) => prisma.eformsign_backup_export_snapshot.create({
        data: { principalId: PRINCIPAL, companyId: "company-test", scopeRevision: "scope-test", policyRevision: "policy-test",
            idempotencyKey: nextKey(), requestHash: HEX_A, status: "building", ...data } as never,
    });
    const candidateData = (snapshotId: string, data: Record<string, unknown> = {}) => ({
        snapshotId, ordinal: 1, documentId: "D001", classification: "excluded_by_policy", reasons: ["incomplete-no-file"],
        statusType: "002", documentKind: "contract", metadataRevision: HEX_A, ...data,
    });
    const newCandidate = (snapshotId: string, data: Record<string, unknown> = {}) =>
        prisma.eformsign_backup_export_candidate.create({ data: candidateData(snapshotId, data) as never });
    const credentialData = (data: Record<string, unknown> = {}) => ({
        principalId: PRINCIPAL, label: "schema-spec", tokenHash: HEX_A, companyIds: ["company-test"], ...data,
    });
    const rejectedBy = async (action: Promise<unknown>, constraint: string): Promise<void> => {
        const error = await action.then(() => null, (e: unknown) => e as Error);
        expect(error).not.toBeNull();
        expect(String(error?.message)).toContain(constraint);
    };

    // Prisma reports a unique violation by its column list rather than the index name.
    const duplicateOn = async (action: Promise<unknown>, columns: string[]): Promise<void> => {
        const error = await action.then(() => null, (e: unknown) => e as Error & { code?: string });
        expect(error).not.toBeNull();
        expect((error as { code?: string }).code).toBe("P2002");
        expect(String(error?.message)).toContain(`(${columns.map(column => `\`${column}\``).join(",")})`);
    };

    beforeAll(async () => { assertTarget(); prisma = new PrismaClient(); await prisma.$connect(); });
    afterAll(async () => {
        if (!prisma) return;
        await prisma.eformsign_backup_export_snapshot.deleteMany({ where: { principalId: { startsWith: PRINCIPAL } } });
        await prisma.eformsign_backup_export_credential.deleteMany({ where: { principalId: { startsWith: PRINCIPAL } } });
        await prisma.$disconnect();
    });
    afterEach(async () => {
        await prisma.eformsign_backup_export_snapshot.deleteMany({ where: { principalId: { startsWith: PRINCIPAL } } });
        await prisma.eformsign_backup_export_credential.deleteMany({ where: { principalId: { startsWith: PRINCIPAL } } });
    });

    describe("CHECK constraints", () => {
        it("credential accepts a valid row and rejects a bad token hash or an empty company list", async () => {
            await expect(prisma.eformsign_backup_export_credential.create({ data: credentialData() })).resolves.toBeDefined();
            for (const tokenHash of ["Z".repeat(64), "A".repeat(64), "a".repeat(63) + " ", "0".repeat(32)]) {
                await rejectedBy(prisma.eformsign_backup_export_credential.create({ data: credentialData({ tokenHash }) }),
                    "chk_export_credential_token_hash_hex");
            }
            await rejectedBy(prisma.eformsign_backup_export_credential.create({ data: credentialData({ tokenHash: HEX_B, companyIds: [] }) }),
                "chk_export_credential_company_ids_nonempty");
        });

        it("snapshot rejects a bad status, a bad request hash and a ready row without its ready fields", async () => {
            await expect(newSnapshot()).resolves.toBeDefined();
            await rejectedBy(newSnapshot({ status: "queued" }), "chk_export_snapshot_status");
            await rejectedBy(newSnapshot({ requestHash: "not-hex" }), "chk_export_snapshot_request_hash_hex");
            const now = new Date();
            const ready = { status: "ready", readyAt: now, expiresAt: new Date(now.getTime() + 86_400_000), counts: { total: 0 } };
            await expect(newSnapshot(ready)).resolves.toBeDefined();
            await rejectedBy(newSnapshot({ ...ready, expiresAt: null }), "chk_export_snapshot_ready_fields");
            await rejectedBy(newSnapshot({ ...ready, readyAt: null }), "chk_export_snapshot_ready_fields");
            await rejectedBy(newSnapshot({ ...ready, counts: undefined }), "chk_export_snapshot_ready_fields");
            // The ready requirement does not bind a failed row.
            await expect(newSnapshot({ status: "failed", failureCode: "invariant" })).resolves.toBeDefined();
        });

        it("candidate rejects a bad classification, ordinal 0, half-filled file triples, bad hex and negative sizes", async () => {
            const { id } = await newSnapshot();
            await expect(newCandidate(id)).resolves.toBeDefined();
            await rejectedBy(newCandidate(id, { ordinal: 2, documentId: "D002", classification: "other" }),
                "chk_export_candidate_classification");
            await rejectedBy(newCandidate(id, { ordinal: 0, documentId: "D003" }), "chk_export_candidate_ordinal_positive");
            await rejectedBy(newCandidate(id, { ordinal: -1, documentId: "D003" }), "chk_export_candidate_ordinal_positive");
            await rejectedBy(newCandidate(id, { ordinal: 2, documentId: "D004", metadataRevision: "xyz" }),
                "chk_export_candidate_metadata_revision_hex");

            const file = { documentSha256: HEX_B, documentByteSize: 10, documentArtifactIdentity: HEX_C };
            const auditFile = { auditTrailSha256: HEX_B, auditTrailByteSize: 10, auditTrailArtifactIdentity: HEX_D };
            await expect(newCandidate(id, { ordinal: 2, documentId: "D005", classification: "included", ...file, ...auditFile }))
                .resolves.toBeDefined();
            await expect(newCandidate(id, { ordinal: 3, documentId: "D006", classification: "included", ...file }))
                .resolves.toBeDefined();
            for (const omit of ["documentSha256", "documentByteSize", "documentArtifactIdentity"]) {
                const half = { ...file, ...auditFile } as Record<string, unknown>;
                delete half[omit];
                await rejectedBy(newCandidate(id, { ordinal: 9, documentId: "D007", ...half }), "chk_export_candidate_document_all_or_none");
            }
            for (const omit of ["auditTrailSha256", "auditTrailByteSize", "auditTrailArtifactIdentity"]) {
                const half = { ...file, ...auditFile } as Record<string, unknown>;
                delete half[omit];
                await rejectedBy(newCandidate(id, { ordinal: 9, documentId: "D008", ...half }), "chk_export_candidate_audit_trail_all_or_none");
            }
            await rejectedBy(newCandidate(id, { ordinal: 9, documentId: "D009", ...file, documentSha256: "G".repeat(64) }),
                "chk_export_candidate_sha256_hex");
            await rejectedBy(newCandidate(id, { ordinal: 9, documentId: "D009", ...file, documentArtifactIdentity: "short" }),
                "chk_export_candidate_sha256_hex");
            await rejectedBy(newCandidate(id, { ordinal: 9, documentId: "D009", ...auditFile, auditTrailSha256: HEX_B.toUpperCase() }),
                "chk_export_candidate_sha256_hex");
            await rejectedBy(newCandidate(id, { ordinal: 9, documentId: "D009", ...file, documentByteSize: -1 }),
                "chk_export_candidate_byte_size_nonneg");
            await expect(newCandidate(id, { ordinal: 10, documentId: "D010", classification: "included", ...file, documentByteSize: 0 }))
                .resolves.toBeDefined();
        });

        it("candidate keeps an unmapped raw status name of any length in text columns", async () => {
            const { id } = await newSnapshot();
            const statusType = "doc_request_something_".repeat(20);
            const documentId = "D".repeat(300);
            await newCandidate(id, { classification: "policy_pending", reasons: ["status-unclassified"], statusType, documentId });
            const row = await prisma.eformsign_backup_export_candidate.findFirstOrThrow({ where: { snapshotId: id } });
            expect(row.statusType).toBe(statusType);
            expect(row.documentId).toBe(documentId);
        });
    });

    describe("uniqueness and cascade", () => {
        it("rejects a repeated (principal, idempotency key) and a repeated (snapshot, document)", async () => {
            const key = nextKey();
            await newSnapshot({ idempotencyKey: key });
            await duplicateOn(newSnapshot({ idempotencyKey: key }), ["principal_id", "idempotency_key"]);
            // A different principal may reuse the key.
            await expect(newSnapshot({ idempotencyKey: key, principalId: `${PRINCIPAL}-b` })).resolves.toBeDefined();
            const { id } = await newSnapshot();
            await newCandidate(id);
            await duplicateOn(newCandidate(id, { ordinal: 2 }), ["snapshot_id", "document_id"]);
            await duplicateOn(newCandidate(id, { documentId: "D002" }), ["snapshot_id", "ordinal"]);
        });

        it("rejects a repeated token hash", async () => {
            await prisma.eformsign_backup_export_credential.create({ data: credentialData() });
            await duplicateOn(prisma.eformsign_backup_export_credential.create({ data: credentialData({ principalId: `${PRINCIPAL}-b` }) }),
                ["token_hash"]);
        });

        it("deletes a snapshot's candidates with it and rejects a candidate without a snapshot", async () => {
            const { id } = await newSnapshot();
            await newCandidate(id);
            await newCandidate(id, { ordinal: 2, documentId: "D002" });
            const other = await newSnapshot();
            await newCandidate(other.id);
            expect(await prisma.eformsign_backup_export_candidate.count({ where: { snapshotId: id } })).toBe(2);
            await prisma.eformsign_backup_export_snapshot.delete({ where: { id } });
            expect(await prisma.eformsign_backup_export_candidate.count({ where: { snapshotId: id } })).toBe(0);
            expect(await prisma.eformsign_backup_export_candidate.count({ where: { snapshotId: other.id } })).toBe(1);
            await rejectedBy(newCandidate("00000000-0000-4000-8000-000000000000"), "eformsign_backup_export_candidate_snapshot_id_fkey");
        });

        it("has no foreign key from a candidate to eformsign_doc", async () => {
            const fks = await prisma.$queryRaw<Array<{ conname: string; target: string }>>`
                SELECT c.conname, c.confrelid::regclass::text AS target
                FROM pg_constraint c
                WHERE c.contype = 'f' AND c.conrelid = 'public.eformsign_backup_export_candidate'::regclass`;
            expect(fks).toEqual([{ conname: "eformsign_backup_export_candidate_snapshot_id_fkey", target: "eformsign_backup_export_snapshot" }]);
        });
    });

    describe("privacy", () => {
        it("keeps all three tables as private as the collection ledger and closed to general API roles", async () => {
            const names = ["eformsign_backup_collection_run", ...TABLES];
            const rls = await prisma.$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>`
                SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = ANY(${names}::text[])`;
            const rlsOf = (name: string) => rls.find(row => row.relname === name)?.relrowsecurity;
            expect(rlsOf("eformsign_backup_collection_run")).toBeDefined();
            for (const table of TABLES) expect(rlsOf(table)).toBe(rlsOf("eformsign_backup_collection_run"));

            const roles = await prisma.$queryRaw<Array<{ rolname: string }>>`
                SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`;
            for (const { rolname } of roles) for (const table of TABLES) {
                const rows = await prisma.$queryRaw<Array<{ held: boolean; columns: boolean }>>`
                    SELECT has_table_privilege(${rolname}::text, ${`public.${table}`}::text, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS held,
                           has_any_column_privilege(${rolname}::text, ${`public.${table}`}::text, 'SELECT,INSERT,UPDATE,REFERENCES') AS columns`;
                expect({ rolname, table, held: rows[0]?.held, columns: rows[0]?.columns })
                    .toEqual({ rolname, table, held: false, columns: false });
            }
        });
    });
});
