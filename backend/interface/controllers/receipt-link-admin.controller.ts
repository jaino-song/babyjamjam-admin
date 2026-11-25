import { Body, Controller, ForbiddenException, Headers, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { StandaloneReceiptIssueService } from "application/services/standalone-receipt-issue.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard, type VerifiedTenantPrincipal } from "infrastructure/tenant";
import { ReceiptLinkManualSendService } from "application/services/receipt-link-manual-send.service";
import { PrepareReceiptLinkDto, SendReceiptLinkDto, StandaloneReceiptLinkDto } from "interface/dto/receipt-link.dto";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";

@Controller("receipt-links")
@UseGuards(JwtGuard, TenantGuard)
export class ReceiptLinkAdminController {
    constructor(
        private readonly manualSendService: ReceiptLinkManualSendService,
        private readonly standaloneIssue: StandaloneReceiptIssueService,
    ) {}

    @Post("standalone")
    @HttpCode(200)
    @UseGuards(BranchManagerGuard)
    async standalone(
        @Body() dto: StandaloneReceiptLinkDto,
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Headers("x-expected-branch-id") expectedBranchId?: string,
    ) {
        if (!tenant.branchId || !tenant.userId || (expectedBranchId !== undefined && expectedBranchId !== tenant.branchId)) {
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }
        return this.standaloneIssue.issue({
            branchId: tenant.branchId,
            userId: tenant.userId,
            clientId: dto.clientId,
            copaymentReceivedDate: dto.copaymentReceivedDate,
            requestId: dto.requestId,
        });
    }

    /** Staff action: queue a "서비스 종료 안내" SMS with a fresh receipt link for the document's client. */
    @Post("send")
    @HttpCode(200)
    async send(
        @Body() dto: SendReceiptLinkDto,
        @CurrentTenant() tenant: { branchId?: string },
        @Req() request: { user?: { userId?: string } },
    ) {
        if (!tenant.branchId) {
            throw new ForbiddenException({ ...codeOnlyProblemBody("ACCESS_DENIED"), reason: "branch_required" });
        }
        return this.manualSendService.send({
            branchId: tenant.branchId,
            documentId: dto.documentId,
            userId: request.user?.userId ?? null,
            ...(dto.clientId !== undefined ? { expectedClientId: dto.clientId } : {}),
            ...(dto.recipientPhone !== undefined ? { expectedRecipientPhone: dto.recipientPhone } : {}),
        });
    }

    /** Staff action: prepare the authoritative receipt URL and recipient identity without enqueueing a job. */
    @Post("prepare")
    @HttpCode(200)
    async prepare(
        @Body() dto: PrepareReceiptLinkDto,
        @CurrentTenant() tenant: { branchId?: string },
        @Req() request: { user?: { userId?: string } },
    ) {
        if (!tenant.branchId) {
            throw new ForbiddenException({ ...codeOnlyProblemBody("ACCESS_DENIED"), reason: "branch_required" });
        }
        return this.manualSendService.prepare({
            branchId: tenant.branchId,
            clientId: dto.clientId,
            userId: request.user?.userId ?? null,
        });
    }
}
