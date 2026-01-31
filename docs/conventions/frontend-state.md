# Frontend State Management

## Overview

Our state management strategy uses **two complementary tools**:

- **Server State**: TanStack Query (React Query) - for API data, caching, synchronization
- **Client State**: Zustand - for form data, UI state, local application state

**Golden Rule**: Never mix them. Use the right tool for the job.

---

## Server State: TanStack Query

### When to Use
- API responses and entity data
- Lists with pagination
- Entity details
- Any data that comes from the backend

### Query Key Factory Pattern

Always use a query key factory to organize and manage query keys consistently.

**Example from `frontend/src/features/clients/hooks/keys.ts`:**

```typescript
export const clientKeys = {
  all: ['clients'] as const,
  lists: () => [...clientKeys.all, 'list'] as const,
  list: (filters: { page?: number; limit?: number; search?: string }) =>
    [...clientKeys.lists(), filters] as const,
  details: () => [...clientKeys.all, 'detail'] as const,
  detail: (id: number) => [...clientKeys.details(), id] as const,
};
```

**Benefits:**
- Centralized key management
- Type-safe filter objects
- Easy invalidation of related queries
- Prevents key typos and inconsistencies

### useQuery Pattern

Fetch data with automatic caching and synchronization.

**Example from `frontend/src/features/clients/hooks/use-clients.ts`:**

```typescript
export function useClients(page: number = 1, limit: number = 10, search?: string) {
  return useQuery<PaginatedResponse<Client>>({
    queryKey: clientKeys.list({ page, limit, search }),
    queryFn: () => clientsApi.list({ page, limit, search }).then(r => r.data),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useClient(id: number) {
  return useQuery<Client>({
    queryKey: clientKeys.detail(id),
    queryFn: () => clientsApi.getById(id).then(r => r.data),
    enabled: !!id,  // Conditional fetching - only fetch if id exists
  });
}
```

**Key Options:**
- `queryKey`: Use the factory pattern
- `queryFn`: Return the data (not the full response)
- `staleTime`: How long data is considered fresh (default: 5 minutes)
- `enabled`: Conditionally enable/disable the query

### useMutation Pattern

Update server data and keep queries in sync.

**Example from `frontend/src/features/clients/hooks/use-clients.ts`:**

```typescript
export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateClientDto) => clientsApi.create(dto).then(r => r.data),
    onSuccess: () => {
      // Invalidate all client queries to refresh lists
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: UpdateClientDto }) =>
      clientsApi.update(id, dto).then(r => r.data),
    onSuccess: (_, { id }) => {
      // Invalidate both list and detail queries
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
    },
  });
}
```

**Key Patterns:**
- Always invalidate related queries on success
- Use the query key factory for precise invalidation
- Return the mutated data from `mutationFn`

---

## Client State: Zustand

### When to Use
- Form state (multi-step forms, temporary input)
- UI state (modals, sidebars, dropdowns)
- Local application state
- Anything that doesn't come from the backend

### Store Pattern

Create stores with clear separation of state and actions.

**Example from `frontend/src/app/store/form-store.ts`:**

```typescript
import { create } from "zustand";

interface FormStore {
  // State
  clientId: number | null;
  name: string;
  phone: string;
  // ... more fields

  // Individual setters
  setClientId: (clientId: number | null) => void;
  setName: (name: string) => void;

  // Batch setters (prevent intermediate renders)
  setEmployeeSelection: (employeeId: number | null, employeeName: string, employeePhone: string) => void;

  // Reset functions
  resetClientFields: () => void;
}

export const useFormStore = create<FormStore>((set) => ({
  clientId: null,
  name: "",
  phone: "",

  setClientId: (clientId) => set({ clientId }),
  setName: (name) => set({ name }),

  // Batch update - prevents intermediate renders
  setEmployeeSelection: (employeeId, employeeName, employeePhone) => set({
    employeeId,
    employeeName,
    employeePhone,
  }),

  resetClientFields: () => set({
    clientId: null,
    name: "",
    phone: "",
  }),
}));
```

**Key Patterns:**
- Define interface with state and actions
- Use individual setters for single fields
- Use batch setters for related fields (prevents intermediate renders)
- Provide reset functions for cleanup
- Always type the store with an interface

### Usage in Components

```typescript
export function ClientForm() {
  const { clientId, setClientId, name, setName, resetClientFields } = useFormStore();

  const handleReset = () => {
    resetClientFields();
  };

  return (
    <form>
      <input value={clientId} onChange={(e) => setClientId(Number(e.target.value))} />
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={handleReset}>Reset</button>
    </form>
  );
}
```

---

## Decision Matrix

| State Type | Tool | Examples | Reason |
|------------|------|----------|--------|
| Server data | TanStack Query | API responses, lists, entity details | Automatic caching, sync, deduplication |
| Form state | Zustand | Multi-step form data, temporary input | Simple, local, no sync needed |
| UI state | Zustand | Modal open/close, sidebar state, dropdowns | Local, ephemeral, no persistence |
| URL state | Next.js router | Pagination, filters, search params | Shareable, bookmarkable, browser history |

---

## Best Practices

### 1. Always Use Query Key Factory
```typescript
// ✅ Good
const { data } = useQuery({
  queryKey: clientKeys.detail(id),
  queryFn: () => clientsApi.getById(id).then(r => r.data),
});

// ❌ Bad - hardcoded keys are error-prone
const { data } = useQuery({
  queryKey: ['clients', 'detail', id],
  queryFn: () => clientsApi.getById(id).then(r => r.data),
});
```

