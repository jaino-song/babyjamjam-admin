import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ExportClassification } from "domain/eformsign-backup/export/constants";
import bcrypt from "bcrypt";

import { generateExportToken, hashExportToken } from "domain/eformsign-backup/export/credential-token";
import { buildMinimalPdf } from "../infrastructure/eformsign-backup/worker/helpers/pdf-fixture-minimal";

export type Profile = "basic" | "pagination" | "kst";
export const COMPANY = "bjj-backup-qa-company";
export const PRINCIPAL = "bjj-backup-qa-worker";
export const A = "10000000-0000-4000-8000-000000000001";
export const B = "10000000-0000-4000-8000-000000000002";
export const USERS = [10, 11, 12].map(n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
export const TEMPLATE = "a".repeat(32);
export const RECORD_TEMPLATE = "b".repeat(32);
export const documentId = (n: number): string => `20000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const B_DOCUMENT = "30000000-0000-4000-8000-000000000001";
export function demand(ok: unknown, code = "FIXTURE_CONTRACT_REJECTED"): asserts ok {
    if (!ok) throw new Error(code);
}

// Frozen expectations: never use the production projector to construct this oracle.
export function frozenDocuments(profile: Profile) {
    const stages = ["created", "sent", "opened", "signed", "reviewed", "completed", "created", "sent", "reviewed", "completed"];
    const codes = ["001", "030", "034", "062", "072", "003", "001", "030", "072", "003"];
    // Characterized at frozen ea7513ab, independently of this fixture. Opened
    // remains filterable while raw 034 is unclassified by the export policy.
    const classifications: ExportClassification[] = [
        "excluded_by_policy", "excluded_by_policy", "policy_pending", "included", "included", "included",
        "excluded_by_policy", "excluded_by_policy", "included", "included",
    ];
    const rows = stages.map((stage, i) => ({
        documentId: documentId(i + 1), branchId: A, kind: i < 6 ? "contract" : "record", stage,
        statusType: codes[i]!, createdDate: new Date("2026-11-04T03:00:00.000Z"),
        classification: classifications[i]!,
    }));
    for (const [n, date] of [[11, "2026-11-03T14:59:59.999Z"], [12, "2026-11-03T15:00:00.000Z"]] as const) {
        rows.push({ documentId: documentId(n), branchId: A, kind: "contract", stage: "created", statusType: "001", createdDate: new Date(date), classification: "excluded_by_policy" });
    }
    if (profile === "pagination") for (let n = 1001; n <= 1121; n++) {
        rows.push({ documentId: documentId(n), branchId: A, kind: "contract", stage: "created", statusType: "001", createdDate: new Date("2026-11-05T03:00:00.000Z"), classification: "excluded_by_policy" });
    }
    rows.push({ documentId: B_DOCUMENT, branchId: B, kind: "record", stage: "created", statusType: "001", createdDate: new Date("2026-11-04T03:00:00.000Z"), classification: "excluded_by_policy" });
    return rows.sort((a, b) => a.documentId < b.documentId ? -1 : 1);
}
export function exerciseIntent(profile: Profile) {
    if (profile === "basic") return { scope: { period: "custom", start: "2026-11-04", end: "2026-11-04", kind: "record", contractStages: [], recordStages: ["reviewed"] }, ids: [documentId(9)], saved: 1, metadataOnly: 0 };
    if (profile === "pagination") return { scope: { period: "custom", start: "2026-11-05", end: "2026-11-05", kind: "contract", contractStages: ["created"], recordStages: [] }, ids: Array.from({ length: 121 }, (_, i) => documentId(1001 + i)), saved: 0, metadataOnly: 121 };
    return { scope: { period: "custom", start: "2026-11-04", end: "2026-11-04", kind: "contract", contractStages: ["created"], recordStages: [] }, ids: [documentId(1), documentId(12)], saved: 0, metadataOnly: 2 };
}

export interface PrivateCredentials { email: string; password: string }
export interface Seeded { accounts: PrivateCredentials[]; token: string; credentialId: string }
export async function seed(db: PrismaClient, profile: Profile, owner: PrivateCredentials): Promise<Seeded> {
    const accounts = [owner, { email: "backup-qa-viewer@example.invalid", password: randomBytes(32).toString("base64url") }, { email: "backup-qa-admin@example.invalid", password: randomBytes(32).toString("base64url") }];
    const token = generateExportToken();
    const credentialId = randomUUID();
    const hashes = await Promise.all(accounts.map(account => bcrypt.hash(account.password, 10)));
    await db.$transaction(async tx => {
        for (const [id, name, slug] of [[A, "백업 QA A", "backup-qa-a"], [B, "백업 QA B", "backup-qa-b"]]) {
            await tx.branch.create({ data: { id, name: name!, slug: slug!, isActive: true } });
        }
        for (let i = 0; i < accounts.length; i++) {
            await tx.user.create({ data: { id: USERS[i]!, email: accounts[i]!.email, passwordHash: hashes[i]!, name: "Backup QA", role: ["owner", "user", "admin"][i]!, approvalStatus: "approved", emailVerified: true, authProvider: "email", phone: `010000000${10 + i}`, birthDate: "1990-01-01" } });
            await tx.user_branch.create({ data: { id: `11000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, userId: USERS[i]!, branchId: A, role: i === 1 ? "user" : "admin" } });
        }
        await tx.user_branch.create({ data: { id: "11000000-0000-4000-8000-000000000004", userId: USERS[0]!, branchId: B, role: "admin" } });
        await tx.eformsign_backup_export_credential.create({ data: { id: credentialId, tokenHash: hashExportToken(token), principalId: PRINCIPAL, label: "Synthetic QA", companyIds: [COMPANY] } });
        for (const row of frozenDocuments(profile)) {
            const doc = await tx.eformsign_doc.create({ data: {
                documentId: row.documentId, branchId: row.branchId, documentKind: row.kind === "record" ? "service_record_snapshot" : "contract",
                templateId: row.kind === "record" ? RECORD_TEMPLATE : TEMPLATE,
                createdDate: row.createdDate, updatedDate: row.createdDate, statusType: row.statusType,
                statusDetail: "synthetic", stepType: "", stepIndex: "", stepName: "", stepRecipientType: "", stepRecipientName: "", stepRecipientSms: "",
                expiredDate: new Date("2099-01-01T00:00:00Z"), detailPayload: { synthetic: true }, syncStatus: "ready", voidedAt: null,
            } });
            if (row.classification === "included") for (const fileType of ["document", "audit_trail"]) {
                const bytes = buildMinimalPdf(`backup-qa ${row.documentId} ${fileType}`);
                await tx.eformsign_doc_file.create({ data: { eformsignDocId: doc.id, fileType, content: bytes as Uint8Array<ArrayBuffer>, contentType: "application/pdf", byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), sourceUpdatedDate: row.createdDate } });
            }
        }
    }, { timeout: 20_000 });
    return { accounts, token, credentialId };
}

