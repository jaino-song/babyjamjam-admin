import { api } from '@/lib/api/client';
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

export interface ClientListParams {
  page?: number;
  limit?: number;
  search?: string;
  tab?: ClientListTab;
}

export interface ClientListSummaryParams {
  search?: string;
}

/**
 * Clients API functions
 * All API calls go through the Next.js /api proxy for CORS safety
 */
export const clientsApi = {
  /**
   * Fetch paginated clients list
   */
  list: (params?: ClientListParams) => {
    const searchParams = new URLSearchParams();
    if (params?.page !== undefined) searchParams.set('page', String(params.page));
    if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params?.search !== undefined) searchParams.set('search', params.search);
    if (params?.tab !== undefined) searchParams.set('tab', params.tab);

    return api.get<PaginatedResponse<Client>>(`/clients?${searchParams.toString()}`);
  },

  /**
   * Fetch branch- and search-scoped directory metrics.
   *
   * The backend owns search matching, so the text is forwarded verbatim.
   */
  listSummary: (params?: ClientListSummaryParams) => {
    const searchParams = new URLSearchParams();
    if (params?.search !== undefined) searchParams.set('search', params.search);

    const query = searchParams.toString();
    return api.get<ClientListSummary>(
      query ? `/clients/list-summary?${query}` : '/clients/list-summary',
    );
  },

  /**
   * Fetch all clients (non-paginated, for dropdowns)
   */
  listAll: () => api.get<Client[]>('/clients'),

  /**
   * Fetch single client by ID
   */
  getById: (id: number) => api.get<Client>(`/clients/${id}`),

  /**
   * Create new client
   */
  create: (data: CreateClientDto) => api.post<Client>('/clients', data),

  /**
   * Update existing client
   */
  update: (id: number, data: UpdateClientDto) => api.patch<Client>(`/clients/${id}`, data),

  /**
   * Delete client
   */
  delete: (id: number) => api.delete(`/clients/${id}`),

  /**
   * Terminate service for a client
   * Changes serviceStatus to 'terminated'
   */
  terminateService: (id: number, dto?: TerminateServiceDto) =>
    api.patch<Client>(`/clients/${id}/terminate`, dto ?? {}),

  /**
   * Request employee replacement for a client
   * Changes serviceStatus to 'replacement_requested'
   */
  requestReplacement: (id: number, dto: RequestReplacementDto) =>
    api.patch<Client>(`/clients/${id}/request-replacement`, dto),

  /**
   * Complete the employee replacement process
   * Changes serviceStatus back to 'active' (or computed status)
   */
  completeReplacement: (id: number) =>
    api.patch<Client>(`/clients/${id}/complete-replacement`, {}),

  /**
   * Approve a pending schedule change request
   */
  approveScheduleChange: (id: string) =>
    api.post<void>(`/schedule-change-requests/${id}/approve`, {}),

  /**
   * Reject a pending schedule change request
   */
  rejectScheduleChange: (id: string, reason?: string) =>
    api.post<void>(`/schedule-change-requests/${id}/reject`, { reason }),
};
