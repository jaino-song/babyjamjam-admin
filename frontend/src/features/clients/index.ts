// Public API for clients feature module

// Types
export type {
    Client,
    CreateClientDto,
    UpdateClientDto,
    PaginatedResponse,
    EmployeeSummary,
    ContractStatus,
} from './types';
export { CONTRACT_STATUS_OPTIONS } from './types';

// Hooks
export {
    useClients,
    useAllClients,
    useClient,
    useCreateClient,
    useUpdateClient,
    useDeleteClient,
} from './hooks/use-clients';
export { clientKeys } from './hooks/keys';

// Components
export { ClientsTable } from './components/ClientsTable';
export { ClientFormDialog } from './components/ClientFormDialog';
export { ClientDetailModal } from './components/ClientDetailModal';
export { EmployeeAutocomplete } from './components/EmployeeAutocomplete';

// API (for advanced usage)
export { clientsApi } from './api/clients.api';
