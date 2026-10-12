"use client";

import { useQuery } from "@tanstack/react-query";
import { QueryErrorState } from "@/components/app/ui/QueryErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { clientsApi } from "@/features/clients/api/clients.api";
import { clientKeys } from "@/features/clients/hooks/keys";
import { employeesApi } from "@/features/employees/api/employees.api";
import { employeeKeys } from "@/features/employees/hooks/keys";
import { isBranchContextAligned, useActiveBranchId } from "@/features/system-templates/branch-context";
import { formatKoreanPhoneNumber } from "@/lib/phone";

type AgentContactCardProps = {
    "data-component": string;
    clientId?: number;
    employeeId?: number;
};

type ContactRecord = { id: number; name?: unknown; phone?: unknown };

// The chat message carries ids only. This card looks the contact up with the
// logged-in user's permissions; the backend answers an unknown or other-branch
// id with an empty 200 body, so only a record carrying the requested id counts.
function asContactRecord(data: unknown, id: number): ContactRecord | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return (data as { id?: unknown }).id === id ? (data as ContactRecord) : null;
}

function isNotFoundError(error: unknown): boolean {
    const status = (error as { response?: { status?: unknown } } | null | undefined)?.response?.status;
    return status === 404 || status === 403;
}

// A masked value ("••••1234") must never be shown as if it were the number.
function readablePhone(value: unknown): string {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed || /[•*]/.test(trimmed)) return "";
    return formatKoreanPhoneNumber(trimmed);
}

export function AgentContactCard({ "data-component": dataComponent, clientId, employeeId }: AgentContactCardProps) {
    const branchId = useActiveBranchId();
    const branchContextReady = isBranchContextAligned(branchId);
    const kind = clientId !== undefined ? "client" : employeeId !== undefined ? "employee" : null;
    const id = clientId ?? employeeId ?? 0;

    const query = useQuery<unknown>({
        queryKey: kind === "employee"
            ? [...employeeKeys.detail(id), "agent-contact", branchId]
            : [...clientKeys.detail(id, branchId), "agent-contact", branchId],
        queryFn: async () => {
            if (!branchId || !isBranchContextAligned(branchId)) {
                throw new Error("Branch selection required");
            }
            const response = kind === "employee" ? await employeesApi.getById(id) : await clientsApi.getById(id);
            return response.data;
        },
        enabled: kind !== null && id > 0 && branchContextReady,
    });

    if (kind === null || !branchContextReady) return null;

    if (query.isError && isNotFoundError(query.error)) return null;

    if (query.data !== undefined) {
        const record = asContactRecord(query.data, id);
        if (!record) return null;
        const name = typeof record.name === "string" ? record.name.trim() : "";
        const phone = readablePhone(record.phone);
        return (
            <div data-component={dataComponent} data-source-component="AgentContactCard" data-slot="contact" className="flex flex-col gap-1">
                <p data-component={`${dataComponent}_line`} data-slot="line" className="text-sm">
                    {name ? <span data-component={`${dataComponent}_line_name`} data-slot="name" className="font-medium">{name}</span> : null}
                    {name ? " · " : null}
                    <span data-component={`${dataComponent}_line_phone`} data-slot="phone">{phone || "연락처 미등록"}</span>
                </p>
                {query.isError ? (
                    <QueryErrorState
                        dataComponent={`${dataComponent}_stale`}
                        size="inline"
                        title="최신 정보를 불러오지 못했습니다"
                        onRetry={() => { void query.refetch(); }}
                        isRetrying={query.isFetching}
                    />
                ) : null}
            </div>
        );
    }

    if (query.isError) {
        return (
            <QueryErrorState
                dataComponent={`${dataComponent}_error`}
                size="inline"
                title="연락처를 불러오지 못했습니다"
                onRetry={() => { void query.refetch(); }}
            />
        );
    }

    return <Skeleton data-component={`${dataComponent}_loading`} aria-hidden="true" className="h-5 w-48" />;
}
