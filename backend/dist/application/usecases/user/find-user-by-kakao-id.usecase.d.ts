import { IUserRepository } from "domain/repositories/user.repository.interface";
import { UserEntity } from "domain/entities/user.entity";
export declare class FindUserByKakaoIdUsecase {
    private readonly userRepository;
    constructor(userRepository: IUserRepository);
    execute(kakaoId: string): Promise<UserEntity | null>;
}
