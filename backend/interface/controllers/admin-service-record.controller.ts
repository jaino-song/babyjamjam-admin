import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    MessageEvent,
    Optional,
    Param,
    ParseIntPipe,
    ParseUUIDPipe,
    Patch,
    PipeTransform,
    Post,
    Query,
    Sse,
    UseGuards,
} from "@nestjs/common";
import { Observable, filter, interval, map, merge } from "rxjs";
import {
    AdminServiceRecordService,
    ServiceRecordAdminActor,
} from "application/services/admin-service-record.service";
import { ConfirmInitialNoProviderDocumentBodyDto } from "interface/dto/eformsign-document-job.dto";
import { ServiceRecordInitialNoProviderDocumentService } from "infrastructure/eformsign/service-record-initial-no-provider-document.service";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { ServiceRecordCaseEventBus } from "application/services/service-record-case-event-bus.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { CurrentTenant, TenantGuard, VerifiedTenantPrincipal } from "infrastructure/tenant";
import { codeOnlyProblemException, problemBody } from "application/utils/problem-bodies";
import {
    KeepServiceRecordPeriodMismatchDto,
    FitServiceRecordPeriodMismatchDto,
    PrepareAdminServiceRecordLinkDto,
    SendAdminServiceRecordLinkDto,
} from "interface/dto/admin-service-record.dto";
import {
    ConfirmServiceRecordEditDraftDto,
    CreateServiceRecordEditDraftDto,
    DiscardServiceRecordEditDraftDto,
    PreviewServiceRecordEditDraftDto,
    RetryServiceRecordDocumentDto,
    UpdateServiceRecordEditDraftDto,
} from "interface/dto/admin-service-record-edit.dto";

/**
 * Admin service-record routes derive tenant and actor scope from the verified
 * request context. Reject every query key before a handler can observe it.
 */
export class AdminServiceRecordNoQueryPipe implements PipeTransform {
    transform(value: unknown): Record<string, never> {
        if (value === undefined) return {};
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/",
                code: "UNEXPECTED_FIELD",
                detail: "관리자 서비스 기록 API는 query parameter를 지원하지 않습니다.",
                location: "query",
            }));
        }
        if (Object.keys(value).length > 0) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/",
                code: "UNEXPECTED_FIELD",
                detail: "관리자 서비스 기록 API는 query parameter를 지원하지 않습니다.",
                location: "query",
            }));
        }
        return {};
    }
}

/** Selected routes accept exactly one UUID selector. Tenant authority still comes from the guard. */
class AdminServiceRecordCaseQueryPipe implements PipeTransform {
    transform(value: unknown): { caseId?: string } {
        if (!value || typeof value !== "object" || Array.isArray(value)
            || Object.keys(value).some((key) => key !== "caseId")) {
            return new AdminServiceRecordNoQueryPipe().transform(value);
        }
        if (!("caseId" in value)) return {};
        if (typeof value.caseId === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.caseId)) {
            return { caseId: value.caseId };
        }
        throw new BadRequestException(problemBody("VALIDATION_FAILED", {
            pointer: "/caseId",
            code: "INVALID_VALUE",
            detail: "제공기록지 선택에는 올바른 caseId만 사용할 수 있습니다.",
            location: "query",
        }));
    }
}

function caseArgument(query?: { caseId?: string }): [] | [string] {
    return query?.caseId ? [query.caseId] : [];
}

@Controller("admin/service-records")
@UseGuards(JwtGuard, TenantGuard)
export class AdminServiceRecordController {
    constructor(
        private readonly adminServiceRecordService: AdminServiceRecordService,
        private readonly adminServiceRecordEditService: AdminServiceRecordEditService,
        private readonly caseEventBus: ServiceRecordCaseEventBus,
        @Optional() private readonly initialNoProviderDocument?: ServiceRecordInitialNoProviderDocumentService,
    ) {}

