import { IClientRepository } from "domain/repositories/client.repository.interface";
export declare class DeleteClientUsecase {
    private readonly clientRepository;
    constructor(clientRepository: IClientRepository);
    execute(id: number): Promise<void>;
}
