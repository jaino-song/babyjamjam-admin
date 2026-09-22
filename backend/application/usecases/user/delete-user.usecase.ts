import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { IUserRepository, USER_REPOSITORY } from "domain/repositories/user.repository.interface";

@Injectable()
export class DeleteUserUsecase {
    constructor(
        @Inject(USER_REPOSITORY)
        private readonly userRepository: IUserRepository,
    ) {}

    async execute(id: string, branchId?: string): Promise<void> {
        if (branchId) {
            const deleted = await this.userRepository.deleteMembership(id, branchId);
            if (!deleted) {
                throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            }
            return;
        }
        await this.userRepository.delete(id);
    }
}
