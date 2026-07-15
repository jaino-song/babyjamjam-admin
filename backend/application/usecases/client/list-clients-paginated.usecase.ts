import { Inject, Injectable } from "@nestjs/common";
import { CLIENT_REPOSITORY, IClientRepository, PaginatedResult } from "domain/repositories/client.repository.interface";
import { ClientEntity } from "domain/entities/client.entity";

@Injectable()
export class ListClientsPaginatedUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    execute(
        branchid: string,
        page: number,
        limit: number,
        search?: string
    ): Promise<PaginatedResult<ClientEntity>> {
        return this.clientRepository.findAllPaginated(branchid, page, limit, search);
    }
}
