import { Controller, Post, Body, Get, Query, Patch, Delete } from "@nestjs/common";
import { UserService } from "application/services/user.service";
import { CreateUserDto, UpdateUserDto } from "../dto/user.dto";

@Controller("users")
export class UserController {
    constructor(private readonly userService: UserService) {}

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
        return this.userService.update(id, updateUserDto);
    }

    @Delete()
    delete(@Query("id") id: string) {
        return this.userService.delete(id);
    }
}