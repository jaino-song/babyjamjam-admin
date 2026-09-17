import { api } from "@/lib/api/client";

/** Owner-only. Safe fields only — never the token hash or plaintext. */
export interface CallIngestToken {
    id: string;
    label: string;
    active: boolean;
    createdAt: string;
}

/**
 * The `token` plaintext is present only here, exactly once, at issuance.
 * Deliberately NOT an extension of CallIngestToken: the create response
 * returns only these four fields (see CallIngestTokenService.createToken), so
 * declaring `active`/`createdAt` here would promise values that arrive as
 * undefined at runtime with no type error.
 */
export interface CreatedCallIngestToken {
    id: string;
    branchId: string;
    label: string;
    token: string;
}

export const callIngestTokenApi = {
    list: async (branchId: string): Promise<CallIngestToken[]> => {
        const { data } = await api.get(`/branches/${branchId}/call-ingest-tokens`);
        return data;
    },
    create: async (branchId: string, label: string): Promise<CreatedCallIngestToken> => {
        const { data } = await api.post(`/branches/${branchId}/call-ingest-tokens`, { label });
        return data;
    },
    revoke: async (id: string): Promise<void> => {
        await api.post(`/call-ingest-tokens/${id}/revoke`);
    },
};
