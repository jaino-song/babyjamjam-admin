import { Inject, Injectable } from "@nestjs/common";
import { USER_REPOSITORY, IUserRepository } from "domain/repositories/user.repository.interface";
import { UserEntity } from "domain/entities/user.entity";

@Injectable()
export class FindUserByIdUsecase {
    constructor(
        @Inject(USER_REPOSITORY)
        private readonly userRepository: IUserRepository,
    ) {}

    execute(id: string, branchId?: string): Promise<UserEntity | null> {
        return branchId
            ? this.userRepository.findByIdInBranch(id, branchId)
            : this.userRepository.findById(id);
    }
}
