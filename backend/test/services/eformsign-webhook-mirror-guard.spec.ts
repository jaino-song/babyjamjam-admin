import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";

/**
 * The webhook's writes must respect what the mirror already established.
 *
 *  1. The unassigned path compares the event's status with the mirror's current status, as
 *     the branch-owned path always did, instead of letting a synthesised code win.
 *  2. A 062 (participant accepted) is never written back as 060.
 *  3. The step NAME comes from `current_status.step_name`, never from `workflow_name`.
 *  4. Recipient / document number / expiry the webhook never carries are never re-sent from
 *     an earlier read.
 *
 * Everything runs the REAL webhook service, usecase and `SbEformsignDocRepository` over an
 * in-memory `eformsign_doc` table whose `updateMany` honours the predicate (as Postgres
 * does), with an optional concurrent write injected between the read and the write.
 */

type Row = Record<string, unknown> & {
    statusType: string;
    statusDetail: string;
    stepType: string;
    stepIndex: string;
    stepName: string;
    documentNumber: string | null;
    stepRecipientType: string;
    stepRecipientName: string;
    stepRecipientSms: string;
    expiredDate: Date;
    expired: boolean;
    updatedDate: Date;
};

const BRANCH = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "doc-mirror-guard";
const T = Date.parse("2026-10-02T09:00:00Z");

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

const freshRow = (branchId: string | null, overrides: Partial<Row> = {}): Row => ({
    id: 1,
    documentId: DOCUMENT_ID,
    branchId,
    documentName: "contract",
    documentNumber: "N-1",
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
    stepName: "고객 서명",
    stepRecipientType: "01",
    stepRecipientName: "recipient-1",
    stepRecipientSms: "01011112222",
    expiredDate: new Date("2026-12-01T00:00:00Z"),
    expired: false,
    clientId: null,
    documentKind: null,
    employeeScheduleId: null,
    templateId: null,
    permanentPurgeRequestedAt: null,
    ...overrides,
});

