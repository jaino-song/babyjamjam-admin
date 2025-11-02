import { IUserRepository } from "domain/repositories/user.repository.interface";
import { UserEntity } from "domain/entities/user.entity";
export declare class CreateUserUsecase {
    private userRepository;
    constructor(userRepository: IUserRepository);
    execute(kakaoId: string, name?: string, email?: string, profileImage?: string): Promise<UserEntity>;
}
