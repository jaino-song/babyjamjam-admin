import {
    BadRequestException,
    Body,
    CanActivate,
    Controller,
    ExecutionContext,
    HttpCode,
    Inject,
    Injectable,
    Param,
    Post,
    Query,
    Req,
    UnauthorizedException,
    UseGuards,
} from "@nestjs/common";
import type { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { CurrentTenant, TenantGuard, type VerifiedTenantPrincipal } from "infrastructure/tenant";
import { AdminServiceRecordNoQueryPipe } from "interface/controllers/admin-service-record.controller";
import { parseOwnerRecordJsonRequest, parseOwnerRecordJsonTarget } from "interface/dto/owner-record-json.dto";

const bearerJwt = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
export const OWNER_RECORD_JSON_JWT_DECODER = Symbol("OWNER_RECORD_JSON_JWT_DECODER");

@Injectable()
export class OwnerRecordJsonBearerGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();
        if (!bearerJwt.test(request.headers.authorization ?? "")) {
            throw new UnauthorizedException(codeOnlyProblemBody("AUTH_REQUIRED"));
        }
        return true;
    }
}

@Controller("admin/service-records")
@UseGuards(OwnerRecordJsonBearerGuard, JwtGuard, TenantGuard, OwnerGuard)
export class OwnerRecordJsonController {
    constructor(
        private readonly editor: AdminServiceRecordEditService,
        @Inject(OWNER_RECORD_JSON_JWT_DECODER)
        private readonly jwtDecoder: Pick<JwtService, "decode">,
    ) {}

    @Post("clients/:clientId/cases/:caseId/owner-json")
    @HttpCode(200)
    writeSessions(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Req() request: Request & { user: { sessionId: string } },
        @Param() params: unknown,
        @Body() raw: unknown,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        void _query;
        if (!request.is("application/json")) {
            throw new BadRequestException(codeOnlyProblemBody("VALIDATION_FAILED"));
        }
        // JwtGuard has already verified this exact bearer token. Read its
        // version claim so the repository can detect revocation while waiting.
        const token = request.headers.authorization?.match(bearerJwt)?.[1];
        const claims = token && this.jwtDecoder.decode<{ tokenVersion?: number }>(token);
        if (!claims || typeof claims.tokenVersion !== "number" || !Number.isSafeInteger(claims.tokenVersion)) {
            throw new UnauthorizedException(codeOnlyProblemBody("AUTH_REQUIRED"));
        }
        return this.editor.confirmOwnerRecordJson({
            branchId: tenant.branchId,
            userId: tenant.userId,
            sessionId: request.user.sessionId,
            tokenVersion: claims.tokenVersion,
        }, parseOwnerRecordJsonTarget(params), parseOwnerRecordJsonRequest(raw));
    }
}
