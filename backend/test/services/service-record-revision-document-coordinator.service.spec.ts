import {
    ServiceRecordRevisionDocumentCoordinator,
    buildServiceRecordContractRevisionSnapshot,
    type ServiceRecordRevisionContractLockedFacts,
    type ServiceRecordRevisionDocumentCoordinatorProcessInput,
    type ServiceRecordContractRevisionOperationPort,
    type ReceiptLinkRevisionRefreshOperationPort,
} from "application/services/service-record-revision-document-coordinator.service";
import type { ServiceRecordContractRevisionProcessResult } from "application/services/service-record-contract-revision.service";
import type { ReceiptLinkRevisionRefreshProcessResult } from "application/services/receipt-link-revision-refresh.service";

const BASE = {
    branchId: "branch-contract",
    clientId: 77,
    serviceRecordCaseId: "case-contract",
    revisionId: "revision-1",
} as const;

const CONTRACT_GENERATION = "contract-generation-1";
const RECEIPT_GENERATION = "receipt-generation-1";

const CONTRACT_RESULT: ServiceRecordContractRevisionProcessResult = {
    status: "capability_unverified",
    state: null,
    reason: "CONTRACT_REVISION_CAPABILITY_UNVERIFIED",
    providerDocumentId: null,
};

const RECEIPT_RESULT: ReceiptLinkRevisionRefreshProcessResult = {
    status: "not_required",
    state: null,
    reason: null,
    promotedTokenIds: [],
};

function lockedFacts(
    overrides: Partial<ServiceRecordRevisionContractLockedFacts["sourceDocument"]> = {},
): ServiceRecordRevisionContractLockedFacts {
    return {
        sourceDocument: {
            documentId: "document-1",
            documentVersion: 4,
            templateId: "template-1",
            templateVersion: "v2",
            workflowScope: {
                templateId: "template-1",
                templateVersion: "v2",
                participantStep: "provider-participant",
            },
            mirrorGeneration: "mirror-4",
            stage: "provider_participant",
            participant: { id: "participant-1", name: "김고객", phone: "010-1111-2222" },
            receivedDate: "2026-07-09",
            receivedAmount: "462000",
            startDate: "2026-07-09",
            endDate: "2027-01-04",
            allowedFieldIds: ["contract.start", "contract.end", "receipt.period"],
            fields: {
                "contract.start": "2026-07-09",
                "contract.end": "2027-01-04",
                "receipt.period": "2026-07-09~2027-01-04",
            },
            ...overrides,
        },
        targetPeriod: {
            startDate: "2026-07-10",
            endDate: "2027-01-05",
            receiptPeriod: "2026-07-10~2027-01-05",
            fields: {
                "contract.start": "2026-07-10",
                "contract.end": "2027-01-05",
                "receipt.period": "2026-07-10~2027-01-05",
            },
        },
    };
}

function harness(): {
    coordinator: ServiceRecordRevisionDocumentCoordinator;
    contract: jest.Mocked<ServiceRecordContractRevisionOperationPort>;
    receipt: jest.Mocked<ReceiptLinkRevisionRefreshOperationPort>;
} {
    const contract: jest.Mocked<ServiceRecordContractRevisionOperationPort> = {
        processOperation: jest.fn().mockResolvedValue(CONTRACT_RESULT),
    };
    const receipt: jest.Mocked<ReceiptLinkRevisionRefreshOperationPort> = {
        processOperation: jest.fn().mockResolvedValue(RECEIPT_RESULT),
    };
    return {
        coordinator: new ServiceRecordRevisionDocumentCoordinator(contract, receipt),
        contract,
        receipt,
    };
}

