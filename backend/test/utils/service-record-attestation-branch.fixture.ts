import { ServiceRecordInitialNoProviderDocumentService } from "infrastructure/eformsign/service-record-initial-no-provider-document.service";
import { matchesWhere } from "./prisma-where-evaluator";

export function attestationReplayInBranch(
    branchId: string,
    input: { revisionId: string; documentStateId: string; expectedGeneration: string },
): ServiceRecordInitialNoProviderDocumentService["confirmInitialNoProviderDocument"] {
    const state = {
        id: input.documentStateId,
        branchId,
        revisionId: input.revisionId,
        generation: input.expectedGeneration,
        operation: "record_snapshot",
        status: "failed",
        outputProof: { kind: "INITIAL_NO_PROVIDER_DOCUMENT_ATTESTATION" },
    };
    const findFirst = jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        matchesWhere(state, where) ? state : null);
    const prisma = { service_record_revision_document_state: { findFirst } };
    const service = new ServiceRecordInitialNoProviderDocumentService(prisma as never, {} as never, {} as never);
    return service.confirmInitialNoProviderDocument.bind(service);
}
