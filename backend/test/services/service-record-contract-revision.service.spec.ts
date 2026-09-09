import type {
    ServiceRecordRevisionDocumentState,
} from "@babyjamjam/shared/types/service-record";
import {
    ServiceRecordContractRevisionService,
    type ServiceRecordContractRevisionCapabilityEvidence,
    type ServiceRecordContractRevisionDocumentObservation,
    type ServiceRecordContractRevisionProcessInput,
    type ServiceRecordContractRevisionProviderPort,
    type ServiceRecordContractRevisionSnapshot,
} from "application/services/service-record-contract-revision.service";

const BRANCH_ID = "branch-contract";
const CLIENT_ID = 77;
const CASE_ID = "case-contract";
const REVISION_ID = "revision-1";
const GENERATION = "generation-1";
const DOCUMENT_ID = "document-original";
const TEMPLATE_ID = "template-contract";
const TEMPLATE_VERSION = "v2";
const WORKFLOW_SCOPE = {
    templateId: TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    participantStep: "provider-participant",
    reviewerStep: "provider-review",
};
const ALLOWED_FIELDS = ["contract.start", "contract.end", "receipt.period", "service.cost"];

function snapshot(
    overrides: Partial<ServiceRecordContractRevisionSnapshot["original"]> = {},
    targetOverrides: Partial<ServiceRecordContractRevisionSnapshot["target"]> = {},
): ServiceRecordContractRevisionSnapshot {
    const original = {
        documentId: DOCUMENT_ID,
        documentVersion: 4,
        templateId: TEMPLATE_ID,
        templateVersion: TEMPLATE_VERSION,
        workflowScope: { ...WORKFLOW_SCOPE },
        mirrorGeneration: "mirror-4",
        stage: "provider_participant" as const,
        participant: { id: "participant-1", name: "김고객", phone: "010-1111-2222" },
        receivedDate: "2026-07-09",
        receivedAmount: "462000",
        startDate: "2026-07-09",
        endDate: "2027-01-04",
        allowedFieldIds: [...ALLOWED_FIELDS],
        fields: {
            "contract.start": "2026-07-09",
            "contract.end": "2027-01-04",
            "receipt.period": "2026-07-09~2027-01-04",
            "service.cost": "1464000",
        },
        ...overrides,
    };
    const target = {
        startDate: "2026-07-10",
        endDate: "2027-01-05",
        receiptPeriod: "2026-07-10~2027-01-05",
        fields: {
            "contract.start": "2026-07-10",
            "contract.end": "2027-01-05",
            "receipt.period": "2026-07-10~2027-01-05",
            "service.cost": "1464000",
        },
        ...targetOverrides,
    };
    return { original, target };
}

function capability(
    current: ServiceRecordContractRevisionSnapshot = snapshot(),
    overrides: Partial<ServiceRecordContractRevisionCapabilityEvidence> = {},
): ServiceRecordContractRevisionCapabilityEvidence {
    return {
        status: "verified",
        templateId: current.original.templateId,
        templateVersion: current.original.templateVersion,
        workflowScope: { ...current.original.workflowScope },
        operations: [
            "request_review_rejection",
            "update_participant_fields",
            "create_replacement_document",
        ],
        ...overrides,
    };
}

function observation(
    current: ServiceRecordContractRevisionSnapshot,
    overrides: Partial<ServiceRecordContractRevisionDocumentObservation> = {},
): ServiceRecordContractRevisionDocumentObservation {
    return {
        documentId: current.original.documentId,
        templateId: current.original.templateId,
        templateVersion: current.original.templateVersion,
        workflowScope: { ...current.original.workflowScope },
        stage: current.original.stage,
        participant: { ...current.original.participant },
        fields: { ...current.original.fields },
        ...overrides,
    };
}

