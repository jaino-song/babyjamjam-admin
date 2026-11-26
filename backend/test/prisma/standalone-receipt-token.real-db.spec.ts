import { ConfigService } from "@nestjs/config";
import { Prisma, PrismaClient } from "@prisma/client";
import type { Response } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ReceiptLinkCleanupSchedulerService } from "application/services/receipt-link-cleanup-scheduler.service";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import type { SchedulerLeaseService } from "application/services/scheduler-lease.service";
import type { FileStoragePort } from "domain/ports/file-storage.port";
import type { ServiceRecordEditSource } from "domain/repositories/service-record-edit.repository.interface";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { loadRevisionFactsSource } from "infrastructure/database/repositories/service-record-edit.repository";
import { ReceiptLinkController } from "interface/controllers/receipt-link.controller";

// Opt in explicitly against the disposable loopback DB used by the Prisma CI gate.
const describeReal = process.env["STANDALONE_RECEIPT_REAL_DB"] === "1" ? describe : describe.skip;
// Permit the direct harness prefix and the repository runner's exact disposable database name.
const THROWAWAY_URL = /^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1):\d+\/(?:throwaway_[A-Za-z0-9_]+|bjj_state_integrity_throwaway)$/;
const ROLLBACK = new Error("Rollback synthetic receipt fixtures");
const SALT = "synthetic-receipt-test";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const birthdayHash = (birthday: string) => sha256(`${SALT}:${birthday}`);

const JAN_1 = new Date("2026-01-01T00:00:00Z");
const JAN_10 = new Date("2026-01-10T00:00:00Z");
const JAN_15 = new Date("2026-01-15T00:00:00Z");
const JAN_20 = new Date("2026-01-20T00:00:00Z");
const JAN_31 = new Date("2026-01-31T00:00:00Z");
const FEB_2 = new Date("2026-02-02T00:00:00Z");
const FEB_14 = new Date("2026-02-14T00:00:00Z");
const BIRTHDAY_AT_ISSUE = "19940102";
const STANDALONE_BIRTHDAY = "19940203";
const OTHER_BIRTHDAY = "19940304";
const IMAGE = Buffer.from("synthetic receipt artifact");