/** Only these relationships may appear during exclusive fixture effects. No catch-all deletion. */
export async function attributableRows(db: PrismaClient, profile: Profile, credentialId: string, emails: string[]) {
    const docs = await db.eformsign_doc.findMany({ select: { id: true, documentId: true, branchId: true } });
    const expected = frozenDocuments(profile);
    demand(docs.length === expected.length && docs.every(d => expected.some(e => e.documentId === d.documentId && e.branchId === d.branchId)), "FOREIGN_DOCUMENT");
    const users = await db.user.findMany({ select: { id: true, email: true } });
    demand(users.length === 3 && users.every(u => USERS.includes(u.id) && emails.includes(u.email!)), "FOREIGN_USER");
    const branches = await db.branch.findMany({ select: { id: true } });
    demand(branches.length === 2 && branches.every(b => [A, B].includes(b.id)), "FOREIGN_BRANCH");
    const sessions = await db.auth_session.findMany({ select: { id: true, userId: true } });
    demand(sessions.every(s => USERS.includes(s.userId)), "FOREIGN_SESSION");
    const refresh = await db.auth_refresh_token.findMany({ select: { id: true, sessionId: true } });
    demand(refresh.every(t => sessions.some(s => s.id === t.sessionId)), "FOREIGN_REFRESH");
    const memberships = await db.user_branch.findMany({ select: { id: true, userId: true, branchId: true } });
    demand(memberships.length === 4 && memberships.every(m => USERS.includes(m.userId) && (m.branchId === A || (m.branchId === B && m.userId === USERS[0]))), "FOREIGN_MEMBERSHIP");
    const files = await db.eformsign_doc_file.findMany({ select: { id: true, eformsignDocId: true } });
    demand(files.every(f => docs.some(d => d.id === f.eformsignDocId)), "FOREIGN_FILE");
    const credentials = await db.eformsign_backup_export_credential.findMany({ select: { id: true } });
    demand(credentials.length === 1 && credentials[0]!.id === credentialId, "FOREIGN_CREDENTIAL");
    const snapshots = await db.eformsign_backup_export_snapshot.findMany({ select: { id: true, principalId: true, companyId: true } });
    demand(snapshots.every(s => s.principalId === PRINCIPAL && s.companyId === COMPANY), "FOREIGN_SNAPSHOT");
    const candidates = await db.eformsign_backup_export_candidate.findMany({ select: { snapshotId: true, ordinal: true, documentId: true } });
    demand(candidates.every(c => snapshots.some(s => s.id === c.snapshotId) && expected.some(e => e.documentId === c.documentId)), "FOREIGN_CANDIDATE");
    const runs = await db.eformsign_backup_run.findMany({ select: { id: true, companyId: true, branchId: true, requestedByUserId: true } });
    demand(runs.every(r => r.companyId === COMPANY && r.branchId === A && r.requestedByUserId === USERS[0]), "FOREIGN_RUN");
    const results = await db.eformsign_backup_run_document.findMany({ select: { runId: true, documentId: true, branchId: true } });
    demand(results.every(r => runs.some(run => run.id === r.runId) && r.branchId === A && expected.some(e => e.documentId === r.documentId && e.branchId === A)), "FOREIGN_RESULT");
    const allowedCounters = ["ip", "identity"].flatMap(scope => ["127.0.0.1", "::ffff:127.0.0.1"].flatMap(ip => (scope === "ip" ? [""] : emails.map(e => e.trim().toLowerCase())).map(email => createHash("sha256").update(`post:login:${scope}:${ip}:${email}`).digest("hex"))));
    const counters = await db.auth_rate_limit.findMany({ select: { keyHash: true } });
    demand(counters.every(c => allowedCounters.includes(c.keyHash)), "FOREIGN_COUNTER");
    return { docs, users: users.map(u => ({ id: u.id })), branches, sessions, refresh, memberships, files, credentials, snapshots, candidates, runs, results, counters, allowedCounters };
}

