import { IUserRepository } from "domain/repositories/user.repository.interface";
import { UserEntity } from "domain/entities/user.entity";
export type UpdateUserParams = {
    name?: string | null;
    email?: string | null;
    profileImage?: string | null;
    role?: string | null;
};
export declare class UpdateUserUsecase {
    private readonly userRepository;
    constructor(userRepository: IUserRepository);
    execute(id: string, updates: UpdateUserParams): Promise<UserEntity>;
}
