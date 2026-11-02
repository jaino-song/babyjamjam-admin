/** The stored facts about a document that decide whether it may be superseded. */
export interface SupersedeCandidateDocument {
    clientId: number | null;
    documentKind: string | null;
    statusType: string;
    stepType: string | null;
    stepName: string | null;
}

export interface IContractSupersedeRepository {
    /** The stored document by its eformsign id, or null when it is not stored locally. */
    findSupersedeCandidate(documentId: string): Promise<SupersedeCandidateDocument | null>;
    /** Whether the branch is the headquarters branch (the one that also sees unassigned documents). */
    isHeadquartersBranch(branchId: string): Promise<boolean>;
}

export const CONTRACT_SUPERSEDE_REPOSITORY = Symbol("CONTRACT_SUPERSEDE_REPOSITORY");
