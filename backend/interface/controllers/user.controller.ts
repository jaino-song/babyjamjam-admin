import { Controller, Post, Body, Get, Query, Patch, Delete, Req, ForbiddenException } from "@nestjs/common";
import { UserService } from "application/services/user.service";
import { CreateUserDto, UpdateUserDto } from "../dto/user.dto";

type AuthenticatedRequest = { user?: { userId: string; role: string } };

@Controller("users")
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Post()
    create(@Body() createUserDto: CreateUserDto, @Req() req: AuthenticatedRequest) {
        if (req.user?.role !== "owner") {
            throw new ForbiddenException();
        }
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
    update(@Query("id") id: string, @Body() updateUserDto: UpdateUserDto, @Req() req: AuthenticatedRequest) {
        if (req.user?.role !== "owner") {
            throw new ForbiddenException();
        }
        return this.userService.update(id, {
            name: updateUserDto.name ?? undefined,
            email: updateUserDto.email ?? undefined,
            profileImage: updateUserDto.profileImage ?? undefined,
            role: updateUserDto.role,
        });
    }

    @Delete()
    delete(@Query("id") id: string, @Req() req: AuthenticatedRequest) {
        if (req.user?.role !== "owner") {
            throw new ForbiddenException();
        }
        return this.userService.delete(id);
    }
}
