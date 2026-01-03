import { api } from '@/core/api/client';
import type {
  Client,
  CreateClientDto,
  UpdateClientDto,
  PaginatedResponse
} from '../types';

/**
 * Clients API functions
 * All API calls go through the Next.js /api proxy for CORS safety
 */
export const clientsApi = {
  /**
   * Fetch paginated clients list
   */
  list: (params?: { page?: number; limit?: number; search?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.search) searchParams.set('search', params.search);

    return api.get<PaginatedResponse<Client>>(`/clients?${searchParams.toString()}`);
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
};
