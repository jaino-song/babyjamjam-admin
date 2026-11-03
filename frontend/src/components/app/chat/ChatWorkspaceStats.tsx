"use client";

import { AlertTriangle, Send } from "lucide-react";
import { StatsBar } from "@/components/app/v3/StatsBar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useInitialUser } from "@/providers/UserProvider";
import { useActiveBranchId, isBranchContextAligned } from "@/features/system-templates/branch-context";
import { useClientListSummary } from "@/features/clients/hooks/use-clients";
import { useDashboardStats } from "@/hooks/useDashboardStats";

export function ChatWorkspaceStats({ "data-component": base }: { "data-component": string }) {
    const user = useInitialUser();
    const branchId = useActiveBranchId();
    const ready = user?.id != null && isBranchContextAligned(branchId);
    const contracts = useDashboardStats({ branchId, enabled: ready });
    const clients = useClientListSummary({ branchId: ready ? branchId : null });
    const errors = [
        { label: "계약서 필요", failed: ready && contracts.isError, retry: contracts.refetch, busy: contracts.isFetching },
        { label: "종료 예정 산모", failed: ready && clients.isError, retry: clients.refetch, busy: clients.isFetching },
    ];
    return (
        <div data-component={base} data-source-component="ChatWorkspaceStats" data-slot="chat-workspace-stats" className="max-h-[35%] shrink-0 overflow-y-auto">
            <StatsBar name={base} density="responsive-square" showDocumentJobs="always" items={[
                { icon: Send, label: "계약서 필요", value: ready && !contracts.isError ? contracts.data?.contractsNotSent ?? "—" : "—", counter: "건", colorIndex: 3, isLoading: ready && contracts.isPending },
                { icon: AlertTriangle, label: "종료 예정 산모", value: ready && !clients.isError ? clients.data?.serviceEnd.count ?? "—" : "—", counter: "명", colorIndex: 3, isLoading: ready && clients.isInitialLoading },
            ]} />
            {errors.map(({ label, failed, retry, busy }, index) => failed && <Alert key={label} data-component={`${base}_error-${index}`} variant="destructive" className="mt-2">
                <AlertTitle>{label} 현황을 불러오지 못했어요</AlertTitle>
                <AlertDescription><Button data-component={`${base}_error-${index}_retry`} variant="outline" size="sm" aria-label={`${label} 현황 다시 시도`} disabled={busy} onClick={() => void retry()}>다시 시도</Button></AlertDescription>
            </Alert>)}
        </div>
    );
}
