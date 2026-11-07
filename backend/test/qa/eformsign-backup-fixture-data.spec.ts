import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { A, B, COMPANY, PRINCIPAL, USERS, attributableRows, cleanup, frozenDocuments } from "./eformsign-backup-fixture-data";
import type { Profile, Seeded } from "./eformsign-backup-fixture-data";

// Importing this test must never load generated Prisma or discover private env files.
jest.mock("@prisma/client", () => { throw new Error("INERT_IMPORT_LOADED_PRISMA"); });

// Independent literal supplied by Main; never derived from the fixture's allowedCounters.
const REFRESH_IP_HASH = "fb1af2630cf1d53ee8906dee716e1e3288d37a98c8949989e8dbc68b4800a612";
const EMAILS = ["owner@example.invalid", "viewer@example.invalid", "admin@example.invalid"];
const CREDENTIAL_ID = "synthetic-credential";
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
const LOGIN_KEYS = [
    "post:login:ip:127.0.0.1:",
    "post:login:ip:::ffff:127.0.0.1:",
    ...EMAILS.flatMap(email => [
        `post:login:identity:127.0.0.1:${email}`,
        `post:login:identity:::ffff:127.0.0.1:${email}`,
    ]),
];
const LOGIN_HASHES = LOGIN_KEYS.map(hashKey);
const SEEDED: Seeded = {
    accounts: EMAILS.map(email => ({ email, password: "synthetic-unused-password" })),
    token: "synthetic-unused-token",
    credentialId: CREDENTIAL_ID,
};

function syntheticDatabase(profile: Profile = "basic", hashes = [...LOGIN_HASHES, REFRESH_IP_HASH]) {
    const docs = frozenDocuments(profile).map((doc, i) => ({ id: `doc-${i}`, documentId: doc.documentId, branchId: doc.branchId }));
    const rows = {
        eformsign_doc: docs,
        user: USERS.map((id, i) => ({ id, email: EMAILS[i]! })),
        branch: [{ id: A }, { id: B }],
        auth_session: USERS.map((userId, i) => ({ id: `session-${i}`, userId })),
        auth_refresh_token: USERS.map((_, i) => ({ id: `refresh-${i}`, sessionId: `session-${i}` })),
        user_branch: [
            ...USERS.map((userId, i) => ({ id: `membership-${i}`, userId, branchId: A })),
            { id: "membership-b", userId: USERS[0]!, branchId: B },
        ],
        eformsign_doc_file: docs.map(doc => ({ id: `file-${doc.id}`, eformsignDocId: doc.id })),
        eformsign_backup_export_credential: [{ id: CREDENTIAL_ID }],
        eformsign_backup_export_snapshot: [{ id: "snapshot", principalId: PRINCIPAL, companyId: COMPANY }],
        eformsign_backup_export_candidate: [{ snapshotId: "snapshot", ordinal: 0, documentId: docs[0]!.documentId }],
        eformsign_backup_run: [{ id: "run", companyId: COMPANY, branchId: A, requestedByUserId: USERS[0]! }],
        eformsign_backup_run_document: [{ runId: "run", documentId: docs[0]!.documentId, branchId: A }],
        auth_rate_limit: hashes.map(keyHash => ({ keyHash })),
    };
    const delegates = Object.fromEntries(Object.entries(rows).map(([table, records]) => [table, {
        findMany: jest.fn(async () => records),
        delete: jest.fn(async () => undefined),
    }]));
    const transaction = jest.fn(async (callback: (tx: typeof delegates) => Promise<void>) => callback(delegates));
    // Catalog checks are inert here: these tests exercise relationship and transaction guards.
    const db = { ...delegates, $queryRaw: jest.fn(async () => []), $transaction: transaction } as unknown as PrismaClient;
    return { db, rows, delegates, transaction };
}

