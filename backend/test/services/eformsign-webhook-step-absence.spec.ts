import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";

/**
 * A webhook whose mirrored `current_status` carries no step fields used to read the row
 * (`05/2`), build a full entity and write it back, copying the step columns it had just
 * read. If the mirror/backfill stored a newer `06/3` between that read and the write, the
 * later-stamped webhook passed the timestamp guard and put `05/2` back over it.
 *
 * These specs run the REAL webhook service, usecase and `SbEformsignDocRepository` over an
 * in-memory `eformsign_doc` table whose `updateMany` honours the predicate (as Postgres
 * does), and inject the concurrent mirror write between the read and the write.
 */

type Row = Record<string, unknown> & {
    stepType: string;
    stepIndex: string;
    updatedDate: Date;
};

const BRANCH = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "doc-step-absence";

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    const and = where["AND"] as Record<string, unknown>[] | undefined;
    if (and && !and.every((w) => matches(row, w))) return false;
    const or = where["OR"] as Record<string, unknown>[] | undefined;
    if (or && !or.some((w) => matches(row, w))) return false;
    for (const [key, condition] of Object.entries(where)) {
        if (key === "AND" || key === "OR") continue;
        const value = row[key] as never;
        if (condition && typeof condition === "object" && !(condition instanceof Date)) {
            const c = condition as { notIn?: unknown[]; in?: unknown[]; lt?: never; lte?: never };
            if (c.notIn && c.notIn.includes(value)) return false;
            if (c.in && !c.in.includes(value)) return false;
            if (c.lt && !(value < c.lt)) return false;
            if (c.lte && !(value <= c.lte)) return false;
        } else if (value !== condition) {
            return false;
        }
    }
    return true;
}

const freshRow = (branchId: string | null): Row => ({
    id: 1,
    documentId: DOCUMENT_ID,
    branchId,
    documentName: "probe contract",
    documentNumber: null,
    templateName: "template",
    customerName: "customer",
    creatorName: "creator",
    lastEditorName: "editor",
    stepRecipientTypes: null,
    createdDate: new Date("2026-09-30T00:00:00Z"),
    updatedDate: new Date("2026-10-01T09:00:00Z"),
    statusType: "060",
    statusDetail: "requested",
    stepType: "05",
    stepIndex: "2",
    stepName: "customer",
    stepRecipientType: "01",
    stepRecipientName: "staff",
    stepRecipientSms: "01011112222",
    expiredDate: new Date("2026-12-01T00:00:00Z"),
    expired: false,
    clientId: null,
    documentKind: null,
    employeeScheduleId: null,
    templateId: null,
    permanentPurgeRequestedAt: null,
});

/** In-memory table. `beforeWrite` runs once, just before the first UPDATE is evaluated. */
function createTable(initial: Row, beforeWrite?: (row: Row) => Row) {
    const state = { row: initial, pendingHook: beforeWrite, updateData: [] as Record<string, unknown>[] };
    const prisma = {
        eformsign_doc: {
            findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
                matches(state.row, where) ? { ...state.row } : null),
            findUnique: jest.fn(async () => ({ ...state.row })),
            updateMany: jest.fn(async ({ where, data }: {
                where: Record<string, unknown>;
                data: Record<string, unknown>;
            }) => {
                if (state.pendingHook) {
                    const hook = state.pendingHook;
                    state.pendingHook = undefined;
                    state.row = hook(state.row);
                }
                state.updateData.push(data);
                if (!matches(state.row, where)) return { count: 0 };
                for (const [key, value] of Object.entries(data)) {
                    if (value !== undefined) (state.row as Record<string, unknown>)[key] = value;
                }
                return { count: 1 };
            }),
        },
    };
    return { state, prisma };
}

/** The mirror/backfill writer storing a newer step between the webhook's read and write. */
const concurrentMirrorWrite = (row: Row): Row => ({
    ...row,
    stepType: "06",
    stepIndex: "3",
    updatedDate: new Date("2026-10-02T08:00:00Z"),
});

function createService(prisma: unknown) {
    const repository = new SbEformsignDocRepository(prisma as never);
    const service = new EformsignWebhookService(
        new UpdateEformsignDocStatusUsecase(repository),
        { execute: async () => undefined } as never,
        {} as never,
        { emit: () => undefined } as never,
        { sendToBranchUsers: async () => ({ sent: 0, failed: 0 }) } as never,
        {} as never,
        {} as never,
        { findById: async () => null } as never,
        repository,
        { findByClientId: async () => [] } as never,
        { findById: async () => null } as never,
        {} as never,
    );
    return { service, repository };
}

