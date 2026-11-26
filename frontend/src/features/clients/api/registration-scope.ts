export interface ClientRegistrationScope {
    branchId: string;
    userId: string;
}

export const REGISTRATION_BRANCH_HEADER = "x-client-registration-branch";
export const REGISTRATION_USER_HEADER = "x-client-registration-user";

export function registrationScopeHeaders({ branchId, userId }: ClientRegistrationScope): Record<string, string> {
    return { [REGISTRATION_BRANCH_HEADER]: branchId, [REGISTRATION_USER_HEADER]: userId };
}
