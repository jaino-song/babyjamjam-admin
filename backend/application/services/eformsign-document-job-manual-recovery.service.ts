import { Inject, Injectable, Logger } from "@nestjs/common";
import { EformsignDocumentSnapshotService } from "./eformsign-document-snapshot.service";
import { AreaTemplateService } from "./area-template.service";
import { EformsignService } from "./eformsign.service";
import { sha256CanonicalJson } from "./eformsign-document-job.service";
import { EformsignCredentialBoundary, assertEformsignProviderCapability, type EformsignProviderPrincipal, type EformsignProviderCredentials } from "./eformsign-credential-boundary.service";
import { parseEformsignTemplateWorkflow, type EformsignTemplateWorkflow } from "application/utils/eformsign-template-workflow";
import type { ContractDataDto } from "application/dto/contract.dto";
import { EFORMSIGN_CLIENT_REPOSITORY, type IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_CONTRACT_RECOVERY_REPOSITORY, EFORMSIGN_CONTRACT_DRAFT_DISPATCH, ContractRecoveryError,
    type IEformsignContractRecoveryRepository, type ContractDraftDispatch, type ContractRecoveryState,
    type ContractRecoveryClaim, type ContractWorkerContext, type ContractDocumentEvidence } from "domain/repositories/eformsign-contract-recovery.repository.interface";
import { eformsignExpiryDateFromRemainingDays } from "domain/utils/eformsign-expiry-date";

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const publicId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.exec(value)?.[0] === value;
function unsupported(reason = "document_mismatch"): never { throw new ContractRecoveryError("RECOVERY_UNSUPPORTED", 409, reason); }
type Context = { options: Record<string, unknown>; companyId: string; creatorId: string; templateId: string; workflow: EformsignTemplateWorkflow };

