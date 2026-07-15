# Frontend Feature Module Architecture Guide

This guide documents the standardized architecture for feature modules in the frontend application. Feature modules encapsulate related functionality (API calls, hooks, components, types) into self-contained, reusable units.

## Directory Structure

Every feature module follows this consistent structure:

```
frontend/src/features/{feature-name}/
├── api/
│   └── {feature}.api.ts          # API layer - HTTP calls
├── components/
│   ├── Component1.tsx
│   ├── Component2.tsx
│   └── ...
├── hooks/
│   ├── keys.ts                   # TanStack Query key factory
│   └── use-{feature}.ts          # Custom hooks (queries & mutations)
├── types/
│   └── index.ts                  # All TypeScript types & constants
└── index.ts                      # PUBLIC API - barrel export
```

### Directory Responsibilities

| Directory | Purpose |
|-----------|---------|
| `api/` | HTTP API calls using Axios. One file per feature. |
| `components/` | React components specific to this feature. |
| `hooks/` | Custom React hooks (TanStack Query hooks, utility hooks). |
| `types/` | TypeScript interfaces, DTOs, enums, constants. |
| `index.ts` | Public API - what consumers import from this feature. |

---

## Public API Pattern

The `index.ts` file is the **single entry point** for consuming this feature. It uses barrel exports to control what's publicly available.

### Example: `frontend/src/features/clients/index.ts`

```typescript
// Public API for clients feature module

// Types
export type {
    Client,
    CreateClientDto,
    UpdateClientDto,
    TerminateServiceDto,
    RequestReplacementDto,
    PaginatedResponse,
    EmployeeSummary,
    ServiceStatus,
    ContractStatus, // deprecated
} from './types';
export { SERVICE_STATUS_OPTIONS, CONTRACT_STATUS_OPTIONS } from './types';

// Hooks
export {
    useClients,
    useAllClients,
    useClient,
    useCreateClient,
    useUpdateClient,
    useDeleteClient,
    useTerminateService,
    useRequestReplacement,
    useCompleteReplacement,
} from './hooks/use-clients';
export { clientKeys } from './hooks/keys';

// Components
export { ClientsTable } from './components/ClientsTable';
export { ClientFormDialog } from './components/ClientFormDialog';
export { ClientDetailModal } from './components/ClientDetailModal';
export { EmployeeAutocomplete } from './components/EmployeeAutocomplete';
export { TerminateConfirmDialog } from './components/TerminateConfirmDialog';
export { ReplacementModal } from './components/ReplacementModal';

// API (for advanced usage)
export { clientsApi } from './api/clients.api';
```

### Public API Rules

1. **Export types** using `export type { ... }` (re-export from `./types`)
2. **Export constants** alongside types (e.g., `SERVICE_STATUS_OPTIONS`)
3. **Export hooks** from `./hooks/use-{feature}.ts`
4. **Export query keys** from `./hooks/keys.ts` (for cache invalidation)
5. **Export components** from `./components/`
6. **Export API** only for advanced usage (most consumers use hooks)
7. **Do NOT export** internal utilities, helpers, or implementation details

---

## API Layer Pattern

The API layer handles all HTTP communication. It's organized as an object with methods, each returning a Promise.

### Example: `frontend/src/features/clients/api/clients.api.ts`

```typescript
import { api } from '@/core/api/client';
import type {
  Client,
  CreateClientDto,
  UpdateClientDto,
  TerminateServiceDto,
  RequestReplacementDto,
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
  update: (id: number, data: UpdateClientDto) => 
    api.patch<Client>(`/clients/${id}`, data),

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
};
```

### API Layer Rules

1. **Export as a single object** named `{feature}Api` (e.g., `clientsApi`)
2. **Each method returns a Promise** from `api.get()`, `api.post()`, etc.
3. **Type all responses** with generic type parameter: `api.get<ResponseType>(...)`
4. **Document each method** with JSDoc comments
5. **Handle query parameters** using `URLSearchParams` for clean URLs
6. **No business logic** - only HTTP communication
7. **No error handling** - let hooks handle errors

