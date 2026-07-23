import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";

import { SystemAdminService } from "application/services/system-admin.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import {
    CreateSystemAdminBranchDto,
    SystemAdminBranchRequestDto,
    UpdateSystemAdminBranchDto,
} from "interface/dto/system-admin.dto";

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
    ): Promise<SystemAdminBranchRequestDto> {
        return this.systemAdminService.createBranch(dto);
    }

    @Patch("branches/:branchId")
    updateBranch(
        @Param("branchId") branchId: string,
        @Body() dto: UpdateSystemAdminBranchDto,
    ): Promise<SystemAdminBranchRequestDto> {
        return this.systemAdminService.updateBranch(branchId, dto);
    }
}
