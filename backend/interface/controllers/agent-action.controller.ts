import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";

import { ActionCoordinatorService } from "application/agent/action-coordinator.service";
import { AgentActionApproveDto, AgentActionRejectDto } from "interface/dto/agent.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";

type AgentActionRequest = Request & { tenant?: VerifiedTenantPrincipal };

@Controller("ai/actions")
@UseGuards(JwtGuard, TenantGuard)
export class AgentActionController {
    constructor(private readonly actions: ActionCoordinatorService) {}

    @Get()
    async list(@Req() request: AgentActionRequest) {
        return (await this.actions.list(this.owner(request))).map((action) => this.actions.publicAction(action));
    }

    @Get(":id")
    async get(@Param("id") id: string, @Req() request: AgentActionRequest) {
        return this.actions.publicAction(await this.actions.get(id, this.owner(request)));
    }

    @Post(":id/approve")
    async approve(
        @Param("id") id: string,
        @Body() dto: AgentActionApproveDto,
        @Req() request: AgentActionRequest,
    ) {
        const result = await this.actions.approve(id, this.principal(request), dto.expectedRevision, dto.acknowledgementToken);
        return { ...result, action: this.actions.publicAction(result.action) };
    }

    @Post(":id/reject")
    async reject(
        @Param("id") id: string,
        @Body() dto: AgentActionRejectDto,
        @Req() request: AgentActionRequest,
    ) {
        return this.actions.publicAction(await this.actions.reject(id, this.principal(request), dto.reason));
    }

    @Post(":id/reconcile")
    async reconcile(
        @Param("id") id: string,
        @Req() request: AgentActionRequest,
    ) {
        return this.actions.publicAction(await this.actions.reconcile(id, this.principal(request)));
    }

    private owner(request: AgentActionRequest) {
        const principal = this.principal(request);
        return { userId: principal.userId, branchId: principal.branchId };
    }

    private principal(request: AgentActionRequest): VerifiedTenantPrincipal {
        if (!request.tenant?.userId || !request.tenant.branchId) {
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }
        return request.tenant;
    }
}
