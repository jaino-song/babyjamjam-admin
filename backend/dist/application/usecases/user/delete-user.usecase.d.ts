import { IUserRepository } from "domain/repositories/user.repository.interface";
export declare class DeleteUserUsecase {
    private readonly userRepository;
    constructor(userRepository: IUserRepository);
    execute(id: string): Promise<void>;
}