---

## Types Layer Pattern

The types layer centralizes all TypeScript interfaces, DTOs, enums, and constants.

### Example: `frontend/src/features/clients/types/index.ts`

```typescript
// Employee summary for client responses
export interface EmployeeSummary {
    id: number;
    name: string;
}

// Document status type for eformsign documents
export type DocumentStatus = 'created' | 'opened' | 'completed' | 'requested' | 'rejected' | 'revoked' | 'deleted' | null;

// Client entity types
export interface Client {
    id: number;
    name: string;
    birthday: string | null;           // YYMMDD format
    dueDate: string | null;
    address: string | null;
    phone: string | null;
    primaryEmployee: EmployeeSummary | null;  // Primary employee info from active schedule
    secondaryEmployee: EmployeeSummary | null; // Secondary employee info from active schedule
    type: string | null;               // voucher type
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    startDate: string | null;
    endDate: string | null;
    careCenter: boolean;
    voucherClient: boolean;
    breastPump: boolean;
    serviceStatus: string | null;      // Renamed from contractStatus
    eDocId: string | null;
    hasSigned: boolean;
    documentStatus: DocumentStatus;    // eformsign document status: created/opened/completed
}

// Create client DTO - Frontend sends employeeId, backend converts to scheduleId
export interface CreateClientDto {
    name: string;
    birthday?: string | null;
    dueDate?: string | null;
    address?: string | null;
    phone?: string | null;
    primaryEmployeeId: number | null;  // Employee ID (backend converts to schedule)
    secondaryEmployeeId?: number | null; // Employee ID (backend converts to schedule)
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    careCenter: boolean;
    voucherClient: boolean;
    breastPump: boolean;
    serviceStatus?: string | null;
}

// Update client DTO - Frontend sends employeeId, backend converts to scheduleId
export interface UpdateClientDto {
    name?: string;
    birthday?: string | null;
    dueDate?: string | null;
    address?: string | null;
    phone?: string | null;
    primaryEmployeeId?: number | null;  // Employee ID (backend converts to schedule)
    secondaryEmployeeId?: number | null; // Employee ID (backend converts to schedule)
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    careCenter?: boolean;
    voucherClient?: boolean;
    breastPump?: boolean;
    serviceStatus?: string | null;
}

// DTO for terminating service
export interface TerminateServiceDto {
    reason?: string;
}

// DTO for requesting replacement
export interface RequestReplacementDto {
    newPrimaryEmployeeId: number;
    newSecondaryEmployeeId?: number | null;
}

// Paginated response
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Service status options (renamed from Contract status)
export const SERVICE_STATUS_OPTIONS = [
    { value: "waiting", label: "대기", labelEn: "Waiting", color: "warning" as const },
    { value: "active", label: "진행중", labelEn: "Active", color: "info" as const },
    { value: "completed", label: "완료", labelEn: "Completed", color: "success" as const },
    { value: "terminated", label: "중단", labelEn: "Terminated", color: "default" as const },
    { value: "replacement_requested", label: "교체 요청", labelEn: "Replacement Requested", color: "error" as const },
] as const;

export type ServiceStatus = typeof SERVICE_STATUS_OPTIONS[number]["value"];

// Legacy export for backwards compatibility (deprecated)
/** @deprecated Use SERVICE_STATUS_OPTIONS instead */
export const CONTRACT_STATUS_OPTIONS = SERVICE_STATUS_OPTIONS;
/** @deprecated Use ServiceStatus instead */
export type ContractStatus = ServiceStatus;
```

### Types Layer Rules

1. **Single file** - `types/index.ts` (not multiple files)
2. **Entity types** - Main domain models (e.g., `Client`)
3. **DTO types** - Data transfer objects for API (e.g., `CreateClientDto`, `UpdateClientDto`)
4. **Constants** - Enums, status options, lookup tables
5. **Helper types** - Pagination, responses, etc.
6. **Document with comments** - Especially for non-obvious fields
7. **Use `as const`** for option objects to preserve literal types

