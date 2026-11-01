import { PrismaClient } from "@prisma/client";

import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";

import {
    calendarStub,
    clientRow,
    createContractClient,
    createContractDoc,
    docRow,
} from "./contracts-fixture";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal, assertThrowawayTarget, type IntegrityPrisma } from "../helpers/real-db";
import { invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

/**
 * SI-CONTRACT-03 — the unfenced end-date fallback. The hypothesis: `syncEndDateFromContract`
 * writes the client end date without the current-contract/void/purge fence and is reachable
 * through `typeof fencedSync !== "function"` fallbacks in
 * `eformsign-webhook.service.ts` (handleCompletedDocument's persist closure) and
 * `reconcile-completed-mirrored-eformsign-doc.usecase.ts` (syncLinkedContract's persist closure).
 *
 * Both call sites only fall back when the real `ServiceRecordLifecycleService` instance lacks
 * `syncEndDateFromCurrentContract` — i.e. only for legacy unit-test doubles. This spec proves
 * the fallback is dead on the production class, and re-asserts (single case, no race) that the
 * fenced path refuses a voided document.
 */

describeReal("unfenced end-date fallback reachability (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let raw: PrismaClient;
    let tracker: RowTracker;
    let lifecycle: ServiceRecordLifecycleService;
    let branchId: string;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        raw = handle.raw;
        tracker = new RowTracker();
        const branchRow = await raw.branch.create({
            data: { name: "무결성 종료일 지점", slug: `throwaway-si-contracts-enddate-${Date.now().toString(36)}` },
        });
        tracker.track("branch", branchRow.id);
        branchId = branchRow.id;
        lifecycle = new ServiceRecordLifecycleService(handle.service, calendarStub);
    });

    afterAll(async () => {
        if (tracker) {
            await tracker.cleanup(raw);
        }
        if (handle) {
            await closeIntegrityPrisma(handle);
        }
    });

    invariant("SI-CONTRACT-03", "the production lifecycle class always exposes the fenced end-date sync, so the unfenced webhook/usecase fallback is dead code", async () => {
        // Both `typeof fencedSync !== "function"` fallbacks (webhook persist
        // closure and reconciler persist closure) can only be taken by a
        // lifecycle double that lacks the fence. The real class has it —
        // including its mirrored variant — so no production caller can reach
        // the unfenced `syncEndDateFromContract`.
        expect(typeof lifecycle.syncEndDateFromCurrentContract).toBe("function");
        expect(typeof lifecycle.syncEndDateFromMirroredContract).toBe("function");

        // And the fenced entry points keep their void fence: a voided contract
        // cannot move the client end date even when it is still the pointer.
        const client = await createContractClient(handle, tracker, branchId);
        const doc = await createContractDoc(handle, tracker, branchId, {
            clientId: client.id,
            voided: true,
            statusType: "050",
            statusDetail: "완료",
        });
        await raw.client.update({ where: { id: client.id }, data: { eDocId: doc.documentId } });
        const before = await clientRow(handle, client.id);

        await expect(lifecycle.syncEndDateFromCurrentContract({
            branchId,
            clientId: client.id,
            endDate: new Date("2026-12-31T00:00:00.000Z"),
            documentId: doc.documentId,
        })).resolves.toBe(false);

        const after = await clientRow(handle, client.id);
        expect(after.endDate).toEqual(before.endDate);
        expect(after.endDate).not.toEqual(new Date("2026-12-31T00:00:00.000Z"));
        expect((await docRow(handle, doc.documentId)).voidedAt).not.toBeNull();
    });
});
