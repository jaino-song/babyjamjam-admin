import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from "@nestjs/common";

import { SystemAdminService } from "application/services/system-admin.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import {
    CreateSystemAdminBranchDto,
    SystemAdminBranchRequestDto,
    UpdateSystemAdminBranchDto,
} from "interface/dto/system-admin.dto";
import { problemBody } from "application/utils/problem-bodies";
import { AdminAuditActor } from "application/services/admin-audit-event.service";
import { runWithAdminAuditActor } from "application/services/admin-audit-context";

@Controller("system-admin")
@UseGuards(JwtGuard, OwnerGuard)
export class SystemAdminController {
    constructor(private readonly systemAdminService: SystemAdminService) {}

    @Get("branch-requests")
    listBranchRequests(): Promise<SystemAdminBranchRequestDto[]> {
        return this.systemAdminService.listBranchRequests();
    }

    @Post("branches")
    createBranch(
        @Body() dto: CreateSystemAdminBranchDto,
        @Request() request: { user?: { userId?: string; role?: string; branchRole?: string } },
    ): Promise<SystemAdminBranchRequestDto> {
        const input = normalizeAdminIdAlias(dto);
        return runWithAdminAuditActor(actorFromRequest(request), () => this.systemAdminService.createBranch(input));
    }

    @Patch("branches/:branchId")
    updateBranch(
        @Param("branchId") branchId: string,
        @Body() dto: UpdateSystemAdminBranchDto,
        @Request() request: { user?: { userId?: string; role?: string; branchRole?: string } },
    ): Promise<SystemAdminBranchRequestDto> {
        const input = normalizeAdminIdAlias(dto);
        return runWithAdminAuditActor(actorFromRequest(request), () => this.systemAdminService.updateBranch(branchId, input));
    }
}

function actorFromRequest(request: { user?: { userId?: string; role?: string; branchRole?: string } }): AdminAuditActor {
    return {
        userId: request.user?.userId ?? null,
        globalRole: request.user?.role ?? null,
        branchRole: request.user?.branchRole ?? null,
    };
}

/**
 * Release-1 alias handling: `ownerId` is the deprecated spelling of `adminId`. Returns the
 * single effective value (an explicit `null` clears the 지점장 through either name), or
 * `{ conflict: true }` when both are sent and differ (the caller turns that into a 400).
 * Pure so it never throws on its own.
 */
export function resolveAdminIdAlias(
    dto: { adminId?: string | null; ownerId?: string | null },
): { value: string | null | undefined } | { conflict: true } {
    if (dto.adminId !== undefined && dto.ownerId !== undefined && dto.adminId !== dto.ownerId) {
        return { conflict: true };
    }
    return { value: dto.adminId !== undefined ? dto.adminId : dto.ownerId };
}

/** Services only ever see `adminId`: fold the deprecated alias in and drop it. */
function normalizeAdminIdAlias<T extends { adminId?: string | null; ownerId?: string | null }>(
    dto: T,
): Omit<T, "ownerId"> {
    const resolved = resolveAdminIdAlias(dto);
    if ("conflict" in resolved) {
        throw new BadRequestException(problemBody("VALIDATION_FAILED", {
            pointer: "/adminId",
            code: "INVALID_VALUE",
            detail: "adminId와 ownerId가 서로 달라요. adminId만 보내 주세요.",
        }));
    }
    const rest: Omit<T, "ownerId"> & { ownerId?: string | null } = { ...dto };
    delete rest.ownerId;
    return resolved.value === undefined ? rest : { ...rest, adminId: resolved.value };
}