### 2. Set Appropriate staleTime
```typescript
// ✅ Good - 5 minutes for relatively stable data
useQuery({
  queryKey: clientKeys.list({ page, limit }),
  queryFn: () => clientsApi.list({ page, limit }).then(r => r.data),
  staleTime: 1000 * 60 * 5,
});

// ✅ Good - 0 for real-time data
useQuery({
  queryKey: orderKeys.active(),
  queryFn: () => ordersApi.getActive().then(r => r.data),
  staleTime: 0,
});
```

### 3. Use Conditional Fetching with `enabled`
```typescript
// ✅ Good - only fetch when id is available
useQuery({
  queryKey: clientKeys.detail(id),
  queryFn: () => clientsApi.getById(id).then(r => r.data),
  enabled: !!id,
});

// ❌ Bad - will attempt fetch with undefined id
useQuery({
  queryKey: clientKeys.detail(id),
  queryFn: () => clientsApi.getById(id).then(r => r.data),
});
```

### 4. Invalidate Related Queries on Mutation
```typescript
// ✅ Good - invalidate all related queries
useMutation({
  mutationFn: (dto: UpdateClientDto) => clientsApi.update(id, dto).then(r => r.data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: clientKeys.all });
  },
});

// ❌ Bad - only invalidates one query, lists become stale
useMutation({
  mutationFn: (dto: UpdateClientDto) => clientsApi.update(id, dto).then(r => r.data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
  },
});
```

### 5. Use Batch Setters in Zustand
```typescript
// ✅ Good - single render
setEmployeeSelection(employeeId, employeeName, employeePhone);

// ❌ Bad - three renders
setEmployeeId(employeeId);
setEmployeeName(employeeName);
setEmployeePhone(employeePhone);
```

### 6. Provide Reset Functions
```typescript
// ✅ Good - easy cleanup
const { resetClientFields } = useFormStore();
resetClientFields();

// ❌ Bad - manual reset is error-prone
setClientId(null);
setName("");
setPhone("");
```

---

## Common Patterns

### Multi-Step Form with Zustand

```typescript
interface StepStore {
  currentStep: number;
  formData: FormData;
  
  setCurrentStep: (step: number) => void;
  updateFormData: (data: Partial<FormData>) => void;
  resetForm: () => void;
}

export const useStepStore = create<StepStore>((set) => ({
  currentStep: 1,
  formData: { /* initial data */ },
  
  setCurrentStep: (step) => set({ currentStep: step }),
  updateFormData: (data) => set((state) => ({
    formData: { ...state.formData, ...data },
  })),
  resetForm: () => set({ currentStep: 1, formData: { /* initial */ } }),
}));
```

### Paginated List with TanStack Query

```typescript
export function useClientsList(page: number = 1, limit: number = 10) {
  return useQuery<PaginatedResponse<Client>>({
    queryKey: clientKeys.list({ page, limit }),
    queryFn: () => clientsApi.list({ page, limit }).then(r => r.data),
    staleTime: 1000 * 60 * 5,
  });
}

// In component:
const [page, setPage] = useState(1);
const { data, isLoading } = useClientsList(page);
```

### Optimistic Updates

```typescript
export function useUpdateClientOptimistic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: UpdateClientDto }) =>
      clientsApi.update(id, dto).then(r => r.data),
    onMutate: async ({ id, dto }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: clientKeys.detail(id) });

      // Snapshot previous data
      const previousData = queryClient.getQueryData(clientKeys.detail(id));

      // Update cache optimistically
      queryClient.setQueryData(clientKeys.detail(id), (old: Client) => ({
        ...old,
        ...dto,
      }));

      return { previousData };
    },
    onError: (_, __, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(clientKeys.detail(id), context.previousData);
      }
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}
```

---

## Anti-Patterns to Avoid

### ❌ Mixing Server and Client State
```typescript
// Bad - storing API data in Zustand
const useStore = create((set) => ({
  clients: [],
  setClients: (clients) => set({ clients }),
}));

// Good - use TanStack Query for API data
const { data: clients } = useQuery({
  queryKey: clientKeys.all,
  queryFn: () => clientsApi.list().then(r => r.data),
});
```

### ❌ Hardcoded Query Keys
```typescript
// Bad
useQuery({
  queryKey: ['clients', 'list', page, limit],
  queryFn: () => clientsApi.list({ page, limit }).then(r => r.data),
});

// Good
useQuery({
  queryKey: clientKeys.list({ page, limit }),
  queryFn: () => clientsApi.list({ page, limit }).then(r => r.data),
});
```

### ❌ Not Invalidating Related Queries
```typescript
// Bad - only invalidates one query
useMutation({
  mutationFn: (dto) => clientsApi.create(dto).then(r => r.data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: clientKeys.detail(1) });
  },
});

// Good - invalidates all related queries
useMutation({
  mutationFn: (dto) => clientsApi.create(dto).then(r => r.data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: clientKeys.all });
  },
});
```

### ❌ Multiple Individual Zustand Updates
```typescript
// Bad - causes multiple renders
setClientId(id);
setName(name);
setPhone(phone);

// Good - single render
setClientSelection(id, name, phone);
```

---

## References

- [TanStack Query Documentation](https://tanstack.com/query/latest)
- [Zustand Documentation](https://github.com/pmndrs/zustand)
- [Query Key Factory Pattern](https://tkdodo.eu/blog/effective-react-query-keys)
