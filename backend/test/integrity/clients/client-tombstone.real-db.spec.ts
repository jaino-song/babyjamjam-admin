import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbHolidayReviewRepository } from "infrastructure/database/repositories/sb.holiday-review.repository";
import { LinkMirroredEformsignDocByPhoneUsecase } from "application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase";

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";
import { createBranch, createClient, createEmployee, createEmployeeSchedule, createEformsignDoc, createMessageTriggerRule, createMessageTriggerJob } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { addDays, dbDate, isoDateInKorea, calendarStub, makeClientService } from "./test-helpers";

jest.setTimeout(120_000);

interface TombstoneConfig {
    get(key: string): string | undefined;
}

const enabledConfig = (): TombstoneConfig => ({
    get: (key: string) => (key === "CLIENT_TOMBSTONE_DELETE_ENABLED" ? "true" : undefined),
});
// CLIENT_TOMBSTONE_DELETE_ENABLED unset + NODE_ENV=test: the default resolves OFF.
const disabledConfig = (): TombstoneConfig => ({ get: () => undefined });

/** Deletes the fixture rows the harness does not sweep or track (children first). */
async function deleteAreaOrphans(raw: IntegrityPrisma["raw"], branchId: string): Promise<void> {
    await raw.end_date_review_item.deleteMany({ where: { branchId } });
    await raw.holiday_change_event.deleteMany({ where: { branchId } });
    await raw.call_record.deleteMany({ where: { branchId } });
    await raw.client_draft.deleteMany({ where: { branchId } });
}

/**
 * SI-CLIENT-05 — tombstone side effects are complete. With dependencies
 * present, an enabled tombstone must: hide the row (`deletedAt`), free the
 * branch-unique phone (`phoneNormalized`), end every open assignment
 * (`employee_schedule.terminatedAt`), cancel every pending automation job, and
 * leave the open end-date review item unreachable. With the switch disabled
 * (unset under NODE_ENV=test) the delete must be refused BEFORE any side
 * effect. A dependency-free client is still physically deleted.
 *
 * SI-CLIENT-04 (review round 1 re-verdict) — dual contract identity. The
 * tombstone clears `phoneNormalized` but keeps `eDocId` and the
 * `eformsign_doc.client_id` pointer BY DESIGN: tombstoning exists because
 * retained history (signed contracts) must stay attached, so detaching those
 * pointers would orphan a legal document. The hypothesis's invariant — a
 * tombstoned client holds no live contract pointer that BLOCKS or RELINKS
 * another client — holds: the reconciler keeps repairing the tombstoned
 * ownership, a new same-phone client still claims a NEW contract. The
 * phone-edit half is pinned below: after `ClientService.update` moves the
 * client's phone, the reconciler keeps the old contract attached to its owner,
 * leaves an unowned old-phone contract unlinked, and links a new-phone
 * contract to the edited client.
 */
