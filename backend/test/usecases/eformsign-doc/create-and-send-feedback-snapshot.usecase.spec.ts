import { CreateAndSendFeedbackSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-feedback-snapshot.usecase";

const TEMPLATE_ID = "tpl_feedback_249";
const BRANCH_ID = "branch-uuid";
const ORG_NAME = "인천 아이미래로";
const REVIEWER = { name: "인천 아이미래로", id: "org@example.com", phoneNumber: "01012345678" };

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function makeDays(count: number, startMonth = 7) {
    return Array.from({ length: count }, (_, i) => ({
        sessionIndex: i + 1,
        // distinct, always-valid month/day per session so slot placement is verifiable
        serviceDate: utc(`2026-${String(((startMonth - 1 + i) % 12) + 1).padStart(2, "0")}-0${((i % 9) + 1)}`),
        answers: { sitzBath: "실시" },
        etcService: null,
        notes: null,
        paymentConfirmed: true,
        momApproval: "approved",
    }));
}

function setup(opts: {
    sessions?: number;
    existingDocs?: Array<{ stepName: string; documentId: string }>;
    templateId?: string | undefined;
    branchName?: string | null;
    reviewer?: typeof REVIEWER | null;
    createImpl?: (n: number) => Promise<{ documentId: string; status: string }>;
} = {}) {
    const sessions = opts.sessions ?? 7;
    const serviceRecordDays = makeDays(sessions);

    const schedule = {
        id: 99,
        clientId: 1234,
        client: { id: 1234, name: "김고객" },
        primaryEmployee: { id: 5, name: "박제공", phone: "010-1111-2222" },
        serviceRecord: {
            momName: "김산모", momBirth: "900101", babyName: "김아기",
            babyBirth: "260615", deliveryType: "자연분만", babyWeight: "3.2",
        },
        serviceRecordDays,
    };

    const prisma = {
        employee_schedule: { findUnique: jest.fn().mockResolvedValue(schedule) },
        branch: { findUnique: jest.fn().mockResolvedValue(opts.branchName === undefined ? { name: ORG_NAME } : (opts.branchName === null ? null : { name: opts.branchName })) },
    };

    let call = 0;
    const createDocument = jest.fn().mockImplementation(async () => {
        call += 1;
        if (opts.createImpl) return opts.createImpl(call);
        return { documentId: `doc-${call}`, status: "created" };
    });
    const eformsignClient = {
        createDocument,
        getTemplateReviewer: jest.fn().mockResolvedValue("reviewer" in opts ? opts.reviewer : REVIEWER),
    };
    const eformsignDocRepository = { findByClientId: jest.fn().mockResolvedValue(opts.existingDocs ?? []) };
    const getAccessTokenUsecase = { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "at", refresh_token: "rt" } }) };
    const createEformsignDocUsecase = { execute: jest.fn().mockResolvedValue(undefined) };
    const configService = { get: jest.fn().mockReturnValue("templateId" in opts ? opts.templateId : TEMPLATE_ID) };

    const usecase = new CreateAndSendFeedbackSnapshotUsecase(
        eformsignClient as never,
        eformsignDocRepository as never,
        prisma as never,
        getAccessTokenUsecase as never,
        createEformsignDocUsecase as never,
        configService as never,
    );

    return { usecase, prisma, createDocument, eformsignClient, eformsignDocRepository, createEformsignDocUsecase, configService };
}

const fieldMap = (fields: Array<{ id: string; value: string }>) => new Map(fields.map((f) => [f.id, f.value]));