    /**
     * GET /admin/service-records/events
     * Server-Sent Events stream telling open editors that a case in the caller's
     * branch changed. The branch is never sent to the client. A `ping` every 30s
     * keeps proxies and clients honest. Declared before the parameterised routes
     * so it can never be shadowed by them.
     */
    @Sse("events")
    @UseGuards(BranchManagerGuard)
    events(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ): Observable<MessageEvent> {
        const branchId = tenant.branchId ?? "";

        const changes = this.caseEventBus.events$.pipe(
            filter((event) => branchId !== "" && event.branchId === branchId),
            map((event) => ({
                type: "case-changed",
                data: {
                    clientId: event.clientId,
                    caseId: event.caseId,
                    caseVersion: event.caseVersion,
                },
            } as MessageEvent)),
        );

        const heartbeat = interval(30000).pipe(
            map(() => ({ type: "ping", data: { at: Date.now() } } as MessageEvent)),
        );

        return merge(changes, heartbeat);
    }

    @Get("client/:clientId")
    getClientOverview(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("clientId", ParseIntPipe) clientId: number,
        @Query(new AdminServiceRecordCaseQueryPipe()) query?: { caseId?: string },
    ) {
        return this.adminServiceRecordService.getClientOverview(tenant.branchId ?? "", clientId, ...caseArgument(query));
    }

    @Post("client/:clientId/period-mismatch/keep")
    @HttpCode(200)
    @UseGuards(BranchManagerGuard)
    keepPeriodMismatch(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Body() body: KeepServiceRecordPeriodMismatchDto,
        @Query(new AdminServiceRecordCaseQueryPipe()) query?: { caseId?: string },
    ) {
        return this.adminServiceRecordService.keepPeriodMismatch(tenant.branchId, clientId, body.sessionIndexes, ...caseArgument(query));
    }

    @Post("client/:clientId/period-mismatch/fit")
    @HttpCode(200)
    @UseGuards(BranchManagerGuard)
    fitPeriodMismatch(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Body() _body: FitServiceRecordPeriodMismatchDto,
        @Query(new AdminServiceRecordCaseQueryPipe()) query?: { caseId?: string },
    ) {
        void _body;
        return this.adminServiceRecordService.fitPeriodMismatch(tenant.branchId, clientId, ...caseArgument(query));
    }

    @Get("client/:clientId/editor")
    @UseGuards(BranchManagerGuard)
    getClientEditor(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Query(new AdminServiceRecordCaseQueryPipe()) query?: { caseId?: string },
    ) {
        return this.adminServiceRecordService.getClientEditor(tenant.branchId, clientId, ...caseArgument(query));
    }

    @Get("clients/:clientId/revisions")
    @UseGuards(BranchManagerGuard)
    getRevisionHistory(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Query(new AdminServiceRecordCaseQueryPipe()) query?: { caseId?: string },
    ) {
        return this.adminServiceRecordService.getRevisionHistory(tenant.branchId, clientId, ...caseArgument(query));
    }

    @Get("clients/:clientId/revisions/:revisionId/changes")
    @UseGuards(BranchManagerGuard)
    getRevisionChanges(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Param("revisionId") revisionId: string,
        @Query(new AdminServiceRecordCaseQueryPipe()) query?: { caseId?: string },
    ) {
        return this.adminServiceRecordService.getRevisionChanges(tenant.branchId, clientId, revisionId, ...caseArgument(query));
    }

    @Get("clients/:clientId/caregiver-edits/:editId/changes")
    @UseGuards(BranchManagerGuard)
    getCaregiverEditChanges(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Param("editId") editId: string,
        @Query(new AdminServiceRecordCaseQueryPipe()) query?: { caseId?: string },
    ) {
        return this.adminServiceRecordService.getCaregiverEditChanges(tenant.branchId, clientId, editId, ...caseArgument(query));
    }

    @Post("revisions/:revisionId/documents/:documentStateId/retry")
    @UseGuards(BranchManagerGuard)
    retryRevisionDocument(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("revisionId") revisionId: string,
        @Param("documentStateId") documentStateId: string,
        @Body() body: RetryServiceRecordDocumentDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordService.retryRevisionDocument(
            tenant.branchId,
            revisionId,
            documentStateId,
            body.expectedGeneration,
            tenant.userId,
        );
    }

