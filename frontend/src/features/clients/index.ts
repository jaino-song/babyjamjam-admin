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
