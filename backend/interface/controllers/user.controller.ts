import {
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { UserService } from "application/services/user.service";
import {
    ApproveUserDto,
    CreateUserDto,
    UpdateUserAccountDto,
    UpdateUserDto,
    UpdateUserSmsAutomationDto,
} from "../dto/user.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { OwnerOnlyGuard } from "infrastructure/auth/owner-only.guard";
import { runWithAdminAuditActor } from "application/services/admin-audit-context";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { toPublicUser } from "interface/dto/public-user.mapper";

type AuthenticatedRequest = { user: { userId: string; role: string; branchId?: string; branchRole?: string } };

@Controller("users")
@UseGuards(JwtGuard, OwnerOrAdminGuard)
export class UserController {
    constructor(private readonly userService: UserService) {}

    private markLegacyUserApi(response: Response): void {
        response.setHeader("Deprecation", "true");
        response.setHeader("Sunset", "Fri, 16 Oct 2026 00:00:00 GMT");
        response.setHeader("Link", '</users/{userId}>; rel="successor-version"');
    }

    @Get()
    findDirectory(
        @Req() req: { user: { role: string; branchId?: string } },
        @Query("status") status?: string,
    ) {
        if (req.user.role !== "owner" && !req.user.branchId) {
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }

        // Owners manage every account from the system-admin console, so their directory
        // is never scoped to the branch they happen to have selected: an account that
        // lives in another branch would otherwise be invisible to them while still
        // blocking its phone number at sign-up (/auth/check-phone is global).
        return this.userService.findDirectory({
            branchId: req.user.role === "owner" ? undefined : req.user.branchId,
            includeUnassigned: req.user.role === "owner",
            callerRole: req.user.role,
            status,
        });
    }

    @Post()
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    async create(@Body() createUserDto: CreateUserDto) {
        return toPublicUser(await this.userService.create(createUserDto));
    }

    @Get("kakao")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    async findByKakaoId(@Query("kakaoId") kakaoId: string) {
        return toPublicUser(await this.userService.findByKakaoId(kakaoId));
    }

    @Get("id")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    async findById(
        @Query("id") id: string,
        @Res({ passthrough: true }) response: Response,
    ) {
        this.markLegacyUserApi(response);
        return toPublicUser(await this.userService.findById(id));
    }
    
    @Patch()
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    async update(
        @Req() req: AuthenticatedRequest,
        @Query("id") id: string,
        @Body() updateUserDto: UpdateUserDto,
        @Res({ passthrough: true }) response: Response,
    ) {
        this.markLegacyUserApi(response);
        return toPublicUser(await runWithAdminAuditActor({
            userId: req.user.userId,
            globalRole: req.user.role,
            branchRole: req.user.branchRole,
        }, () => this.userService.update(id, {
            name: updateUserDto.name ?? undefined,
            email: updateUserDto.email ?? undefined,
            profileImage: updateUserDto.profileImage ?? undefined,
            role: updateUserDto.role,
            callerRole: req.user.role,
        })));
    }

    @Delete()
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    delete(
        @Req() req: AuthenticatedRequest,
        @Query("id") id: string,
        @Res({ passthrough: true }) response: Response,
    ) {
        this.markLegacyUserApi(response);
        return runWithAdminAuditActor({
            userId: req.user.userId,
            globalRole: req.user.role,
            branchRole: req.user.branchRole,
        }, () => this.userService.delete(id));
    }

    @Get(":id")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    async findGlobalUserById(@Param("id") id: string) {
        return toPublicUser(await this.userService.findById(id));
    }

    @Patch(":id")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    async updateGlobalUser(
        @Req() req: AuthenticatedRequest,
        @Param("id") id: string,
        @Body() updateUserDto: UpdateUserDto,
    ) {
        return toPublicUser(await runWithAdminAuditActor({
            userId: req.user.userId,
            globalRole: req.user.role,
            branchRole: req.user.branchRole,
        }, () => this.userService.update(id, {
            name: updateUserDto.name ?? undefined,
            email: updateUserDto.email ?? undefined,
            profileImage: updateUserDto.profileImage ?? undefined,
            role: updateUserDto.role,
            callerRole: req.user.role,
        })));
    }

    @Patch(":id/account-assignment")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    updateGlobalUserAccountAssignment(
        @Req() req: AuthenticatedRequest,
        @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
        @Body() updateUserDto: UpdateUserAccountDto,
    ) {
        return runWithAdminAuditActor({
            userId: req.user.userId,
            globalRole: req.user.role,
            branchRole: req.user.branchRole,
        }, () => this.userService.updateAccountAssignment(id, {
            role: updateUserDto.role,
            branchIds: updateUserDto.branchIds,
            expectedRole: updateUserDto.expectedRole,
            expectedBranchIds: updateUserDto.expectedBranchIds,
            callerRole: req.user.role,
        }));
    }

    @Delete(":id")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    deleteGlobalUser(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
        return runWithAdminAuditActor({
            userId: req.user.userId,
            globalRole: req.user.role,
            branchRole: req.user.branchRole,
        }, () => this.userService.delete(id));
    }

    @Post(":id/approve")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    approve(
        @Req() req: AuthenticatedRequest,
        @Param("id") id: string,
        @Body() approveUserDto: ApproveUserDto,
    ) {
        return runWithAdminAuditActor({
            userId: req.user.userId,
            globalRole: req.user.role,
            branchRole: req.user.branchRole,
        }, () => this.userService.approve(id, {
            role: approveUserDto.role,
            branchId: approveUserDto.branchId,
            approvedBy: req.user.userId,
            ...(approveUserDto.ownerBranchId ? { ownerBranchId: approveUserDto.ownerBranchId } : {}),
            ...(approveUserDto.smsAutomationEnabled !== undefined
                ? { smsAutomationEnabled: approveUserDto.smsAutomationEnabled }
                : {}),
        }));
    }

    @Patch(":id/sms-automation")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    async updateSmsAutomation(
        @Req() req: AuthenticatedRequest,
        @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
        @Body() dto: UpdateUserSmsAutomationDto,
    ) {
        return toPublicUser(await runWithAdminAuditActor({
            userId: req.user.userId,
            globalRole: req.user.role,
            branchRole: req.user.branchRole,
        }, () => this.userService.setSmsAutomationEnabled(id, dto.enabled, req.user.userId)));
    }

    @Post(":id/reject")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    reject(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
        return runWithAdminAuditActor({
            userId: req.user.userId,
            globalRole: req.user.role,
            branchRole: req.user.branchRole,
        }, () => this.userService.reject(id));
    }
}
