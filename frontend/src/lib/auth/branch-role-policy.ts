export interface BranchRoleUser {
  role?: string | null;
  branchRole?: string | null;
}

export interface BranchRoleAuthQuery {
  data?: BranchRoleUser | null;
  isPending?: boolean;
  isLoading?: boolean;
  isFetching?: boolean;
  isError?: boolean;
}

/**
 * Returns whether the active branch membership permits branch-management actions.
 *
 * Global owner authority is explicit. Every other role must come from the
 * authoritative selected-branch membership; the global role is never used as a
 * fallback when branchRole is missing.
 */
export function canManageBranch(user: BranchRoleUser | null | undefined): boolean {
  return user?.role === "owner"
    || user?.branchRole === "admin"
    || user?.branchRole === "manager";
}

export function canManageBranchFromAuthQuery(query: BranchRoleAuthQuery): boolean {
  return !query.isPending
    && !query.isLoading
    && !query.isFetching
    && !query.isError
    && canManageBranch(query.data);
}
