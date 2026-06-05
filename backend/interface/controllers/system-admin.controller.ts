import { Controller, Get, UseGuards } from "@nestjs/common";

import { SystemAdminService } from "application/services/system-admin.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { SystemAdminBranchRequestDto } from "interface/dto/system-admin.dto";

@Controller("system-admin")
@UseGuards(JwtGuard, OwnerGuard)
export class SystemAdminController {
    constructor(private readonly systemAdminService: SystemAdminService) {}

    @Get("branch-requests")
    listBranchRequests(): Promise<SystemAdminBranchRequestDto[]> {
        return this.systemAdminService.listBranchRequests();
    }
}