function createTable(initial: Row, beforeWrite?: (row: Row) => Row) {
    const state = { row: initial, pendingHook: beforeWrite, updateData: [] as Record<string, unknown>[] };
    const prisma = {
        eformsign_doc: {
            findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
                matches(state.row, where) ? { ...state.row } : null),
            findUnique: jest.fn(async () => ({ ...state.row })),
            count: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
                matches(state.row, where) ? 1 : 0),
            // The unassigned upsert tries a create when its UPDATE matched nothing, then
            // falls back to deciding why; a row exists here, so the create always collides.
            create: jest.fn(async () => {
                throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
            }),
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

const documentPayload = (
    status: string,
    extra: { ts?: number; action?: string } = {},
) => ({
    webhook_id: "probe-webhook",
    webhook_name: "probe",
    company_id: "probe",
    event_type: extra.action ? "document_action" : "document",
    document: {
        id: DOCUMENT_ID,
        document_title: "contract",
        template_id: "template",
        template_name: "template",
        workflow_seq: 1,
        workflow_name: "workflow-name",
        status,
        ...(extra.action ? { action: extra.action } : {}),
        updated_date: extra.ts ?? T,
    },
}) as never;

const pdfPayload = (status: string) => ({
    webhook_id: "probe-webhook",
    webhook_name: "probe",
    company_id: "probe",
    event_type: "ready_document_pdf",
    ready_document_pdf: {
        document_id: DOCUMENT_ID,
        document_title: "contract",
        document_status: status,
        template_id: "template",
        template_name: "template",
        workflow_seq: 1,
        workflow_name: "workflow-name",
    },
}) as never;

const mirror = (
    statusType: string,
    step: { type?: string; index?: string; name?: string } = {},
) => ({
    mirroredDocument: {
        updated_date: T,
        current_status: {
            status_type: statusType,
            step_type: step.type ?? "",
            step_index: step.index ?? "",
            step_name: step.name ?? "",
        },
    },
}) as never;

const BOTH_PATHS: ReadonlyArray<[string, string | null]> = [
    ["unassigned (branchId null)", null],
    ["branch-owned", BRANCH],
];

/**
 * The unassigned path used to write whatever status the event name synthesised, so an event
 * whose code differed from the mirror's overwrote it. Each row below is one such event: the
 * mirror (already projected onto the row by the controller, same timestamp as the webhook)
 * says `mirrorCode`, the event synthesises `eventCode`. Dropping the event keeps the
 * mirrored value, and nothing the mirror lacks is lost: a synthesised label only restates the
 * event name, and the document/template names the mirror writes itself.
 */
const DISAGREEING_EVENTS: ReadonlyArray<[string, string, string, string]> = [
    // [event status, synthesised code, mirror code, why the mirror value wins]
    ["doc_create", "010", "060", "created, then immediately requested"],
    ["doc_request_approval", "060", "010", "mirror reports the approval request itself"],
    ["doc_accept_approval", "060", "070", "approval accepted, review already requested"],
    ["doc_accept_outsider", "060", "070", "outsider accepted, review already requested"],
    ["doc_accept_participant", "060", "070", "participant accepted, review already requested"],
    ["doc_tempsave_participant", "060", "001", "mirror reports the draft state"],
    ["doc_request_participant", "060", "070", "an older request event at the mirror's timestamp"],
    ["doc_decline", "080", "060", "mirror says the document is still live"],
    ["doc_not_in_the_status_table", "060", "070", "unknown events collapse to 060"],
];

describe("unassigned webhook path honours the mirrored status", () => {
    it.each(DISAGREEING_EVENTS)(
        "%s (%s) loses to a mirror at %s on an unassigned row (%s)",
        async (eventStatus, _eventCode, mirrorCode) => {
            const { state, prisma } = createTable(freshRow(null, {
                statusType: mirrorCode,
                statusDetail: "from mirror",
                updatedDate: new Date(T),
            }));
            const { service } = createService(prisma);

            await service.processWebhook(documentPayload(eventStatus), mirror(mirrorCode));

            expect(state.row.statusType).toBe(mirrorCode);
            expect(state.row.statusDetail).toBe("from mirror");
            expect(state.updateData).toHaveLength(0);
        },
    );

    it.each(DISAGREEING_EVENTS)(
        "%s (%s) is dropped the same way on a branch-owned row",
        async (eventStatus, _eventCode, mirrorCode) => {
            const { state, prisma } = createTable(freshRow(BRANCH, {
                statusType: mirrorCode,
                statusDetail: "from mirror",
                updatedDate: new Date(T - 1000),
            }));
            const { service } = createService(prisma);

            await service.processWebhook(documentPayload(eventStatus), mirror(mirrorCode));

            expect(state.row.statusType).toBe(mirrorCode);
            expect(state.updateData).toHaveLength(0);
        },
    );

    it("a non-completion ready_document_pdf event is held to the mirror too", async () => {
        const { state, prisma } = createTable(freshRow(null, {
            statusType: "070",
            statusDetail: "from mirror",
            updatedDate: new Date(T),
        }));
        const { service } = createService(prisma);

        await service.processWebhook(pdfPayload("doc_request_participant"), mirror("070"));

        expect(state.row.statusType).toBe("070");
        expect(state.updateData).toHaveLength(0);
    });

    it("a document_action carries the mirror's own code instead of a synthesised 020", async () => {
        const { state, prisma } = createTable(freshRow(null, {
            statusType: "070",
            statusDetail: "from mirror",
            updatedDate: new Date(T),
        }));
        const { service } = createService(prisma);

        await service.processWebhook(
            documentPayload("doc_request_reviewer", { action: "doc_open_participant" }),
            mirror("070"),
        );

        // Before the guard this wrote 020 over a reviewer-stage 070. An action knows
        // nothing about status, detail or expiry, so it writes none of them.
        expect(state.row.statusType).toBe("070");
        expect(state.row.statusDetail).toBe("from mirror");
        expect(state.updateData).toHaveLength(1);
        expect(state.updateData[0]).not.toHaveProperty("statusType");
        expect(state.updateData[0]).not.toHaveProperty("statusDetail");
        expect(state.updateData[0]).not.toHaveProperty("expired");
    });

    it("CONTROL: an action with no mirror still falls back to 020", async () => {
        const { state, prisma } = createTable(freshRow(null));
        const { service } = createService(prisma);

        await service.processWebhook(
            documentPayload("doc_request_participant", { action: "doc_open_participant" }),
        );

        expect(state.row.statusType).toBe("020");
    });

    it.each([
        ["doc_request_participant", "060", "서명 요청됨"],
        ["doc_request_reviewer", "070", "검토 요청"],
        ["doc_accept_reviewer", "072", "검토 완료"],
        ["doc_reject_reviewer", "071", "검토 반려"],
        ["doc_expired", "080", "만료"],
    ])("CONTROL: %s still lands when the mirror agrees (%s)", async (eventStatus, code, detail) => {
        const { state, prisma } = createTable(freshRow(null, { statusType: "010" }));
        const { service } = createService(prisma);

        await service.processWebhook(documentPayload(eventStatus), mirror(code));

        expect(state.row.statusType).toBe(code);
        expect(state.row.statusDetail).toBe(detail);
    });

    it("CONTROL: with no mirrored document the guard does not engage", async () => {
        const { state, prisma } = createTable(freshRow(null, { statusType: "010" }));
        const { service } = createService(prisma);

        await service.processWebhook(documentPayload("doc_request_participant"));

        expect(state.row.statusType).toBe("060");
    });

    it.each([
        ["document event", documentPayload("doc_complete")],
        ["ready_document_pdf event", pdfPayload("doc_complete")],
    ])("CONTROL: a completion %s is exempt from the comparison", async (_label, payload) => {
        // A completion settles through the completion path, whose mirror code may be any of
        // 003/012/022/032/062/072/092 rather than the synthesised 050.
        const { state, prisma } = createTable(freshRow(null, { statusType: "060" }));
        const { service } = createService(prisma);

        await service.processWebhook(payload, mirror("062"));

        expect(state.row.statusType).toBe("050");
        expect(state.updateData).toHaveLength(1);
    });
});

describe.each(BOTH_PATHS)(
    "a document_action never rewrites the status facts of a terminal mirrored row, %s row",
    (_label, branchId) => {
        it.each([
            ["080", "만료", true],
            ["061", "거부", false],
        ])("a row at %s (%s, expired=%s) keeps its detail and expiry", async (code, detail, expired) => {
            const { state, prisma } = createTable(freshRow(branchId, {
                statusType: code,
                statusDetail: detail,
                expired,
                updatedDate: new Date(T - 1000),
            }));
            const { service } = createService(prisma);

            await service.processWebhook(
                documentPayload("doc_request_participant", { action: "doc_open_participant" }),
                mirror(code),
            );

            expect(state.row.statusType).toBe(code);
            expect(state.row.statusDetail).toBe(detail);
            expect(state.row.expired).toBe(expired);
            // The action itself still lands.
            expect(state.row.updatedDate).toEqual(new Date(T));
            expect(state.updateData).toHaveLength(1);
            expect(state.updateData[0]).not.toHaveProperty("statusDetail");
            expect(state.updateData[0]).not.toHaveProperty("expired");
        });

        it("a live row keeps its detail too, and still takes the action's timestamp", async () => {
            const { state, prisma } = createTable(freshRow(branchId, {
                statusDetail: "서명 요청됨",
                updatedDate: new Date(T - 1000),
            }));
            const { service } = createService(prisma);

            await service.processWebhook(
                documentPayload("doc_request_participant", { action: "doc_open_participant" }),
                mirror("060"),
            );

            expect(state.row.statusDetail).toBe("서명 요청됨");
            expect(state.row.updatedDate).toEqual(new Date(T));
        });
    },
);

describe("a branch-owned action is compare-and-set on the status it read", () => {
    const action = () =>
        documentPayload("doc_request_participant", { action: "doc_open_participant" });

    it("does not write the mirror's 060 over a 080 another webhook stored after the read", async () => {
        // Read as 060; before the UPDATE another webhook stores 080/만료/expired=true at T-60s.
        // The timestamp predicate alone lets the action (and its mirror at T) through.
        const { state, prisma } = createTable(
            freshRow(BRANCH, { updatedDate: new Date(T - 3_600_000) }),
            (row) => ({
                ...row,
                statusType: "080",
                statusDetail: "만료",
                expired: true,
                updatedDate: new Date(T - 60_000),
            }),
        );
        const { service } = createService(prisma);

        await service.processWebhook(action(), mirror("060"));

        expect(state.row.statusType).toBe("080");
        expect(state.row.statusDetail).toBe("만료");
        expect(state.row.expired).toBe(true);
        expect(state.row.updatedDate).toEqual(new Date(T - 60_000));
    });

    it("CONTROL: with the status unchanged since the read the action still lands", async () => {
        const { state, prisma } = createTable(
            freshRow(BRANCH, { updatedDate: new Date(T - 3_600_000) }),
            (row) => ({ ...row, stepName: "someone else touched a column", updatedDate: new Date(T - 60_000) }),
        );
        const { service } = createService(prisma);

        await service.processWebhook(action(), mirror("060"));

        expect(state.row.statusType).toBe("060");
        expect(state.row.updatedDate).toEqual(new Date(T));
        expect(state.updateData).toHaveLength(1);
    });

    it("CONTROL: a status webhook (not an action) is not pinned to the read status", async () => {
        const { state, prisma } = createTable(
            freshRow(BRANCH, { updatedDate: new Date(T - 3_600_000) }),
            (row) => ({ ...row, statusType: "070", updatedDate: new Date(T - 60_000) }),
        );
        const { service } = createService(prisma);

        await service.processWebhook(documentPayload("doc_request_participant"), mirror("060"));

        expect(state.row.statusType).toBe("060");
        expect(state.row.updatedDate).toEqual(new Date(T));
    });
});

describe("a 062 acceptance is never written back as 060", () => {
    it.each(BOTH_PATHS)(
        "%s: doc_accept_participant at the mirror's timestamp leaves a mirrored 062",
        async (_label, branchId) => {
            const { state, prisma } = createTable(freshRow(branchId, {
                statusType: "062",
                statusDetail: "accepted",
                updatedDate: new Date(T),
            }));
            const { service } = createService(prisma);

            await service.processWebhook(documentPayload("doc_accept_participant"), mirror("062"));

            expect(state.row.statusType).toBe("062");
            expect(state.row.statusDetail).toBe("accepted");
            expect(state.updateData).toHaveLength(0);
        },
    );

    it.each(BOTH_PATHS)(
        "%s: an event that raced a newer 062 write is refused by the repository guards as well",
        async (_label, branchId) => {
            // No mirrored document here, so only the repository predicate stands in the way:
            // the row is read as 060 and becomes 062 before the webhook's write lands.
            const { state, prisma } = createTable(
                freshRow(branchId, { updatedDate: new Date(T - 3_600_000) }),
                (row) => ({ ...row, statusType: "062", updatedDate: new Date(T) }),
            );
            const { service } = createService(prisma);

            await service.processWebhook(documentPayload("doc_accept_participant"));

            expect(state.row.statusType).toBe("062");
        },
    );

    it.each(BOTH_PATHS)(
        "%s: doc_accept_participant older than the stored 062 is stale",
        async (_label, branchId) => {
            const { state, prisma } = createTable(freshRow(branchId, {
                statusType: "062",
                updatedDate: new Date(T + 60_000),
            }));
            const { service } = createService(prisma);

            await service.processWebhook(documentPayload("doc_accept_participant"));

            expect(state.row.statusType).toBe("062");
            expect(state.updateData).toHaveLength(0);
        },
    );
});

describe.each(BOTH_PATHS)("045 / 041 are mapped to their own codes, %s row", (_label, branchId) => {
    it.each([
        ["doc_request_reject", "045", "철회 요청"],
        ["doc_reject_request", "045", "철회 요청"],
        ["doc_refuse_revoke", "041", "서명 요청됨"],
    ])("%s is stored as %s when the mirror reports it", async (eventStatus, code, detail) => {
        const { state, prisma } = createTable(freshRow(branchId));
        const { service } = createService(prisma);

        await service.processWebhook(documentPayload(eventStatus), mirror(code));

        expect(state.row.statusType).toBe(code);
        expect(state.row.statusDetail).toBe(detail);
    });

    it.each(["doc_request_reject", "doc_refuse_revoke"])(
        "%s is dropped when the mirror says the document is still at 060",
        async (eventStatus) => {
            const { state, prisma } = createTable(freshRow(branchId));
            const { service } = createService(prisma);

            await service.processWebhook(documentPayload(eventStatus), mirror("060"));

            expect(state.row.statusType).toBe("060");
            expect(state.updateData).toHaveLength(0);
        },
    );
});

describe.each(BOTH_PATHS)("stepName comes from the mirrored step, %s row", (_label, branchId) => {
    const concurrentStepName = (row: Row): Row => ({
        ...row,
        stepName: "제공기관 확인",
        updatedDate: new Date(T - 60_000),
    });

    it("stores current_status.step_name and not the workflow name", async () => {
        const { state, prisma } = createTable(freshRow(branchId));
        const { service } = createService(prisma);

        await service.processWebhook(
            documentPayload("doc_request_participant"),
            mirror("060", { name: "제공기관 확인" }),
        );

        expect(state.row.stepName).toBe("제공기관 확인");
        expect(state.updateData[0]).toMatchObject({ stepName: "제공기관 확인" });
    });

    it("stores the mirrored step name from a ready_document_pdf event", async () => {
        const { state, prisma } = createTable(freshRow(branchId));
        const { service } = createService(prisma);

        await service.processWebhook(
            pdfPayload("doc_request_participant"),
            mirror("060", { name: "제공기관 확인" }),
        );

        expect(state.row.stepName).toBe("제공기관 확인");
    });

    it("keeps the stored step name when the mirror has none", async () => {
        const { state, prisma } = createTable(freshRow(branchId));
        const { service } = createService(prisma);

        await service.processWebhook(documentPayload("doc_request_participant"), mirror("060"));

        expect(state.row.stepName).toBe("고객 서명");
        expect(state.updateData).toHaveLength(1);
        expect(state.updateData[0]).not.toHaveProperty("stepName");
    });

    it("keeps the stored step name when there is no mirrored document at all", async () => {
        const { state, prisma } = createTable(freshRow(branchId));
        const { service } = createService(prisma);

        await service.processWebhook(documentPayload("doc_request_participant"));

        expect(state.row.stepName).toBe("고객 서명");
        expect(state.updateData[0]).not.toHaveProperty("stepName");
    });

    it("a newer step name stored concurrently survives a webhook that has none", async () => {
        const { state, prisma } = createTable(freshRow(branchId), concurrentStepName);
        const { service } = createService(prisma);

        await service.processWebhook(documentPayload("doc_request_participant"), mirror("060"));

        expect(state.row.stepName).toBe("제공기관 확인");
        // The webhook itself still lands.
        expect(state.row.updatedDate).toEqual(new Date(T));
    });

    it("a newer step name stored concurrently survives a document_action", async () => {
        const { state, prisma } = createTable(freshRow(branchId), concurrentStepName);
        const { service } = createService(prisma);

        await service.processWebhook(
            documentPayload("doc_request_participant", { action: "doc_open_participant" }),
            mirror("060"),
        );

        expect(state.row.stepName).toBe("제공기관 확인");
    });
});

describe("the completion claim does not write the workflow name as the step name", () => {
    const claimContext = (step?: { name?: string }) => ({
        ...(mirror("003", step) as object),
        deferCompletionEvent: true,
        deferCompletionEffects: true,
    }) as never;

    it("omits stepName when the mirror carries none", async () => {
        const { state, prisma } = createTable(freshRow(BRANCH));
        const { service } = createService(prisma);

        await service.processWebhook(documentPayload("doc_complete"), claimContext());

        expect(state.row.statusType).toBe("050");
        expect(state.row.stepName).toBe("고객 서명");
        expect(state.updateData[0]).not.toHaveProperty("stepName");
    });

    it("writes the mirrored step name when it has one", async () => {
        const { state, prisma } = createTable(freshRow(BRANCH));
        const { service } = createService(prisma);

        await service.processWebhook(
            documentPayload("doc_complete"),
            claimContext({ name: "제공기관 확인" }),
        );

        expect(state.row.statusType).toBe("050");
        expect(state.row.stepName).toBe("제공기관 확인");
    });
});

describe.each(BOTH_PATHS)(
    "recipient, document number and expiry are not re-sent from an earlier read, %s row",
    (_label, branchId) => {
        const concurrentMirrorWrite = (row: Row): Row => ({
            ...row,
            documentNumber: "N-2",
            stepRecipientType: "02",
            stepRecipientName: "recipient-2",
            stepRecipientSms: "01099998888",
            expiredDate: new Date("2027-01-15T00:00:00Z"),
            updatedDate: new Date(T - 60_000),
        });

        it("a newer concurrent write to those columns survives a status webhook", async () => {
            const { state, prisma } = createTable(freshRow(branchId), concurrentMirrorWrite);
            const { service } = createService(prisma);

            await service.processWebhook(documentPayload("doc_request_participant"), mirror("060"));

            expect(state.row.documentNumber).toBe("N-2");
            expect(state.row.stepRecipientType).toBe("02");
            expect(state.row.stepRecipientName).toBe("recipient-2");
            expect(state.row.stepRecipientSms).toBe("01099998888");
            expect(state.row.expiredDate).toEqual(new Date("2027-01-15T00:00:00Z"));
            // The webhook still lands.
            expect(state.row.updatedDate).toEqual(new Date(T));
            for (const key of [
                "documentNumber",
                "stepRecipientType",
                "stepRecipientName",
                "stepRecipientSms",
                "expiredDate",
            ]) {
                expect(state.updateData[0]).not.toHaveProperty(key);
            }
        });

        it("a newer concurrent stepRecipientTypes survives a status webhook", async () => {
            const { state, prisma } = createTable(
                freshRow(branchId, { stepRecipientTypes: "05" }),
                (row) => ({ ...row, stepRecipientTypes: "06", updatedDate: new Date(T - 60_000) }),
            );
            const { service } = createService(prisma);

            await service.processWebhook(documentPayload("doc_request_participant"), mirror("060"));

            expect(state.row["stepRecipientTypes"]).toBe("06");
            expect(state.updateData[0]).not.toHaveProperty("stepRecipientTypes");
        });

        it("CONTROL: the fields the webhook does carry are still written", async () => {
            const { state, prisma } = createTable(freshRow(branchId, { expired: false }));
            const { service } = createService(prisma);

            await service.processWebhook(
                documentPayload("doc_expired"),
                mirror("080", { type: "06", index: "3", name: "제공기관 확인" }),
            );

            expect(state.updateData[0]).toMatchObject({
                statusType: "080",
                statusDetail: "만료",
                stepType: "06",
                stepIndex: "3",
                stepName: "제공기관 확인",
                expired: true,
                documentName: "contract",
                templateName: "template",
                updatedDate: new Date(T),
            });
        });
    },
);

describe("mirror/backfill and other default-option writes are unchanged", () => {
    const entity = (overrides: Record<string, unknown> = {}): EformsignDocEntity =>
        EformsignDocEntity.reconstitute({
            id: 1,
            documentId: DOCUMENT_ID,
            documentName: "contract",
            documentNumber: "N-9",
            templateName: "template",
            customerName: "customer",
            creatorName: "creator",
            lastEditorName: "editor",
            stepRecipientTypes: ["05"],
            createdDate: new Date("2026-09-30T00:00:00Z"),
            updatedDate: new Date(T),
            statusType: "070",
            statusDetail: "검토 요청",
            stepType: "06",
            stepIndex: "3",
            stepName: "제공기관 확인",
            stepRecipientType: "02",
            stepRecipientName: "recipient-2",
            stepRecipientSms: "01099998888",
            expiredDate: new Date("2027-01-15T00:00:00Z"),
            expired: false,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: "template-1",
            ...overrides,
        } as never);

    it("update() with default options writes every column, as before", async () => {
        const { state, prisma } = createTable(freshRow(BRANCH));
        const repository = new SbEformsignDocRepository(prisma as never);

        await repository.update(BRANCH, entity());

        expect(state.updateData).toHaveLength(1);
        expect(state.updateData[0]).toEqual({
            documentId: DOCUMENT_ID,
            documentName: "contract",
            documentNumber: "N-9",
            templateName: "template",
            customerName: "customer",
            creatorName: "creator",
            lastEditorName: "editor",
            stepRecipientTypes: "05",
            createdDate: new Date("2026-09-30T00:00:00Z"),
            updatedDate: new Date(T),
            statusType: "070",
            statusDetail: "검토 요청",
            stepType: "06",
            stepIndex: "3",
            stepName: "제공기관 확인",
            stepRecipientType: "02",
            stepRecipientName: "recipient-2",
            stepRecipientSms: "01099998888",
            expiredDate: new Date("2027-01-15T00:00:00Z"),
            expired: false,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: "template-1",
        });
    });

    it("the mirror's upsertUnassignedByDocumentId() with default options still writes stepName, expiry and number", async () => {
        const { state, prisma } = createTable(freshRow(null));
        const repository = new SbEformsignDocRepository(prisma as never);

        await repository.upsertUnassignedByDocumentId(entity());

        expect(state.updateData).toHaveLength(1);
        expect(state.updateData[0]).toMatchObject({
            statusType: "070",
            statusDetail: "검토 요청",
            stepType: "06",
            stepIndex: "3",
            stepName: "제공기관 확인",
            expired: false,
            expiredDate: new Date("2027-01-15T00:00:00Z"),
            createdDate: new Date("2026-09-30T00:00:00Z"),
            updatedDate: new Date(T),
            documentNumber: "N-9",
            templateId: "template-1",
        });
    });

    it("update() with updateStepRecipient:false also leaves stepRecipientTypes out", async () => {
        const { state, prisma } = createTable(freshRow(BRANCH));
        const repository = new SbEformsignDocRepository(prisma as never);

        await repository.update(BRANCH, entity(), { updateStepRecipient: false });

        expect(state.updateData[0]).not.toHaveProperty("stepRecipientTypes");
        expect(state.updateData[0]).not.toHaveProperty("stepRecipientName");
    });

    it("update() honours each new option independently", async () => {
        const { state, prisma } = createTable(freshRow(BRANCH));
        const repository = new SbEformsignDocRepository(prisma as never);

        await repository.update(BRANCH, entity(), {
            updateStepName: false,
            updateStepRecipient: false,
            updateDocumentNumber: false,
            updateExpiredDate: false,
        });

        const data = state.updateData[0];
        for (const key of [
            "stepName",
            "stepRecipientType",
            "stepRecipientName",
            "stepRecipientSms",
            "documentNumber",
            "expiredDate",
        ]) {
            expect(data).not.toHaveProperty(key);
        }
        expect(data).toMatchObject({ stepType: "06", stepIndex: "3", statusType: "070" });
    });

    it("claimCompletionStatus() still writes a stepName it is given", async () => {
        const { state, prisma } = createTable(freshRow(BRANCH));
        const repository = new SbEformsignDocRepository(prisma as never);

        await repository.claimCompletionStatus(BRANCH, {
            documentId: DOCUMENT_ID,
            statusType: "050",
            statusDetail: "완료",
            stepName: "제공기관 확인",
            expired: false,
        });

        expect(state.updateData[0]).toMatchObject({ stepName: "제공기관 확인" });
    });
});
