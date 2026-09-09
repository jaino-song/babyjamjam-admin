import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import {
    EFORMSIGN_SDK_CAPABILITY_RECIPIENT_ID,
    EFORMSIGN_SDK_CAPABILITY_RECIPIENT_TYPE,
} from "./eformsign-sdk-capability.live.helper";
import {
    EFORMSIGN_WORKFLOW_UPDATE_AFTER_STATUS_TYPE,
    EFORMSIGN_WORKFLOW_UPDATE_AFTER_STEP_INDEX,
    EFORMSIGN_WORKFLOW_UPDATE_AFTER_STEP_TYPE,
    EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID,
    EFORMSIGN_WORKFLOW_UPDATE_RECIPIENT_ID,
    EFORMSIGN_WORKFLOW_UPDATE_TEMPLATE_ID,
    assertWorkflowUpdateDeclinedDocument,
    assertWorkflowUpdateTemplateTopology,
    postSingleWorkflowUpdateDecline,
} from "./eformsign-workflow-update.live.helper";

const config = { get: () => "https://vendor.example.test" };
const memberId = EFORMSIGN_WORKFLOW_UPDATE_RECIPIENT_ID;

function templateFixture(): Record<string, unknown> {
    const option = (extra: Record<string, unknown> = {}) => ({
        receipients: [],
        use_reject_restrict: false,
        ...extra,
    });
    return {
        form_id: EFORMSIGN_WORKFLOW_UPDATE_TEMPLATE_ID,
        config: {
            step_settings: [
                { seq: 1, type: "write", step_group: 1, option: option() },
                { seq: 2, type: "participant", step_group: 3, option: option({ use_receipient_specified: false }) },
                {
                    seq: 3,
                    type: "participant",
                    step_group: 4,
                    option: option({
                        receipients: [{ receipient_type: "internal", group: { id: memberId } }],
                        specified_recipient_type: "groupormember",
                        specified_recipient_seq: -1,
                        use_receipient_specified: true,
                    }),
                },
                {
                    seq: 4,
                    type: "reviewer",
                    step_group: 5,
                    option: option({
                        specified_recipient_type: "beforewriter",
                        specified_recipient_seq: 3,
                        use_receipient_specified: true,
                    }),
                },
                { seq: 5, type: "complete", step_group: 2, option: option() },
            ],
        },
    };
}

function documentFixture(overrides: Partial<EformsignApiDocumentResponse> = {}): EformsignApiDocumentResponse {
    return {
        id: EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID,
        document_number: "test",
        template: { id: EFORMSIGN_WORKFLOW_UPDATE_TEMPLATE_ID, name: "test" },
        document_name: "test",
        creator: { recipient_type: "writer", id: "writer", name: "writer" },
        created_date: 0,
        updated_date: 0,
        current_status: {
            status_type: EFORMSIGN_WORKFLOW_UPDATE_AFTER_STATUS_TYPE,
            step_type: EFORMSIGN_WORKFLOW_UPDATE_AFTER_STEP_TYPE,
            step_index: EFORMSIGN_WORKFLOW_UPDATE_AFTER_STEP_INDEX,
            step_name: "test",
            step_group: 4,
            expired_date: 0,
            _expired: false,
            step_recipients: [{ recipient_type: EFORMSIGN_SDK_CAPABILITY_RECIPIENT_TYPE, id: EFORMSIGN_SDK_CAPABILITY_RECIPIENT_ID, name: "test" }],
        },
        fields: [{ id: "field", value: "value", type: "text" }],
        ...overrides,
    };
}

