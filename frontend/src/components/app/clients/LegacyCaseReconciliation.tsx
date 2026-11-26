"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { normalizeApiError } from "@babyjamjam/shared";
import { serviceRecordCaseLabel } from "@babyjamjam/shared/constants/service-record-display";
import type { AdminServiceRecordCaseSummary, ServiceRecordOverview } from "@babyjamjam/shared/types/service-record";
import { useQueryClient } from "@tanstack/react-query";

import { FormField, FormNativeSelect } from "@/components/app/ui/form-section";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Client } from "@/features/clients/types";
import { useBabyRecordCapability } from "@/features/clients/hooks/use-baby-record-capability";
import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { useGetAuthUser, type AuthUser } from "@/hooks/useGetAuthUser";
import { canManageBranchFromAuthQuery } from "@/lib/auth/branch-role-policy";
import { AUTH_USER_QUERY_KEY } from "@/lib/auth/query-keys";

interface LegacyCaseReconciliationProps {
    "data-component": string;
    client: Client;
    record: AdminServiceRecordCaseSummary;
    householdCases: AdminServiceRecordCaseSummary[];
    detail?: ServiceRecordOverview;
    confirmed: boolean;
    canReconcileNow?: () => boolean;
    onRefresh?: (adoptedCaseId?: string) => void | Promise<void>;
}

export function LegacyCaseReconciliation(props: LegacyCaseReconciliationProps) {
    const auth = useGetAuthUser();
    const queryClient = useQueryClient();
    const hasAuthQuery = queryClient.getQueryState(AUTH_USER_QUERY_KEY) !== undefined;
    const hasManagerRole = canManageBranchFromAuthQuery(auth)
        && !auth.isPaused && !auth.isPlaceholderData && auth.data?.branchRole != null;
    const capability = useBabyRecordCapability(props.confirmed && hasManagerRole
        && props.record.babyId === null && !props.record.retired && props.record.submittedSessions > 0);
    const canManage = hasManagerRole
        && (auth.data?.branchId === undefined || auth.data.branchId === capability.branchId);

    const isEnabledNow = () => {
        if (!canManage || !capability.isEnabledNow()) return false;
        if (!hasAuthQuery) return true;
        // A branch or authority refresh can invalidate the query before React updates the form.
        const current = queryClient.getQueryState<AuthUser | null>(AUTH_USER_QUERY_KEY);
        return current?.status === "success" && current.fetchStatus === "idle"
            && !current.isInvalidated && current.data === auth.data;
    };

    return <LegacyCaseReconciliationForm
        key={JSON.stringify([capability.branchId, props.client.id, props.record.caseId])}
        {...props}
        enabled={Boolean(capability.branchId && capability.status === "enabled" && canManage)}
        isEnabledNow={isEnabledNow}
        retryCapability={capability.retry}
    />;
}

function LegacyCaseReconciliationForm({
    "data-component": base, client, record, householdCases, detail, confirmed, canReconcileNow,
    onRefresh, enabled, isEnabledNow, retryCapability,
}: LegacyCaseReconciliationProps & {
    enabled: boolean;
    isEnabledNow: () => boolean;
    retryCapability: () => unknown;
}) {
    const [babyId, setBabyId] = useState("");
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<"linked" | "conflict" | "error">();
    const inFlight = useRef(false);
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const detailCase = detail?.cases?.find(({ caseId }) => caseId === record.caseId);
    const canOffer = confirmed && enabled && client.fetalConfirmation === "CONFIRMED"
        && record.babyId === null && record.retired === false
        && record.submittedSessions > 0 && record.babyCount === client.babies?.length
        && record.babyCount === client.babyCount
        && (!detail?.record || detail.record.id === record.caseId)
        && (!detail?.cases || (detailCase?.babyId === null && detailCase.retired === false
            && detailCase.babyCount === record.babyCount && detailCase.submittedSessions > 0))
        && result !== "linked";
    const claimed = new Set([...householdCases, ...(detail?.cases ?? [])].map((item) => item.babyId));
    const employeeNames = new Map([
        ...householdCases.flatMap((item) => item.assignees),
        ...(detail?.assignments ?? []).map((assignment) => assignment.employee),
        client.primaryEmployee,
        client.secondaryEmployee,
    ].flatMap((employee) => employee?.name?.trim() ? [[employee.id, employee.name.trim()] as const] : []));
    const options = (client.babies ?? []).slice().sort((left, right) => left.ordinal - right.ordinal)
        .flatMap(({ babyId: id }, index) => {
            if (claimed.has(id)) return [];
            const slot = client.babyAssignments?.find((assignment) => assignment.babyId === id)?.providerSlot;
            const employeeId = client.providers?.find((provider) => provider.slot === slot)?.employeeId;
            const name = employeeId === undefined ? undefined : employeeNames.get(employeeId);
            const rank = serviceRecordCaseLabel({ rank: index + 1, legacyName: null });
            return [{ value: id, label: name ? `${rank} · ${name}` : rank }];
        });
    const selected = canOffer && options.some(({ value }) => value === babyId) ? babyId : "";

    useEffect(() => {
        if (!selected) setBabyId("");
    }, [selected]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!mounted.current || !selected || inFlight.current || !isEnabledNow() || canReconcileNow?.() === false) return;
        inFlight.current = true;
        setPending(true);
        setResult(undefined);
        setBabyId("");
        try {
            const { data } = await serviceRecordsApi.adoptLegacyCase(client.id, record.caseId, selected);
            if (!mounted.current) return;
            if (data?.caseId !== record.caseId || data.babyId !== selected) {
                setResult("error");
                await onRefresh?.();
                return;
            }
            setResult("linked");
            await onRefresh?.(record.caseId);
        } catch (error) {
            if (!mounted.current) return;
            const status = normalizeApiError(error).status;
            if (status === 409 || status === 404) {
                setResult("conflict");
                await Promise.allSettled([onRefresh?.(), retryCapability()]);
            } else {
                setResult("error");
            }
        } finally {
            inFlight.current = false;
            if (mounted.current) setPending(false);
        }
    };

    if ((!canOffer || !options.length) && !result && !pending) return null;

    return (
        <form data-component={base} data-slot="legacy-case-reconciliation"
            data-source-component="LegacyCaseReconciliation" className="space-y-2" onSubmit={submit}>
            {(canOffer && options.length > 0) || pending ? (
                <div className="flex flex-wrap items-end gap-2">
                    <FormField data-component={`${base}_baby`} label="연결할 아기"
                        labelAccessory={serviceRecordCaseLabel(record)} htmlFor={`${base}_baby-select`}>
                        <FormNativeSelect data-component={`${base}_baby_control`} id={`${base}_baby-select`}
                            value={selected} onValueChange={setBabyId} options={options}
                            placeholder="아기를 선택해 주세요" disabled={pending || !canOffer} />
                    </FormField>
                    <Button data-component={`${base}_submit`} data-slot="submit" type="submit"
                        disabled={!selected} loading={pending}>연결</Button>
                </div>
            ) : null}
            {result ? (
                <Alert data-component={`${base}_status`} data-slot="status" role="status">
                    <AlertDescription data-component={`${base}_status_description`}>
                        {result === "linked" ? "기존 제공기록지를 선택한 아기에 연결했어요."
                            : result === "conflict" ? "연결 대상이 변경되었어요. 최신 기록지와 아기를 확인해 주세요."
                            : "제공기록지를 연결하지 못했어요."}
                    </AlertDescription>
                </Alert>
            ) : null}
        </form>
    );
}