@Injectable()
export class EformsignDocumentJobManualRecoveryService {
    private readonly logger = new Logger(EformsignDocumentJobManualRecoveryService.name);
    constructor(
        @Inject(EFORMSIGN_CONTRACT_RECOVERY_REPOSITORY) private readonly repository: IEformsignContractRecoveryRepository,
        @Inject(EFORMSIGN_CONTRACT_DRAFT_DISPATCH) private readonly draft: ContractDraftDispatch,
        private readonly credentials: EformsignCredentialBoundary,
        private readonly options: EformsignService,
        private readonly templates: AreaTemplateService,
        @Inject(EFORMSIGN_CLIENT_REPOSITORY) private readonly provider: IEformsignClientRepository,
        private readonly snapshots: EformsignDocumentSnapshotService,
    ) {}
    private invalidate(branchId: string) {
        const failed = () => this.logger.warn("Failed to invalidate document snapshot after verified completion");
        try { void this.snapshots.bumpVersion(branchId).catch(failed); } catch { failed(); }
    }
    private claim(state: ContractRecoveryState, userId: string): ContractRecoveryClaim {
        return { jobId: state.jobId, branchId: state.branchId, userId, claimEpoch: state.claimEpoch };
    }
    private response(state: ContractRecoveryState) {
        if (state.claimEpoch < 1n || !state.claimExpiresAt) unsupported("claim_conflict");
        return { jobId: state.jobId, claimEpoch: state.claimEpoch.toString(), claimExpiresAt: state.claimExpiresAt.toISOString() };
    }
    private async bounded<T>(run: (fresh: () => void) => Promise<T>, onTimeout?: () => Promise<void>): Promise<T> {
        let expired = false;
        const deadline = Date.now() + 160_000;
        const fresh = () => { if (expired || Date.now() >= deadline) throw new ContractRecoveryError("RECOVERY_UNAVAILABLE", 503); };
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([run(fresh), new Promise<never>((_, reject) => { timer = setTimeout(() => {
                expired = true; void onTimeout?.().catch(() => undefined); reject(new ContractRecoveryError("RECOVERY_UNAVAILABLE", 503));
            }, 160_000); })]);
        } catch (error) { if (error instanceof ContractRecoveryError) throw error; throw new ContractRecoveryError("RECOVERY_UNAVAILABLE", 503); }
        finally { if (timer) clearTimeout(timer); }
    }
    private async withCredentials<T>(principal: EformsignProviderPrincipal, run: (credentials: EformsignProviderCredentials) => Promise<T>) {
        return this.credentials.withCredentials(principal, "contract.dispatch", async credentials => {
            try { return await run(credentials); } catch (error) {
                if (error instanceof ContractRecoveryError) throw error;
                throw new ContractRecoveryError("RECOVERY_UNAVAILABLE", 503);
            }
        });
    }
    private async context(state: ContractRecoveryState, credentials: EformsignProviderCredentials, fresh: () => void): Promise<Context> {
        const data = object(state.payload["contractData"]); if (!data) unsupported("payload_expired");
        const frozen = object(state.payload["contractDraft"]) ?? (state.providerDocumentId || state.creationIntent?.providerDocumentId ? object(state.payload["contractDispatch"]) : null);
        const area = typeof data["area"] === "string" && data["area"] ? await this.templates.findByArea(state.branchId, data["area"]) : null;
        fresh();
        const effective = frozen?.["effectiveTemplateId"] ?? frozen?.["templateId"] ?? this.options.resolveEffectiveTemplateId(area?.templateId);
        if (!publicId(effective)) unsupported();
        const config = await this.provider.getTemplateWorkflowConfig(credentials.accessToken, effective); fresh();
        const workflow = parseEformsignTemplateWorkflow(config, effective);
        if (frozen?.["workflow"] && sha256CanonicalJson(frozen["workflow"]) !== sha256CanonicalJson(workflow)) unsupported();
        const documentOption = this.options.generateDocumentOptions(data as unknown as ContractDataDto, credentials.accessToken, credentials.refreshToken, effective, workflow) as Record<string, unknown>;
        const companyId = object(documentOption["company"])?.["id"], creatorId = object(documentOption["user"])?.["id"];
        if (!publicId(companyId) || typeof creatorId !== "string" || !creatorId || (frozen?.["companyId"] && frozen["companyId"] !== companyId)
            || (frozen?.["creatorId"] && frozen["creatorId"] !== creatorId)) unsupported();
        return { options: documentOption, companyId, creatorId, templateId: effective, workflow };
    }
    private async evidence(credentials: EformsignProviderCredentials, context: Context, id: string, fresh: () => void): Promise<ContractDocumentEvidence> {
        if (!publicId(id)) unsupported();
        const doc = await this.provider.getDocument(credentials.accessToken, id); fresh();
        if (!doc || doc.id !== id || doc.template?.id !== context.templateId || doc.creator?.id !== context.creatorId || doc.creator.recipient_type !== "01"
            || !Number.isFinite(doc.created_date) || !Number.isFinite(doc.updated_date) || doc.current_status?._expired === true) unsupported();
        const status = doc.current_status;
        const isDraft = status?.status_type === "001" && status.step_type === "00";
        const confirmed = context.workflow.steps.some(step => step.seq === status?.step_index && step.stepGroup === status.step_group && (
            (step.type === "participant" && status.status_type === "060" && status.step_type === "05")
            || (step.type === "reviewer" && status.status_type === "070" && status.step_type === "06")
            || (step.type === "complete" && status.status_type === "003" && status.step_type === "01")
        ));
        if (!isDraft && !confirmed) unsupported();
        return { documentId: id, templateId: context.templateId, companyId: context.companyId, creatorId: context.creatorId,
            documentName: doc.document_name ?? null, documentNumber: doc.document_number ?? null, templateName: doc.template.name ?? null,
            creatorName: doc.creator.name ?? null, lastEditorName: doc.last_editor?.name ?? null,
            stepRecipientTypes: [...new Set((status.step_recipients ?? []).map(recipient => recipient.recipient_type))],
            statusType: status.status_type, stepType: status.step_type, stepIndex: status.step_index, stepName: status.step_name,
            confirmed, createdAt: new Date(doc.created_date), updatedAt: new Date(doc.updated_date),
            expiresAt: eformsignExpiryDateFromRemainingDays(status.expired_date, Date.now()) };
    }
    async open(jobId: string, principal: EformsignProviderPrincipal) {
        assertEformsignProviderCapability(principal, "contract.dispatch");
        if (!principal.userId) throw new ContractRecoveryError("AUTH_REQUIRED", 401);
        let startedDraft: { claim: ContractRecoveryClaim; intentId: string } | undefined;
        return this.bounded(async fresh => {
            let state = await this.repository.open(jobId, principal.branchId!, principal.userId!); fresh();
            const claim = this.claim(state, principal.userId!), response = this.response(state);
            if (["verified", "closed"].includes(state.phase)) return { kind: "verify_only" as const, ...response };
            return this.withCredentials(principal, async credentials => {
                if (state.phase === "human_exposed") {
                    let evidence: ContractDocumentEvidence;
                    try {
                        if (!state.providerDocumentId) unsupported();
                        const context = await this.context(state, credentials, fresh);
                        evidence = await this.evidence(credentials, context, state.providerDocumentId, fresh);
                    } catch (error) {
                        if (error instanceof ContractRecoveryError && error.code === "RECOVERY_UNSUPPORTED") {
                            throw new ContractRecoveryError("PROVIDER_STATE_UNAVAILABLE", 503);
                        }
                        throw error;
                    }
                    if (evidence.confirmed) {
                        await this.repository.completeManual(claim, evidence); this.invalidate(state.branchId);
                        return { kind: "verify_only" as const, ...response };
                    }
                    await this.repository.reexposeHuman(claim, evidence); fresh();
                    return { kind: "editable" as const, ...response, document: { companyId: evidence.companyId, templateId: evidence.templateId, documentId: evidence.documentId } };
                }
                const context = await this.context(state, credentials, fresh);
                let id = state.providerDocumentId ?? state.draftIntent?.providerDocumentId ?? state.creationIntent?.providerDocumentId;
                let draftIntentId: string | undefined;
                if (!id) {
                    const intent = await this.repository.beginDraft(claim, context.templateId, { companyId: context.companyId, creatorId: context.creatorId, workflow: context.workflow });
                    startedDraft = { claim, intentId: intent.id };
                    draftIntentId = intent.id; fresh();
                    try {
                        const result = await this.draft.dispatchDraft({ documentOption: context.options, beforeOpen: async () => {
                            fresh(); const allowed = await this.repository.beforeDraftOpen(claim, intent.id); fresh(); return allowed;
                        } });
                        fresh();
                        if (!result.ok || !publicId(result.candidateDocumentId)) {
                            if (!result.ok && result.uncertain === false) { await this.repository.releaseDraftBeforeOpen(claim, intent.id); startedDraft = undefined; }
                            else await this.repository.markDraftUncertain(claim, intent.id);
                            unsupported("draft_unavailable");
                        }
                        id = result.candidateDocumentId;
                        await this.repository.recordDraftCandidate(claim, intent.id, id); fresh();
                    } catch (error) {
                        await this.repository.markDraftUncertain(claim, intent.id).catch(() => undefined);
                        throw error;
                    }
                }
                const evidence = await this.evidence(credentials, context, id, fresh);
                if ((draftIntentId || (!state.providerDocumentId && state.draftIntent?.providerDocumentId === id)) && evidence.confirmed) unsupported();
                if (!state.providerDocumentId) state = await this.repository.bindDocument(claim, evidence, draftIntentId ?? state.draftIntent?.id);
                fresh();
                if (evidence.confirmed) { await this.repository.completeManual(claim, evidence); this.invalidate(state.branchId); return { kind: "verify_only" as const, ...response }; }
                if (state.phase === "creation_uncertain") return { kind: "verify_only" as const, ...response };
                const exposed = await this.repository.expose(claim, evidence); fresh();
                if (!exposed) return { kind: "verify_only" as const, ...response };
                return { kind: "editable" as const, ...response, document: { companyId: evidence.companyId, templateId: evidence.templateId, documentId: evidence.documentId } };
            });
        }, async () => { if (startedDraft) await this.repository.markDraftUncertain(startedDraft.claim, startedDraft.intentId); });
    }
    async verify(jobId: string, principal: EformsignProviderPrincipal, epoch: bigint) {
        assertEformsignProviderCapability(principal, "contract.dispatch");
        if (!principal.userId) throw new ContractRecoveryError("AUTH_REQUIRED", 401);
        return this.bounded(async fresh => {
            const claim = { jobId, branchId: principal.branchId!, userId: principal.userId!, claimEpoch: epoch };
            const state = await this.repository.readClaim(claim); fresh();
            if (["verified", "closed"].includes(state.phase)) return { kind: "verified" as const, jobId, claimEpoch: epoch.toString() };
            if (!state.providerDocumentId || !["human_exposed", "creation_uncertain"].includes(state.phase)) unsupported("unverified_creation");
            return this.withCredentials(principal, async credentials => {
                const context = await this.context(state, credentials, fresh);
                const evidence = await this.evidence(credentials, context, state.providerDocumentId!, fresh);
                if (!evidence.confirmed) return { kind: "pending" as const, jobId, claimEpoch: epoch.toString() };
                await this.repository.completeManual(claim, evidence); this.invalidate(state.branchId);
                return { kind: "verified" as const, jobId, claimEpoch: epoch.toString() };
            });
        });
    }
    async completeAutomatic(worker: ContractWorkerContext, documentId: string, principal: EformsignProviderPrincipal) {
        return this.bounded(async fresh => {
            const state = await this.repository.readWorker(worker); fresh();
            return this.withCredentials(principal, async credentials => {
                const context = await this.context(state, credentials, fresh), evidence = await this.evidence(credentials, context, documentId, fresh);
                if (!evidence.confirmed) unsupported("unverified_creation");
                await this.repository.completeAutomatic(worker, evidence); this.invalidate(state.branchId);
            });
        });
    }
}
