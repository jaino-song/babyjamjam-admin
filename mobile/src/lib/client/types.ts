import type { StartDateChangeMode } from "@babyjamjam/shared";
import type { UpdateClientDto as FeatureUpdateClientDto } from "@/features/clients/types";

export interface UpdateClientDto extends FeatureUpdateClientDto {
    startDateChangeMode?: StartDateChangeMode;
}

// Re-export the remaining types from the feature module to avoid duplication
export {
    type EmployeeSummary,
    type DocumentStatus,
    type ClientBadge,
    type ClientBadgeKey,
    type ClientBadgeStatus,
    type ClientBadgeTone,
    type Client,
    type CreateClientDto,
    type TerminateServiceDto,
    type RequestReplacementDto,
    type PaginatedResponse,
    SERVICE_STATUS_OPTIONS,
    type ServiceStatus,
    CONTRACT_STATUS_OPTIONS,
    type ContractStatus,
} from "@/features/clients/types";
