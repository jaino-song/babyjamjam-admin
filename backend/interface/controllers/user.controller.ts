import { Controller, Post, Body, Get, Query, Patch, Delete, Param, Req, UseGuards, ForbiddenException } from "@nestjs/common";
import { UserService } from "application/services/user.service";
import { CreateUserDto, UpdateUserDto, ApproveUserDto } from "../dto/user.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { OwnerOnlyGuard } from "infrastructure/auth/owner-only.guard";

type AuthenticatedRequest = { user: { userId: string; role: string; branchId?: string } };

@Controller("users")
@UseGuards(JwtGuard, OwnerOrAdminGuard)
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Get()
    findDirectory(
        @Req() req: { user: { role: string; branchId?: string } },
        @Query("status") status?: string,
    ) {
        if (req.user.role !== "owner" && !req.user.branchId) {
            throw new ForbiddenException("Branch context is required");
        }

        const branchId = req.user.role === "owner" ? undefined : req.user.branchId;
        return this.userService.findDirectory({ branchId, status });
    }

    @Post()
    create(@Body() createUserDto: CreateUserDto) {
        return this.userService.create(createUserDto);
    }

    @Get("kakao")
    findByKakaoId(@Query("kakaoId") kakaoId: string) {
        return this.userService.findByKakaoId(kakaoId);
    }

    @Get("id")
    findById(@Query("id") id: string) {
        return this.userService.findById(id);
    }
    
    @Patch()
    update(
        @Req() req: AuthenticatedRequest,
        @Query("id") id: string,
        @Body() updateUserDto: UpdateUserDto,
    ) {
        return this.userService.update(id, {
            name: updateUserDto.name ?? undefined,
            email: updateUserDto.email ?? undefined,
            profileImage: updateUserDto.profileImage ?? undefined,
            role: updateUserDto.role,
            callerRole: req.user.role,
        });
    }

    @Delete()
    delete(@Query("id") id: string) {
        return this.userService.delete(id);
    }

    @Post(":id/approve")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    approve(
        @Req() req: AuthenticatedRequest,
        @Param("id") id: string,
        @Body() approveUserDto: ApproveUserDto,
    ) {
        return this.userService.approve(id, {
            role: approveUserDto.role,
            branchId: approveUserDto.branchId,
            approvedBy: req.user.userId,
        });
    }

    @Post(":id/reject")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    reject(@Param("id") id: string) {
        return this.userService.reject(id);
    }
}
