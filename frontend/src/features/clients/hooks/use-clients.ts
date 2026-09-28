'use client';

import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { messageTriggerKeys } from '@/features/message-triggers/hooks/keys';
import { serviceRecordKeys } from '@/features/service-records/hooks/keys';
import {
  getActiveBranchId,
  isBranchContextAligned,
  useActiveBranchId,
} from '@/features/system-templates/branch-context';
import {
  removeById,
  restoreQueries,
  snapshotAndTransformQueries,
  type QuerySnapshot,
} from '@/lib/query/optimistic-list-cache';

import { clientsApi } from '../api/clients.api';
import { clientKeys } from './keys';
import type {
  Client,
  CreateClientDto,
  UpdateClientDto,
  TerminateServiceDto,
  RequestReplacementDto,
  PaginatedResponse,
  ClientListSummary,
  ClientListTab,
} from '../types';

const CLIENT_DIRECTORY_PAGE_SIZE = 20;
const CLIENT_QUERY_STALE_TIME_MS = 1000 * 60 * 5;

export interface UseClientDirectoryOptions {
  /** The authorized branch captured by the caller; omitted uses the active branch cookie. */
  branchId?: string | null;
  search?: string;
  tab?: ClientListTab;
  limit?: number;
}

export interface UseClientsOptions {
  branchId?: string | null;
  tab?: ClientListTab;
}

export interface UseClientListSummaryOptions {
  /** The authorized branch captured by the caller; omitted uses the active branch cookie. */
  branchId?: string | null;
  search?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isClientRecord = (value: unknown): value is Client =>
  isRecord(value) && typeof value.id === 'number';

const isPaginatedClientResponse = (value: unknown): value is PaginatedResponse<Client> =>
  isRecord(value) && Array.isArray(value.data);

interface InfiniteClientPages {
  pages: PaginatedResponse<Client>[];
  pageParams: unknown[];
}

const isInfiniteClientPages = (value: unknown): value is InfiniteClientPages =>
  isRecord(value)
  && Array.isArray(value.pages)
  && value.pages.every(isPaginatedClientResponse);

function getClientQueryBranchId(queryKey: readonly unknown[]): string | undefined {
  if (queryKey[1] !== 'list') return undefined;

  if (queryKey[2] === 'all' && typeof queryKey[3] === 'string') {
    return queryKey[3];
  }

  const scopedFilters = queryKey[3];
  if (!isRecord(scopedFilters) || typeof scopedFilters.branchId !== 'string') {
    return undefined;
  }

  return scopedFilters.branchId;
}

function belongsToBranch(queryKey: readonly unknown[], branchId: string | null): boolean {
  return branchId !== null && getClientQueryBranchId(queryKey) === branchId;
}

const mergeUpdatedClient = (client: Client, updatedClient: Client): Client =>
  client.id === updatedClient.id ? { ...client, ...updatedClient } : client;

const mergeUpdatedClientList = (clients: Client[], updatedClient: Client): Client[] =>
  clients.map((client) => mergeUpdatedClient(client, updatedClient));

const updateClientCacheData = (currentData: unknown, updatedClient: Client): unknown => {
  if (!currentData) return currentData;

  if (Array.isArray(currentData)) {
    return mergeUpdatedClientList(currentData, updatedClient);
  }

  if (isInfiniteClientPages(currentData)) {
    return {
      ...currentData,
      pages: currentData.pages.map((page) => ({
        ...page,
        data: mergeUpdatedClientList(page.data, updatedClient),
      })),
    };
  }

  if (isPaginatedClientResponse(currentData)) {
    return {
      ...currentData,
      data: mergeUpdatedClientList(currentData.data, updatedClient),
    };
  }

  if (isClientRecord(currentData)) {
    return mergeUpdatedClient(currentData, updatedClient);
  }

  return currentData;
};

interface ScheduleChangeMutationVariables {
  requestId: string;
  clientId: number;
}

interface RejectScheduleChangeMutationVariables extends ScheduleChangeMutationVariables {
  reason?: string;
}

/**
 * Fetch paginated clients list
 */
export function useClients(
  page: number = 1,
  limit: number = 10,
  search?: string,
  options: UseClientsOptions = {},
) {
  const activeBranchId = useActiveBranchId();
  const branchId = options.branchId === undefined ? activeBranchId : options.branchId;
  const tab = options.tab;
  const branchContextReady = options.branchId === null
    ? false
    : branchId === null || isBranchContextAligned(branchId);

  return useQuery<PaginatedResponse<Client>>({
    queryKey: clientKeys.list({ page, limit, search, tab, branchId }),
    queryFn: async () => {
      if (branchId && !isBranchContextAligned(branchId)) {
        throw new Error('Branch selection required');
      }

      const response = await clientsApi.list({ page, limit, search, tab });
      return response.data;
    },
    enabled: branchContextReady,
    staleTime: CLIENT_QUERY_STALE_TIME_MS,
  });
}

/**
 * Fetch the branch-scoped client directory as a real server-paginated list.
 *
 * `matchedTotal` comes from the backend pagination envelope and is deliberately
 * kept separate from `clients.length`, which only represents loaded pages.
 */
export function useClientDirectory(options: UseClientDirectoryOptions = {}) {
  const activeBranchId = useActiveBranchId();
  const branchId = options.branchId === undefined ? activeBranchId : options.branchId;
  const search = options.search;
  const tab = options.tab ?? 'all';
  const limit = options.limit ?? CLIENT_DIRECTORY_PAGE_SIZE;
  const branchContextReady = isBranchContextAligned(branchId);

  const query = useInfiniteQuery<PaginatedResponse<Client>, Error>({
    queryKey: clientKeys.directory({ branchId, limit, search, tab }),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      if (!branchId || !isBranchContextAligned(branchId)) {
        throw new Error('Branch selection required');
      }

      const page = typeof pageParam === 'number' ? pageParam : Number(pageParam);
      const response = await clientsApi.list({
        page,
        limit,
        search,
        tab,
      });
      return response.data;
    },
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    enabled: branchContextReady,
    staleTime: CLIENT_QUERY_STALE_TIME_MS,
  });

