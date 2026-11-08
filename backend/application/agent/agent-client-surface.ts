import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";

export type AgentClientSurface = "mobile";
export type AgentPrincipal = VerifiedTenantPrincipal & { clientSurface?: AgentClientSurface };

type AgentHeaders = Record<string, string | string[] | undefined>;

export const MOBILE_EXCLUDED_CAPABILITIES: ReadonlySet<string> = new Set(["service-records.edit"]);

// Header names are case-insensitive; values must be exactly "mobile" (no trim or folding).
export function readAgentClientSurface(headers: AgentHeaders): AgentClientSurface | undefined {
    const value = Object.entries(headers).find(([name]) => name.toLowerCase() === "x-bjj-client")?.[1];
    return value === "mobile" ? "mobile" : undefined;
}

export function agentPrincipalForHeaders(principal: VerifiedTenantPrincipal, headers: AgentHeaders): AgentPrincipal {
    return { ...principal, clientSurface: readAgentClientSurface(headers) };
}
