export interface IOrganizationRepository {
    findAllActive(): Promise<{ id: string; name: string }[]>;
}

export const ORGANIZATION_REPOSITORY = "ORGANIZATION_REPOSITORY";
