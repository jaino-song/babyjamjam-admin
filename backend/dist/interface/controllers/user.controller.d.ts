import { UserService } from "application/services/user.service";
import { CreateUserDto, UpdateUserDto } from "../dto/user.dto";
export declare class UserController {
    private readonly userService;
    constructor(userService: UserService);
    create(createUserDto: CreateUserDto): Promise<import("../../domain/entities/user.entity").UserEntity>;
    findById(id: string): Promise<import("../../domain/entities/user.entity").UserEntity>;
    findByKakaoId(kakaoId: string): Promise<import("../../domain/entities/user.entity").UserEntity>;
    update(id: string, updateUserDto: UpdateUserDto): Promise<import("../../domain/entities/user.entity").UserEntity>;
    delete(id: string): Promise<void>;
}