  const visibleData = branchContextReady ? query.data : undefined;
  const clients = visibleData?.pages.flatMap((page) => page.data) ?? [];
  const matchedTotal = visibleData?.pages[0]?.total ?? 0;
  const hasCachedPages = visibleData !== undefined;

  return {
    ...query,
    data: visibleData,
    clients,
    rows: clients,
    loadedRows: clients,
    loadedCount: clients.length,
    matchedTotal,
    matchedCount: matchedTotal,
    isInitialLoading: branchContextReady && query.isPending && !hasCachedPages,
    isSuccessfulEmpty: branchContextReady && query.isSuccess && clients.length === 0,
    isPopulated: branchContextReady && query.isSuccess && clients.length > 0,
    isInitialError: branchContextReady && query.isLoadingError,
    isRefreshError: branchContextReady && query.isRefetchError,
    isSameScopeRefreshError: branchContextReady && query.isRefetchError,
    hasStaleData: branchContextReady && query.isRefetchError && hasCachedPages,
    isNextPageError: branchContextReady && query.isFetchNextPageError,
    isNextPageFetchError: branchContextReady && query.isFetchNextPageError,
    isEndOfList: hasCachedPages && !query.hasNextPage && !query.isFetchNextPageError,
    isBranchContextReady: branchContextReady,
  };
}

/**
 * Fetch summary metrics independently from directory pages. The backend
 * computes every metric from the branch and search scope before tab counts,
 * so this hook never derives cards from loaded rows.
 */
export function useClientListSummary(options: UseClientListSummaryOptions = {}) {
  const activeBranchId = useActiveBranchId();
  const branchId = options.branchId === undefined ? activeBranchId : options.branchId;
  const branchContextReady = isBranchContextAligned(branchId);

  const query = useQuery<ClientListSummary>({
    queryKey: clientKeys.summary({ branchId, search: options.search }),
    queryFn: async () => {
      if (!branchId || !isBranchContextAligned(branchId)) {
        throw new Error('Branch selection required');
      }

      const response = await clientsApi.listSummary({ search: options.search });
      return response.data;
    },
    enabled: branchContextReady,
    staleTime: CLIENT_QUERY_STALE_TIME_MS,
  });

  const visibleData = branchContextReady ? query.data : undefined;

  return {
    ...query,
    data: visibleData,
    isInitialLoading: branchContextReady && query.isPending && visibleData === undefined,
    isSuccessfulEmpty: branchContextReady && query.isSuccess && visibleData?.total === 0,
    isPopulated: branchContextReady && query.isSuccess && visibleData !== undefined && visibleData.total > 0,
    isInitialError: branchContextReady && query.isLoadingError,
    isRefreshError: branchContextReady && query.isRefetchError,
    isSameScopeRefreshError: branchContextReady && query.isRefetchError,
    hasStaleData: branchContextReady && query.isRefetchError && visibleData !== undefined,
    isBranchContextReady: branchContextReady,
  };
}

/**
 * Fetch all clients (non-paginated, for dropdowns)
 */
export function useAllClients(options: { branchId?: string | null } = {}) {
  const activeBranchId = useActiveBranchId();
  const branchId = options.branchId === undefined ? activeBranchId : options.branchId;
  const branchContextReady = options.branchId === null
    ? false
    : branchId === null || isBranchContextAligned(branchId);

  return useQuery<Client[]>({
    queryKey: clientKeys.allClients(branchId),
    queryFn: async () => {
      if (branchId && !isBranchContextAligned(branchId)) {
        throw new Error('Branch selection required');
      }

      const response = await clientsApi.listAll();
      return response.data;
    },
    enabled: branchContextReady,
    staleTime: CLIENT_QUERY_STALE_TIME_MS,
  });
}

/**
 * Fetch single client by ID
 */
