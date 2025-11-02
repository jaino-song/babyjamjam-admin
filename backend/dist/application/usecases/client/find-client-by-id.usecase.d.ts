import { ClientEntity } from "domain/entities/client.entity";
import { IClientRepository } from "domain/repositories/client.repository.interface";
export declare class FindClientByIdUsecase {
    private readonly clientRepository;
    constructor(clientRepository: IClientRepository);
    execute(id: number): Promise<ClientEntity | null>;
}
