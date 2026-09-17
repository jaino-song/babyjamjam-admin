"use client";

import { getUserErrorMessage } from "@babyjamjam/shared";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { clientQueryKeys, fetchClient, useClient, useDeleteClient } from "@/hooks/useClients";
import { useEmployees } from "@/hooks/useEmployees";
import { useClientMessageHistory } from "@/hooks/useClientMessageHistory";
import { useLocale } from "@/providers/LocaleProvider";
import { eformsignApi } from "@/services/api";
import { todayIsoDate } from "@/lib/contracts/date-input";
import { getStatusCategory } from "@/lib/eformsign/status-codes";
import { t } from "@/lib/i18n/translations";
import { toast } from "@/hooks/use-toast";
import { useFormStore } from "@/stores/form-store";
import { MobileTwoButtonModal } from "@/components/app/ui/MobileTwoButtonModal";
import { Button } from "@/components/ui/button";
import type { Client } from "@/lib/client/types";
import type { EformsignDocument } from "@/lib/eformsign/types";
import {
  ClientDetailContent,
  type ClientNotificationLogRecord,
  type DetailTabId,
} from "./client-detail";

function documentStatusFromStatusType(statusType: string | null | undefined): Client["documentStatus"] {
  const normalized = statusType?.trim().padStart(3, "0");
  if (!normalized) return null;

  const category = getStatusCategory(normalized);
  if (category === "completed") return "completed";
  if (category === "expired") return "rejected";
  if (normalized === "020") return "opened";
  if (["001", "002", "010", "043"].includes(normalized)) return "created";
  if (["030", "060", "070"].includes(normalized)) return "requested";
  return null;
}

function contractPrefillDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  const dateOnlyMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnlyMatch) return dateOnlyMatch[1];

  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) {
    const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    const date = new Date(`${iso}T00:00:00`);
    if (!Number.isNaN(date.getTime())) return iso;
  }

  if (digits.length === 6) {
    const yy = Number(digits.slice(0, 2));
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    const iso = `${year}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
    const date = new Date(`${iso}T00:00:00`);
    if (!Number.isNaN(date.getTime())) return iso;
  }

  return undefined;
}

export interface UseClientDetailControllerOptions {
  client?: Client | null;
  clientId?: number | null;
  dataComponent: string;
  onClientUpdated?: (client: Client) => void;
  onClientDeleted?: (clientId: number) => void;
}

export interface ClientDetailControllerResult {
  detailClient: Client | null;
  detail: ReactNode;
  detailSheetTab: DetailTabId;
  setDetailSheetTab: (tab: DetailTabId) => void;
  isDetailRefreshing: boolean;
  detailRefreshError: boolean;
  retryDetail: () => void;
  deleteModal: ReactNode;
  deleteTargetClientId: number | null;
}

/**
 * Owns the client detail data and action workflow shared by the clients and
 * employee schedule screens. Callers only provide the selected row and mount
 * the returned detail node in their list-to-detail organism.
 */
export function useClientDetailController({
  client,
  clientId,
  dataComponent,
  onClientUpdated,
  onClientDeleted,
}: UseClientDetailControllerOptions): ClientDetailControllerResult {
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: employees = [] } = useEmployees();
  const prefillContractCreation = useFormStore((state) => state.prefillFromContract);
  const deleteClient = useDeleteClient();
  // A URL-selected client is authoritative while the detail request is in
  // flight. A selected row may seed the controller only when it represents
  // that same URL identity (or when no URL identity was provided).
  const resolvedClientId = clientId ?? client?.id ?? null;
  const resolvedClient = client && (clientId === null || clientId === undefined || client.id === clientId)
    ? client
    : null;
  const detailQuery = useClient(resolvedClientId ?? 0);
  const [detailClient, setDetailClient] = useState<Client | null>(resolvedClient);
  const [detailSheetTab, setDetailSheetTab] = useState<DetailTabId>(
    resolvedClient?.pendingScheduleChange ? "scheduleChange" : "basic",
  );
  const [isDetailRefreshing, setIsDetailRefreshing] = useState(false);
  const [detailRefreshError, setDetailRefreshError] = useState(false);
  const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);
  const onClientUpdatedRef = useRef(onClientUpdated);
  const onClientDeletedRef = useRef(onClientDeleted);
  const resolvedClientIdRef = useRef(resolvedClientId);
  const detailRequestRef = useRef(0);
  const previousDetailIdRef = useRef<number | null>(resolvedClientId);
  const initialDetailIdRef = useRef<number | null>(null);
  const deletedDetailIdRef = useRef<number | null>(null);

  useEffect(() => {
    onClientUpdatedRef.current = onClientUpdated;
  }, [onClientUpdated]);

  useEffect(() => {
    onClientDeletedRef.current = onClientDeleted;
  }, [onClientDeleted]);

  useEffect(() => {
    resolvedClientIdRef.current = resolvedClientId;
  }, [resolvedClientId]);

  useEffect(() => {
    if (previousDetailIdRef.current === resolvedClientId) return;
    previousDetailIdRef.current = resolvedClientId;
    detailRequestRef.current += 1;
    initialDetailIdRef.current = null;
    if (deletedDetailIdRef.current !== resolvedClientId) deletedDetailIdRef.current = null;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- selected-row or URL identity changes reset controller state. */
    setDetailClient(resolvedClient);
    setDetailSheetTab(resolvedClient?.pendingScheduleChange ? "scheduleChange" : "basic");
    setIsDetailRefreshing(false);
    setDetailRefreshError(false);
    setDeleteTargetClientId(null);
  }, [resolvedClient, resolvedClientId]);

  useEffect(() => {
    if (
      resolvedClient ||
      resolvedClientId === null ||
      deletedDetailIdRef.current === resolvedClientId ||
      !detailQuery.data ||
      detailQuery.data.id !== resolvedClientId ||
      detailClient
    ) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- query completion supplies the URL-selected client. */
    setDetailClient(detailQuery.data);
    setDetailSheetTab(detailQuery.data.pendingScheduleChange ? "scheduleChange" : "basic");
  }, [detailClient, detailQuery.data, resolvedClient, resolvedClientId]);

  const retryDetail = useCallback(() => {
    if (resolvedClientId === null || deletedDetailIdRef.current === resolvedClientId) return;

    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    const targetClientId = resolvedClientId;
    setIsDetailRefreshing(true);
    setDetailRefreshError(false);
    void queryClient.fetchQuery({
      queryKey: clientQueryKeys.detail(targetClientId),
      queryFn: () => fetchClient(targetClientId),
      staleTime: 0,
    }).then((freshClient) => {
      if (detailRequestRef.current !== requestId || resolvedClientIdRef.current !== targetClientId) return;
      setDetailClient(freshClient);
      onClientUpdatedRef.current?.(freshClient);
    }).catch(() => {
      if (detailRequestRef.current !== requestId || resolvedClientIdRef.current !== targetClientId) return;
      setDetailRefreshError(true);
    }).finally(() => {
      if (detailRequestRef.current !== requestId || resolvedClientIdRef.current !== targetClientId) return;
      setIsDetailRefreshing(false);
    });
  }, [queryClient, resolvedClientId]);

  useEffect(() => {
    if (resolvedClientId === null || initialDetailIdRef.current === resolvedClientId) return;
    initialDetailIdRef.current = resolvedClientId;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- this effect starts the explicit fresh-detail request. */
    retryDetail();
  }, [resolvedClientId, retryDetail]);

  const {
    notificationLogs: detailNotificationLogs,
    isLoading: isNotificationLogsLoading,
    isError: isNotificationLogsError,
    refetch: refetchNotificationLogs,
  } = useClientMessageHistory(detailClient);
  const { data: detailContractDocument } = useQuery<EformsignDocument>({
    queryKey: ["eformsign-docs", "document", detailClient?.eDocId],
    queryFn: async () => {
      if (!detailClient?.eDocId) throw new Error("documentId is required");
      return eformsignApi.getDocument(detailClient.eDocId);
    },
    enabled: Boolean(detailClient?.eDocId && (detailSheetTab === "basic" || detailSheetTab === "contracts")),
    staleTime: 1000 * 60,
    retry: 1,
  });

  const localDetailClient = useMemo(() => {
    if (!detailClient || detailClient.id !== resolvedClientId) {
      return null;
    }

    const documentStatus = documentStatusFromStatusType(detailContractDocument?.current_status?.status_type);
    if (!documentStatus || detailContractDocument?.id !== detailClient.eDocId) return detailClient;

    return {
      ...detailClient,
      documentStatus,
      hasSigned: documentStatus === "completed" ? true : detailClient.hasSigned,
    };
  }, [detailClient, detailContractDocument, resolvedClientId]);

  const handleClientUpdated = useCallback((updatedClient: Client) => {
    if (resolvedClientIdRef.current !== updatedClient.id) return;
    detailRequestRef.current += 1;
    setDetailClient(updatedClient);
    setIsDetailRefreshing(false);
    setDetailRefreshError(false);
    queryClient.setQueryData(clientQueryKeys.detail(updatedClient.id), updatedClient);
    void queryClient.invalidateQueries({ queryKey: clientQueryKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: clientQueryKeys.detail(updatedClient.id) });
    onClientUpdatedRef.current?.(updatedClient);
  }, [queryClient]);

  const handleEdit = useCallback((target: Client) => {
    router.push(`/clients/new?clientId=${target.id}`);
  }, [router]);

  const handleMessage = useCallback(() => {
    if (localDetailClient) router.push(`/messages/new?clientId=${localDetailClient.id}`);
  }, [localDetailClient, router]);

  const handleIssueContract = useCallback((target: Client) => {
    const primaryEmployee =
      employees.find((employee) => employee.id === target.primaryEmployee?.id) ??
      employees.find((employee) => employee.name.trim() === target.primaryEmployee?.name?.trim());

    prefillContractCreation({
      clientId: target.id,
      name: target.name,
      phone: target.phone ?? "",
      birthday: target.birthday ?? "",
      dueDate: contractPrefillDate(target.dueDate),
      address: target.address ?? "",
      employeeId: primaryEmployee?.id ?? target.primaryEmployee?.id ?? null,
      employeeName: primaryEmployee?.name ?? target.primaryEmployee?.name ?? "",
      employeePhone: primaryEmployee?.phone ?? "",
      startDate: contractPrefillDate(target.startDate),
      endDate: contractPrefillDate(target.endDate),
      fullPrice: target.fullPrice ?? "",
      grant: target.grant ?? "",
      actualPrice: target.actualPrice ?? "",
      paymentDate: todayIsoDate(),
      voucherType: target.type ?? "",
      voucherDuration: target.duration != null ? String(target.duration) : "",
      area: "",
    });
    router.push("/contracts/new");
  }, [employees, prefillContractCreation, router]);

  const handleDeleteConfirm = async () => {
    if (
      deleteTargetClientId == null ||
      deleteTargetClientId !== resolvedClientId ||
      deleteTargetClientId !== resolvedClientIdRef.current
    ) return;
    const targetClientId = deleteTargetClientId;

    try {
      await deleteClient.mutateAsync(targetClientId);
      const isCurrentDetail = resolvedClientIdRef.current === targetClientId;
      deletedDetailIdRef.current = targetClientId;
      queryClient.removeQueries({ queryKey: clientQueryKeys.detail(targetClientId) });
      if (isCurrentDetail) {
        detailRequestRef.current += 1;
        initialDetailIdRef.current = targetClientId;
        if (detailClient?.id === targetClientId) setDetailClient(null);
        setIsDetailRefreshing(false);
        setDetailRefreshError(false);
        setDeleteTargetClientId(null);
        onClientDeletedRef.current?.(targetClientId);
      }
      toast({
        variant: "success",
        title: t(locale, "clients.delete-success"),
        description: t(locale, "clients.delete-success-description"),
      });
    } catch {
      toast({
        title: t(locale, "clients.delete-fail"),
        description: getUserErrorMessage(t(locale, "clients.delete-fail-description")),
        variant: "destructive",
      });
    }
  };

  const detail = (
    <>
      {isDetailRefreshing ? (
        <div
          className="detail-empty-state"
          role="status"
          aria-label="고객 정보 새로고침 중"
          data-component={`${dataComponent}_fresh-loading`}
        >
          고객 정보를 불러오는 중입니다.
        </div>
      ) : null}
      {detailRefreshError ? (
        <div
          className="detail-empty-state"
          role="alert"
          data-component={`${dataComponent}_fresh-error`}
        >
          <p>고객 정보를 불러오지 못했습니다.</p>
          <Button
            type="button"
            variant="v3-outline"
            size="sm"
            onClick={retryDetail}
            data-component={`${dataComponent}_fresh-error_retry`}
          >
            다시 시도
          </Button>
        </div>
      ) : null}
      {localDetailClient ? (
        <ClientDetailContent
          data-component={dataComponent}
          client={localDetailClient}
          contractDocument={detailContractDocument ?? null}
          activeTab={detailSheetTab}
          notificationLogs={detailNotificationLogs as ClientNotificationLogRecord[]}
          isNotificationLogsLoading={isNotificationLogsLoading}
          isNotificationLogsError={isNotificationLogsError}
          onRetryNotificationLogs={() => {
            void refetchNotificationLogs();
          }}
          isIssuingContract={false}
          onTabChange={setDetailSheetTab}
          onMessage={handleMessage}
          onIssueContract={handleIssueContract}
          onEdit={handleEdit}
          onDelete={setDeleteTargetClientId}
          onClientUpdated={handleClientUpdated}
        />
      ) : null}
    </>
  );

  const deleteModal = (
    <MobileTwoButtonModal
      data-component={`${dataComponent}_delete-confirm-modal`}
      open={deleteTargetClientId != null && deleteTargetClientId === resolvedClientId}
      title={t(locale, "common.delete")}
      description={t(locale, "clients.delete-confirm")}
      cancelLabel={t(locale, "common.cancel")}
      confirmLabel={t(locale, "common.delete")}
      loading={deleteClient.isPending}
      onOpenChange={(open) => {
        if (!open && !deleteClient.isPending) setDeleteTargetClientId(null);
      }}
      onCancel={() => setDeleteTargetClientId(null)}
      onConfirm={handleDeleteConfirm}
    />
  );

  return {
    detailClient: localDetailClient,
    detail,
    detailSheetTab,
    setDetailSheetTab,
    isDetailRefreshing,
    detailRefreshError,
    retryDetail,
    deleteModal,
    deleteTargetClientId,
  };
}
