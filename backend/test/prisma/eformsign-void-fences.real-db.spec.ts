import { PrismaClient } from "@prisma/client";

import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import type { HolidayCalendarService } from "application/services/holiday-calendar.service";

/**
 * Real-PostgreSQL regression for BJJ-439 (merge-audit F1): the locked completion fences must
 * refuse a document that was voided AFTER the writer's unlocked read and BEFORE the writer took
 * the row lock. Each case suspends the writer at the entry of its transaction (everything the
 * caller decided before that point is stale), commits the void through `markVoided`, then lets the
 * unchanged writer run. Skipped unless HOLIDAY_REVIEW_REAL_DB=1, and then only against a local
 * throwaway database:
 *
 *   createdb throwaway_vf && export DATABASE_URL=postgresql://<user>@localhost/throwaway_vf DIRECT_URL=$DATABASE_URL
 *   npx prisma migrate deploy && HOLIDAY_REVIEW_REAL_DB=1 npx jest test/prisma/eformsign-void-fences.real-db.spec.ts
 */
const ENABLED = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1";
const describeReal = ENABLED ? describe : describe.skip;

// Same guard as holiday-review.real-db.spec.ts (a spec cannot be imported without running it).
const THROWAWAY_URL = /^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/;
function assertThrowawayTarget(): void {
    const url = process.env["DATABASE_URL"];
    if (!url || url !== process.env["DIRECT_URL"] || !THROWAWAY_URL.test(url)) {
        throw new Error("Refusing real-DB spec: DATABASE_URL and DIRECT_URL must be the same local throwaway database");
    }
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ACTOR = "22222222-2222-4222-8222-222222222222";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

describeReal("voided contract fences under the document row lock (real PostgreSQL)", () => {
    let raw: PrismaClient;
    let repository: SbEformsignDocRepository;
    let branchId: string;
    let sequence = 0;

    beforeAll(async () => {
        assertThrowawayTarget();
        raw = new PrismaClient();
        await raw.$connect();
        branchId = (await raw.branch.create({
            data: { name: "void fences", slug: `throwaway-void-fences-${Date.now().toString(36)}` },
        })).id;
        repository = new SbEformsignDocRepository(raw as unknown as PrismaService);
    });

    afterAll(async () => {
        await raw.service_record_case.deleteMany({ where: { branchId } });
        await raw.client.deleteMany({ where: { branchId } });
        await raw.eformsign_doc.deleteMany({ where: { branchId } });
        await raw.branch.deleteMany({ where: { id: branchId } });
        await raw.$disconnect();
    });

    async function makeClient(eDocId: string | null) {
        return raw.client.create({
            data: {
                name: `void-fence-${++sequence}`,
                voucherClient: false,
                branchId,
                startDate: d("2026-10-01"),
                endDate: d("2026-10-16"),
                duration: 12,
                eDocId,
            },
        });
    }

    async function makeDocument(
        label: string,
        clientId: number,
        overrides: { updatedDate?: Date; voided?: boolean; ready?: boolean } = {},
    ) {
        const documentId = `void-fence-${label}-${++sequence}-${Date.now().toString(36)}`;
        const updatedDate = overrides.updatedDate ?? new Date("2026-10-10T00:00:00.000Z");
        const row = await raw.eformsign_doc.create({
            data: {
                documentId,
                createdDate: updatedDate,
                updatedDate,
                statusType: "050",
                statusDetail: "Complete",
                stepType: "reviewer",
                stepIndex: "1",
                stepName: "reviewer",
                stepRecipientType: "client",
                stepRecipientName: "Fixture",
                stepRecipientSms: "01000000000",
                expiredDate: new Date("2099-01-01T00:00:00.000Z"),
                clientId,
                branchId,
                documentKind: "contract",
                ...(overrides.voided ? { voidedAt: new Date("2026-10-11T00:00:00.000Z"), voidedBy: ACTOR } : {}),
                ...(overrides.ready
                    ? {
                        syncStatus: "ready",
                        detailSourceUpdatedDate: new Date("2026-10-10T01:00:00.000Z"),
                        detailSyncedAt: new Date("2026-10-10T01:01:00.000Z"),
                    }
                    : {}),
            },
        });
        if (overrides.ready) {
            for (const fileType of ["document", "audit_trail"]) {
                await raw.eformsign_doc_file.create({
                    data: {
                        eformsignDocId: row.id,
                        fileType,
                        content: Buffer.from("x"),
                        contentType: "application/pdf",
                        byteSize: 1,
                        sha256: "0".repeat(64),
                        sourceUpdatedDate: new Date("2026-10-10T01:00:00.000Z"),
                    },
                });
            }
        }
        return { id: row.id, documentId };
    }

    /**
     * Runs `writer` against a Prisma whose `$transaction` is held at its entry, commits the void
     * of `documentId` while the writer is suspended, then releases it. Returns the writer's result.
     */
    async function voidWhileWriterIsSuspended<T>(
        documentId: string,
        writer: (suspended: PrismaService) => Promise<T>,
    ): Promise<T> {
        const gate = deferred();
        const entered = deferred();
        const suspended = new Proxy(raw, {
            get(target, key) {
                if (key === "$transaction") {
                    return async (...args: unknown[]) => {
                        entered.resolve();
                        await gate.promise;
                        return (target.$transaction as (...inner: unknown[]) => Promise<unknown>)(...args);
                    };
                }
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        }) as unknown as PrismaService;

        const pending = writer(suspended);
        await entered.promise;
        // The void commits while the writer holds a decision made on a not-voided read.
        await expect(repository.markVoided(branchId, documentId, new Date(), ACTOR)).resolves.toBe(true);
        gate.resolve();
        return pending;
    }

    const calendar = { forBranch: async () => KR_BUILTIN_CALENDAR } as unknown as HolidayCalendarService;
    const lifecycleFor = (prisma: PrismaService) => new ServiceRecordLifecycleService(prisma, calendar);

    async function clientRow(id: number) {
        return raw.client.findUniqueOrThrow({ where: { id } });
    }

    it("linkClientIfActive writes no pointer for a document voided after the unlocked read, and records the void", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("link", client.id);

        const linked = await voidWhileWriterIsSuspended(documentId, (suspended) =>
            new SbEformsignDocRepository(suspended).linkClientIfActive(branchId, documentId, client.id));

        expect(linked).toBe(false);
        expect((await clientRow(client.id)).eDocId).toBeNull();
        const row = await raw.eformsign_doc.findUniqueOrThrow({ where: { documentId } });
        expect(row.voidedAt).not.toBeNull();
        expect(row.voidedBy).toBe(ACTOR);
    });

    it("linkClientIfActive still links a document that is not voided", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("link-ok", client.id);

        await expect(repository.linkClientIfActive(branchId, documentId, client.id)).resolves.toBe(true);
        expect((await clientRow(client.id)).eDocId).toBe(documentId);
    });

    it("a newer contract still relinks when the client's pointer is a voided document", async () => {
        const client = await makeClient(null);
        const older = await makeDocument("older", client.id, {
            updatedDate: new Date("2026-10-01T00:00:00.000Z"),
            voided: true,
        });
        await raw.client.update({ where: { id: client.id }, data: { eDocId: older.documentId } });
        const newer = await makeDocument("newer", client.id, { updatedDate: new Date("2026-10-12T00:00:00.000Z") });

        await expect(repository.linkClientIfActive(branchId, newer.documentId, client.id)).resolves.toBe(true);
        expect((await clientRow(client.id)).eDocId).toBe(newer.documentId);
        // An older document still loses the newer-than comparison against the voided pointer.
        const stale = await makeDocument("stale", client.id, { updatedDate: new Date("2026-09-01T00:00:00.000Z") });
        await expect(repository.linkClientIfActive(branchId, stale.documentId, client.id)).resolves.toBe(false);
        expect((await clientRow(client.id)).eDocId).toBe(newer.documentId);
    });

    it("isCurrentContractDocument is false for a document voided after the unlocked read, true otherwise", async () => {
        const voidedClient = await makeClient(null);
        const voided = await makeDocument("current-voided", voidedClient.id);
        await raw.client.update({ where: { id: voidedClient.id }, data: { eDocId: voided.documentId } });

        const voidedAnswer = await voidWhileWriterIsSuspended(voided.documentId, (suspended) =>
            new SbEformsignDocRepository(suspended).isCurrentContractDocument(branchId, voided.documentId));
        expect(voidedAnswer).toBe(false);

        const liveClient = await makeClient(null);
        const live = await makeDocument("current-live", liveClient.id);
        await raw.client.update({ where: { id: liveClient.id }, data: { eDocId: live.documentId } });
        await expect(repository.isCurrentContractDocument(branchId, live.documentId)).resolves.toBe(true);
    });

    it("syncEndDateFromCurrentContract moves no end date for a document voided after the unlocked read", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("sync-current", client.id);
        await raw.client.update({ where: { id: client.id }, data: { eDocId: documentId } });

        const applied = await voidWhileWriterIsSuspended(documentId, (suspended) =>
            lifecycleFor(suspended).syncEndDateFromCurrentContract({
                branchId,
                clientId: client.id,
                documentId,
                endDate: d("2026-10-30"),
            }));

        expect(applied).toBe(false);
        expect((await clientRow(client.id)).endDate).toEqual(d("2026-10-16"));
    });

    it("syncEndDateFromCurrentContract still moves the end date for a document that is not voided", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("sync-current-ok", client.id);
        await raw.client.update({ where: { id: client.id }, data: { eDocId: documentId } });

        await expect(lifecycleFor(raw as unknown as PrismaService).syncEndDateFromCurrentContract({
            branchId,
            clientId: client.id,
            documentId,
            endDate: d("2026-10-30"),
        })).resolves.toBe(true);
        expect((await clientRow(client.id)).endDate).toEqual(d("2026-10-30"));
    });

    it("syncEndDateFromMirroredContract moves no end date for a ready mirror voided after the unlocked read", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("sync-mirror", client.id, { ready: true });
        await raw.client.update({ where: { id: client.id }, data: { eDocId: documentId } });

        const applied = await voidWhileWriterIsSuspended(documentId, (suspended) =>
            lifecycleFor(suspended).syncEndDateFromMirroredContract({
                branchId,
                clientId: client.id,
                documentId,
                endDate: d("2026-10-30"),
                detailSourceUpdatedDate: new Date("2026-10-10T01:00:00.000Z"),
                detailSyncedAt: new Date("2026-10-10T01:01:00.000Z"),
            }));

        expect(applied).toBe(false);
        expect((await clientRow(client.id)).endDate).toEqual(d("2026-10-16"));
    });

    it("syncEndDateFromMirroredContract still moves the end date for a ready mirror that is not voided", async () => {
        const client = await makeClient(null);
        const { documentId } = await makeDocument("sync-mirror-ok", client.id, { ready: true });
        await raw.client.update({ where: { id: client.id }, data: { eDocId: documentId } });

        await expect(lifecycleFor(raw as unknown as PrismaService).syncEndDateFromMirroredContract({
            branchId,
            clientId: client.id,
            documentId,
            endDate: d("2026-10-30"),
            detailSourceUpdatedDate: new Date("2026-10-10T01:00:00.000Z"),
            detailSyncedAt: new Date("2026-10-10T01:01:00.000Z"),
        })).resolves.toBe(true);
        expect((await clientRow(client.id)).endDate).toEqual(d("2026-10-30"));
    });
});
