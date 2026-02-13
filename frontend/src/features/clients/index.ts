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

// API (for advanced usage)
export { clientsApi } from './api/clients.api';

// Note: Components are now in components/app/clients/
// Import them directly from there instead