describe("CreateAndSendFeedbackSnapshotUsecase", () => {
    it("splits 7 sessions into two documents named (1/2) and (2/2)", async () => {
        const { usecase, createDocument, createEformsignDocUsecase } = setup({ sessions: 7 });
        const result = await usecase.execute(BRANCH_ID, 99);

        expect(result).toEqual({ documentIds: ["doc-1", "doc-2"], documentId: "doc-1", chunkCount: 2 });
        expect(createDocument).toHaveBeenCalledTimes(2);
        expect(createDocument.mock.calls[0][1].documentName).toBe("서비스 제공기록지 - 김고객 (1/2)");
        expect(createDocument.mock.calls[1][1].documentName).toBe("서비스 제공기록지 - 김고객 (2/2)");
        expect(createEformsignDocUsecase.execute).toHaveBeenCalledTimes(2);
    });

    it("places session 6 in slot 1 of the second document", async () => {
        const { usecase, createDocument } = setup({ sessions: 7 });
        await usecase.execute(BRANCH_ID, 99);
        // session 6 (i=5): month = ((7-1+5) % 12) + 1 = 12, day = (5%9)+1 = 06
        const doc2 = fieldMap(createDocument.mock.calls[1][1].prefillFields);
        expect(doc2.get("월 1")).toBe("12");
        expect(doc2.get("일 1")).toBe("06");
    });

    it("persists every chunk with a scheduleId chunk-marker in stepName and linkToClient:false", async () => {
        const { usecase, createEformsignDocUsecase } = setup({ sessions: 7 });
        await usecase.execute(BRANCH_ID, 99);
        const markers = createEformsignDocUsecase.execute.mock.calls.map((c) => c[1].stepName);
        expect(markers).toEqual(["제공기록지 S99 1/2", "제공기록지 S99 2/2"]);
        for (const call of createEformsignDocUsecase.execute.mock.calls) {
            expect(call[1].linkToClient).toBe(false);
            expect(call[1].clientId).toBe(1234);
            expect(call[1].stepRecipientType).toBe("reviewer");
            expect(call[1].stepRecipientName).toBe(REVIEWER.name);
        }
    });

    it("dispatches every chunk to the template's pre-specified reviewer", async () => {
        const { usecase, createDocument, eformsignClient } = setup({ sessions: 7 });
        await usecase.execute(BRANCH_ID, 99);
        expect(eformsignClient.getTemplateReviewer).toHaveBeenCalledWith("at", TEMPLATE_ID);
        for (const call of createDocument.mock.calls) {
            expect(call[1].reviewer).toEqual(REVIEWER);
            expect(call[1].recipient).toBeUndefined();
        }
    });

    it("throws when the template has no pre-specified reviewer", async () => {
        const { usecase, createDocument } = setup({ reviewer: null });
        await expect(usecase.execute(BRANCH_ID, 99)).rejects.toThrow(/검토자/);
        expect(createDocument).not.toHaveBeenCalled();
    });

    it("includes 제공기관 이름 in every document's prefill", async () => {
        const { usecase, createDocument } = setup({ sessions: 7 });
        await usecase.execute(BRANCH_ID, 99);
        for (const call of createDocument.mock.calls) {
            expect(fieldMap(call[1].prefillFields).get("제공기관 이름")).toBe(ORG_NAME);
        }
    });

    it("skips chunks whose marker already exists (retry-safe)", async () => {
        const { usecase, createDocument, createEformsignDocUsecase } = setup({
            sessions: 7,
            existingDocs: [{ stepName: "제공기록지 S99 1/2", documentId: "old-doc-1" }],
        });
        const result = await usecase.execute(BRANCH_ID, 99);
        expect(createDocument).toHaveBeenCalledTimes(1); // only chunk 2 created
        expect(createDocument.mock.calls[0][1].documentName).toBe("서비스 제공기록지 - 김고객 (2/2)");
        expect(createEformsignDocUsecase.execute).toHaveBeenCalledTimes(1);
        expect(result.documentIds).toEqual(["old-doc-1", "doc-1"]);
    });

    it("throws when EFORMSIGN_FEEDBACK_TEMPLATE_ID is unset", async () => {
        const { usecase, createDocument } = setup({ templateId: undefined });
        await expect(usecase.execute(BRANCH_ID, 99)).rejects.toThrow(/EFORMSIGN_FEEDBACK_TEMPLATE_ID/);
        expect(createDocument).not.toHaveBeenCalled();
    });

    it("throws when the branch has no name (제공기관 required at creation)", async () => {
        const { usecase, createDocument } = setup({ branchName: null });
        await expect(usecase.execute(BRANCH_ID, 99)).rejects.toThrow(/제공기관/);
        expect(createDocument).not.toHaveBeenCalled();
    });

    it("propagates a mid-batch createDocument failure after persisting earlier chunks", async () => {
        const { usecase, createEformsignDocUsecase } = setup({
            sessions: 7,
            createImpl: (n) => (n === 2 ? Promise.reject(new Error("eformsign 500")) : Promise.resolve({ documentId: `doc-${n}`, status: "created" })),
        });
        await expect(usecase.execute(BRANCH_ID, 99)).rejects.toThrow("eformsign 500");
        // chunk 1 was persisted before chunk 2 failed
        expect(createEformsignDocUsecase.execute).toHaveBeenCalledTimes(1);
        expect(createEformsignDocUsecase.execute.mock.calls[0][1].stepName).toBe("제공기록지 S99 1/2");
    });

    it("creates a single header-only document when there are no sessions", async () => {
        const { usecase, createDocument } = setup({ sessions: 0 });
        const result = await usecase.execute(BRANCH_ID, 99);
        expect(result.chunkCount).toBe(1);
        expect(createDocument).toHaveBeenCalledTimes(1);
        expect(createDocument.mock.calls[0][1].documentName).toBe("서비스 제공기록지 - 김고객 (1/1)");
    });
});