describeReal("standalone receipt tokens on PostgreSQL", () => {
    let db: PrismaClient;

    beforeAll(() => {
        const url = process.env["DATABASE_URL"];
        if (!url || url !== process.env["DIRECT_URL"] || !THROWAWAY_URL.test(url)) {
            throw new Error("Receipt tests require matching DATABASE_URL and DIRECT_URL for a loopback throwaway DB");
        }
        db = new PrismaClient({ datasourceUrl: url });
    });

    afterAll(async () => db?.$disconnect());
    afterEach(() => jest.useRealTimers());

    async function inRollback(operation: (tx: Prisma.TransactionClient) => Promise<void>) {
        await expect(db.$transaction(async (tx) => {
            await operation(tx);
            throw ROLLBACK;
        }, { timeout: 15_000 })).rejects.toBe(ROLLBACK);
    }

    it("upgrades and preserves a legacy document FK, accepts both kinds and is rerunnable", async () => {
        const migration = readFileSync(join(__dirname, "../../prisma/migrations/20261123120000_add_standalone_receipt_link_token/migration.sql"), "utf8");
        await inRollback(async (tx) => {
            await tx.$executeRaw`CREATE TEMP TABLE receipt_test_doc (id integer PRIMARY KEY) ON COMMIT DROP`;
            await tx.$executeRaw`
                CREATE TEMP TABLE receipt_link_token (
                    id integer PRIMARY KEY,
                    eformsign_doc_id integer NOT NULL REFERENCES receipt_test_doc(id) ON DELETE CASCADE
                ) ON COMMIT DROP
            `;
            await tx.$executeRaw`INSERT INTO receipt_test_doc VALUES (77)`;
            await tx.$executeRaw`INSERT INTO pg_temp.receipt_link_token (id, eformsign_doc_id) VALUES (1, 77)`;

            await tx.$executeRawUnsafe(migration);
            await tx.$executeRaw`INSERT INTO pg_temp.receipt_link_token (id, eformsign_doc_id) VALUES (2, 77)`;
            await tx.$executeRaw`
                INSERT INTO pg_temp.receipt_link_token (id, kind, frozen_client_name)
                VALUES (3, 'standalone', 'Client X')
            `;

            async function rejectShape(kind: string, documentId: number | null, name: string | null) {
                await tx.$executeRaw`SAVEPOINT invalid_receipt_shape`;
                await expect(tx.$executeRaw`
                    INSERT INTO pg_temp.receipt_link_token (id, kind, eformsign_doc_id, frozen_client_name)
                    VALUES (4, ${kind}, ${documentId}, ${name})
                `).rejects.toMatchObject({ code: "P2010", meta: { code: "23514" } });
                await tx.$executeRaw`ROLLBACK TO SAVEPOINT invalid_receipt_shape`;
                await tx.$executeRaw`RELEASE SAVEPOINT invalid_receipt_shape`;
            }

            await rejectShape("contract", null, null);
            await rejectShape("standalone", 77, "Client X");
            await rejectShape("standalone", null, null);
            await rejectShape("standalone", null, "");
            await rejectShape("standalone", null, " \t");
            await rejectShape("unknown", 77, "Client X");

            const readRows = () => tx.$queryRaw`SELECT * FROM pg_temp.receipt_link_token ORDER BY id`;
            const readConstraints = () => tx.$queryRaw`
                SELECT oid::text, conname FROM pg_constraint
                WHERE conrelid = 'pg_temp.receipt_link_token'::regclass ORDER BY conname
            `;
            const rows = await readRows();
            const constraints = await readConstraints();
            expect(rows).toEqual([
                { id: 1, kind: "contract", eformsign_doc_id: 77, frozen_client_name: null },
                { id: 2, kind: "contract", eformsign_doc_id: 77, frozen_client_name: null },
                { id: 3, kind: "standalone", eformsign_doc_id: null, frozen_client_name: "Client X" },
            ]);
            expect(await tx.$queryRaw`SELECT id FROM receipt_test_doc`).toEqual([{ id: 77 }]);
            await tx.$executeRawUnsafe(migration);
            expect(await readRows()).toEqual(rows);
            expect(await readConstraints()).toEqual(constraints);
        });
    });

    async function fixtures(tx: Prisma.TransactionClient) {
        // Reuse the rollback transaction for repository methods that open their own transaction.
        const repository = new SbReceiptLinkTokenRepository({
            receipt_link_token: tx.receipt_link_token,
            service_record_revision: tx.service_record_revision,
            $executeRaw: tx.$executeRaw.bind(tx),
            $queryRaw: tx.$queryRaw.bind(tx),
            $transaction: <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) => operation(tx),
        } as unknown as PrismaService);
        const service = new ReceiptLinkTokenService(repository, new ConfigService({ RECEIPT_LINK_HASH_SALT: SALT }));
        const download = jest.fn(async () => IMAGE);
        const deleteObject = jest.fn(async () => undefined);
        const storage = { download, delete: deleteObject } as unknown as FileStoragePort;
        const controller = new ReceiptLinkController(service, storage);
        const cleanup = new ReceiptLinkCleanupSchedulerService(service, storage, { holdsLease: () => true } as SchedulerLeaseService);
        const tenantA = await tx.branch.create({ data: { name: "Tenant A", slug: randomUUID() } });
        const tenantB = await tx.branch.create({ data: { name: "Tenant B", slug: randomUUID() } });
        const clientX = await tx.client.create({
            data: { branchId: tenantA.id, name: "Client X", birthday: BIRTHDAY_AT_ISSUE, voucherClient: true },
        });
        const clientY = await tx.client.create({
            data: { branchId: tenantB.id, name: "Client Y", birthday: OTHER_BIRTHDAY, voucherClient: true },
        });
        const createDocument = (date: Date) => tx.eformsign_doc.create({
            data: {
                documentId: randomUUID(), branchId: tenantA.id, clientId: clientX.id,
                documentKind: "contract", createdDate: date, updatedDate: date,
                expiredDate: FEB_14, statusType: "070", statusDetail: "",
                stepType: "", stepIndex: "", stepName: "", stepRecipientType: "",
                stepRecipientName: "", stepRecipientSms: "",
            },
        });
        const document = await createDocument(JAN_1);
        const contractPath = `receipts/${tenantA.id}/${document.id}/contract.png`;
        const contractInput = {
            branchId: tenantA.id, clientId: clientX.id, eformsignDocId: document.id,
            birthday: BIRTHDAY_AT_ISSUE, storagePath: contractPath,
            contentSha256: sha256("contract content"), byteSize: 40, source: "manual" as const,
        };
        const contract = await service.issue({ ...contractInput, now: JAN_1 });

        async function insertStandalone(client: typeof clientX, birthday: string) {
            const branchId = client.branchId!;
            const token = `efr_${randomBytes(32).toString("base64url")}`;
            const storagePath = `receipts/${branchId}/standalone/${randomUUID()}.png`;
            const jobId = randomUUID();
            const row = await repository.insertStandaloneLink({
                branchId, clientId: client.id, jobId, linkTokenHash: sha256(token),
                expectedBirthdayHash: birthdayHash(birthday), frozenClientName: client.name,
                expiresAt: JAN_31, storagePath, contentSha256: sha256("standalone content"), byteSize: IMAGE.length,
                createdBy: null, createdAt: JAN_1,
            });
            return { ...row, token, storagePath, jobId };
        }
        const standalone = await insertStandalone(clientX, STANDALONE_BIRTHDAY);
        return {
            repository, service, controller, cleanup, deleteObject, download, tenantA, tenantB,
            clientX, clientY, createDocument, document, contract, contractInput, contractPath, standalone, insertStandalone,
        };
    }

    function setPublicClock(date: Date) {
        jest.useFakeTimers({
            doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate",
                "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
        }).setSystemTime(date);
    }

    it("preserves the standalone birthday, expiry and filename through contract refresh, replacement and terminal document changes", async () => {
        await inRollback(async (tx) => {
            const f = await fixtures(tx);
            expect(await tx.receipt_link_token.findUniqueOrThrow({ where: { id: f.contract.id } }))
                .toMatchObject({ kind: "contract", eformsignDocId: f.document.id, expiresAt: JAN_31 });
            expect(await tx.receipt_link_token.findUniqueOrThrow({ where: { id: f.standalone.id } }))
                .toMatchObject({ kind: "standalone", jobId: f.standalone.jobId, eformsignDocId: null, expiresAt: JAN_31 });
            await expect(f.repository.findActiveByJobId(f.standalone.jobId)).resolves.toBeNull();

            const original = await tx.receipt_link_token.findUniqueOrThrow({ where: { id: f.standalone.id } });
            await tx.client.update({ where: { id: f.clientX.id }, data: { name: "Client Y", birthday: OTHER_BIRTHDAY } });
            await expect(f.service.issue({ ...f.contractInput, now: JAN_15 })).resolves.toEqual({
                ...f.contract, expiresAt: FEB_14,
            });
            expect(await tx.receipt_link_token.findUniqueOrThrow({ where: { id: f.contract.id } }))
                .toMatchObject({ expiresAt: FEB_14, expectedBirthdayHash: birthdayHash(OTHER_BIRTHDAY) });
            expect(await tx.receipt_link_token.findUniqueOrThrow({ where: { id: f.standalone.id } })).toEqual(original);

            const facts = await loadRevisionFactsSource(tx, f.tenantA.id, {
                client: { id: f.clientX.id },
                documentScope: {
                    contract: { currentDocumentId: f.document.documentId },
                    receipt: { evidence: "observed", sourceDocumentId: f.document.documentId, tokenIds: [f.contract.id] },
                },
            } as ServiceRecordEditSource);
            expect(facts.receiptTokens?.map((token) => token.id)).toEqual([f.contract.id]);

            const replacement = await f.createDocument(JAN_15);
            expect(await tx.receipt_link_token.findUniqueOrThrow({ where: { id: f.standalone.id } })).toEqual(original);
            await tx.eformsign_doc.update({
                where: { id: replacement.id }, data: { statusType: "046", voidedAt: JAN_15 },
            });
            expect(await tx.receipt_link_token.findUniqueOrThrow({ where: { id: f.standalone.id } })).toEqual(original);
            await tx.eformsign_doc.deleteMany({ where: { id: { in: [f.document.id, replacement.id] } } });
            expect(await tx.receipt_link_token.findUnique({ where: { id: f.contract.id } })).toBeNull();
            expect(await tx.receipt_link_token.findUniqueOrThrow({ where: { id: f.standalone.id } })).toEqual(original);

            setPublicClock(JAN_20);
            const token = f.standalone.token;
            expect(await f.controller.receiptStatus(token)).toEqual({
                ok: true, state: "pending", branchName: "Tenant A", expiresAt: JAN_31.toISOString(),
                remainingAttempts: 5, lockedUntil: null,
            });
            await expect(f.controller.receiptVerify(token, { birthday: OTHER_BIRTHDAY })).rejects.toMatchObject({
                response: { reason: "verification_failed" },
            });
            const { accessToken } = await f.controller.receiptVerify(token, { birthday: STANDALONE_BIRTHDAY });
            await expect(f.controller.receiptAccess(token, accessToken)).resolves.toEqual({ ok: true, clientName: "Client X" });
            const response = { set: jest.fn(), send: jest.fn() };
            await f.controller.image(token, "1", accessToken, undefined, response as unknown as Response);
            expect(f.download).toHaveBeenCalledWith(f.standalone.storagePath);
            expect(response.set).toHaveBeenCalledWith(expect.objectContaining({
                "Content-Disposition": expect.stringContaining("%EC%98%81%EC%88%98%EC%A6%9D_Client%20X.png"),
                "Cache-Control": "private, no-store",
            }));
            expect(response.send).toHaveBeenCalledWith(IMAGE);

            const other = await f.insertStandalone(f.clientY, OTHER_BIRTHDAY);
            await expect(f.controller.receiptAccess(other.token, accessToken)).rejects.toMatchObject({ status: 401 });
            await expect(f.controller.image(other.token, undefined, accessToken, undefined, response as unknown as Response))
                .rejects.toMatchObject({ status: 401 });
            expect(f.download).toHaveBeenCalledTimes(1);
        });
    });

    it.each(["revoked", "expired", "tombstoned", "deleted", "foreign tenant"] as const)(
        "denies %s standalone links across public routes, including an existing access credential",
        async (state) => {
            await inRollback(async (tx) => {
                const f = await fixtures(tx);
                const token = f.standalone.token;
                setPublicClock(JAN_1);
                const { accessToken } = await f.controller.receiptVerify(token, { birthday: STANDALONE_BIRTHDAY });
                await expect(f.controller.receiptAccess(token, accessToken)).resolves.toMatchObject({ ok: true });
                const where = { id: f.standalone.id };
                let reason: "not_found" | "revoked" | "expired" = "not_found";
                setPublicClock(JAN_20);
                switch (state) {
                    case "revoked": {
                        await tx.receipt_link_token.updateMany({
                            where: { id: { in: [f.contract.id, f.standalone.id] } },
                            data: { active: false, revokedAt: JAN_10 },
                        });
                        expect(await f.controller.receiptStatus(f.contract.linkToken)).toMatchObject({ ok: true });
                        expect(await tx.receipt_link_token.findUniqueOrThrow({ where: { id: f.contract.id } }))
                            .toMatchObject({ active: true, revokedAt: null });
                        reason = "revoked";
                        break;
                    }
                    case "expired":
                        setPublicClock(JAN_31);
                        reason = "expired";
                        break;
                    case "tombstoned":
                        await tx.client.update({ where: { id: f.clientX.id }, data: { deletedAt: JAN_20 } });
                        break;
                    case "deleted":
                        await tx.client.delete({ where: { id: f.clientX.id } });
                        expect(await tx.receipt_link_token.findUniqueOrThrow({ where })).toMatchObject({ clientId: null });
                        break;
                    case "foreign tenant":
                        await tx.receipt_link_token.update({ where, data: { clientId: f.clientY.id } });
                        break;
                }
                await expect(f.controller.receiptStatus(token)).rejects.toMatchObject({ response: { reason } });
                await expect(f.controller.receiptVerify(token, { birthday: STANDALONE_BIRTHDAY }))
                    .rejects.toMatchObject({ response: { reason } });
                await expect(f.controller.receiptAccess(token, accessToken)).rejects.toMatchObject({ status: 401 });
                await expect(f.controller.image(token, undefined, accessToken, undefined, {} as Response))
                    .rejects.toMatchObject({ status: 401 });
                expect(f.download).not.toHaveBeenCalled();
                if (state === "revoked") {
                    expect(await tx.receipt_link_token.findUniqueOrThrow({ where }))
                        .toMatchObject({ active: false, revokedAt: JAN_10, accessTokenHash: sha256(accessToken) });
                }
            });
        },
    );

    it("disposes an expired standalone artifact once and retains a path shared with the current contract", async () => {
        await inRollback(async (tx) => {
            const f = await fixtures(tx);
            await f.service.issue({ ...f.contractInput, now: JAN_15 });
            // A synthetic cross-kind reference models older data sharing an object.
            const shared = await f.insertStandalone(f.clientX, STANDALONE_BIRTHDAY);
            await tx.receipt_link_token.update({ where: { id: shared.id }, data: { storagePath: f.contractPath } });
            setPublicClock(FEB_2);
            await f.cleanup.cleanupExpiredLinks(FEB_2);
            await f.cleanup.cleanupExpiredLinks(FEB_2);
            expect(f.deleteObject.mock.calls).toEqual([[f.standalone.storagePath]]);
            expect(await tx.receipt_link_token.findUnique({ where: { id: f.standalone.id } })).toBeNull();
            expect(await tx.receipt_link_token.findUnique({ where: { id: shared.id } })).toBeNull();
            expect(await tx.receipt_link_token.findUniqueOrThrow({ where: { id: f.contract.id } }))
                .toMatchObject({ storagePath: f.contractPath, expiresAt: FEB_14 });
        });
    });
});
