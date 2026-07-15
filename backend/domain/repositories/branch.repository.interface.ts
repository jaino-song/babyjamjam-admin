export interface IBranchRepository {
    findAllActive(): Promise<{ id: string; name: string }[]>;
}

export const BRANCH_REPOSITORY = "BRANCH_REPOSITORY";