---

## Hooks Layer Pattern

Hooks encapsulate TanStack Query logic (queries and mutations) and provide a clean interface to components.

### Query Key Factory: `frontend/src/features/clients/hooks/keys.ts`

```typescript
/**
 * Query Key Factory for Clients
 * Centralizes all query keys for proper cache management
 */
export const clientKeys = {
  all: ['clients'] as const,
  lists: () => [...clientKeys.all, 'list'] as const,
  list: (filters: { page?: number; limit?: number; search?: string }) =>
    [...clientKeys.lists(), filters] as const,
  details: () => [...clientKeys.all, 'detail'] as const,
  detail: (id: number) => [...clientKeys.details(), id] as const,
};
```

### Custom Hooks: `frontend/src/features/clients/hooks/use-clients.ts`

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientsApi } from '../api/clients.api';
import { clientKeys } from './keys';
import type {
  Client,
  CreateClientDto,
  UpdateClientDto,
  TerminateServiceDto,
  RequestReplacementDto,
  PaginatedResponse
} from '../types';

/**
 * Fetch paginated clients list
 */
export function useClients(page: number = 1, limit: number = 10, search?: string) {
  return useQuery<PaginatedResponse<Client>>({
    queryKey: clientKeys.list({ page, limit, search }),
    queryFn: () => clientsApi.list({ page, limit, search }).then(r => r.data),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Fetch all clients (non-paginated, for dropdowns)
 */
export function useAllClients() {
  return useQuery<Client[]>({
    queryKey: clientKeys.all,
    queryFn: () => clientsApi.listAll().then(r => r.data),
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Fetch single client by ID
 */
export function useClient(id: number) {
  return useQuery<Client>({
    queryKey: clientKeys.detail(id),
    queryFn: () => clientsApi.getById(id).then(r => r.data),
    enabled: !!id,
  });
}

/**
 * Create new client mutation
 */
export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateClientDto) => clientsApi.create(data).then(r => r.data),
    onSuccess: () => {
      // Invalidate all client queries to refetch
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

/**
 * Update existing client mutation
 */
export function useUpdateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateClientDto }) =>
      clientsApi.update(id, data).then(r => r.data),
    onSuccess: (updatedClient) => {
      // Update specific client in cache
      queryClient.setQueryData(clientKeys.detail(updatedClient.id), updatedClient);
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });
}

/**
 * Delete client mutation
 */
export function useDeleteClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => clientsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

/**
 * Terminate service for a client
 */
export function useTerminateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto?: TerminateServiceDto }) =>
      clientsApi.terminateService(id, dto).then(r => r.data),
    onSuccess: (updatedClient) => {
      queryClient.setQueryData(clientKeys.detail(updatedClient.id), updatedClient);
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });
}

/**
 * Request employee replacement for a client
 */
export function useRequestReplacement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: RequestReplacementDto }) =>
      clientsApi.requestReplacement(id, dto).then(r => r.data),
    onSuccess: (updatedClient) => {
      queryClient.setQueryData(clientKeys.detail(updatedClient.id), updatedClient);
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });
}

/**
 * Complete the employee replacement process
 */
