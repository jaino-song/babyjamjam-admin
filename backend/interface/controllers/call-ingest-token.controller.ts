import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    HttpCode,
    Param,
    Post,
    UseGuards,
} from "@nestjs/common";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { CreateCallIngestTokenDto } from "interface/dto/call-inbox.dto";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";

@Controller()
@UseGuards(JwtGuard, TenantGuard, BranchManagerGuard)
export class CallIngestTokenController {
    constructor(
        private readonly tokenService: CallIngestTokenService,
        private readonly tenantContext: TenantContext,
    ) {}

    @Post("branches/:branchId/call-ingest-tokens")
    async create(@Param("branchId") branchId: string, @Body() dto: CreateCallIngestTokenDto) {
        if (branchId !== this.tenantContext.branchId) {
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }
        return this.tokenService.createToken(branchId, dto.label);
    }

    @Get("branches/:branchId/call-ingest-tokens")
    async list(@Param("branchId") branchId: string) {
        if (branchId !== this.tenantContext.branchId) {
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }
        return this.tokenService.list(branchId);
    }

    @Post("call-ingest-tokens/:id/revoke")
    @HttpCode(200)
    async revoke(@Param("id") id: string) {
        await this.tokenService.revoke(id, this.tenantContext.branchId);
        return { success: true };
    }
}
