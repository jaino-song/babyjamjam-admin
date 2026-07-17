import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { ClientHasCompletedServiceRecordError } from "domain/errors/client-has-completed-service-record.error";

const COMPLETED_SERVICE_RECORD_MESSAGE =
    "완료된 제공기록지가 있는 고객은 삭제할 수 없습니다. 서비스 종료 처리를 이용해 주세요.";

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
            if (error instanceof ClientHasCompletedServiceRecordError) {
                throw new ConflictException(COMPLETED_SERVICE_RECORD_MESSAGE);
            }
            // Defense-in-depth: if some other FK still blocks the delete (e.g. a
            // race that slipped past the repository's own pre-check), surface it
            // as the same clear 409 instead of an unexplained 500.
            if (isForeignKeyViolation(error)) {
                throw new ConflictException(COMPLETED_SERVICE_RECORD_MESSAGE);
            }
            throw error;
        }
    }
}
