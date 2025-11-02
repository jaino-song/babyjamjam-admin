import { ClientEntity } from "domain/entities/client.entity";
import { IClientRepository } from "domain/repositories/client.repository.interface";
export declare class ListClientsUsecase {
    private readonly clientRepository;
    constructor(clientRepository: IClientRepository);
    execute(): Promise<ClientEntity[]>;
}
