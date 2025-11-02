import { ClientEntity } from "domain/entities/client.entity";
import { IClientRepository } from "domain/repositories/client.repository.interface";
type CreateClientParams = {
    name: string;
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
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
};
export declare class CreateClientUsecase {
    private readonly clientRepository;
    constructor(clientRepository: IClientRepository);
    execute(params: CreateClientParams): Promise<ClientEntity>;
}
export {};
