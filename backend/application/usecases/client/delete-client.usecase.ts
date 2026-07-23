import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

export const CLIENT_DELETE_CONFLICT_CODE = "CLIENT_DELETE_CONFLICT";
export const CLIENT_DELETE_CONFLICT_MESSAGE =
    "연결된 데이터로 인해 고객을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.";

function isForeignKeyViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

@Injectable()
export class DeleteClientUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async execute(branchid: string, id: number): Promise<void> {
        const client = await this.clientRepository.findById(branchid, id);
        if (!client) {
            throw new NotFoundException(`Client with id ${id} not found`);
        }

        try {
            await this.clientRepository.delete(branchid, id);
        } catch (error) {
            // Defense-in-depth for any relation not covered by the document-
            // preservation migration. The API route only exposes this coded,
            // allowlisted message and never forwards raw database details.
            if (isForeignKeyViolation(error)) {
                throw new ConflictException({
                    code: CLIENT_DELETE_CONFLICT_CODE,
                    message: CLIENT_DELETE_CONFLICT_MESSAGE,
                });
            }
            throw error;
        }
    }
}