describe("ServiceRecordRevisionDocumentCoordinator", () => {
    it("maps locked contract facts and runs requested operations independently", async () => {
        const { coordinator, contract, receipt } = harness();
        const facts = lockedFacts();

        const result = await coordinator.process({
            ...BASE,
            revisionGeneration: "revision-generation-1",
            contract: { generation: CONTRACT_GENERATION, lockedFacts: facts },
            receipt: { expectedGeneration: RECEIPT_GENERATION, documentStateId: "receipt-state-1" },
        });

        expect(result).toMatchObject({
            revisionGeneration: "revision-generation-1",
            status: "capability_unverified",
            contract: CONTRACT_RESULT,
            receipt: RECEIPT_RESULT,
        });
        expect(contract.processOperation).toHaveBeenCalledWith(expect.objectContaining({
            ...BASE,
            snapshot: {
                original: {
                    documentId: "document-1",
                    documentVersion: 4,
                    templateId: "template-1",
                    templateVersion: "v2",
                    workflowScope: facts.sourceDocument.workflowScope,
                    mirrorGeneration: "mirror-4",
                    stage: "provider_participant",
                    participant: facts.sourceDocument.participant,
                    receivedDate: "2026-07-09",
                    receivedAmount: "462000",
                    startDate: "2026-07-09",
                    endDate: "2027-01-04",
                    allowedFieldIds: ["contract.start", "contract.end", "receipt.period"],
                    fields: facts.sourceDocument.fields,
                },
                target: facts.targetPeriod,
            },
            generation: CONTRACT_GENERATION,
        }));
        expect(receipt.processOperation).toHaveBeenCalledWith({
            ...BASE,
            documentStateId: "receipt-state-1",
            expectedGeneration: RECEIPT_GENERATION,
            retry: undefined,
        });
    });

    it("reports missing immutable facts without invoking either operation service", async () => {
        const { coordinator, contract, receipt } = harness();

        const result = await coordinator.process({
            ...BASE,
            contract: { generation: CONTRACT_GENERATION },
            receipt: { expectedGeneration: RECEIPT_GENERATION, documentStateId: "" },
        });

        expect(result.status).toBe("manual_review");
        expect(result.contract).toMatchObject({
            status: "manual_review",
            state: null,
            reason: "REVISION_DOCUMENT_IMMUTABLE_FACTS_MISSING",
        });
        expect(result.receipt).toMatchObject({
            status: "manual_review",
            state: null,
            reason: "REVISION_DOCUMENT_IMMUTABLE_FACTS_MISSING",
        });
        expect(result.reason).toBe(
            "contract:REVISION_DOCUMENT_IMMUTABLE_FACTS_MISSING|receipt:REVISION_DOCUMENT_IMMUTABLE_FACTS_MISSING",
        );
        expect(contract.processOperation).not.toHaveBeenCalled();
        expect(receipt.processOperation).not.toHaveBeenCalled();
    });

    it("uses the persisted contract state on resume and never replaces it with caller facts", async () => {
        const { coordinator, contract } = harness();
        const invalidFacts = lockedFacts({ documentId: null, fields: null });

        await coordinator.process({
            ...BASE,
            contract: {
                generation: CONTRACT_GENERATION,
                documentStateId: "contract-state-1",
                lockedFacts: invalidFacts,
            },
        });

        expect(contract.processOperation).toHaveBeenCalledWith({
            ...BASE,
            documentStateId: "contract-state-1",
            generation: CONTRACT_GENERATION,
            retry: undefined,
        });
        expect(contract.processOperation.mock.calls[0]?.[0]).not.toHaveProperty("snapshot");
    });

    it("returns a named missing-fact reason instead of fabricating a contract snapshot", () => {
        const result = buildServiceRecordContractRevisionSnapshot(
            lockedFacts({ documentId: null }),
        );

        expect(result).toEqual({
            snapshot: null,
            reason: "CONTRACT_REVISION_SNAPSHOT_MISSING_FACT:sourceDocument.documentId",
        });
    });

    it("preserves an explicitly null source document version", () => {
        const facts = lockedFacts({ documentVersion: null });
        const result = buildServiceRecordContractRevisionSnapshot(facts);

        expect(result.reason).toBeNull();
        expect(result.snapshot?.original.documentVersion).toBeNull();
    });

    it("rejects an omitted source document version instead of inventing one", () => {
        const facts = lockedFacts() as unknown as Record<string, unknown>;
        const source = facts["sourceDocument"] as Record<string, unknown>;
        delete source["documentVersion"];

        const result = buildServiceRecordContractRevisionSnapshot(
            facts as unknown as ServiceRecordRevisionContractLockedFacts,
        );

        expect(result).toEqual({
            snapshot: null,
            reason: "CONTRACT_REVISION_SNAPSHOT_MISSING_FACT:sourceDocument.documentVersion",
        });
    });

    it("rejects malformed target periods and preserves the exact source facts", () => {
        const facts = lockedFacts();
        const result = buildServiceRecordContractRevisionSnapshot({
            ...facts,
            targetPeriod: {
                ...facts.targetPeriod,
                receiptPeriod: "2026-07-10~2027-01-06",
            },
        });

        expect(result.snapshot).toBeNull();
        expect(result.reason).toBe("CONTRACT_REVISION_SNAPSHOT_MISSING_FACT:targetPeriod.receiptPeriod");
    });

    it("fails closed for an unexpected operation error while still processing the other operation", async () => {
        const { coordinator, contract, receipt } = harness();
        contract.processOperation.mockRejectedValueOnce(new Error("unexpected"));

        const result = await coordinator.process({
            ...BASE,
            contract: { generation: CONTRACT_GENERATION, documentStateId: "contract-state-1" },
            receipt: { expectedGeneration: RECEIPT_GENERATION, documentStateId: "receipt-state-1" },
        });

        expect(result.status).toBe("unknown");
        expect(result.contract).toMatchObject({
            status: "unknown",
            state: null,
            reason: "REVISION_DOCUMENT_COORDINATOR_OPERATION_FAILED",
        });
        expect(result.receipt).toEqual(RECEIPT_RESULT);
        expect(receipt.processOperation).toHaveBeenCalledTimes(1);
    });

    it("does not invoke operations when the shared scope is invalid", async () => {
        const { coordinator, contract, receipt } = harness();
        const invalidInput: ServiceRecordRevisionDocumentCoordinatorProcessInput = {
            ...BASE,
            clientId: 0,
            contract: { generation: CONTRACT_GENERATION, documentStateId: "contract-state-1" },
            receipt: { expectedGeneration: RECEIPT_GENERATION, documentStateId: "receipt-state-1" },
        };

        const result = await coordinator.process(invalidInput);

        expect(result.status).toBe("manual_review");
        expect(result.reason).toBe(
            "contract:REVISION_DOCUMENT_COORDINATOR_INPUT_INVALID|receipt:REVISION_DOCUMENT_COORDINATOR_INPUT_INVALID",
        );
        expect(contract.processOperation).not.toHaveBeenCalled();
        expect(receipt.processOperation).not.toHaveBeenCalled();
    });
});
