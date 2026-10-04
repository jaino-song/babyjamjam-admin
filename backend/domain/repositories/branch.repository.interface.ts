export interface IBranchRepository {
    findAll(): Promise<{ id: string; name: string }[]>;
    findAllActive(): Promise<{ id: string; name: string }[]>;
}

export const BRANCH_REPOSITORY = "BRANCH_REPOSITORY";