describeReal("SI-CLIENT-05/04 tombstone side effects and contract identity", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let branchId: string;
    let kstToday: string;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
        kstToday = isoDateInKorea(new Date());
        const branch = await createBranch(handle.raw, tracker);
        branchId = branch.id;
    });

    afterAll(async () => {
        if (tracker) {
            await deleteAreaOrphans(handle.raw, branchId);
            await tracker.cleanup(handle.raw);
        }
        if (handle) await closeIntegrityPrisma(handle);
    });

    /** A client with one live assignment, one pending automation job, one open review item. */
    async function createClientWithDependencies(label: string) {
        const client = await createClient(handle.raw, tracker, { branchId, name: `${label} 고객` });
        const employee = await createEmployee(handle.raw, tracker, { branchId });
        const schedule = await createEmployeeSchedule(handle.raw, tracker, {
            clientId: client.id,
            primaryEmployeeId: employee.id,
        }, { branchId, terminatedAt: null });
        const rule = await createMessageTriggerRule(handle.raw, tracker, {
            branchId,
            eventType: "CLIENT_CREATED",
        });
        const job = await createMessageTriggerJob(handle.raw, tracker, { ruleId: rule.id }, {
            branchId,
            clientId: client.id,
            status: "pending",
        });
        const event = await handle.raw.holiday_change_event.create({
            data: {
                branchId,
                date: dbDate(kstToday),
                change: "added",
                name: "휴일 추가",
                source: "manual",
            },
        });
        await handle.raw.end_date_review_item.create({
            data: {
                changeEventId: event.id,
                branchId,
                clientId: client.id,
                storedEnd: dbDate(addDays(kstToday, 10)),
                recalculatedEnd: dbDate(addDays(kstToday, 11)),
                affectedFrom: dbDate(kstToday),
                category: "safe",
                status: "open",
            },
        });
        return { client, schedule, job, eventId: event.id };
    }

    invariant(
        "SI-CLIENT-05",
        "an enabled tombstone hides the client, frees the phone, ends assignments, cancels pending jobs and hides the review item",
        async () => {
            const { client, schedule, job } = await createClientWithDependencies("톰스톤-사이드이펙트");
            const repository = new SbClientRepository(handle.service, enabledConfig() as never);

            const outcome = await repository.delete(branchId, client.id);

            if (outcome !== "tombstoned") {
                throw new Error(`SI-CLIENT-05: expected "tombstoned", got "${outcome}"`);
            }
            const row = await handle.raw.client.findUniqueOrThrow({
                where: { id: client.id },
                select: { deletedAt: true, phoneNormalized: true, phone: true },
            });
            if (!row.deletedAt) throw new Error("SI-CLIENT-05: tombstone did not set deletedAt");
            if (row.phoneNormalized !== null) {
                throw new Error(`SI-CLIENT-05: tombstone kept phoneNormalized "${String(row.phoneNormalized)}"`);
            }
            if (!row.phone) throw new Error("SI-CLIENT-05: tombstone cleared the display phone (raw column must stay)");

            const scheduleRow = await handle.raw.employee_schedule.findUniqueOrThrow({
                where: { id: schedule.id },
                select: { terminatedAt: true },
            });
            if (!scheduleRow.terminatedAt) {
                throw new Error("SI-CLIENT-05: tombstone did not end the open assignment (terminatedAt)");
            }

            const jobRow = await handle.raw.message_trigger_job.findUniqueOrThrow({
                where: { id: job.id },
                select: { status: true, canceledAt: true, cancelReason: true, claimToken: true },
            });
            if (jobRow.status !== "canceled" || !jobRow.canceledAt || jobRow.claimToken !== null) {
                throw new Error(
                    `SI-CLIENT-05: pending job not canceled cleanly (status=${jobRow.status}, canceledAt=${String(jobRow.canceledAt)}, claimToken=${String(jobRow.claimToken)})`,
                );
            }

            // The open review item row stays (the client row does too), but it
            // is unreachable: the review list counts only live clients' items.
            const reviewRepository = new SbHolidayReviewRepository(handle.service);
            const itemsOfClient = await handle.raw.end_date_review_item.findMany({
                where: { clientId: client.id, status: "open" },
                select: { id: true },
            });
            if (itemsOfClient.length !== 1) {
                throw new Error("SI-CLIENT-05: fixture review item missing before the reachability check");
            }
            const summariesForBranch = await reviewRepository.listOpenEventSummaries(branchId);
            const totalOpen = summariesForBranch.reduce((sum, entry) => sum + entry.safeOpen + entry.riskOpen, 0);
            if (totalOpen !== 0) {
                throw new Error(
                    `SI-CLIENT-05: the tombstoned client's open review item is still listed (${totalOpen} open item(s) counted)`,
                );
            }
        },
    );

    invariant(
        "SI-CLIENT-05",
        "with the switch disabled (unset + NODE_ENV=test) a delete with dependencies is refused before any side effect",
        async () => {
            const { client, schedule, job } = await createClientWithDependencies("삭제-거부");
            const repository = new SbClientRepository(handle.service, disabledConfig() as never);

            await expect(repository.delete(branchId, client.id)).rejects.toMatchObject({
                code: "CLIENT_RETENTION_BLOCKED",
            });

            const row = await handle.raw.client.findUniqueOrThrow({
                where: { id: client.id },
                select: { deletedAt: true, phoneNormalized: true },
            });
            if (row.deletedAt) throw new Error("SI-CLIENT-05: refused delete still tombstoned the client");
            const scheduleRow = await handle.raw.employee_schedule.findUniqueOrThrow({
                where: { id: schedule.id },
                select: { terminatedAt: true },
            });
            if (scheduleRow.terminatedAt) throw new Error("SI-CLIENT-05: refused delete still ended the assignment");
            const jobRow = await handle.raw.message_trigger_job.findUniqueOrThrow({
                where: { id: job.id },
                select: { status: true },
            });
            if (jobRow.status !== "pending") throw new Error("SI-CLIENT-05: refused delete still canceled the job");
        },
    );

    invariant(
        "SI-CLIENT-05",
        "a dependency-free client is physically deleted even with the tombstone switch disabled",
        async () => {
            const client = await createClient(handle.raw, tracker, { branchId, name: "무의존 삭제 고객" });
            const repository = new SbClientRepository(handle.service, disabledConfig() as never);
            const outcome = await repository.delete(branchId, client.id);
            if (outcome !== "deleted") {
                throw new Error(`SI-CLIENT-05: dependency-free delete outcome was "${outcome}", expected "deleted"`);
            }
            const row = await handle.raw.client.findUnique({ where: { id: client.id }, select: { id: true } });
            if (row) throw new Error("SI-CLIENT-05: dependency-free client row still exists");
        },
    );

    invariant(
        "SI-CLIENT-04",
        "after a phone edit the old contract stays owned, an unowned old-phone contract stays unlinked, and the new-phone contract links to the edited client",
        async () => {
            const format = (phone: string): string => `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
            const phone1 = `010${String(41_000_000 + Math.floor(Math.random() * 8_999_999)).padStart(8, "0")}`;
            const phone2 = `010${String(57_000_000 + Math.floor(Math.random() * 8_999_999)).padStart(8, "0")}`;

            const client = await createClient(handle.raw, tracker, {
                branchId,
                name: "김전화",
                birthday: "1992-03-04",
                phone: format(phone1),
                phoneNormalized: phone1,
            });
            // One mirrored contract already owned by the client, pointer set.
            const oldDocumentId = await createEformsignDoc(handle.raw, tracker, {
                branchId,
                clientId: client.id,
                documentKind: "contract",
                statusType: "050",
                customerPhone: phone1,
                stepRecipientSms: phone1,
                syncStatus: "ready",
            }).then((doc) => doc.documentId);
            await handle.raw.client.update({ where: { id: client.id }, data: { eDocId: oldDocumentId } });

            // The client edits their phone on the real ClientService.update path.
            const service = makeClientService({ prisma: handle.service, raw: handle.raw });
            await service.update(branchId, client.id, { phone: format(phone2) });
            const editedRow = await handle.raw.client.findUniqueOrThrow({
                where: { id: client.id },
                select: { phoneNormalized: true },
            });
            if (editedRow.phoneNormalized !== phone2) {
                throw new Error(`SI-CLIENT-04 fixture: the phone edit stored "${String(editedRow.phoneNormalized)}", expected ${phone2}`);
            }

            const linker = new LinkMirroredEformsignDocByPhoneUsecase(
                handle.service,
                { get: () => undefined } as never,
                { getClientAutoRegistrationEnabled: async () => false } as never,
                calendarStub,
            );

            // Leg 1 — the reconciler reconciles the OLD contract: it stays
            // attached to its owner (retained signed-contract history, 고객-06).
            const oldResult = await linker.execute(oldDocumentId);
            if (oldResult !== "already_linked") {
                throw new Error(
                    `SI-CLIENT-04: the reconciler did not keep the owned old contract attached after the phone edit (result "${oldResult}")`,
                );
            }
            const oldDoc = await handle.raw.eformsign_doc.findUniqueOrThrow({
                where: { documentId: oldDocumentId },
                select: { clientId: true },
            });
            if (oldDoc.clientId !== client.id) {
                throw new Error(
                    `SI-CLIENT-04: the owned old contract moved to client ${String(oldDoc.clientId)} after the phone edit`,
                );
            }

            // Leg 2 — a contract for the OLD phone with no owner: the edited
            // client no longer matches the phone, and with auto-registration
            // off nothing may claim it (it stays unlinked).
            const orphanOldDocumentId = await createEformsignDoc(handle.raw, tracker, {
                branchId,
                documentKind: "contract",
                statusType: "050",
                customerPhone: phone1,
                stepRecipientSms: phone1,
                detailPayload: {
                    document: { id: "integrity-fixture" },
                    fields: [
                        { id: "이용자 성명", value: "김전화", type: "text" },
                        { id: "이용자 생년월일", value: "920304", type: "text" },
                        { id: "이용자 연락처", value: format(phone1), type: "text" },
                    ],
                    recipients: [{ recipient_type: "02", name: "김전화", sms: format(phone1) }],
                },
                detailSourceUpdatedDate: new Date(),
                detailSyncedAt: new Date(),
                syncStatus: "ready",
            }).then((doc) => doc.documentId);
            const orphanResult = await linker.execute(orphanOldDocumentId);
            const orphanOwners = await handle.raw.client.count({ where: { phoneNormalized: phone1, deletedAt: null } });
            if (orphanOwners !== 0) {
                throw new Error(`SI-CLIENT-04: ${orphanOwners} live client(s) still hold the edited-away phone`);
            }
            const orphanDoc = await handle.raw.eformsign_doc.findUniqueOrThrow({
                where: { documentId: orphanOldDocumentId },
                select: { clientId: true },
            });
            if (orphanDoc.clientId !== null || orphanResult === "linked" || orphanResult === "created" || orphanResult === "already_linked") {
                throw new Error(
                    `SI-CLIENT-04: the unowned old-phone contract got assigned to client ${String(orphanDoc.clientId)} (result "${orphanResult}") after the phone edit`,
                );
            }

            // Leg 3 — a contract for the NEW phone: it must reach the edited
            // client through the phone match.
            const newDocumentId = await createEformsignDoc(handle.raw, tracker, {
                branchId,
                documentKind: "contract",
                statusType: "050",
                customerPhone: phone2,
                stepRecipientSms: phone2,
                detailPayload: {
                    document: { id: "integrity-fixture" },
                    fields: [
                        { id: "이용자 성명", value: "김전화", type: "text" },
                        { id: "이용자 생년월일", value: "920304", type: "text" },
                        { id: "이용자 연락처", value: format(phone2), type: "text" },
                    ],
                    recipients: [{ recipient_type: "02", name: "김전화", sms: format(phone2) }],
                },
                detailSourceUpdatedDate: new Date(),
                detailSyncedAt: new Date(),
                syncStatus: "ready",
            }).then((doc) => doc.documentId);
            const newResult = await linker.execute(newDocumentId);
            const newDoc = await handle.raw.eformsign_doc.findUniqueOrThrow({
                where: { documentId: newDocumentId },
                select: { clientId: true },
            });
            if (newResult !== "linked" || newDoc.clientId !== client.id) {
                throw new Error(
                    `SI-CLIENT-04: the new-phone contract was left unlinked or attached elsewhere after the phone edit (result "${newResult}", clientId ${String(newDoc.clientId)})`,
                );
            }
        },
    );

    invariant(
        "SI-CLIENT-04",
        "the stale tombstone pointer does not block a new same-phone client from claiming a new contract",
        async () => {
            const phone = `010${String(50_000_000 + Math.floor(Math.random() * 49_999_999)).padStart(8, "0")}`;
            const formatted = `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
            const oldClient = await createClient(handle.raw, tracker, {
                branchId,
                name: "김이전",
                birthday: "1992-03-04",
                phone: formatted,
                phoneNormalized: phone,
            });
            const oldDocumentId = await createEformsignDoc(handle.raw, tracker, {
                branchId,
                clientId: oldClient.id,
                documentKind: "contract",
                customerPhone: phone,
                stepRecipientSms: phone,
            }).then((doc) => doc.documentId);
            await handle.raw.client.update({ where: { id: oldClient.id }, data: { eDocId: oldDocumentId } });

            const repository = new SbClientRepository(handle.service, enabledConfig() as never);
            if (await repository.delete(branchId, oldClient.id) !== "tombstoned") {
                throw new Error("SI-CLIENT-04 fixture: tombstone failed");
            }

            // The same person re-registers with the same phone.
            const newClient = await createClient(handle.raw, tracker, {
                branchId,
                name: "김재등록",
                birthday: "1992-03-04",
                phone: formatted,
                phoneNormalized: phone,
            });

            const linker = new LinkMirroredEformsignDocByPhoneUsecase(
                handle.service,
                { get: () => undefined } as never,
                { getClientAutoRegistrationEnabled: async () => false } as never,
                calendarStub,
            );
            const newDocumentId = await createEformsignDoc(handle.raw, tracker, {
                branchId,
                documentKind: "contract",
                statusType: "050",
                customerPhone: phone,
                stepRecipientSms: phone,
                detailPayload: {
                    document: { id: "integrity-fixture" },
                    fields: [
                        { id: "이용자 성명", value: "김재등록", type: "text" },
                        { id: "이용자 생년월일", value: "920304", type: "text" },
                        { id: "이용자 연락처", value: formatted, type: "text" },
                    ],
                    recipients: [{ recipient_type: "02", name: "김재등록", sms: formatted }],
                },
                detailSourceUpdatedDate: new Date(),
                detailSyncedAt: new Date(),
                syncStatus: "ready",
            }).then((doc) => doc.documentId);

            const result = await linker.execute(newDocumentId);
            if (result !== "linked" && result !== "created") {
                throw new Error(
                    `SI-CLIENT-04: the stale tombstone pointer blocked the new same-phone client (link result "${result}")`,
                );
            }
            const newPointer = await handle.raw.client.findUniqueOrThrow({
                where: { id: newClient.id },
                select: { eDocId: true },
            });
            if (newPointer.eDocId !== newDocumentId) {
                throw new Error(`SI-CLIENT-04: new client pointer is ${String(newPointer.eDocId)}, expected ${newDocumentId}`);
            }
        },
    );

    invariant(
        "SI-CLIENT-04",
        "the mirror reconciler keeps the tombstoned owner attached to the old contract (evidence for SI-CLIENT-04)",
        async () => {
            const phone = `010${String(60_000_000 + Math.floor(Math.random() * 39_999_999)).padStart(8, "0")}`;
            const formatted = `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
            const oldClient = await createClient(handle.raw, tracker, {
                branchId,
                name: "김수정",
                birthday: "1992-03-04",
                phone: formatted,
                phoneNormalized: phone,
            });
            const oldDocumentId = await createEformsignDoc(handle.raw, tracker, {
                branchId,
                clientId: oldClient.id,
                documentKind: "contract",
                statusType: "050",
                customerPhone: phone,
                stepRecipientSms: phone,
                syncStatus: "ready",
            }).then((doc) => doc.documentId);
            await handle.raw.client.update({ where: { id: oldClient.id }, data: { eDocId: oldDocumentId } });

            const repository = new SbClientRepository(handle.service, enabledConfig() as never);
            if (await repository.delete(branchId, oldClient.id) !== "tombstoned") {
                throw new Error("SI-CLIENT-04 fixture: tombstone failed");
            }

            const linker = new LinkMirroredEformsignDocByPhoneUsecase(
                handle.service,
                { get: () => undefined } as never,
                { getClientAutoRegistrationEnabled: async () => false } as never,
                calendarStub,
            );
            // The mirror re-reconciles the OLD contract: it must not relink it
            // to a live client while it stays owned by the tombstone.
            const result = await linker.execute(oldDocumentId);
            const doc = await handle.raw.eformsign_doc.findUniqueOrThrow({
                where: { documentId: oldDocumentId },
                select: { clientId: true },
            });
            const pointer = await handle.raw.client.findUniqueOrThrow({
                where: { id: oldClient.id },
                select: { eDocId: true },
            });
            if (result === "linked" && (doc.clientId !== oldClient.id || pointer.eDocId !== oldDocumentId)) {
                throw new Error("SI-CLIENT-04 reconciler moved the tombstoned ownership unexpectedly");
            }
            if (doc.clientId !== oldClient.id || pointer.eDocId !== oldDocumentId) {
                throw new Error("SI-CLIENT-04: expected the reconciler to leave the tombstoned ownership in place");
            }
        },
    );
});
