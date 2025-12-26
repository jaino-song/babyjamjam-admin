import { ClientEntity } from "domain/entities/client.entity";

export interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface IClientRepository {
    findById(id: number): Promise<ClientEntity | null>;
    findAll(): Promise<ClientEntity[]>;
    findAllPaginated(page: number, limit: number, search?: string): Promise<PaginatedResult<ClientEntity>>;
    create(client: ClientEntity): Promise<ClientEntity>;
    update(client: ClientEntity): Promise<ClientEntity>;
    delete(id: number): Promise<void>;
}

export const CLIENT_REPOSITORY = "CLIENT_REPOSITORY";
