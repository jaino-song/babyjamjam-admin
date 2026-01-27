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

    /**
     * Find clients whose service starts within the next N days (inclusive)
     * Used for daily summary notifications
     */
    findStartingWithinDays(days: number): Promise<ClientEntity[]>;

    /**
     * Find clients whose service ends within the next N days (inclusive)
     * Used for daily summary notifications
     */
    findEndingWithinDays(days: number): Promise<ClientEntity[]>;

    /**
     * Find clients with incomplete contracts (eformsign doc not completed)
     * whose service starts within the next N days
     */
    findWithIncompleteContractsStartingWithinDays(days: number): Promise<ClientEntity[]>;

    /**
     * Find clients without any contract sent (eDocId is null)
     * whose service starts within the next N days
     */
    findWithoutContractSentStartingWithinDays(days: number): Promise<ClientEntity[]>;
}

export const CLIENT_REPOSITORY = "CLIENT_REPOSITORY";
