import { EformsignWebhookService } from "../../application/services/eformsign-webhook.service";

/**
 * BJJ-247 contract-isolation guarantee: completing a FEEDBACK snapshot document must NOT run
 * the contract-completion side effects (link eDocId / sync endDate), which
 * all funnel through handleCompletedDocument(). The gate keys on the document's template_id.
 */
const FEEDBACK_TPL = "tpl_feedback_123";
const CONTRACT_TPL = "tpl_contract_999";

function makeService() {
    const eformsignDocRepository = {
        claimCompletionStatus: jest.fn().mockResolvedValue("claimed"),
        findByDocumentId: jest.fn(),
    };
    const deps = {
        updateStatusUsecase: { execute: jest.fn() },
        linkDocumentUsecase: { execute: jest.fn() },
        syncClientEndDateUsecase: { execute: jest.fn() },
        eventBus: { emit: jest.fn() },
        notificationService: {},
        eformsignApiClient: { getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: "x" } }) },
        clientRepository: {},
        eformsignDocRepository,
        employeeScheduleRepository: {},
        employeeRepository: {},
    };
    const service = new EformsignWebhookService(
        deps.updateStatusUsecase as any,
        deps.linkDocumentUsecase as any,
        deps.syncClientEndDateUsecase as any,
        deps.eventBus as any,
        deps.notificationService as any,
        deps.eformsignApiClient as any,
        deps.clientRepository as any,
        deps.eformsignDocRepository as any,
        deps.employeeScheduleRepository as any,
        deps.employeeRepository as any,
    );
    // Isolate the units downstream of the gate so the test targets the gate decision only.
    const handleCompleted = jest.spyOn(service as any, "handleCompletedDocument").mockResolvedValue(undefined);
    jest.spyOn(service as any, "notifyReviewRequiredIfNeeded").mockResolvedValue(undefined);
    return { service, handleCompleted };
}

const docEvent = (template_id: string) => ({
    id: "doc1", status: "doc_complete", document_title: "기록지", template_id, workflow_seq: 1, workflow_name: "wf",
});
const pdfEvent = (template_id: string) => ({
    document_id: "doc1", document_status: "doc_complete", template_id, workflow_seq: 1, workflow_name: "wf",
});

describe("EformsignWebhookService — feedback template_id gate", () => {
    const OLD = process.env["EFORMSIGN_FEEDBACK_TEMPLATE_ID"];
    beforeAll(() => { process.env["EFORMSIGN_FEEDBACK_TEMPLATE_ID"] = FEEDBACK_TPL; });
    afterAll(() => {
        if (OLD === undefined) delete process.env["EFORMSIGN_FEEDBACK_TEMPLATE_ID"];
        else process.env["EFORMSIGN_FEEDBACK_TEMPLATE_ID"] = OLD;
    });

    it("document event + contract template → runs contract-completion side effects", async () => {
        const { service, handleCompleted } = makeService();
        await (service as any).handleDocumentEvent("branch1", docEvent(CONTRACT_TPL));
        expect(handleCompleted).toHaveBeenCalledTimes(1);
    });

    it("document event + feedback template → SKIPS contract-completion side effects", async () => {
        const { service, handleCompleted } = makeService();
        await (service as any).handleDocumentEvent("branch1", docEvent(FEEDBACK_TPL));
        expect(handleCompleted).not.toHaveBeenCalled();
    });

    it("ready_document_pdf + contract template → runs contract-completion side effects", async () => {
        const { service, handleCompleted } = makeService();
        await (service as any).handleReadyDocumentPdfEvent("branch1", pdfEvent(CONTRACT_TPL));
        expect(handleCompleted).toHaveBeenCalledTimes(1);
    });

    it("ready_document_pdf + feedback template → SKIPS contract-completion side effects", async () => {
        const { service, handleCompleted } = makeService();
        await (service as any).handleReadyDocumentPdfEvent("branch1", pdfEvent(FEEDBACK_TPL));
        expect(handleCompleted).not.toHaveBeenCalled();
    });
});