export function useClient(id: number) {
  const branchId = useActiveBranchId();
  const branchContextReady = isBranchContextAligned(branchId);
  const query = useQuery<Client>({
    queryKey: clientKeys.detail(id, branchId),
    queryFn: async () => {
      if (!branchId || !isBranchContextAligned(branchId)) {
        throw new Error('Branch selection required');
      }

      const response = await clientsApi.getById(id);
      return response.data;
    },
    enabled: id > 0 && branchContextReady,
  });

  return {
    ...query,
    data: branchContextReady ? query.data : undefined,
    isBranchContextReady: branchContextReady,
  };
}

/**
 * Create new client mutation
 */
export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateClientDto) => clientsApi.create(dto).then(r => r.data),
    onSuccess: async () => {
      // Invalidate all client queries to refresh lists
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
    },
  });
}

/**
 * Update existing client mutation
 */
export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: UpdateClientDto }) =>
      clientsApi.update(id, dto).then(r => r.data),
    onSuccess: async (updatedClient, { id }) => {
      const activeBranchId = getActiveBranchId();
      queryClient.setQueriesData(
        {
          queryKey: clientKeys.all,
          predicate: (query) => belongsToBranch(query.queryKey, activeBranchId),
        },
        (currentData) => updateClientCacheData(currentData, updatedClient)
      );
      queryClient.setQueryData(
        activeBranchId ? clientKeys.detail(id, activeBranchId) : clientKeys.detail(id),
        updatedClient,
      );

      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
      await queryClient.refetchQueries({
        queryKey: serviceRecordKeys.clientOverview(id),
      });
    },
  });
}

/**
 * Delete client mutation
 */
// Removes a client from a cached list, adjusting the count only when the client
// was actually present. Detail records and unknown shapes pass through unchanged.
const removeClientFromCacheData = (currentData: unknown, id: number): unknown => {
  if (!currentData) return currentData;

  if (Array.isArray(currentData)) {
    return removeById(currentData as Client[], id);
  }

  if (isInfiniteClientPages(currentData)) {
    const removedPageIndex = currentData.pages.findIndex((page) =>
      page.data.some((client) => client.id === id),
    );
    if (removedPageIndex === -1) return currentData;

    const total = Math.max(0, currentData.pages[removedPageIndex].total - 1);
    return {
      ...currentData,
      pages: currentData.pages.map((page, pageIndex) => ({
        ...page,
        data: pageIndex === removedPageIndex ? removeById(page.data, id) : page.data,
        total,
        totalPages: page.limit > 0 ? Math.ceil(total / page.limit) : page.totalPages,
      })),
    };
  }

  if (isPaginatedClientResponse(currentData)) {
    const data = removeById(currentData.data, id);
    if (data === currentData.data) return currentData;

    const total = Math.max(0, currentData.total - 1);
    return {
      ...currentData,
      data,
      total,
      totalPages:
        currentData.limit > 0 ? Math.ceil(total / currentData.limit) : currentData.totalPages,
    };
  }

  return currentData;
};

export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, number, { previous: QuerySnapshot }>({
    mutationFn: (id: number) => clientsApi.delete(id),
    onMutate: async (id) => {
      const activeBranchId = getActiveBranchId();
      // Scoped to list representations so detail caches are left untouched.
      const previous = await snapshotAndTransformQueries(
        queryClient,
        {
          queryKey: clientKeys.all,
          predicate: (query) => belongsToBranch(query.queryKey, activeBranchId),
        },
        (current) => removeClientFromCacheData(current, id),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) restoreQueries(queryClient, context.previous);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
    },
  });
}

/**
 * Terminate service mutation
 * Sets serviceStatus to 'terminated'
 */
export function useTerminateService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto?: TerminateServiceDto }) =>
      clientsApi.terminateService(id, dto).then(r => r.data),
    onSuccess: async (_, { id }) => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
    },
  });
}

/**
 * Request replacement mutation
 * Sets serviceStatus to 'replacement_requested'
 */
export function useRequestReplacement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: RequestReplacementDto }) =>
      clientsApi.requestReplacement(id, dto).then(r => r.data),
    onSuccess: async (_, { id }) => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
    },
  });
}

/**
 * Complete replacement mutation
 * Resets serviceStatus to computed value based on dates
 */
export function useCompleteReplacement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      clientsApi.completeReplacement(id).then(r => r.data),
    onSuccess: async (_, id) => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
    },
  });
}

/**
 * Approve a pending schedule change request
 */
export function useApproveScheduleChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId }: ScheduleChangeMutationVariables) =>
      clientsApi.approveScheduleChange(requestId).then(r => r.data),
    onSuccess: async (_, { clientId }) => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
      await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
    },
  });
}

/**
 * Reject a pending schedule change request
 */
export function useRejectScheduleChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId, reason }: RejectScheduleChangeMutationVariables) =>
      clientsApi.rejectScheduleChange(requestId, reason).then(r => r.data),
    onSuccess: async (_, { clientId }) => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      await queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
    },
  });
}
