/** The stored facts about a document that decide whether it may be superseded. */
export interface SupersedeCandidateDocument {
    clientId: number | null;
    documentKind: string | null;
    statusType: string;
    stepType: string | null;
    stepName: string | null;
}

export interface IContractSupersedeRepository {
    /**
     * The stored document by its eformsign id, scoped to the branch that owns it.
     * Null when it is not stored locally or belongs to another branch.
     */
    findSupersedeCandidate(branchId: string, documentId: string): Promise<SupersedeCandidateDocument | null>;
}

export const CONTRACT_SUPERSEDE_REPOSITORY = Symbol("CONTRACT_SUPERSEDE_REPOSITORY");