const webhookPayload = (action = false) => ({
    webhook_id: "probe-webhook",
    webhook_name: "probe",
    company_id: "probe",
    event_type: action ? "document_action" : "document",
    document: {
        id: DOCUMENT_ID,
        document_title: "probe contract",
        template_id: "template",
        template_name: "template",
        workflow_seq: 1,
        workflow_name: "customer",
        status: "doc_request_participant",
        ...(action ? { action: "doc_open_participant" } : {}),
        updated_date: Date.parse("2026-10-02T09:00:00Z"),
    },
}) as never;

const mirror = (stepType: string, stepIndex: string) => ({
    mirroredDocument: {
        current_status: {
            status_type: "060",
            step_type: stepType,
            step_index: stepIndex,
            step_name: "customer",
        },
    },
}) as never;

describe.each([
    ["unassigned (branchId null)", null],
    ["branch-owned", BRANCH],
])("webhook step-field absence, %s row", (_label, branchId) => {
    it("CONTROL: with no concurrent write a blank-step webhook leaves 05/2 and still updates the status", async () => {
        const { state, prisma } = createTable(freshRow(branchId));
        const { service } = createService(prisma);

        await service.processWebhook(webhookPayload(), mirror("", ""));

        expect(state.row.stepType).toBe("05");
        expect(state.row.stepIndex).toBe("2");
        expect(state.row.updatedDate).toEqual(new Date("2026-10-02T09:00:00Z"));
        expect(state.updateData).toHaveLength(1);
    });

    it("a newer concurrent 06/3 survives a later blank-step webhook", async () => {
        const { state, prisma } = createTable(freshRow(branchId), concurrentMirrorWrite);
        const { service } = createService(prisma);

        await service.processWebhook(webhookPayload(), mirror("", ""));

        expect(state.row.stepType).toBe("06");
        expect(state.row.stepIndex).toBe("3");
        // The webhook still lands: only the step columns are withheld from the UPDATE.
        expect(state.row.updatedDate).toEqual(new Date("2026-10-02T09:00:00Z"));
        expect(state.updateData).toHaveLength(1);
        expect(state.updateData[0]).not.toHaveProperty("stepType");
        expect(state.updateData[0]).not.toHaveProperty("stepIndex");
    });

    it("a newer concurrent 06/3 survives a webhook with no mirrored document at all", async () => {
        const { state, prisma } = createTable(freshRow(branchId), concurrentMirrorWrite);
        const { service } = createService(prisma);

        await service.processWebhook(webhookPayload());

        expect(state.row.stepType).toBe("06");
        expect(state.row.stepIndex).toBe("3");
    });

    it("a newer concurrent 06/3 survives a blank-step document_action webhook", async () => {
        const { state, prisma } = createTable(freshRow(branchId), concurrentMirrorWrite);
        const { service } = createService(prisma);

        await service.processWebhook(webhookPayload(true), mirror("", ""));

        expect(state.row.stepType).toBe("06");
        expect(state.row.stepIndex).toBe("3");
    });

    it("a webhook that carries step fields still writes both", async () => {
        const { state, prisma } = createTable(freshRow(branchId));
        const { service } = createService(prisma);

        await service.processWebhook(webhookPayload(), mirror("06", "3"));

        expect(state.row.stepType).toBe("06");
        expect(state.row.stepIndex).toBe("3");
        expect(state.updateData[0]).toMatchObject({ stepType: "06", stepIndex: "3" });
    });

    it("writes only the supplied step field when the other is blank", async () => {
        const { state, prisma } = createTable(freshRow(branchId), concurrentMirrorWrite);
        const { service } = createService(prisma);

        await service.processWebhook(webhookPayload(), mirror("07", ""));

        expect(state.row.stepType).toBe("07");
        expect(state.row.stepIndex).toBe("3");
        expect(state.updateData[0]).not.toHaveProperty("stepIndex");
    });
});

