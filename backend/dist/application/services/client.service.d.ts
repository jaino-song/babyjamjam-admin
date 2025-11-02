import { CreateClientUsecase, DeleteClientUsecase, FindClientByIdUsecase, ListClientsUsecase, UpdateClientUsecase } from "application/usecases/client";
import { ClientEntity } from "domain/entities/client.entity";
export declare class ClientService {
    private readonly createClientUsecase;
    private readonly findClientByIdUsecase;
    private readonly listClientsUsecase;
    private readonly updateClientUsecase;
    private readonly deleteClientUsecase;
    constructor(createClientUsecase: CreateClientUsecase, findClientByIdUsecase: FindClientByIdUsecase, listClientsUsecase: ListClientsUsecase, updateClientUsecase: UpdateClientUsecase, deleteClientUsecase: DeleteClientUsecase);
    create(params: {
        name: string;
        primaryEmployeeId: number;
        secondaryEmployeeId?: number | null;
        address?: string | null;
        phone?: string | null;
        type?: string | null;
        duration?: number | null;
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        careCenter: boolean;
        voucherClient: boolean;
    }): Promise<ClientEntity>;
    findAll(): Promise<ClientEntity[]>;
    findById(id: number): Promise<ClientEntity | null>;
    update(id: number, params: {
        name?: string;
        primaryEmployeeId?: number;
        secondaryEmployeeId?: number | null;
        address?: string | null;
        phone?: string | null;
        type?: string | null;
        duration?: number | null;
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        careCenter?: boolean;
        voucherClient?: boolean;
    }): Promise<ClientEntity>;
    delete(id: number): Promise<void>;
}
