"use client";

import { useQuery } from "@tanstack/react-query";

import { QueryErrorState } from "@/components/app/ui/QueryErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { clientsApi } from "@/features/clients/api/clients.api";
import { clientKeys } from "@/features/clients/hooks/keys";
import { employeesApi } from "@/features/employees/api/employees.api";
import { employeeKeys } from "@/features/employees/hooks/keys";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { formatKoreanPhoneNumber } from "@/lib/phone";

interface Props {
    "data-component": string;
    clientId?: number;
    employeeId?: number;
}

function isContact(value: unknown, id: number): value is { id: number; name: string; phone?: string | null } {
    return typeof value === "object" && value !== null
        && "id" in value && value.id === id
        && "name" in value && typeof value.name === "string";
}

export function AgentContactCard({ "data-component": dataComponent, clientId, employeeId }: Props) {
    const { data: authUser } = useGetAuthUser();
    const branchId = authUser?.branchId;
    const id = clientId ?? employeeId ?? 0;
    const enabled = Boolean(branchId) && Number.isSafeInteger(id) && id > 0;
    const query = useQuery<unknown>({
        queryKey: [...(clientId !== undefined ? clientKeys.detail(id) : employeeKeys.detail(id)), "agent-contact", branchId],
        queryFn: async () => {
            const response = clientId !== undefined
                ? await clientsApi.getById(id)
                : await employeesApi.getById(id);
            return response.data;
        },
        enabled,
    });

    if (!enabled) return null;
    const status = (query.error as { response?: { status?: number } } | null)?.response?.status;
    if (query.isError && (status === 403 || status === 404)) return null;
    const contact = isContact(query.data, id) ? query.data : null;
    if (!contact && !query.isError && query.isSuccess) return null;

    return (
        <div data-component={dataComponent} data-slot="agent-contact" className="text-sm">
            {contact ? (
                <p data-slot="contact-line">
                    <span data-slot="name">{contact.name}</span>{" · "}
                    <span data-slot="phone">{contact.phone && !/[•*]/.test(contact.phone) ? formatKoreanPhoneNumber(contact.phone) : "연락처 미등록"}</span>
                </p>
            ) : !query.isError ? (
                <Skeleton data-component={`${dataComponent}_loading`} data-slot="contact-loading" className="h-4 w-48" />
            ) : null}
            {query.isError && (
                <QueryErrorState
                    dataComponent={`${dataComponent}_error`}
                    size="inline"
                    title={contact ? "최신 정보를 불러오지 못했습니다" : "연락처를 불러오지 못했습니다"}
                    isRetrying={query.isFetching}
                    onRetry={() => { void query.refetch(); }}
                />
            )}
        </div>
    );
}
