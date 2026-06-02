import { jwtDecode } from "jwt-decode";

interface TokenPayload {
  role?: string | null;
  branchRole?: string | null;
}

const ADMIN_ROLES = new Set(["owner", "admin"]);

export function isAdminToken(token: string): boolean {
  try {
    const decoded = jwtDecode<TokenPayload>(token);
    return ADMIN_ROLES.has(decoded.role ?? "") || ADMIN_ROLES.has(decoded.branchRole ?? "");
  } catch {
    return false;
  }
}