export const OWNED_TABLES = ["branch", "user", "user_branch", "auth_session", "auth_refresh_token", "auth_rate_limit", "eformsign_doc", "eformsign_doc_file", "eformsign_backup_export_credential", "eformsign_backup_export_snapshot", "eformsign_backup_export_candidate", "eformsign_backup_run", "eformsign_backup_run_document"];
export async function assertOtherTablesEmpty(db: PrismaClient, emptyAll = false): Promise<void> {
    const tables = await db.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
    for (const { tablename } of tables) {
        if (!emptyAll && OWNED_TABLES.includes(tablename)) continue;
        // Catalog identifiers only, quoted defensively; never accepts user SQL.
        const count = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM public."${tablename.replaceAll('"', '""')}"`);
        demand(count[0]?.n === 0n, "FOREIGN_ROWS");
    }
}
export async function cleanup(db: PrismaClient, profile: Profile, seeded: Seeded, record: (rows: unknown) => Promise<void>): Promise<void> {
    await assertOtherTablesEmpty(db);
    const rows = await attributableRows(db, profile, seeded.credentialId, seeded.accounts.map(a => a.email));
    await record(rows); // Private PK evidence survives a failed/interrupted teardown.
    await db.$transaction(async tx => {
        for (const r of rows.results) await tx.eformsign_backup_run_document.delete({ where: { runId_documentId: { runId: r.runId, documentId: r.documentId } } });
        for (const r of rows.runs) await tx.eformsign_backup_run.delete({ where: { id: r.id } });
        for (const c of rows.candidates) await tx.eformsign_backup_export_candidate.delete({ where: { snapshotId_ordinal: { snapshotId: c.snapshotId, ordinal: c.ordinal } } });
        for (const s of rows.snapshots) await tx.eformsign_backup_export_snapshot.delete({ where: { id: s.id } });
        for (const t of rows.refresh) await tx.auth_refresh_token.delete({ where: { id: t.id } });
        for (const s of rows.sessions) await tx.auth_session.delete({ where: { id: s.id } });
        for (const c of rows.counters) await tx.auth_rate_limit.delete({ where: { keyHash: c.keyHash } });
        for (const f of rows.files) await tx.eformsign_doc_file.delete({ where: { id: f.id } });
        for (const d of rows.docs) await tx.eformsign_doc.delete({ where: { id: d.id } });
        for (const c of rows.credentials) await tx.eformsign_backup_export_credential.delete({ where: { id: c.id } });
        for (const m of rows.memberships) await tx.user_branch.delete({ where: { id: m.id } });
        for (const u of rows.users) await tx.user.delete({ where: { id: u.id } });
        for (const b of rows.branches) await tx.branch.delete({ where: { id: b.id } });
    }, { timeout: 20_000 });
    await assertOtherTablesEmpty(db, true);
}
