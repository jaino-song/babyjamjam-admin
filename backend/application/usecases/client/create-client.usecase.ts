import { Inject, Injectable } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

type CreateClientParams = {
    name: string;
    address: string | null;
    phone: string | null;
    type: string | null;
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    startDate: Date | null;
    endDate: Date | null;
    careCenter: boolean;
    voucherClient: boolean;
    birthday: string | null;
    dueDate: Date | null;
    serviceStatus: string | null;
    breastPump: boolean;
    eDocId?: string | null;
};

@Injectable()
export class CreateClientUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    execute(params: CreateClientParams): Promise<ClientEntity> {
        const client = ClientEntity.create({
            ...params,
            eDocId: params.eDocId ?? null,
        });
        return this.clientRepository.create(client);
    }
}
