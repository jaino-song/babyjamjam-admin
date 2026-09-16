import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";

import { AgentTaskService } from "application/agent/agent-task.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { AgentTaskCreateDto, AgentTaskPatchDto } from "interface/dto/agent-task.dto";

type AgentTaskRequest = Request & { tenant?: VerifiedTenantPrincipal };

@Controller("ai/agent/tasks")
@UseGuards(JwtGuard, TenantGuard)
export class AgentTaskController {
    constructor(private readonly tasks: AgentTaskService) {}

    @Post()
    create(
        @Body() dto: AgentTaskCreateDto,
        @Req() request: AgentTaskRequest,
        @Res({ passthrough: true }) response: Response,
    ) {
        response.setHeader("Cache-Control", "no-store");
        return this.tasks.create(this.principal(request), dto);
    }

    @Get(":id")
    get(
        @Param("id") id: string,
        @Req() request: AgentTaskRequest,
        @Res({ passthrough: true }) response: Response,
    ) {
        response.setHeader("Cache-Control", "no-store");
        return this.tasks.get(this.principal(request), id);
    }

    @Patch(":id")
    patch(
        @Param("id") id: string,
        @Body() dto: AgentTaskPatchDto,
        @Req() request: AgentTaskRequest,
        @Res({ passthrough: true }) response: Response,
    ) {
        response.setHeader("Cache-Control", "no-store");
        return this.tasks.patch(this.principal(request), id, dto);
    }

    private principal(request: AgentTaskRequest): VerifiedTenantPrincipal {
        if (!request.tenant?.userId || !request.tenant.branchId) {
            throw new ForbiddenException("Verified tenant principal missing");
        }
        return request.tenant;
    }
}