describe("eformsign workflow update helper guards", () => {
    afterEach(() => jest.restoreAllMocks());

    it("accepts the exact sequential workflow and explicit reviewer inheritance", () => {
        const topology = assertWorkflowUpdateTemplateTopology(templateFixture());
        expect(topology).toMatchObject({
            stepCount: 5,
            sequential: true,
            parallel: false,
            rejectRestrictionsFalse: true,
            reviewerPreviousSequence: 3,
            participantSequence: 3,
            userParticipantUnselected: true,
        });
        expect(topology.steps.map((step) => step.sequence)).toEqual([1, 2, 3, 4, 5]);
    });

    it("rejects duplicate groups, selected user steps, and incorrect reviewer predecessors", () => {
        const duplicateGroups = templateFixture();
        const duplicateConfig = duplicateGroups["config"] as Record<string, unknown>;
        const duplicateSettings = duplicateConfig["step_settings"] as Array<Record<string, unknown>>;
        const completeStep = duplicateSettings[4];
        if (!completeStep) throw new Error("fixture incomplete");
        duplicateSettings[4] = { ...completeStep, step_group: 5 };
        expect(() => assertWorkflowUpdateTemplateTopology(duplicateGroups)).toThrow(/parallel step groups/);

        const selectedUser = templateFixture();
        const selectedConfig = selectedUser["config"] as Record<string, unknown>;
        const selectedSettings = selectedConfig["step_settings"] as Array<Record<string, unknown>>;
        const userStep = selectedSettings[1];
        if (!userStep) throw new Error("fixture incomplete");
        selectedSettings[1] = {
            ...userStep,
            option: {
                ...(userStep["option"] as Record<string, unknown>),
                receipients: [{ receipient_type: "external", id: "customer" }],
                use_receipient_specified: true,
            },
        };
        expect(() => assertWorkflowUpdateTemplateTopology(selectedUser)).toThrow(/user participant is selected/);

        const wrongPredecessor = templateFixture();
        const wrongConfig = wrongPredecessor["config"] as Record<string, unknown>;
        const wrongSettings = wrongConfig["step_settings"] as Array<Record<string, unknown>>;
        const reviewerStep = wrongSettings[3];
        if (!reviewerStep) throw new Error("fixture incomplete");
        wrongSettings[3] = {
            ...reviewerStep,
            option: { ...(reviewerStep["option"] as Record<string, unknown>), specified_recipient_seq: 2 },
        };
        expect(() => assertWorkflowUpdateTemplateTopology(wrongPredecessor)).toThrow(/inherit participant step 3/);
    });

    it("sends exactly one decline with only the documented comment and matches response ids", async () => {
        const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ document_id: EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID }),
        } as Response);

        const evidence = await postSingleWorkflowUpdateDecline(config, "token");
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`https://vendor.example.test/v2.0/api/documents/${EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID}/decline`);
        expect(init.method).toBe("POST");
        expect(init.redirect).toBe("error");
        expect(JSON.parse(String(init.body))).toEqual({ comment: "제공기관 날짜 자동 수정 검증" });
        expect(JSON.parse(String(init.body))).not.toHaveProperty("previous_steps");
        expect(evidence).toMatchObject({
            attempted: true,
            responseReceived: true,
            httpSuccess: true,
            responseIdPresent: true,
            responseIdMatches: true,
            transportError: false,
        });
    });

    it("records a transport failure or mismatched response without retrying", async () => {
        const transportSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
        await expect(postSingleWorkflowUpdateDecline(config, "token")).resolves.toMatchObject({
            attempted: true,
            responseReceived: false,
            transportError: true,
        });
        expect(transportSpy).toHaveBeenCalledTimes(1);

        await expect(postSingleWorkflowUpdateDecline(config, "token", "other-document")).rejects.toThrow(/outside the exact allowlist/);
        expect(transportSpy).toHaveBeenCalledTimes(1);

        transportSpy.mockReset().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ document_id: "other-document" }),
        } as Response);
        await expect(postSingleWorkflowUpdateDecline(config, "token")).resolves.toMatchObject({
            responseReceived: true,
            responseIdPresent: true,
            responseIdMatches: false,
        });
        expect(transportSpy).toHaveBeenCalledTimes(1);
    });

    it("accepts the expected declined stage and rejects a changed recipient", () => {
        expect(assertWorkflowUpdateDeclinedDocument(documentFixture()).fieldCount).toBe(1);
        expect(() => assertWorkflowUpdateDeclinedDocument(documentFixture({
            current_status: {
                ...documentFixture().current_status,
                step_recipients: [{ recipient_type: "insider", id: "other", name: "test" }],
            },
        }))).toThrow(/recipient changed/);
    });
});
