import { Controller, Post, Body, Get, Query, Patch, Delete, Req, UseGuards, ForbiddenException } from "@nestjs/common";
import { UserService } from "application/services/user.service";
import { CreateUserDto, UpdateUserDto } from "../dto/user.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";

@Controller("users")
@UseGuards(JwtGuard, OwnerOrAdminGuard)
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Get()
    findDirectory(@Req() req: { user: { role: string; branchId?: string } }) {
        if (req.user.role !== "owner" && !req.user.branchId) {
            throw new ForbiddenException("Branch context is required");
        }

        const branchId = req.user.role === "owner" ? undefined : req.user.branchId;
        return this.userService.findDirectory({ branchId });
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
    update(@Query("id") id: string, @Body() updateUserDto: UpdateUserDto) {
        return this.userService.update(id, {
            name: updateUserDto.name ?? undefined,
            email: updateUserDto.email ?? undefined,
            profileImage: updateUserDto.profileImage ?? undefined,
            role: updateUserDto.role,
        });
    }

    @Delete()
    delete(@Query("id") id: string) {
        return this.userService.delete(id);
    }
}