export function useCompleteReplacement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      clientsApi.completeReplacement(id).then(r => r.data),
    onSuccess: (updatedClient) => {
      queryClient.setQueryData(clientKeys.detail(updatedClient.id), updatedClient);
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });
}
```

### Hooks Layer Rules

1. **Query Key Factory** - Centralize all query keys in `keys.ts`
2. **Queries** - Use `useQuery()` for fetching data
3. **Mutations** - Use `useMutation()` for create/update/delete
4. **Cache invalidation** - Use `queryClient.invalidateQueries()` after mutations
5. **Optimistic updates** - Use `queryClient.setQueryData()` when appropriate
6. **Enable/disable queries** - Use `enabled` option for conditional queries
7. **Set staleTime** - Define how long data is considered fresh
8. **Add 'use client'** - All hook files must have this directive

---

## Import Conventions

### ✅ GOOD - Import from feature barrel export

```typescript
import { 
  useClients, 
  ClientsTable, 
  type Client,
  SERVICE_STATUS_OPTIONS 
} from '@/features/clients';
```

### ❌ BAD - Import from internal paths

```typescript
// DON'T DO THIS
import { useClients } from '@/features/clients/hooks/use-clients';
import { ClientsTable } from '@/features/clients/components/ClientsTable';
import type { Client } from '@/features/clients/types';
```

### Why?

1. **Single source of truth** - `index.ts` controls the public API
2. **Easier refactoring** - Move files without breaking imports
3. **Encapsulation** - Hide internal structure from consumers
4. **Consistency** - All imports follow the same pattern

---

## When to Create a Feature Module

Create a new feature module when:

| Criterion | Example |
|-----------|---------|
| **Related functionality** | All client-related code (CRUD, status changes, etc.) |
| **Reusable across pages** | Clients table used in multiple pages |
| **Shared types & API** | Multiple components need the same data |
| **Distinct domain** | Clients, Employees, Schedules are separate features |
| **Testable in isolation** | Feature can be tested independently |

### Don't create a feature module for:

- **Single-use components** - Keep in the page directory
- **Shared utilities** - Put in `@/core` or `@/lib`
- **Layout components** - Put in `@/components/layout`
- **Global state** - Use Zustand stores in `@/stores`

---

## Naming Conventions

| Item | Pattern | Example |
|------|---------|---------|
| Feature directory | `{feature-name}` (plural) | `clients`, `employees`, `schedules` |
| API file | `{feature}.api.ts` | `clients.api.ts` |
| Hooks file | `use-{feature}.ts` | `use-clients.ts` |
| Query keys | `{feature}Keys` | `clientKeys` |
| API export | `{feature}Api` | `clientsApi` |
| Component | `PascalCase.tsx` | `ClientsTable.tsx`, `ClientFormDialog.tsx` |
| Hook | `use{Feature}` | `useClients()`, `useCreateClient()` |
| Type | `PascalCase` | `Client`, `CreateClientDto` |
| DTO | `{Entity}Dto` | `CreateClientDto`, `UpdateClientDto` |
| Constant | `UPPER_SNAKE_CASE` | `SERVICE_STATUS_OPTIONS` |
| Query key | `{feature}Keys` object | `clientKeys.list()`, `clientKeys.detail(id)` |

---

## Component Branch

Components within a feature module should follow this pattern:

```typescript
// ✅ GOOD - Feature-specific component
export function ClientsTable() {
  const { data, isLoading } = useClients();
  return <table>{/* ... */}</table>;
}

// ✅ GOOD - Reusable within feature
export function ClientFormDialog() {
  const { mutate } = useCreateClient();
  return <dialog>{/* ... */}</dialog>;
}

// ❌ BAD - Generic component (belongs in @/components)
export function Button() {
  return <button>{/* ... */}</button>;
}

// ❌ BAD - Layout component (belongs in @/components/layout)
export function Header() {
  return <header>{/* ... */}</header>;
}
```

---

## Example: Creating a New Feature Module

### Step 1: Create directory structure

```bash
mkdir -p frontend/src/features/invoices/{api,components,hooks,types}
```

### Step 2: Create types (`types/index.ts`)

```typescript
export interface Invoice {
  id: number;
  clientId: number;
  amount: number;
  status: 'draft' | 'sent' | 'paid';
  createdAt: string;
}

export interface CreateInvoiceDto {
  clientId: number;
  amount: number;
}

export const INVOICE_STATUS_OPTIONS = [
  { value: 'draft', label: '임시저장' },
  { value: 'sent', label: '발송' },
  { value: 'paid', label: '완료' },
] as const;
```

### Step 3: Create API layer (`api/invoices.api.ts`)

```typescript
import { api } from '@/core/api/client';
import type { Invoice, CreateInvoiceDto } from '../types';

