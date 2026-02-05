import { ClientEntity } from "domain/entities/client.entity";

export interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface IClientRepository {
    findById(organizationid: string, id: number): Promise<ClientEntity | null>;
    findAll(organizationid: string): Promise<ClientEntity[]>;
    findAllPaginated(
        organizationid: string,
        page: number,
        limit: number,
        search?: string
    ): Promise<PaginatedResult<ClientEntity>>;
    create(organizationid: string, client: ClientEntity): Promise<ClientEntity>;
    update(organizationid: string, client: ClientEntity): Promise<ClientEntity>;
    delete(organizationid: string, id: number): Promise<void>;

    // Date-based queries for scheduler (P3)
    /**
     * Find clients whose service starts on a specific date
     * Used for contract reminders (3-day, 1-day before)
     */
    findByStartDate(organizationid: string, date: Date): Promise<ClientEntity[]>;

    /**
     * Find clients whose service ends on a specific date
     * Used for survey requests
     */
    findByEndDate(organizationid: string, date: Date): Promise<ClientEntity[]>;

    /**
     * Find clients created on a specific date (for payment reminders)
     * Used to send payment reminders X days after registration
     */
    findByCreatedDate(organizationid: string, date: Date): Promise<ClientEntity[]>;

    /**
     * Find clients whose service starts within the next N days (inclusive)
     * Used for daily summary notifications
     */
    findStartingWithinDays(organizationid: string, days: number): Promise<ClientEntity[]>;

    /**
     * Find clients whose service ends within the next N days (inclusive)
     * Used for daily summary notifications
     */
    findEndingWithinDays(organizationid: string, days: number): Promise<ClientEntity[]>;

    /**
     * Find clients with incomplete contracts (eformsign doc not completed)
     * whose service starts within the next N days
     */
    findWithIncompleteContractsStartingWithinDays(
        organizationid: string,
        days: number
    ): Promise<ClientEntity[]>;

    /**
     * Find clients without any contract sent (eDocId is null)
     * whose service starts within the next N days
     */
    findWithoutContractSentStartingWithinDays(
        organizationid: string,
        days: number
    ): Promise<ClientEntity[]>;
}

export const CLIENT_REPOSITORY = "CLIENT_REPOSITORY";
