import { randomUUID } from "node:crypto";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import {
    ServiceRecordContractRevisionService,
    type ServiceRecordContractRevisionCapabilityEvidence,
    type ServiceRecordContractRevisionDocumentObservation,
    type ServiceRecordContractRevisionDispatchPort,
    type ServiceRecordContractRevisionProcessInput,
    type ServiceRecordContractRevisionProviderPort,
    type ServiceRecordContractRevisionSnapshot,
} from "application/services/service-record-contract-revision.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import type { ServiceRecordEditJsonValue } from "domain/repositories/service-record-edit.repository.interface";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

const ORIGINAL_START = "2026-09-07";
const ORIGINAL_END = "2026-09-23";
const TARGET_START = "2026-09-08";
const TARGET_END = "2026-09-24";
const RECEIVED_DATE = "2026-08-31";
const RECEIVED_AMOUNT = "600000";
const TEMPLATE_ID = "task5-contract-template";
const TEMPLATE_VERSION = "task5-contract-v1";

function contractSnapshot(
    overrides: Partial<ServiceRecordContractRevisionSnapshot["original"]> = {},
    targetFields: Record<string, string> = {
        "contract.start": TARGET_START,
        "contract.end": TARGET_END,
        "receipt.period": `${TARGET_START}~${TARGET_END}`,
        "service.cost": "1464000",
    },
): ServiceRecordContractRevisionSnapshot {
    const original = {
        documentId: `synthetic-contract-document-${randomUUID()}`,
        documentVersion: 4,
        templateId: TEMPLATE_ID,
        templateVersion: TEMPLATE_VERSION,
        workflowScope: {
            templateId: TEMPLATE_ID,
            templateVersion: TEMPLATE_VERSION,
            providerWorkflow: "contract-period",
        },
        mirrorGeneration: `synthetic-mirror-${randomUUID()}`,
        stage: "provider_participant" as const,
        participant: { id: "synthetic-participant", name: "Task 5 Contract Client", phone: "010-5555-0105" },
        receivedDate: RECEIVED_DATE,
        receivedAmount: RECEIVED_AMOUNT,
        startDate: ORIGINAL_START,
        endDate: ORIGINAL_END,
        allowedFieldIds: ["contract.start", "contract.end", "receipt.period", "service.cost"],
        fields: {
            "contract.start": ORIGINAL_START,
            "contract.end": ORIGINAL_END,
            "receipt.period": `${ORIGINAL_START}~${ORIGINAL_END}`,
            "service.cost": "1464000",
        },
        ...overrides,
    };
    return {
        original,
        target: {
            startDate: TARGET_START,
            endDate: TARGET_END,
            receiptPeriod: `${TARGET_START}~${TARGET_END}`,
            fields: targetFields,
        },
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

function verifiedCapability(
    current: ServiceRecordContractRevisionSnapshot,
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
    };
}

function makeProvider(
    current: ServiceRecordContractRevisionSnapshot,
): jest.Mocked<ServiceRecordContractRevisionProviderPort> {
    return {
        inspectDocument: jest.fn().mockResolvedValue(observation(current)),
        requestReviewRejection: jest.fn().mockResolvedValue(undefined),
        updateParticipantFields: jest.fn().mockResolvedValue(undefined),
        createReplacementDocument: jest.fn().mockResolvedValue({ documentId: "synthetic-replacement" }),
        findReplacementDocument: jest.fn().mockResolvedValue(null),
    };
}

function makeDispatch(): jest.Mocked<ServiceRecordContractRevisionDispatchPort> {
    let sequence = 0;
    return {
        claim: jest.fn().mockImplementation(async () => ({
            disposition: "claimed" as const,
            claimToken: `synthetic-claim-${++sequence}`,
        })),
        markAccepted: jest.fn().mockResolvedValue(undefined),
        markUncertain: jest.fn().mockResolvedValue(undefined),
    };
}

function makeService(
    repository: ServiceRecordEditRepository,
    provider: jest.Mocked<ServiceRecordContractRevisionProviderPort>,
    dispatch: jest.Mocked<ServiceRecordContractRevisionDispatchPort>,
): ServiceRecordContractRevisionService {
    return new ServiceRecordContractRevisionService(repository as never, provider, dispatch);
}

async function waitForBarrier(barrier: Promise<void>, label: string, timeoutMs = 5000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            barrier,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

describeE2E("contract revision operation state (real disposable PostgreSQL)", () => {
    let prisma: ReturnType<typeof createApprovedServiceRecordConfirmClient>;
    let repository: ServiceRecordEditRepository;

    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
        repository = new ServiceRecordEditRepository(prisma as unknown as PrismaService);
    });

    // Retain synthetic operation history with its revision evidence in the disposable DB.

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    async function appendRevision(fixture: Awaited<ReturnType<typeof createServiceRecordConfirmFixture>>) {
        const revision = await repository.appendRevision({
            branchId: fixture.branch.id,
            serviceRecordCaseId: fixture.record.id,
            actorUserId: fixture.actorUserId,
            payload: { source: "task5-contract-e2e" },
            plannedSessions: [],
            provenance: { source: "task5-contract-e2e" },
            formVersionAtConfirm: 2,
        });
        await prisma.service_record_case.update({ where: { id: fixture.record.id },
            data: { currentRevisionId: revision.id } });
        return revision;
    }

    async function createOperationState(
        fixture: Awaited<ReturnType<typeof createServiceRecordConfirmFixture>>,
        current: ServiceRecordContractRevisionSnapshot,
        overrides: { status?: "pending" | "processing" | "unknown" | "failed"; step?: string } = {},
    ) {
        const revision = await appendRevision(fixture);
        const generation = randomUUID();
        const state = await repository.createRevisionDocumentState({
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            serviceRecordCaseId: fixture.record.id,
            revisionId: revision.id,
            operation: "contract_period",
            generation,
            immutableInput: current as unknown as ServiceRecordEditJsonValue,
            inputFingerprint: sha256CanonicalJson(current),
            documentVersion: current.original.documentVersion,
            sourceDocumentId: current.original.documentId,
            templateId: current.original.templateId,
            templateVersion: current.original.templateVersion,
            workflowScope: current.original.workflowScope,
            mirrorGeneration: current.original.mirrorGeneration,
            status: overrides.status ?? "pending",
            step: overrides.step ?? "prepared",
        });
        return { revision, generation, state };
    }

    function operationInput(
        fixture: Awaited<ReturnType<typeof createServiceRecordConfirmFixture>>,
        revisionId: string,
        generation: string,
        current: ServiceRecordContractRevisionSnapshot,
        stateId: string,
        overrides: Partial<ServiceRecordContractRevisionProcessInput> = {},
    ): ServiceRecordContractRevisionProcessInput {
        return {
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            serviceRecordCaseId: fixture.record.id,
            revisionId,
            generation,
            documentStateId: stateId,
            capability: verifiedCapability(current),
            ...overrides,
        };
    }

    it("persists an unverified operation without inspecting, dispatching, or mutating a provider document", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const current = contractSnapshot();
        current.original.documentVersion = null;
        const revision = await appendRevision(fixture);
        const generation = randomUUID();
        const provider = makeProvider(current);
        const dispatch = makeDispatch();
        const service = makeService(repository, provider, dispatch);

        const result = await service.processOperation({
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            serviceRecordCaseId: fixture.record.id,
            revisionId: revision.id,
            generation,
            snapshot: current,
        });

        expect(result.status).toBe("capability_unverified");
        expect(provider.inspectDocument).not.toHaveBeenCalled();
        expect(provider.requestReviewRejection).not.toHaveBeenCalled();
        expect(provider.updateParticipantFields).not.toHaveBeenCalled();
        expect(provider.createReplacementDocument).not.toHaveBeenCalled();
        expect(dispatch.claim).not.toHaveBeenCalled();
        expect(result.state).toBeTruthy();

        const persisted = await repository.findRevisionDocumentState(
            fixture.branch.id,
            fixture.client.id,
            revision.id,
            result.state!.id,
        );
        expect(persisted).toMatchObject({
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            revisionId: revision.id,
            generation,
            status: "capability_unverified",
            immutableInput: current,
            inputFingerprint: sha256CanonicalJson(current),
            sourceDocumentId: current.original.documentId,
            documentVersion: null,
            targetDocumentId: null,
            mirrorGeneration: current.original.mirrorGeneration,
            lastErrorCode: "CONTRACT_REVISION_CAPABILITY_UNVERIFIED",
        });
    });

    it("reuses the persisted immutable receipt and period snapshot after an unknown mutation outcome", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const current = contractSnapshot();
        const { revision, generation, state } = await createOperationState(fixture, current);
        const provider = makeProvider(current);
        const dispatch = makeDispatch();
        const service = makeService(repository, provider, dispatch);
        const events: string[] = [];

        provider.inspectDocument.mockImplementation(async () => {
            const call = provider.inspectDocument.mock.calls.length;
            events.push(`inspect-${call}`);
            return observation(current, call >= 5 ? { fields: { ...current.target.fields } } : {});
        });
        provider.updateParticipantFields.mockImplementation(async (input) => {
            events.push("mutate");
            if (provider.updateParticipantFields.mock.calls.length === 1) throw new Error("response lost");
            expect(input.preservedReceipt).toEqual({ receivedDate: RECEIVED_DATE, receivedAmount: RECEIVED_AMOUNT });
        });

        const first = await service.processOperation(operationInput(
            fixture,
            revision.id,
            generation,
            current,
            state.id,
        ));
        expect(first.status).toBe("unknown");
        const afterUnknown = await repository.findRevisionDocumentState(
            fixture.branch.id,
            fixture.client.id,
            revision.id,
            state.id,
        );
        expect(afterUnknown).toMatchObject({
            generation,
            immutableInput: current,
            inputFingerprint: sha256CanonicalJson(current),
            status: "unknown",
        });

        const resumed = await service.processOperation(operationInput(
            fixture,
            revision.id,
            generation,
            current,
            state.id,
            { retry: true },
        ));

        expect(resumed.status).toBe("waiting_for_signature");
        expect(provider.updateParticipantFields).toHaveBeenCalledTimes(2);
        expect(events.indexOf("inspect-3")).toBeGreaterThanOrEqual(0);
        expect(events.indexOf("inspect-3")).toBeLessThan(events.indexOf("mutate", events.indexOf("mutate") + 1));
        for (const call of provider.updateParticipantFields.mock.calls) {
            expect(call[0]).toMatchObject({
                fields: current.target.fields,
                preservedReceipt: { receivedDate: RECEIVED_DATE, receivedAmount: RECEIVED_AMOUNT },
            });
        }
        const persisted = await repository.findRevisionDocumentState(
            fixture.branch.id,
            fixture.client.id,
            revision.id,
            state.id,
        );
        expect(persisted).toMatchObject({
            generation,
            immutableInput: current,
            inputFingerprint: sha256CanonicalJson(current),
            status: "waiting_for_signature",
            sourceDocumentId: current.original.documentId,
            targetDocumentId: null,
        });
        expect(await prisma.service_record_revision_document_state.count({ where: { revisionId: revision.id } })).toBe(1);
    });

    it("lets one concurrent processor win the state CAS while the loser makes no duplicate mutable provider call", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const current = contractSnapshot();
        const { revision, generation, state } = await createOperationState(fixture, current);
        const provider = makeProvider(current);
        const dispatch = makeDispatch();
        const service = makeService(repository, provider, dispatch);
        let release!: () => void;
        let resolveReached!: () => void;
        const reached = new Promise<void>((resolve) => { resolveReached = resolve; });
        const gate = new Promise<void>((resolve) => { release = resolve; });

        provider.inspectDocument.mockImplementation(async () => {
            const call = provider.inspectDocument.mock.calls.length;
            if (call <= 2) {
                if (call === 2) resolveReached();
                await gate;
            }
            return observation(current, call > 2 ? { fields: { ...current.target.fields } } : {});
        });

        const input = operationInput(fixture, revision.id, generation, current, state.id);
        const first = service.processOperation(input);
        const second = service.processOperation(input);
        await waitForBarrier(reached, "both initial contract document observations");
        release();
        const results = await Promise.all([first, second]);

        expect(results.map((result) => result.status).sort()).toEqual(["unknown", "waiting_for_signature"].sort());
        expect(provider.updateParticipantFields).toHaveBeenCalledTimes(1);
        expect(dispatch.claim).toHaveBeenCalledTimes(1);
        const persisted = await repository.findRevisionDocumentState(
            fixture.branch.id,
            fixture.client.id,
            revision.id,
            state.id,
        );
        expect(persisted).toMatchObject({
            status: "waiting_for_signature",
            generation,
            immutableInput: current,
            inputFingerprint: sha256CanonicalJson(current),
        });
    });
});