describe("UpdateEformsignDocStatusUsecase step-field absence over the real repository", () => {
    const params = {
        documentId: DOCUMENT_ID,
        statusType: "060",
        statusDetail: "requested",
        stepName: "customer",
    };

    it("the unguarded update path (no sourceUpdatedDate) keeps a concurrent 06/3", async () => {
        const { state, prisma } = createTable(freshRow(BRANCH), concurrentMirrorWrite);
        const usecase = new UpdateEformsignDocStatusUsecase(
            new SbEformsignDocRepository(prisma as never),
        );

        await usecase.executeWithOutcome(BRANCH, params);

        expect(state.row.stepType).toBe("06");
        expect(state.row.stepIndex).toBe("3");
        expect(state.updateData[0]).not.toHaveProperty("stepType");
        expect(state.updateData[0]).not.toHaveProperty("stepIndex");
    });

    it("CONTROL: the unguarded update path without a race keeps 05/2", async () => {
        const { state, prisma } = createTable(freshRow(BRANCH));
        const usecase = new UpdateEformsignDocStatusUsecase(
            new SbEformsignDocRepository(prisma as never),
        );

        await usecase.executeWithOutcome(BRANCH, params);

        expect(state.row.stepType).toBe("05");
        expect(state.row.stepIndex).toBe("2");
    });

    it("the unguarded update path still writes supplied step fields", async () => {
        const { state, prisma } = createTable(freshRow(BRANCH));
        const usecase = new UpdateEformsignDocStatusUsecase(
            new SbEformsignDocRepository(prisma as never),
        );

        await usecase.executeWithOutcome(BRANCH, { ...params, stepType: "06", stepIndex: "3" });

        expect(state.row.stepType).toBe("06");
        expect(state.row.stepIndex).toBe("3");
    });

    it("the source-newer path omits only the unsupplied step field", async () => {
        const { state, prisma } = createTable(freshRow(BRANCH), concurrentMirrorWrite);
        const usecase = new UpdateEformsignDocStatusUsecase(
            new SbEformsignDocRepository(prisma as never),
        );

        await usecase.executeWithOutcome(BRANCH, {
            ...params,
            stepType: "07",
            sourceUpdatedDate: new Date("2026-10-02T09:00:00Z"),
        });

        expect(state.row.stepType).toBe("07");
        expect(state.row.stepIndex).toBe("3");
        expect(state.updateData[0]).not.toHaveProperty("stepIndex");
    });
});

describe("SbEformsignDocRepository.updateDocument step options", () => {
    const entity = (): EformsignDocEntity => EformsignDocEntity.reconstitute({
        id: 1,
        documentId: DOCUMENT_ID,
        documentName: "probe contract",
        templateName: "template",
        customerName: "customer",
        creatorName: "creator",
        lastEditorName: "editor",
        stepRecipientTypes: null,
        createdDate: new Date("2026-09-30T00:00:00Z"),
        updatedDate: new Date("2026-10-02T09:00:00Z"),
        statusType: "060",
        statusDetail: "requested",
        stepType: "05",
        stepIndex: "2",
        stepName: "customer",
        stepRecipientType: "01",
        stepRecipientName: "staff",
        stepRecipientSms: "01011112222",
        expiredDate: new Date("2026-12-01T00:00:00Z"),
        expired: false,
        clientId: null,
    } as never);

    it("omits the step columns from the pending-column retry write as well", async () => {
        const { state, prisma } = createTable(freshRow(BRANCH));
        const realUpdateMany = prisma.eformsign_doc.updateMany.getMockImplementation()!;
        prisma.eformsign_doc.updateMany
            .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => {
                state.updateData.push(data);
                throw Object.assign(
                    new Error("The column `eformsign_doc.document_kind` does not exist"),
                    { code: "P2022", meta: { column: "eformsign_doc.document_kind" } },
                );
            })
            .mockImplementation(realUpdateMany);
        const repository = new SbEformsignDocRepository(prisma as never);

        await repository.update(BRANCH, entity(), { updateStepType: false, updateStepIndex: false });

        expect(state.updateData).toHaveLength(2);
        for (const data of state.updateData) {
            expect(data).not.toHaveProperty("stepType");
            expect(data).not.toHaveProperty("stepIndex");
        }
    });

    it("defaults to writing both step columns", async () => {
        const { state, prisma } = createTable(freshRow(BRANCH));
        const repository = new SbEformsignDocRepository(prisma as never);

        await repository.update(BRANCH, entity());

        expect(state.updateData[0]).toMatchObject({ stepType: "05", stepIndex: "2" });
    });
});
