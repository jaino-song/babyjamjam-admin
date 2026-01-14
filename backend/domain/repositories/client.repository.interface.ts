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

    // Date-based queries for scheduler (P3)
    /**
     * Find clients whose service starts on a specific date
     * Used for contract reminders (3-day, 1-day before)
     */
    findByStartDate(date: Date): Promise<ClientEntity[]>;

    /**
     * Find clients whose service ends on a specific date
     * Used for survey requests
     */
    findByEndDate(date: Date): Promise<ClientEntity[]>;

    /**
     * Find clients created on a specific date (for payment reminders)
     * Used to send payment reminders X days after registration
     */
    findByCreatedDate(date: Date): Promise<ClientEntity[]>;
}

export const CLIENT_REPOSITORY = "CLIENT_REPOSITORY";
