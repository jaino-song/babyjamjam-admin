import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    ConflictException,
    ForbiddenException,
    GoneException,
    Logger,
    MessageEvent,
    NotFoundException,
    Post,
    Param,
    ParseUUIDPipe,
    Query,
    Req,
    Optional,
    ServiceUnavailableException,
    Sse,
    UnauthorizedException,
    UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Observable, filter, interval, map, merge } from "rxjs";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { ListClientNamesByBranchUsecase } from "application/usecases/eformsign-doc/list-client-names-by-branch.usecase";
import { ListReviewStageContractsUsecase } from "application/usecases/eformsign-doc/list-review-stage-contracts.usecase";
import { ListEformsignLinkConfirmationsUsecase } from "application/usecases/eformsign-doc/list-eformsign-link-confirmations.usecase";
import { DispatchDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";
import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";
import { ContractSupersedeService } from "application/services/contract-supersede.service";
import { AdoptEformsignDocUsecase } from "application/usecases/eformsign-doc/adopt-eformsign-doc.usecase";
import type { CreateEformsignDocResult } from "application/usecases/eformsign-doc/create-eformsign-doc.usecase";
import { SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS } from "application/usecases/eformsign-doc/service-record-field-ids";
import {
    CreateEformsignDocLocalDto,
    DispatchHeadlessRequestDto,
    DispatchHeadlessResponseDto,
    FinalizeHeadlessRequestDto,
    FinalizeHeadlessResponseDto,
    ReconcileEformsignDispatchIntentDto,
    EformsignDispatchIntentResponseDto,
    AdoptEformsignDocDto,
    ReviewNeededContractDto,
    EformsignLinkConfirmationDto,
} from "interface/dto/eformsign-doc.dto";
import {
    CreateEformsignDocumentJobDto,
    FinalizeEformsignDocumentJobDto,
    EnqueueEformsignDocumentJobResponseDto,
    EformsignDocumentJobListResponseDto,
    EformsignDocumentJobSummaryResponseDto,
    EformsignDocumentJobRecoveryResponseDto,
    EformsignDocumentJobResolveResponseDto,
    toEformsignDocumentJobResponse,
} from "interface/dto/eformsign-document-job.dto";
import { classifyRecovery, parseManualClaim } from "domain/entities/eformsign-document-job.entity";
import type {
    ClaimRecoveryResult,
    ResolveManuallyResult,
} from "domain/repositories/eformsign-document-job.repository.interface";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { parseInteger } from "interface/parse-integer";
import {
    assertEformsignProviderCapability,
    type EformsignProviderPrincipal,
} from "application/services/eformsign-credential-boundary.service";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";

type RecoveryRejection = Exclude<
    ClaimRecoveryResult | ResolveManuallyResult,
    { kind: "claimed" | "resolved" | "already_resolved" }
>;

@Controller("eformsign-docs")
@UseGuards(JwtGuard, TenantGuard)
export class EformsignDocController {
    private readonly logger = new Logger(EformsignDocController.name);

    constructor(
        private readonly eformsignDocService: EformsignDocService,
        private readonly listClientNamesByBranchUsecase: ListClientNamesByBranchUsecase,
        private readonly listReviewStageContractsUsecase: ListReviewStageContractsUsecase,
        private readonly dispatchHeadlessUsecase: DispatchDocumentHeadlessUsecase,
        private readonly finalizeHeadlessUsecase: FinalizeDocumentHeadlessUsecase,
        private readonly adoptEformsignDocUsecase: AdoptEformsignDocUsecase,
        private readonly eventBus: EformsignDocsEventBus,
        private readonly headlessProgressService: EformsignHeadlessProgressService,
        private readonly configService: ConfigService,
        private readonly documentJobService: EformsignDocumentJobService,
        private readonly listEformsignLinkConfirmationsUsecase: ListEformsignLinkConfirmationsUsecase,
        @Optional() private readonly dispatchBoundary?: EformsignDispatchBoundaryService,
        @Optional() private readonly contractSupersedeService?: ContractSupersedeService,
    ) {}

    /**
     * GET /eformsign-docs/feedback-template-id
     * Exposes the 제공기록지 template id(s) so the UI can split service-record documents
     * from contract documents by template — never by (renamable) template name.
     * `templateId` stays the base (5회) id for backward compatibility; `templateIds`
     * lists every configured tier (base, then 10/15/20회 in that order) so the UI can
     * match documents created on any tier's template (BJJ-multi-tier).
     */
    @Get("feedback-template-id")
    getServiceRecordTemplateId(): { templateId: string | null; templateIds: string[] } {
        const templateId = this.configService.get<string>("EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID")?.trim();
        const templateIds = SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS
            .map(({ envKey }) => this.configService.get<string>(envKey)?.trim())
            .filter((id): id is string => Boolean(id));
        return { templateId: templateId || null, templateIds };
    }

    /**
     * GET /eformsign-docs/review-needed-contracts
     * Provider-review-stage (070) contracts for the dashboard card: the branch's
     * own plus unclaimed ones (documents often reach the review stage before any
     * branch adopts them), with the nightly auto-finalize bookkeeping so the UI
     * can badge 대기 / 재시도 / 수동 확인 필요.
     */
    @Get("review-needed-contracts")
    async getReviewNeededContracts(
        @CurrentTenant() tenant: { branchId?: string },
    ): Promise<ReviewNeededContractDto[]> {
        const branchId = tenant.branchId ?? "";
        const contracts = await this.listReviewStageContractsUsecase.execute();
        return contracts
            .filter((contract) => contract.branchId === branchId || contract.branchId === null)
            .sort((a, b) => (a.contractEndDate ?? "9999-99-99").localeCompare(b.contractEndDate ?? "9999-99-99"))
            .map((contract) => ({
                documentId: contract.documentId,
                customerName: contract.customerName,
                contractEndDate: contract.contractEndDate,
                autoFinalizeAttempts: contract.autoFinalizeAttempts,
                autoFinalizeLastError: contract.autoFinalizeLastError,
                autoFinalizeLastAttemptAt:
                    contract.autoFinalizeLastAttemptAt?.toISOString() ?? null,
            }));
    }

    @Get("link-confirmations")
    async listLinkConfirmations(
        @CurrentTenant() tenant: EformsignProviderPrincipal,
        @Query("clientId") clientId?: string,
    ): Promise<EformsignLinkConfirmationDto[]> {
        const parsedClientId = clientId === undefined ? undefined : parseInteger(clientId, "clientId", { min: 1 });
        let canConfirm = true;
        try {
            assertEformsignProviderCapability(tenant, "contract.adopt");
        } catch (error) {
            if (!(error instanceof ForbiddenException)) throw error;
            canConfirm = false;
        }
        const confirmations = await this.listEformsignLinkConfirmationsUsecase.execute(tenant.branchId ?? "", parsedClientId);
        return confirmations.map(confirmation => ({ ...confirmation, canConfirm }));
    }

    /**
     * GET /eformsign-docs/events
     * Server-Sent Events stream of doc-list mutations for the current branch.
     * Emits a `docs-changed` event after each webhook completes; sends a `ping`
     * every 30s to keep proxies + clients honest.
     */
    @Sse("events")
    events(@CurrentTenant() tenant: { branchId?: string }): Observable<MessageEvent> {
        const branchId = tenant.branchId ?? "";

        const docs = this.eventBus.events$.pipe(
            filter((e) => e.branchId === branchId),
            map((e) => ({ data: e, type: "docs-changed" } as MessageEvent)),
        );

        const heartbeat = interval(30000).pipe(
            map(() => ({ data: { at: Date.now() }, type: "ping" } as MessageEvent)),
        );

        return merge(docs, heartbeat);
    }

    @Sse("dispatch-headless/progress")
    dispatchHeadlessProgress(@Query("progressId") progressId: string): Observable<MessageEvent> {
        const progress = this.headlessProgressService.events$.pipe(
            filter((event) => event.progressId === progressId),
            map((event) => ({ data: event, type: "progress" } as MessageEvent)),
        );

        const heartbeat = interval(30000).pipe(
            map(() => ({ data: { at: Date.now() }, type: "ping" } as MessageEvent)),
        );

        return merge(progress, heartbeat);
    }

    @Sse("finalize-headless/progress")
    finalizeHeadlessProgress(@Query("progressId") progressId: string): Observable<MessageEvent> {
        const progress = this.headlessProgressService.events$.pipe(
            filter((event) => event.progressId === progressId),
            map((event) => ({ data: event, type: "progress" } as MessageEvent)),
        );

        const heartbeat = interval(30000).pipe(
            map(() => ({ data: { at: Date.now() }, type: "ping" } as MessageEvent)),
        );

        return merge(progress, heartbeat);
    }

    // ============ Local DB Endpoints ============

    /**
     * Legacy provider credential endpoints are retained as deterministic
     * tombstones.  Keeping the paths avoids a misleading 404 for older
     * clients while ensuring no request body can mint or reveal credentials.
     */
    @Post("access-token")
    getAccessToken(): never {
        throw new GoneException(codeOnlyProblemBody("EFORMSIGN_CREDENTIALS_SERVER_ONLY"));
    }

    @Post("refresh-token")
    refreshAccessToken(): never {
        throw new GoneException(codeOnlyProblemBody("EFORMSIGN_CREDENTIALS_SERVER_ONLY"));
    }

    /**
     * POST /eformsign-docs
     * Create a new eformsign document record in local DB
     * Called by frontend after document is created in eformsign
     */
    @Post()
    async create(@CurrentTenant() tenant: { branchId?: string }, @Body() dto: CreateEformsignDocLocalDto) {
        const statusType = normalizeEformsignStatusCode(dto.statusType);
        if (!/^[0-9]{3}$/.test(statusType)) {
            throw new BadRequestException(codeOnlyProblemBody("VALIDATION_FAILED"));
        }
        this.logger.log(`[POST /eformsign-docs] Received request to create doc record: documentId=${dto.documentId}, clientId=${dto.clientId}`);
        try {
            const result = await this.eformsignDocService.create(tenant.branchId ?? "", {
                documentId: dto.documentId,
                clientId: dto.clientId,
                statusType,
                statusDetail: dto.statusDetail,
                stepType: dto.stepType,
                stepIndex: dto.stepIndex,
                stepName: dto.stepName,
                stepRecipientType: dto.stepRecipientType,
                stepRecipientName: dto.stepRecipientName,
                stepRecipientSms: dto.stepRecipientSms,
                expiredDate: new Date(dto.expiredDate),
                linkToClient: dto.linkToClient,
                documentKind: dto.documentKind,
                employeeScheduleId: dto.employeeScheduleId,
                templateId: dto.templateId,
            });
            this.logger.log(`[POST /eformsign-docs] Successfully created record id=${result.id}`);
            const resultWithWarnings = result as CreateEformsignDocResult;
            return {
                ...result.toJSON(),
                ...(resultWithWarnings.warnings ? { warnings: resultWithWarnings.warnings } : {}),
            };
        } catch (error) {
            this.logger.error(
                `[POST /eformsign-docs] Failed to create record: ${sanitizeEformsignErrorMessage(error)}`,
            );
            throw error;
        }
    }

    /**
     * GET /eformsign-docs
     * List all stored eformsign documents from local DB
     */
    @Get()
    findAll(@CurrentTenant() tenant: { branchId?: string }) {
        return this.eformsignDocService.findAll(tenant.branchId ?? "");
    }

    /**
     * GET /eformsign-docs/id?id=123
     * Find a stored eformsign document by its DB id
     */
    @Get("id")
    findById(@CurrentTenant() tenant: { branchId?: string }, @Query("id") id: string) {
        return this.eformsignDocService.findById(tenant.branchId ?? "", parseInteger(id, "id", { min: 1 }));
    }

    /**
     * GET /eformsign-docs/document-id?documentId=abc123
     * Find a stored eformsign document by the eformsign documentId
     */
    @Get("document-id")
    findByDocumentId(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("documentId") documentId: string
    ) {
        return this.eformsignDocService.findByDocumentId(tenant.branchId ?? "", documentId);
    }

    /**
     * GET /eformsign-docs/client-names
     * Returns documentId → clientName mapping for current branch.
     * Used by the contracts list to show the customer's name even after the
     * doc has progressed past step 1 (eformsign list_document loses outsider info).
     */
    @Get("client-names")
    listClientNames(@CurrentTenant() tenant: { branchId?: string }) {
        return this.listClientNamesByBranchUsecase.execute(tenant.branchId ?? "");
    }

    /**
     * GET /eformsign-docs/client?clientId=123
     * Find all stored eformsign documents linked to a client
     */
    @Get("client")
    findByClientId(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("clientId") clientId: string
    ) {
        return this.eformsignDocService.findByClientIdWithContractEndDates(
            tenant.branchId ?? "",
            parseInteger(clientId, "clientId", { min: 1 }),
        );
    }

    /** 원격 생성에는 성공했지만 로컬 저장에 실패한 문서를 현재 지점으로 복구한다. */
    @Post("adopt")
    async adopt(
        @CurrentTenant() tenant: EformsignProviderPrincipal,
        @Body() dto: AdoptEformsignDocDto,
    ) {
        assertEformsignProviderCapability(tenant, "contract.adopt");
        const result = await this.adoptEformsignDocUsecase.execute(tenant.branchId ?? "", dto, tenant);
        return {
            ...result.toJSON(),
            ...(result.warnings ? { warnings: result.warnings } : {}),
        };
    }

    /**
     * POST /eformsign-docs/dispatch-headless
     * Run the creation iframe gate sequence (mode:"01") off-screen via Playwright.
     * Returns { ok: false, fallbackHint: "iframe" } on any failure so the
     * frontend can fall back to the existing iframe modal automatically.
     */
    @Post("dispatch-headless")
    async dispatchHeadless(
        @CurrentTenant() tenant: EformsignProviderPrincipal,
        @Body() dto: DispatchHeadlessRequestDto,
    ): Promise<DispatchHeadlessResponseDto> {
        assertEformsignProviderCapability(tenant, "contract.dispatch");
        this.logger.log(`[POST /eformsign-docs/dispatch-headless] clientId=${dto.clientId}`);
        const result = await this.dispatchHeadlessUsecase.execute(
            tenant.branchId ?? "",
            {
                contractData: dto.contractData,
                clientId: dto.clientId,
                progressId: dto.progressId,
                force: dto.force,
            },
            tenant,
        );
        if (!result.ok) {
            this.logger.warn(`[dispatch-headless] failed: ${result.reason}`);
            return {
                ok: false,
                durationMs: result.durationMs,
                reason: result.reason,
                failedStep: result.failedStep,
                fallbackHint: result.fallbackHint,
                remoteDocumentId: result.remoteDocumentId,
                existingDocumentId: result.existingDocumentId,
                dispatchIntentId: result.dispatchIntentId,
                code: result.code,
                outcome: result.outcome,
                recovery: result.recovery,
            };
        }
        return {
            ok: true,
            documentId: result.documentId,
            durationMs: result.durationMs,
        };
    }

    /**
     * POST /eformsign-docs/finalize-headless
     * Run the staff-finalize iframe gate sequence (mode:"02") off-screen.
     */
    @Post("finalize-headless")
    async finalizeHeadless(
        @CurrentTenant() tenant: EformsignProviderPrincipal,
        @Body() dto: FinalizeHeadlessRequestDto,
    ): Promise<FinalizeHeadlessResponseDto> {
        assertEformsignProviderCapability(tenant, "contract.finalize");
        const visibleDocument = await this.eformsignDocService.findByDocumentId(
            tenant.branchId ?? "",
            dto.documentId,
        );
        if (!visibleDocument) {
            // Denied the same way for every cause — not this branch's, no such
            // row, or an unclaimed one headquarters can see in its list but
            // cannot finalize. The usecase's own assertOwnedTarget repeats this
            // exact branch-scoped lookup and fails closed identically, so the
            // boundary does not move; what changes is that the caller now gets
            // the finalize contract's refusal shape instead of a bare 403 it
            // could only render as "something went wrong".
            this.logger.warn(
                `[finalize-headless] denied: documentId=${dto.documentId} not visible to branch`,
            );
            return {
                ok: false,
                durationMs: 0,
                reason: "authorization_denied",
                fallbackHint: "manual_check",
                // BJJ-319 phase 5-4b additive fields for the same refusal the
                // usecase's assertOwnedTarget returns; the reason stays the
                // compatibility alias.
                code: "ACCESS_DENIED",
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            };
        }
        this.logger.log(`[POST /eformsign-docs/finalize-headless] documentId=${dto.documentId}`);
        const result = await this.finalizeHeadlessUsecase.execute(
            {
                branchId: tenant.branchId ?? "",
                documentId: dto.documentId,
                prefillEndDate: dto.prefillEndDate,
                progressId: dto.progressId,
            },
            tenant,
        );
        if (!result.ok) {
            this.logger.warn(
                `[finalize-headless] failed: ${result.reason} (fallback: ${result.fallbackHint})`,
            );
            return {
                ok: false,
                durationMs: result.durationMs,
                reason: result.reason,
                fallbackHint: result.fallbackHint,
                dispatchIntentId: result.dispatchIntentId,
                code: result.code,
                outcome: result.outcome,
                recovery: result.recovery,
            };
        }
        return {
            ok: true,
            completed: result.completed,
            durationMs: result.durationMs,
        };
    }

    /**
     * GET /eformsign-docs/dispatch-intents/:intentId
     * Read the branch-scoped receipt for an eformsign provider call. Started/
     * uncertain calls are never replayed automatically; an authorized operator
     * can use the companion reconciliation route below to unblock a retry.
     */
    @Get("dispatch-intents/:intentId")
    @UseGuards(BranchManagerGuard)
    async getDispatchIntent(
        @CurrentTenant() tenant: {
            branchId?: string;
            globalRole?: string;
            branchRole?: string;
        },
        @Param("intentId", new ParseUUIDPipe()) intentId: string,
    ): Promise<EformsignDispatchIntentResponseDto> {
        const isOperator = tenant.globalRole === "owner"
            || tenant.branchRole === "admin"
            || tenant.branchRole === "manager";
        if (!isOperator || !this.dispatchBoundary) {
            throw new ForbiddenException("전자문서 작업을 확인할 권한이 없습니다.");
        }
        const result = await this.dispatchBoundary.findById(
            tenant.branchId ?? "",
            intentId,
        );
        // Do not reveal whether an intent exists in another branch.
        if (!result) {
            throw new ForbiddenException("전자문서 작업을 확인할 권한이 없습니다.");
        }
        return {
            intentId: result.id,
            status: result.status,
            outcome: result.reconciledOutcome,
            providerDocumentId: result.providerDocumentId,
        };
    }

    @Post("dispatch-intents/:intentId/reconcile")
    @UseGuards(BranchManagerGuard)
    @HttpCode(HttpStatus.OK)
    async reconcileDispatchIntent(
        @CurrentTenant() tenant: {
            branchId?: string;
            userId?: string;
            globalRole?: string;
            branchRole?: string;
        },
        @Req() request: { user?: { userId?: string } },
        @Param("intentId", new ParseUUIDPipe()) intentId: string,
        @Body() dto: ReconcileEformsignDispatchIntentDto,
    ): Promise<EformsignDispatchIntentResponseDto> {
        const isOperator = tenant.globalRole === "owner"
            || tenant.branchRole === "admin"
            || tenant.branchRole === "manager";
        if (!isOperator || !this.dispatchBoundary) {
            throw new ForbiddenException("전자문서 작업을 확인할 권한이 없습니다.");
        }

        const result = await this.dispatchBoundary.reconcile({
            branchId: tenant.branchId ?? "",
            intentId: intentId.trim(),
            outcome: dto.outcome,
            actorUserId: tenant.userId ?? request.user?.userId ?? "",
            reason: dto.reason,
            providerDocumentId: dto.providerDocumentId?.trim() || undefined,
        });
        return {
            intentId: result.id,
            status: result.status,
            outcome: result.reconciledOutcome ?? dto.outcome,
            providerDocumentId: result.providerDocumentId,
        };
    }

    /**
     * POST /eformsign-docs/jobs/creation
     * Queue a durable document-creation operation. The branch and actor are
     * always taken from the authenticated tenant; neither is client supplied.
     */
    @Post("jobs/creation")
    @HttpCode(HttpStatus.ACCEPTED)
    async enqueueCreationJob(
        @CurrentTenant() tenant: EformsignProviderPrincipal,
        @Req() request: { user?: { userId?: string } },
        @Body() dto: CreateEformsignDocumentJobDto,
    ): Promise<EnqueueEformsignDocumentJobResponseDto> {
        assertEformsignProviderCapability(tenant, "contract.dispatch");
        this.assertDocumentJobsAccepting();
        if (dto.supersedeDocumentId !== undefined) {
            // A reissue cancels the named contract once the new one is sent, so the
            // caller must be allowed to see it. Never skip this check.
            const visible = this.contractSupersedeService
                ? await this.contractSupersedeService.isDocumentVisibleToBranch(
                    tenant.branchId ?? "",
                    dto.supersedeDocumentId,
                )
                : false;
            if (!visible) throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }
        const result = await this.enqueueDocumentJob(() =>
            this.documentJobService.enqueueCreateDocument({
                branchId: tenant.branchId ?? "",
                createdByUserId: tenant.userId ?? request.user?.userId,
                requestKey: dto.requestKey,
                clientId: dto.clientId,
                contractData: dto.contractData,
                ...(dto.supersedeDocumentId !== undefined
                    ? { supersedeDocumentId: dto.supersedeDocumentId }
                    : {}),
            }),
        );
        return {
            jobId: result.job.id,
            status: result.job.status,
            existing: result.existing,
        };
    }

    /**
     * POST /eformsign-docs/jobs/finalization
     * Queue a durable document-finalization operation for the current staff
     * actor. Auto-finalization uses the worker-facing service directly.
     */
    @Post("jobs/finalization")
    @HttpCode(HttpStatus.ACCEPTED)
    async enqueueFinalizationJob(
        @CurrentTenant() tenant: EformsignProviderPrincipal,
        @Req() request: { user?: { userId?: string } },
        @Body() dto: FinalizeEformsignDocumentJobDto,
    ): Promise<EnqueueEformsignDocumentJobResponseDto> {
        assertEformsignProviderCapability(tenant, "contract.finalize");
        this.assertDocumentJobsAccepting();
        const result = await this.enqueueDocumentJob(() =>
            this.documentJobService.enqueueFinalizeDocument({
                branchId: tenant.branchId ?? "",
                createdByUserId: tenant.userId ?? request.user?.userId,
                requestKey: dto.requestKey,
                documentId: dto.documentId,
                prefillEndDate: dto.prefillEndDate,
                source: "staff",
            }),
        );
        return {
            jobId: result.job.id,
            status: result.job.status,
            existing: result.existing,
        };
    }

    /** GET /eformsign-docs/jobs/summary */
    @Get("jobs/summary")
    async getDocumentJobSummary(
        @CurrentTenant() tenant: { branchId?: string },
    ): Promise<EformsignDocumentJobSummaryResponseDto> {
        const summary = await this.documentJobService.getSummary(tenant.branchId ?? "");
        return {
            activeCount: summary.activeCount,
            requiresAttentionCount: summary.requiresAttentionCount,
            failedCount: summary.failedCount,
            unresolvedCount: summary.unresolvedCount,
            unresolvedJobIds: summary.unresolvedJobIds,
        };
    }

    /**
     * GET /eformsign-docs/jobs
     * Return all active/attention jobs and at most the last 24 hours of
     * terminal jobs for the authenticated branch.
     */
    @Get("jobs")
    async listDocumentJobs(
        @CurrentTenant() tenant: { branchId?: string },
    ): Promise<EformsignDocumentJobListResponseDto> {
        const terminalSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const result = await this.documentJobService.listForBranch(
            tenant.branchId ?? "",
            terminalSince,
            50,
        );
        return {
            active: result.active.map(toEformsignDocumentJobResponse),
            requiresAttention: result.requiresAttention.map(toEformsignDocumentJobResponse),
            recent: result.recent.map(toEformsignDocumentJobResponse),
        };
    }

    /**
     * POST /eformsign-docs/jobs/:jobId/recovery
     * Take the 10-minute manual-recovery claim on a failed / requires_attention
     * contract job. Works even when new enqueues are paused.
     */
    @Post("jobs/:jobId/recovery")
    @HttpCode(HttpStatus.OK)
    async claimDocumentJobRecovery(
        @CurrentTenant() tenant: EformsignProviderPrincipal,
        @Req() request: { user?: { userId?: string } },
        @Param("jobId", new ParseUUIDPipe()) jobId: string,
    ): Promise<EformsignDocumentJobRecoveryResponseDto> {
        assertEformsignProviderCapability(tenant, "contract.dispatch");
        const result = await this.runManualRecovery(tenant, request, (input) =>
            this.documentJobService.claimRecovery(input), jobId);
        if (result.kind !== "claimed") return this.throwRecoveryRejection(result);
        const claim = parseManualClaim(result.job.progressStep);
        const claimExpiresAt = claim ? new Date(claim.expiresAtMs).toISOString() : null;
        const recoveryKind = classifyRecovery(result.job);
        if (recoveryKind === "manual_send" && !result.job.payload) {
            // The claim stays so the same user can still resolve the job by hand.
            throw new GoneException({ code: "RECOVERY_PAYLOAD_EXPIRED", claimExpiresAt });
        }
        return {
            job: toEformsignDocumentJobResponse(result.job),
            recoveryKind,
            // A verify_result job may already have been sent, so it never gets a prefilled resend.
            payload: recoveryKind === "manual_send" ? result.job.payload : null,
            claimExpiresAt,
        };
    }

    /**
     * POST /eformsign-docs/jobs/:jobId/resolve
     * Record that staff finished a stuck contract job by hand. Idempotent.
     */
    @Post("jobs/:jobId/resolve")
    @HttpCode(HttpStatus.OK)
    async resolveDocumentJob(
        @CurrentTenant() tenant: EformsignProviderPrincipal,
        @Req() request: { user?: { userId?: string } },
        @Param("jobId", new ParseUUIDPipe()) jobId: string,
    ): Promise<EformsignDocumentJobResolveResponseDto> {
        assertEformsignProviderCapability(tenant, "contract.dispatch");
        const result = await this.runManualRecovery(tenant, request, (input) =>
            this.documentJobService.resolveManually(input), jobId);
        if (result.kind !== "resolved" && result.kind !== "already_resolved") {
            return this.throwRecoveryRejection(result);
        }
        return {
            job: toEformsignDocumentJobResponse(result.job),
            alreadyResolved: result.kind === "already_resolved",
        };
    }

    private async runManualRecovery<T>(
        tenant: EformsignProviderPrincipal,
        request: { user?: { userId?: string } },
        operation: (input: { jobId: string; branchId: string; userId: string; now: Date }) => Promise<T>,
        jobId: string,
    ): Promise<T> {
        const userId = tenant.userId ?? request.user?.userId;
        if (!userId) throw new UnauthorizedException(codeOnlyProblemBody("AUTH_REQUIRED"));
        try {
            return await operation({ jobId, branchId: tenant.branchId ?? "", userId, now: new Date() });
        } catch (error) {
            if (error instanceof Error && error.message === "INVALID_MANUAL_CLAIM_USER") {
                throw new UnauthorizedException(codeOnlyProblemBody("AUTH_REQUIRED"));
            }
            throw error;
        }
    }

    private throwRecoveryRejection(result: RecoveryRejection): never {
        switch (result.kind) {
            case "not_found":
                throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            case "claimed_by_other":
                throw new ConflictException({
                    code: "MANUAL_RECOVERY_CLAIMED",
                    expiresAt: result.expiresAt.toISOString(),
                });
            case "invalid_state":
                throw new ConflictException({ code: "JOB_NOT_RECOVERABLE", status: result.status });
        }
    }

    private assertDocumentJobsAccepting(): void {
        if (
            this.configService
                .get<string>("EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED")
                ?.trim()
                .toLowerCase() !== "true"
        ) {
            throw new ServiceUnavailableException("Eformsign document jobs are not accepting new work");
        }
    }

    private async enqueueDocumentJob<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            if (
                error instanceof Error
                && error.message.startsWith("EFORMSIGN_DOCUMENT_JOB_")
            ) {
                throw new ConflictException("전자문서 작업 요청이 기존 작업과 충돌합니다.");
            }
            throw error;
        }
    }
}