export const invoicesApi = {
  list: () => api.get<Invoice[]>('/invoices'),
  getById: (id: number) => api.get<Invoice>(`/invoices/${id}`),
  create: (data: CreateInvoiceDto) => api.post<Invoice>('/invoices', data),
  update: (id: number, data: Partial<CreateInvoiceDto>) =>
    api.patch<Invoice>(`/invoices/${id}`, data),
  delete: (id: number) => api.delete(`/invoices/${id}`),
};
```

### Step 4: Create query keys (`hooks/keys.ts`)

```typescript
export const invoiceKeys = {
  all: ['invoices'] as const,
  lists: () => [...invoiceKeys.all, 'list'] as const,
  list: () => [...invoiceKeys.lists()] as const,
  details: () => [...invoiceKeys.all, 'detail'] as const,
  detail: (id: number) => [...invoiceKeys.details(), id] as const,
};
```

### Step 5: Create hooks (`hooks/use-invoices.ts`)

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoicesApi } from '../api/invoices.api';
import { invoiceKeys } from './keys';
import type { Invoice, CreateInvoiceDto } from '../types';

export function useInvoices() {
  return useQuery<Invoice[]>({
    queryKey: invoiceKeys.list(),
    queryFn: () => invoicesApi.list().then(r => r.data),
  });
}

export function useInvoice(id: number) {
  return useQuery<Invoice>({
    queryKey: invoiceKeys.detail(id),
    queryFn: () => invoicesApi.getById(id).then(r => r.data),
    enabled: !!id,
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateInvoiceDto) =>
      invoicesApi.create(data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
    },
  });
}
```

### Step 6: Create public API (`index.ts`)

```typescript
export type { Invoice, CreateInvoiceDto } from './types';
export { INVOICE_STATUS_OPTIONS } from './types';

export { useInvoices, useInvoice, useCreateInvoice } from './hooks/use-invoices';
export { invoiceKeys } from './hooks/keys';

export { invoicesApi } from './api/invoices.api';
```

### Step 7: Use in components

```typescript
import { useInvoices, type Invoice } from '@/features/invoices';

export function InvoicesPage() {
  const { data: invoices, isLoading } = useInvoices();
  
  if (isLoading) return <div>Loading...</div>;
  
  return (
    <div>
      {invoices?.map(invoice => (
        <div key={invoice.id}>{invoice.id}</div>
      ))}
    </div>
  );
}
```

---

## Best Practices

1. **Keep features focused** - One domain per feature module
2. **Use barrel exports** - Always import from `@/features/{feature}`
3. **Centralize types** - All types in `types/index.ts`
4. **Document APIs** - Add JSDoc comments to API methods
5. **Cache management** - Use query keys for proper invalidation
6. **Error handling** - Let components handle errors from hooks
7. **Lazy load** - Use dynamic imports for large components
8. **Test in isolation** - Feature modules should be independently testable

---

## Migration Guide

If you have code outside the feature module structure:

### Before (scattered)
```
frontend/src/
├── hooks/useClients.ts
├── api/clients.ts
├── types/client.ts
├── components/ClientsTable.tsx
```

### After (organized)
```
frontend/src/features/clients/
├── api/clients.api.ts
├── hooks/use-clients.ts
├── hooks/keys.ts
├── types/index.ts
├── components/ClientsTable.tsx
└── index.ts
```

Move files and update imports to use the barrel export pattern.

---

## Troubleshooting

### Issue: Circular imports

**Problem**: `types/index.ts` imports from `hooks/use-clients.ts` and vice versa

**Solution**: Types should never import from hooks. Only hooks import from types.

### Issue: Cache not updating

**Problem**: Mutation succeeds but UI doesn't update

**Solution**: Ensure `onSuccess` callback invalidates or updates the correct query key

### Issue: Stale data

**Problem**: Data is cached too long

**Solution**: Adjust `staleTime` in `useQuery()` options

### Issue: Type errors in components

**Problem**: TypeScript complains about missing types

**Solution**: Ensure types are exported from `index.ts` using `export type { ... }`