    @Post("revisions/:revisionId/documents/:documentStateId/confirm-no-provider-document")
    @UseGuards(BranchManagerGuard)
    @HttpCode(HttpStatus.OK)
    confirmInitialNoProviderDocument(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("revisionId", new ParseUUIDPipe()) revisionId: string,
        @Param("documentStateId", new ParseUUIDPipe()) documentStateId: string,
        @Body() body: ConfirmInitialNoProviderDocumentBodyDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        void _query;
        if (!this.initialNoProviderDocument) throw codeOnlyProblemException("DEPENDENCY_UNAVAILABLE");
        return this.initialNoProviderDocument.confirmInitialNoProviderDocument({
            branchId: tenant.branchId, actorUserId: tenant.userId, revisionId, documentStateId,
            expectedGeneration: body.expectedGeneration,
        });
    }

    @Post("client/:clientId/draft")
    @UseGuards(BranchManagerGuard)
    startDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Body() body: CreateServiceRecordEditDraftDto,
        @Query(new AdminServiceRecordCaseQueryPipe()) query?: { caseId?: string },
    ) {
        return this.adminServiceRecordEditService.startDraft(tenant.branchId, clientId, tenant.userId, body, ...caseArgument(query));
    }

    @Get("client/:clientId/draft")
    @UseGuards(BranchManagerGuard)
    getDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Query(new AdminServiceRecordCaseQueryPipe()) query?: { caseId?: string },
    ) {
        return this.adminServiceRecordEditService.getDraft(tenant.branchId, clientId, ...caseArgument(query));
    }

    @Patch("drafts/:draftId")
    @UseGuards(BranchManagerGuard)
    updateDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("draftId") draftId: string,
        @Body() body: UpdateServiceRecordEditDraftDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordEditService.updateDraft(tenant.branchId, draftId, tenant.userId, body);
    }

    @Post("drafts/:draftId/discard")
    @UseGuards(BranchManagerGuard)
    discardDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("draftId") draftId: string,
        @Body() body: DiscardServiceRecordEditDraftDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordEditService.discardDraft(tenant.branchId, draftId, tenant.userId, body);
    }

    @Post("drafts/:draftId/preview")
    @UseGuards(BranchManagerGuard)
    previewDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("draftId") draftId: string,
        @Body() body: PreviewServiceRecordEditDraftDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordEditService.previewDraft(tenant.branchId, draftId, tenant.userId, body);
    }

    @Post("drafts/:draftId/confirm")
    @UseGuards(BranchManagerGuard)
    confirmDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("draftId") draftId: string,
        @Body() body: ConfirmServiceRecordEditDraftDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordEditService.confirmDraft(tenant.branchId, draftId, tenant.userId, body);
    }

    @Post("schedules/:scheduleId/prepare-link")
    prepareLink(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
        @Body() body: PrepareAdminServiceRecordLinkDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordService.prepareLink(
            tenant.branchId ?? "",
            scheduleId,
            body?.recipientPhone,
            ...caseArgument(body),
        );
    }

    @Post("schedules/:scheduleId/send-link")
    async sendLinkNow(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
        @Body() body: SendAdminServiceRecordLinkDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordService.sendLinkNow(
            tenant.branchId ?? "",
            scheduleId,
            body?.preparedLinkToken,
            body?.recipientPhone,
            ...caseArgument(body),
        );
    }

    @Post("schedules/:scheduleId/reset-link")
    @UseGuards(BranchManagerGuard)
    resetLink(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        const actor: ServiceRecordAdminActor = {
            userId: tenant.userId,
            globalRole: tenant.globalRole,
            branchRole: tenant.branchRole,
        };
        return this.adminServiceRecordService.resetLink(tenant.branchId, scheduleId, actor);
    }
}
