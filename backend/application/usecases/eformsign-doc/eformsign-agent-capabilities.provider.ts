import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { resolveEformsignDocDisplayStatus, type EformsignDocDisplayStatus } from "application/utils/eformsign-doc-display-status";
import { MIRROR_UNASSIGNED_KEY } from "application/utils/eformsign-list-doc-from-mirror";
import { FindEformsignDocsByClientIdUsecase } from "./find-eformsign-docs-by-client-id.usecase";
import { FindRecentContractsUsecase, type RecentContractRow } from "./find-recent-contracts.usecase";

const DISPLAY_STATUS_VALUES = ["pending", "signed", "review", "unassigned", "completed", "expired", "unknown"] as const satisfies readonly EformsignDocDisplayStatus[];

const InputSchema = z.object({
    clientId: z.number().int().positive().describe(
        "The client's numeric id — look it up via clients.search first; this does not accept a client name."
    ),
});
const StatusSchema = z.object({ documentId: z.string(), documentName: z.string().nullable(), status: z.string(), statusDetail: z.string(), updatedDate: z.string(), expired: z.boolean() });
const OutputSchema = z.object({ documents: z.array(StatusSchema) });

const RecentInputSchema = z.object({
    limit: z.number().int().min(1).max(20).optional().describe("Max rows to return, default 10."),
    status: z.enum(DISPLAY_STATUS_VALUES).optional().describe(
        "Filter to documents whose display status equals this value. Applied before the limit, over a bounded larger window (up to 200 rows) so the filter does not silently starve the result."
    ),
});
const RecentDocSchema = z.object({
    documentId: z.string(),
    documentName: z.string().nullable(),
    clientId: z.number().int().positive().nullable(),
    clientName: z.string().nullable(),
    status: z.string(),
    statusDetail: z.string(),
    updatedDate: z.string(),
    expired: z.boolean(),
});
const RecentOutputSchema = z.object({ documents: z.array(RecentDocSchema) });
const RECENT_CONTRACTS_FILTERED_WINDOW = 200;

/**
 * Same inputs the rest of the app passes when it resolves a contract's display
 * status (see `FindEformsignDocsByClientIdUsecase.executeWithContractEndDates`
 * and the mirror list service): the unassigned marker for a client-less row, and
 * the mirrored contract end date so a provider-review-step document can resolve
 * to "signed" once the review window has not yet opened, not just "review".
 *
 * The `expired` column is layered on top rather than fed into the resolver —
 * `resolveEformsignDocDisplayStatus` only ever derives "expired" from the vendor
 * status code, so a row whose `expired` column is true for a reason the status
 * code does not capture would otherwise silently resolve to "pending". Mirrors
 * the resolver's own precedence: a terminal "completed" status is never
 * downgraded.
 */
function resolveRecentContractDisplayStatus(doc: RecentContractRow): EformsignDocDisplayStatus {
    const resolved = resolveEformsignDocDisplayStatus({
        id: doc.documentId,
        current_status: { status_type: doc.statusType, step_type: doc.stepType, step_name: doc.stepName },
        ...(doc.clientId === null ? { [MIRROR_UNASSIGNED_KEY]: true } : {}),
        ...(doc.contractEndDate ? { contract_end_date: doc.contractEndDate } : {}),
    });
    return doc.expired && resolved !== "completed" ? "expired" : resolved;
}

@Injectable()
@AgentCapabilityProvider()
export class EformsignAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly findDocs: FindEformsignDocsByClientIdUsecase,
        private readonly findRecentContracts?: FindRecentContractsUsecase,
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        return [
            {
                meta: { name: "contracts.status", domain: "contracts", version: "1.0.0", description: "Read the eformsign contract/e-signature document status for one specific client. Use for: 계약서 상태, 전자서명 진행상황, 서명 완료 여부 확인. Input: clientId — the client's numeric id; look it up via clients.search first, this does not accept a client name. Returns, per non-deleted document: documentId, documentName, status, statusDetail, updatedDate, expired.", risk: "read", requiredRoles: ["owner", "admin", "manager", "user"], renderer: "activity", flagKey: "agent.capability.contracts.status", sideEffect: false },
                inputSchema: InputSchema, outputSchema: OutputSchema,
                execute: async (context, rawInput) => {
                    const docs = await this.findDocs.execute(context.principal.branchId, InputSchema.parse(rawInput).clientId);
                    return { documents: docs.filter((doc) => doc.statusType !== "deleted").map((doc) => ({ documentId: doc.documentId, documentName: doc.documentName, status: resolveEformsignDocDisplayStatus({ id: doc.documentId, current_status: { status_type: doc.statusType, step_type: doc.stepType, step_name: doc.stepName } }), statusDetail: doc.statusDetail, updatedDate: doc.updatedDate.toISOString(), expired: doc.expired })) };
                },
            },
            {
                meta: {
                    name: "contracts.recent",
                    domain: "contracts",
                    version: "1.0.0",
                    description: "List the most recently updated contracts for the current branch, across all clients. Use for: 최근 계약서, 계약서 현황, 서명 안 된 계약서. Input: optional limit (1-20, default 10), optional status (display status: pending/signed/review/unassigned/completed/expired/unknown) — when given, applied over a bounded window before the limit. Returns, newest updated first: documentId, documentName, clientId, clientName, status, statusDetail, updatedDate, expired. There is no rest-day or leave calendar here — this only covers contract documents, never service-record submissions.",
                    risk: "read", requiredRoles: ["owner", "admin", "manager", "user"], renderer: "activity", flagKey: "agent.capability.contracts.recent", sideEffect: false,
                },
                inputSchema: RecentInputSchema, outputSchema: RecentOutputSchema,
                execute: async (context, rawInput) => {
                    const input = RecentInputSchema.parse(rawInput);
                    const limit = input.limit ?? 10;
                    if (!this.findRecentContracts) throw new Error("contracts.recent is not available");
                    const take = input.status ? RECENT_CONTRACTS_FILTERED_WINDOW : limit;
                    const docs = await this.findRecentContracts.execute(context.principal.branchId, take);

                    const withDisplayStatus = docs.map((doc) => ({
                        ...doc,
                        displayStatus: resolveRecentContractDisplayStatus(doc),
                    }));
                    const filtered = input.status
                        ? withDisplayStatus.filter((doc) => doc.displayStatus === input.status)
                        : withDisplayStatus;

                    return {
                        documents: filtered.slice(0, limit).map((doc) => ({
                            documentId: doc.documentId,
                            documentName: doc.documentName,
                            clientId: doc.clientId,
                            clientName: doc.clientName,
                            status: doc.displayStatus,
                            statusDetail: doc.statusDetail,
                            updatedDate: doc.updatedDate.toISOString(),
                            expired: doc.expired,
                        })),
                    };
                },
            },
        ];
    }
}
