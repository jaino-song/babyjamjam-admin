import { IUserRepository } from "domain/repositories/user.repository.interface";
import { UserEntity } from "domain/entities/user.entity";
export declare class FindUserByIdUsecase {
    private readonly userRepository;
    constructor(userRepository: IUserRepository);
    execute(id: string): Promise<UserEntity | null>;
}