describe("backup fixture counter attribution (hermetic)", () => {
    it("accepts every pre-existing login hash without a refresh counter", async () => {
        const { db } = syntheticDatabase("basic", LOGIN_HASHES);
        const result = await attributableRows(db, "basic", CREDENTIAL_ID, EMAILS);
        expect(result.counters).toEqual(LOGIN_HASHES.map(keyHash => ({ keyHash })));
    });

    it.each<Profile>(["basic", "pagination", "kst"])("accepts only the approved additional hash with valid %s relationships", async profile => {
        const { db, rows } = syntheticDatabase(profile);
        const result = await attributableRows(db, profile, CREDENTIAL_ID, EMAILS);
        expect(result.counters).toEqual(rows.auth_rate_limit);
        expect([...result.allowedCounters].sort()).toEqual([...LOGIN_HASHES, REFRESH_IP_HASH].sort());
        expect(new Set(result.allowedCounters).size).toBe(9);
    });

    it("preserves login email normalization without adding refresh identities", async () => {
        const { db } = syntheticDatabase();
        const result = await attributableRows(db, "basic", CREDENTIAL_ID, EMAILS.map(email => ` ${email.toUpperCase()} `).concat(EMAILS));
        expect(new Set(result.allowedCounters)).toEqual(new Set([...LOGIN_HASHES, REFRESH_IP_HASH]));
    });

    it.each([
        ["refresh identity", hashKey(`post:refreshToken:identity:127.0.0.1:${EMAILS[0]}`)],
        ["refresh IP with identity", hashKey(`post:refreshToken:ip:127.0.0.1:${EMAILS[0]}`)],
        ["refresh mapped IPv6", hashKey("post:refreshToken:ip:::ffff:127.0.0.1:")],
        ["refresh IPv6 loopback", hashKey("post:refreshToken:ip:::1:")],
        ["refresh other IPv4", hashKey("post:refreshToken:ip:127.0.0.2:")],
        ["other action", hashKey("post:logout:ip:127.0.0.1:")],
        ["other method", hashKey("get:refreshToken:ip:127.0.0.1:")],
        ["missing trailing colon", hashKey("post:refreshToken:ip:127.0.0.1")],
        ["foreign login identity", hashKey("post:login:identity:127.0.0.1:foreign@example.invalid")],
        ["altered approved hash", REFRESH_IP_HASH.slice(0, -1) + "3"],
        ["unknown hash", "f".repeat(64)],
    ])("rejects %s before cleanup records or deletes anything", async (_label, keyHash) => {
        const { db, transaction, delegates } = syntheticDatabase("basic", [...LOGIN_HASHES, REFRESH_IP_HASH, keyHash]);
        const record = jest.fn(async () => undefined);
        await expect(attributableRows(db, "basic", CREDENTIAL_ID, EMAILS)).rejects.toThrow("FOREIGN_COUNTER");
        await expect(cleanup(db, "basic", SEEDED, record)).rejects.toThrow("FOREIGN_COUNTER");
        expect(record).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
        for (const delegate of Object.values(delegates)) expect(delegate.delete).not.toHaveBeenCalled();
    });

    it("passes only the accepted counter keys into the cleanup transaction after recording", async () => {
        const { db, delegates, transaction } = syntheticDatabase();
        const record = jest.fn(async () => {
            expect(transaction).not.toHaveBeenCalled();
            for (const delegate of Object.values(delegates)) expect(delegate.delete).not.toHaveBeenCalled();
        });
        await cleanup(db, "basic", SEEDED, record);
        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ counters: [...LOGIN_HASHES, REFRESH_IP_HASH].map(keyHash => ({ keyHash })) }));
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(delegates["auth_rate_limit"]!.delete.mock.calls).toEqual([...LOGIN_HASHES, REFRESH_IP_HASH].map(keyHash => [{ where: { keyHash } }]));
    });
});

type SyntheticRows = ReturnType<typeof syntheticDatabase>["rows"];
const FOREIGN_RELATIONSHIPS: Array<[string, (rows: SyntheticRows) => void]> = [
    ["FOREIGN_DOCUMENT", rows => { rows.eformsign_doc[0]!.branchId = "foreign"; }],
    ["FOREIGN_USER", rows => { rows.user[0]!.id = "foreign"; }],
    ["FOREIGN_USER", rows => { rows.user[0]!.email = "foreign@example.invalid"; }],
    ["FOREIGN_BRANCH", rows => { rows.branch[0]!.id = "foreign"; }],
    ["FOREIGN_SESSION", rows => { rows.auth_session[0]!.userId = "foreign"; }],
    ["FOREIGN_REFRESH", rows => { rows.auth_refresh_token[0]!.sessionId = "foreign"; }],
    ["FOREIGN_MEMBERSHIP", rows => { rows.user_branch[0]!.branchId = B; rows.user_branch[0]!.userId = USERS[1]!; }],
    ["FOREIGN_FILE", rows => { rows.eformsign_doc_file[0]!.eformsignDocId = "foreign"; }],
    ["FOREIGN_CREDENTIAL", rows => { rows.eformsign_backup_export_credential[0]!.id = "foreign"; }],
    ["FOREIGN_SNAPSHOT", rows => { rows.eformsign_backup_export_snapshot[0]!.principalId = "foreign"; }],
    ["FOREIGN_CANDIDATE", rows => { rows.eformsign_backup_export_candidate[0]!.snapshotId = "foreign"; }],
    ["FOREIGN_RUN", rows => { rows.eformsign_backup_run[0]!.requestedByUserId = USERS[1]!; }],
    ["FOREIGN_RESULT", rows => { rows.eformsign_backup_run_document[0]!.runId = "foreign"; }],
];

describe("backup fixture relationship guards with the approved refresh counter", () => {
    it.each(FOREIGN_RELATIONSHIPS)("still rejects %s before cleanup records or deletes anything", async (code, corrupt) => {
        const { db, rows, transaction, delegates } = syntheticDatabase();
        corrupt(rows);
        const record = jest.fn(async () => undefined);
        await expect(attributableRows(db, "basic", CREDENTIAL_ID, EMAILS)).rejects.toThrow(code);
        await expect(cleanup(db, "basic", SEEDED, record)).rejects.toThrow(code);
        expect(record).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
        for (const delegate of Object.values(delegates)) expect(delegate.delete).not.toHaveBeenCalled();
    });
});
