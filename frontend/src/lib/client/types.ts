// Re-export all types from the feature module to avoid duplication
export {
    type EmployeeSummary,
    type DocumentStatus,
    type Client,
    type CreateClientDto,
    type UpdateClientDto,
    type TerminateServiceDto,
    type RequestReplacementDto,
    type PaginatedResponse,
    SERVICE_STATUS_OPTIONS,
    type ServiceStatus,
    CONTRACT_STATUS_OPTIONS,
    type ContractStatus,
} from "@/features/clients/types";