function makeState(
    current: ServiceRecordContractRevisionSnapshot,
    overrides: Partial<ServiceRecordRevisionDocumentState> = {},
): ServiceRecordRevisionDocumentState {
    const now = "2026-09-08T00:00:00.000Z";
    return {
        id: "state-1",
        branchId: BRANCH_ID,
        clientId: CLIENT_ID,
        serviceRecordCaseId: CASE_ID,
        revisionId: REVISION_ID,
        operation: "contract_period",
        generation: GENERATION,
        immutableInput: current as unknown as Record<string, unknown>,
        inputFingerprint: "fingerprint-1",
        documentVersion: current.original.documentVersion,
        sourceDocumentId: current.original.documentId,
        targetDocumentId: null,
        templateId: current.original.templateId,
        templateVersion: current.original.templateVersion,
        workflowScope: current.original.workflowScope,
        mirrorGeneration: current.original.mirrorGeneration,
        step: "prepared",
        status: "pending",
        attempts: 0,
        nextAttemptAt: null,
        lastErrorCode: null,
        outputProof: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

function input(
    current: ServiceRecordContractRevisionSnapshot,
    overrides: Partial<ServiceRecordContractRevisionProcessInput> = {},
): ServiceRecordContractRevisionProcessInput {
    return {
        branchId: BRANCH_ID,
        clientId: CLIENT_ID,
        serviceRecordCaseId: CASE_ID,
        revisionId: REVISION_ID,
        generation: GENERATION,
        snapshot: current,
        capability: capability(current),
        ...overrides,
    };
}

function setup(initial = snapshot()): {
    service: ServiceRecordContractRevisionService;
    repository: {
        findRevisionDocumentState: jest.Mock;
        createRevisionDocumentState: jest.Mock;
        advanceRevisionDocumentState: jest.Mock;
        retryRevisionDocumentState: jest.Mock;
    };
    provider: jest.Mocked<ServiceRecordContractRevisionProviderPort>;
    dispatch: {
        claim: jest.Mock;
        markAccepted: jest.Mock;
        markUncertain: jest.Mock;
    };
    state: ServiceRecordRevisionDocumentState;
} {
    let state = makeState(initial);
    const repository = {
        findRevisionDocumentState: jest.fn(),
        createRevisionDocumentState: jest.fn().mockImplementation(async () => state),
        advanceRevisionDocumentState: jest.fn().mockImplementation(async (patch) => {
            state = {
                ...state,
                ...patch,
                version: state.version + 1,
                updatedAt: "2026-09-08T00:00:01.000Z",
            };
            return state;
        }),
        retryRevisionDocumentState: jest.fn().mockImplementation(async () => {
            state = { ...state, status: "pending", step: "prepared", version: state.version + 1 };
            return state;
        }),
    };
    const provider: jest.Mocked<ServiceRecordContractRevisionProviderPort> = {
        inspectDocument: jest.fn().mockResolvedValue(observation(initial)),
        requestReviewRejection: jest.fn().mockResolvedValue(undefined),
        updateParticipantFields: jest.fn().mockResolvedValue(undefined),
        createReplacementDocument: jest.fn().mockResolvedValue({ documentId: "document-replacement" }),
        findReplacementDocument: jest.fn().mockResolvedValue(null),
    };
    const dispatch = {
        claim: jest.fn().mockResolvedValue({ disposition: "claimed", claimToken: "claim-1" }),
        markAccepted: jest.fn().mockResolvedValue(undefined),
        markUncertain: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ServiceRecordContractRevisionService(
        repository as never,
        provider,
        dispatch,
    );
    return { service, repository, provider, dispatch, state };
}

describe("ServiceRecordContractRevisionService", () => {
    it("stores capability_unverified without inspecting, dispatching, or calling the provider", async () => {
        const current = snapshot();
        const { service, provider, dispatch, repository } = setup(current);

        const result = await service.processOperation(input(current, { capability: undefined }));

        expect(result.status).toBe("capability_unverified");
        expect(result.reason).toBe("CONTRACT_REVISION_CAPABILITY_UNVERIFIED");
        expect(provider.inspectDocument).not.toHaveBeenCalled();
        expect(provider.requestReviewRejection).not.toHaveBeenCalled();
        expect(provider.updateParticipantFields).not.toHaveBeenCalled();
        expect(provider.createReplacementDocument).not.toHaveBeenCalled();
        expect(dispatch.claim).not.toHaveBeenCalled();
        expect(repository.advanceRevisionDocumentState).toHaveBeenCalledWith(expect.objectContaining({
            status: "capability_unverified",
            lastErrorCode: "CONTRACT_REVISION_CAPABILITY_UNVERIFIED",
        }));
    });

    it("marks content-only changes as not_required when the outer contract period is unchanged", async () => {
        const current = snapshot({}, {
            startDate: "2026-07-09",
            endDate: "2027-01-04",
            receiptPeriod: "2026-07-09~2027-01-04",
            fields: {
                "contract.start": "2026-07-09",
                "contract.end": "2027-01-04",
                "receipt.period": "2026-07-09~2027-01-04",
                "service.cost": "999999",
            },
        });
        const { service, provider, dispatch, repository } = setup(current);

        const result = await service.processOperation(input(current, { capability: undefined }));

        expect(result.status).toBe("not_required");
        expect(provider.inspectDocument).not.toHaveBeenCalled();
        expect(dispatch.claim).not.toHaveBeenCalled();
        expect(repository.advanceRevisionDocumentState).toHaveBeenCalledWith(expect.objectContaining({
            status: "not_required",
            step: "prepared",
            lastErrorCode: null,
        }));
    });

    it("rejects an empty target field map instead of treating it as a successful update", async () => {
        const current = snapshot({}, {
            fields: {},
        });
        const { service, provider, dispatch, repository } = setup(current);

        const result = await service.processOperation(input(current));

        expect(result.status).toBe("manual_review");
        expect(result.reason).toBe("CONTRACT_REVISION_INPUT_INVALID");
        expect(provider.inspectDocument).not.toHaveBeenCalled();
        expect(provider.updateParticipantFields).not.toHaveBeenCalled();
        expect(provider.createReplacementDocument).not.toHaveBeenCalled();
        expect(dispatch.claim).not.toHaveBeenCalled();
        expect(repository.advanceRevisionDocumentState).toHaveBeenCalledWith(expect.objectContaining({
            status: "manual_review",
            lastErrorCode: "CONTRACT_REVISION_INPUT_INVALID",
        }));
    });

    it("fails closed for missing original receipt date or amount without filling defaults", async () => {
        for (const field of ["receivedDate", "receivedAmount"] as const) {
            const current = snapshot({ [field]: null });
            const { service, provider, dispatch } = setup(current);

            const result = await service.processOperation(input(current));

            expect(result.status).toBe("manual_review");
            expect(result.reason).toBe("CONTRACT_REVISION_INPUT_INVALID");
            expect(provider.inspectDocument).not.toHaveBeenCalled();
            expect(provider.updateParticipantFields).not.toHaveBeenCalled();
            expect(dispatch.claim).not.toHaveBeenCalled();
        }
    });

    it("persists an explicitly null original document version without inventing a version", async () => {
        const current = snapshot({ documentVersion: null });
        const { service, repository } = setup(current);

        const result = await service.processOperation(input(current, { capability: undefined }));

        expect(result.status).toBe("capability_unverified");
        expect(repository.createRevisionDocumentState).toHaveBeenCalledWith(expect.objectContaining({
            documentVersion: null,
        }));
    });

    it("accepts an explicitly null original document version when resuming persisted state", async () => {
        const current = snapshot({ documentVersion: null });
        const { service, repository } = setup(current);
        repository.findRevisionDocumentState.mockResolvedValue(makeState(current));

        const result = await service.processOperation(input(current, {
            documentStateId: "state-1",
            capability: undefined,
        }));

        expect(result.status).toBe("capability_unverified");
        expect(repository.findRevisionDocumentState).toHaveBeenCalledWith(
            BRANCH_ID,
            CLIENT_ID,
            REVISION_ID,
            "state-1",
        );
    });

    it("rejects an omitted original document version on resume", async () => {
        const current = snapshot();
        const persisted = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
        const original = persisted["original"] as Record<string, unknown>;
        delete original["documentVersion"];
        const { service, provider, dispatch, repository } = setup(current);
        repository.findRevisionDocumentState.mockResolvedValue(makeState(current, {
            immutableInput: persisted,
        }));

        const result = await service.processOperation(input(current, {
            documentStateId: "state-1",
        }));

        expect(result.status).toBe("manual_review");
        expect(result.reason).toBe("CONTRACT_REVISION_INPUT_INVALID");
        expect(provider.inspectDocument).not.toHaveBeenCalled();
        expect(dispatch.claim).not.toHaveBeenCalled();
        expect(repository.advanceRevisionDocumentState).toHaveBeenCalledWith(expect.objectContaining({
            status: "manual_review",
        }));
    });

    it("rejects a target field that attempts to replace the preserved receipt facts", async () => {
        const current = snapshot({
            allowedFieldIds: [...ALLOWED_FIELDS, "receipt.receivedAmount"],
        }, {
            fields: {
                ...snapshot().target.fields,
                "receipt.receivedAmount": "999999",
            },
        });
        const { service, provider, dispatch } = setup(current);

        const result = await service.processOperation(input(current));

        expect(result.status).toBe("manual_review");
        expect(result.reason).toBe("CONTRACT_REVISION_INPUT_INVALID");
        expect(provider.inspectDocument).not.toHaveBeenCalled();
        expect(provider.updateParticipantFields).not.toHaveBeenCalled();
        expect(dispatch.claim).not.toHaveBeenCalled();
    });

    it("updates a verified participant document while preserving receipt facts and waiting for signature", async () => {
        const current = snapshot();
        const { service, provider, dispatch, repository } = setup(current);
        provider.inspectDocument
            .mockResolvedValueOnce(observation(current))
            .mockResolvedValueOnce(observation(current, { fields: { ...current.target.fields } }));

        const result = await service.processOperation(input(current));

        expect(result.status).toBe("waiting_for_signature");
        expect(provider.updateParticipantFields).toHaveBeenCalledWith(expect.objectContaining({
            documentId: DOCUMENT_ID,
            fields: current.target.fields,
            preservedReceipt: { receivedDate: "2026-07-09", receivedAmount: "462000" },
            workflowScope: WORKFLOW_SCOPE,
        }));
        expect(dispatch.claim).toHaveBeenCalledWith(expect.objectContaining({
            operation: "contract_period",
            step: "participant_update_claim",
            generation: GENERATION,
        }));
        expect(repository.advanceRevisionDocumentState).toHaveBeenCalledWith(expect.objectContaining({
            step: "participant_update_claim",
            status: "processing",
        }));
        expect(dispatch.markAccepted).toHaveBeenCalledWith("claim-1", null);
        expect(result.state?.sourceDocumentId).toBe(DOCUMENT_ID);
        expect(result.state?.targetDocumentId).toBeNull();
    });

    it("creates a completed-contract replacement from frozen fields with a fresh signer and retains the source pointer", async () => {
        const current = snapshot({ stage: "completed" });
        const { service, provider, dispatch, repository } = setup(current);

        const result = await service.processOperation(input(current));

        expect(result.status).toBe("waiting_for_signature");
        expect(provider.createReplacementDocument).toHaveBeenCalledWith(expect.objectContaining({
            sourceDocumentId: DOCUMENT_ID,
            templateId: TEMPLATE_ID,
            templateVersion: TEMPLATE_VERSION,
            fields: current.target.fields,
            preservedReceipt: { receivedDate: "2026-07-09", receivedAmount: "462000" },
            recipient: current.original.participant,
        }));
        const replacementInput = provider.createReplacementDocument.mock.calls[0]?.[0];
        expect(replacementInput).toBeDefined();
        expect(Object.keys(replacementInput?.fields ?? {})).not.toEqual(expect.arrayContaining(["이용자 서명", "도장"]));
        expect(dispatch.markAccepted).toHaveBeenCalledWith("claim-1", "document-replacement");
        expect(repository.advanceRevisionDocumentState).toHaveBeenCalledWith(expect.objectContaining({
            step: "replacement_create_claim",
            status: "processing",
        }));
        expect(result.state?.sourceDocumentId).toBe(DOCUMENT_ID);
        expect(result.state?.targetDocumentId).toBe("document-replacement");
    });

    it("does not create another replacement when a completed state is retried after success", async () => {
        const current = snapshot({ stage: "completed" });
        const { service, provider, repository } = setup(current);
        const completed = makeState(current, {
            status: "completed",
            step: "replacement_created",
            targetDocumentId: "document-replacement",
        });
        repository.findRevisionDocumentState.mockResolvedValue(completed);

        const result = await service.processOperation(input(current, {
            documentStateId: "state-1",
            retry: true,
        }));

        expect(result.status).toBe("completed");
        expect(result.providerDocumentId).toBe("document-replacement");
        expect(provider.inspectDocument).not.toHaveBeenCalled();
        expect(provider.createReplacementDocument).not.toHaveBeenCalled();
        expect(repository.retryRevisionDocumentState).not.toHaveBeenCalled();
    });

    it("queries after an unknown participant mutation instead of retrying the same mutation", async () => {
        const current = snapshot();
        const { service, provider, dispatch } = setup(current);
        provider.updateParticipantFields.mockRejectedValueOnce(new Error("timeout"));
        provider.inspectDocument
            .mockResolvedValueOnce(observation(current))
            .mockResolvedValueOnce(observation(current));

        const result = await service.processOperation(input(current));

        expect(result.status).toBe("unknown");
        expect(provider.updateParticipantFields).toHaveBeenCalledTimes(1);
        expect(provider.inspectDocument).toHaveBeenCalledTimes(2);
        expect(dispatch.markUncertain).toHaveBeenCalledWith("claim-1", "CONTRACT_REVISION_PROVIDER_OUTCOME_UNKNOWN");
    });

    it("queries an unknown review mutation before retrying and resumes without a duplicate rejection", async () => {
        const current = snapshot({ stage: "provider_review" });
        const { service, provider, repository } = setup(current);
        repository.findRevisionDocumentState.mockResolvedValue(makeState(current, { status: "unknown", step: "unknown" }));
        provider.inspectDocument.mockResolvedValue(observation(current));
        provider.requestReviewRejection.mockRejectedValueOnce(new Error("timeout"));

        const result = await service.processOperation(input(current, {
            documentStateId: "state-1",
            retry: true,
        }));

        expect(result.status).toBe("unknown");
        expect(provider.requestReviewRejection).toHaveBeenCalledTimes(1);
        expect(provider.inspectDocument).toHaveBeenCalledTimes(3);
        expect(repository.retryRevisionDocumentState).toHaveBeenCalled();
    });

    it("queries an unknown replacement before retrying and resumes an already-created document", async () => {
        const current = snapshot({ stage: "completed" });
        const { service, provider, dispatch, repository } = setup(current);
        repository.findRevisionDocumentState.mockResolvedValue(makeState(current, { status: "unknown", step: "unknown" }));
        provider.findReplacementDocument.mockResolvedValue({ documentId: "document-existing-replacement" });

        const result = await service.processOperation(input(current, {
            documentStateId: "state-1",
            retry: true,
        }));

        expect(result.status).toBe("waiting_for_signature");
        expect(provider.createReplacementDocument).not.toHaveBeenCalled();
        expect(provider.findReplacementDocument).toHaveBeenCalledWith(expect.objectContaining({
            sourceDocumentId: DOCUMENT_ID,
            operationFingerprint: "fingerprint-1",
        }));
        expect(dispatch.markAccepted).toHaveBeenCalledWith("claim-1", "document-existing-replacement");
        expect(repository.retryRevisionDocumentState).not.toHaveBeenCalled();
    });

    it("uses the persisted immutable snapshot on retry and ignores a newly supplied snapshot", async () => {
        const persisted = snapshot({ stage: "completed" });
        const current = snapshot({ stage: "completed" }, {
            startDate: "2026-07-11",
            endDate: "2027-01-06",
            receiptPeriod: "2026-07-11~2027-01-06",
            fields: {
                "contract.start": "2026-07-11",
                "contract.end": "2027-01-06",
                "receipt.period": "2026-07-11~2027-01-06",
                "service.cost": "1464000",
            },
        });
        const { service, provider, repository } = setup(persisted);
        repository.findRevisionDocumentState.mockResolvedValue(makeState(persisted, { status: "unknown" }));
        repository.retryRevisionDocumentState.mockResolvedValue(makeState(persisted, { status: "pending", version: 2 }));

        await service.processOperation(input(current, {
            documentStateId: "state-1",
            retry: true,
            capability: capability(persisted),
        }));

        expect(provider.createReplacementDocument).toHaveBeenCalledWith(expect.objectContaining({
            fields: persisted.target.fields,
            operationFingerprint: "fingerprint-1",
        }));
        expect(provider.createReplacementDocument).not.toHaveBeenCalledWith(expect.objectContaining({
            fields: current.target.fields,
        }));
        expect(repository.retryRevisionDocumentState).toHaveBeenCalledWith({
            branchId: BRANCH_ID,
            clientId: CLIENT_ID,
            revisionId: REVISION_ID,
            stateId: "state-1",
            expectedGeneration: GENERATION,
            enqueueJob: false,
        });
    });

    it("does not mutate when capability identity does not match the pinned template scope", async () => {
        const current = snapshot();
        const { service, provider, dispatch } = setup(current);

        const result = await service.processOperation(input(current, {
            capability: capability(current, { templateVersion: "v-other" }),
        }));

        expect(result.status).toBe("manual_review");
        expect(result.reason).toBe("CONTRACT_REVISION_CAPABILITY_MISMATCH");
        expect(provider.inspectDocument).not.toHaveBeenCalled();
        expect(dispatch.claim).not.toHaveBeenCalled();
    });

    it("rejects unsupported workflow stages into manual review without a provider call", async () => {
        const current = snapshot({ stage: "unsupported" });
        const { service, provider, dispatch } = setup(current);

        const result = await service.processOperation(input(current));

        expect(result.status).toBe("manual_review");
        expect(result.reason).toBe("CONTRACT_REVISION_WORKFLOW_UNSUPPORTED");
        expect(provider.inspectDocument).not.toHaveBeenCalled();
        expect(dispatch.claim).not.toHaveBeenCalled();
    });
});
