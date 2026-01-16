import { Injectable, Inject, Logger, NotFoundException } from "@nestjs/common";
import {
    CreateClientUsecase,
    DeleteClientUsecase,
    FindClientByIdUsecase,
    ListClientsUsecase,
    ListClientsPaginatedUsecase,
    UpdateClientUsecase,
} from "application/usecases/client";
import { ClientEntity } from "domain/entities/client.entity";
import { CLIENT_REPOSITORY, IClientRepository, PaginatedResult } from "domain/repositories/client.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { computeServiceStatus, SERVICE_STATUS, ServiceStatusType } from "domain/value-objects/service-status.vo";
import { AlimtalkService } from "./alimtalk.service";

const FILTER_DAYS_THRESHOLD = 7;

// Document status type for eformsign documents
// Maps to eformsign_doc.status_type values:
// - 010: created (문서 생성됨)
// - 020: opened (서명 페이지 열림)
// - 050: completed (완료)
// - 060: requested (서명 요청됨/진행중)
// - 080: rejected (거부됨)
// - 090: revoked (철회됨)
// - 099: deleted (삭제됨)
export type DocumentStatusType = 'created' | 'opened' | 'completed' | 'requested' | 'rejected' | 'revoked' | 'deleted' | null;

// Response type that includes employee information
export interface ClientWithEmployees {
    id: number;
    name: string;
    address: string | null;
    phone: string | null;
    type: string | null;
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    startDate: Date | null;
    endDate: Date | null;
    careCenter: boolean;
    voucherClient: boolean;
    birthday: string | null;
    serviceStatus: string | null;
    breastPump: boolean;
    eDocId: string | null;
    hasSigned: boolean;
    documentStatus: DocumentStatusType;
    primaryEmployee: { id: number; name: string } | null;
    secondaryEmployee: { id: number; name: string } | null;
}

export interface PaginatedClientWithEmployees {
    data: ClientWithEmployees[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

@Injectable()
export class ClientService {
    private readonly logger = new Logger(ClientService.name);

    constructor(
        private readonly createClientUsecase: CreateClientUsecase,
        private readonly findClientByIdUsecase: FindClientByIdUsecase,
        private readonly listClientsUsecase: ListClientsUsecase,
        private readonly listClientsPaginatedUsecase: ListClientsPaginatedUsecase,
        private readonly updateClientUsecase: UpdateClientUsecase,
        private readonly deleteClientUsecase: DeleteClientUsecase,
        private readonly prismaService: PrismaService,
        private readonly alimtalkService: AlimtalkService,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async create(params: {
        name: string;
        primaryEmployeeId: number;
        secondaryEmployeeId?: number | null;
        address?: string | null;
        phone?: string | null;
        type?: string | null;
        duration?: number | null;
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        careCenter: boolean;
        voucherClient: boolean;
        birthday?: string | null;
        serviceStatus?: string | null;
        breastPump: boolean;
        eDocId?: string | null;
    }): Promise<ClientEntity> {
        const startDate = params.startDate ? new Date(params.startDate) : new Date();
        const endDate = params.endDate ? new Date(params.endDate) : new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);

        // First create the client
        const client = await this.createClientUsecase.execute({
            name: params.name,
            address: params.address ?? null,
            phone: params.phone ?? null,
            type: params.type ?? null,
            duration: params.duration ?? null,
            fullPrice: params.fullPrice ?? null,
            grant: params.grant ?? null,
            actualPrice: params.actualPrice ?? null,
            startDate: startDate,
            endDate: endDate,
            careCenter: params.careCenter,
            voucherClient: params.voucherClient,
            birthday: params.birthday ?? null,
            serviceStatus: params.serviceStatus ?? null,
            breastPump: params.breastPump,
            eDocId: params.eDocId ?? null,
        });

        // Then create the employee_schedule with the client_id
        await this.prismaService.employee_schedule.create({
            data: {
                client_id: client.id,
                primary_employee_id: params.primaryEmployeeId,
                secondary_employee_id: params.secondaryEmployeeId ?? null,
                work_address: params.address ?? "",
                start_date: startDate,
                end_date: endDate,
                replaced: false,
            },
        });

        this.alimtalkService.sendClientCreatedAlimtalk(client).catch((error) => {
            this.logger.error(`Failed to send client created alimtalk: ${error}`);
        });

        return client;
    }

    async findAll(): Promise<ClientWithEmployees[]> {
        const clients = await this.listClientsUsecase.execute();
        return this.attachEmployeesToClients(clients);
    }

    async findAllPaginated(page: number, limit: number, search?: string): Promise<PaginatedClientWithEmployees> {
        const result = await this.listClientsPaginatedUsecase.execute(page, limit, search);
        const clientsWithEmployees = await this.attachEmployeesToClients(result.data);
        return {
            data: clientsWithEmployees,
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
        };
    }

    async findById(id: number): Promise<ClientWithEmployees | null> {
        const client = await this.findClientByIdUsecase.execute(id);
        if (!client) return null;

        const [withEmployees] = await this.attachEmployeesToClients([client]);
        return withEmployees ?? null;
    }

    async findByFilter(filter: string): Promise<ClientWithEmployees[]> {
        let clients: ClientEntity[];

        switch (filter) {
            case 'starting-soon':
                clients = await this.clientRepository.findStartingWithinDays(FILTER_DAYS_THRESHOLD);
                break;
            case 'ending-soon':
                clients = await this.clientRepository.findEndingWithinDays(FILTER_DAYS_THRESHOLD);
                break;
            case 'incomplete-contracts':
                clients = await this.clientRepository.findWithIncompleteContractsStartingWithinDays(FILTER_DAYS_THRESHOLD);
                break;
            case 'no-contract':
                clients = await this.clientRepository.findWithoutContractSentStartingWithinDays(FILTER_DAYS_THRESHOLD);
                break;
            default:
                this.logger.warn(`Unknown filter: ${filter}`);
                clients = [];
        }

        return this.attachEmployeesToClients(clients);
    }

    /**
     * Helper method to attach employee info to clients and compute service status
     * Implements lazy update: computes status on access and updates DB if changed
     */
    private async attachEmployeesToClients(clients: ClientEntity[]): Promise<ClientWithEmployees[]> {
        if (clients.length === 0) return [];

        const clientIds = clients.map(c => c.id);

        // Get all active schedules for these clients with employee info
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: {
                client_id: { in: clientIds },
                replaced: false,
            },
            include: {
                employee_employee_schedule_primary_employee_idToemployee: true,
                employee_employee_schedule_secondary_employee_idToemployee: true,
            },
        });

        // Create a map of client_id to schedule
        const scheduleMap = new Map(schedules.map(s => [s.client_id, s]));

        // Batch fetch eformsign_docs for all clients with eDocId
        const eDocIds = clients.map(c => c.eDocId).filter((id): id is string => id !== null);
        const docs = eDocIds.length > 0
            ? await this.prismaService.eformsign_doc.findMany({
                where: { document_id: { in: eDocIds } },
                select: { document_id: true, status_type: true },
            })
            : [];
        const docStatusMap = new Map(docs.map(d => [d.document_id, d.status_type]));

        // Compute and update service status for each client (lazy update strategy)
        const clientsNeedingUpdate: { id: number; newStatus: ServiceStatusType }[] = [];

        const result = clients.map(client => {
            const schedule = scheduleMap.get(client.id);

            // Compute current service status based on dates
            const computedStatus = computeServiceStatus(
                client.serviceStatus,
                client.startDate,
                client.endDate,
            );

            // Track clients that need status update in DB
            if (client.serviceStatus !== computedStatus) {
                clientsNeedingUpdate.push({ id: client.id, newStatus: computedStatus });
            }

            return {
                id: client.id,
                name: client.name,
                address: client.address,
                phone: client.phone,
                type: client.type,
                duration: client.duration,
                fullPrice: client.fullPrice,
                grant: client.grant,
                actualPrice: client.actualPrice,
                startDate: client.startDate,
                endDate: client.endDate,
                careCenter: client.careCenter,
                voucherClient: client.voucherClient,
                birthday: client.birthday,
                serviceStatus: computedStatus, // Return computed status, not stored one
                breastPump: client.breastPump,
                eDocId: client.eDocId,
                hasSigned: client.eDocId !== null,
                documentStatus: this.mapStatusTypeToDocumentStatus(docStatusMap.get(client.eDocId ?? '')),
                primaryEmployee: schedule?.employee_employee_schedule_primary_employee_idToemployee
                    ? { id: schedule.employee_employee_schedule_primary_employee_idToemployee.id, name: schedule.employee_employee_schedule_primary_employee_idToemployee.name }
                    : null,
                secondaryEmployee: schedule?.employee_employee_schedule_secondary_employee_idToemployee
                    ? { id: schedule.employee_employee_schedule_secondary_employee_idToemployee.id, name: schedule.employee_employee_schedule_secondary_employee_idToemployee.name }
                    : null,
            };
        });

        // Batch update clients whose status changed (non-blocking)
        if (clientsNeedingUpdate.length > 0) {
            this.updateServiceStatusesInBackground(clientsNeedingUpdate);
        }

        return result;
    }

    /**
     * Background update of service statuses (fire-and-forget)
     * Does not block the main response
     */
    private updateServiceStatusesInBackground(
        updates: { id: number; newStatus: ServiceStatusType }[]
    ): void {
        // Use Promise.allSettled to handle each update independently
        Promise.allSettled(
            updates.map(async ({ id, newStatus }) => {
                try {
                    await this.prismaService.client.update({
                        where: { id },
                        data: { service_status: newStatus },
                    });
                    this.logger.debug(`Updated client ${id} service status to ${newStatus}`);
                } catch (error) {
                    this.logger.warn(`Failed to update client ${id} service status: ${error}`);
                }
            })
        ).catch(error => {
            this.logger.error(`Error in background status updates: ${error}`);
        });
    }

    private mapStatusTypeToDocumentStatus(statusType?: string): DocumentStatusType {
        switch (statusType) {
            case '010': return 'created';
            case '020': return 'opened';
            case '050': return 'completed';
            case '060': return 'requested';
            case '080': return 'rejected';
            case '090': return 'revoked';
            case '099': return 'deleted';
            default: return null;
        }
    }

    async update(id: number, params: {
        name?: string;
        primaryEmployeeId?: number;
        secondaryEmployeeId?: number | null;
        address?: string | null;
        phone?: string | null;
        type?: string | null;
        duration?: number | null;
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        careCenter?: boolean;
        voucherClient?: boolean;
        birthday?: string | null;
        serviceStatus?: string | null;
        breastPump?: boolean;
        eDocId?: string | null;
    }): Promise<ClientEntity> {
        // Get existing client
        const existingClient = await this.findClientByIdUsecase.execute(id);
        if (!existingClient) {
            throw new Error(`Client with id ${id} not found`);
        }

        const startDate = params.startDate ? new Date(params.startDate) : existingClient.startDate ?? new Date();
        const endDate = params.endDate ? new Date(params.endDate) : existingClient.endDate ?? new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);

        // Check if employee assignment is being changed
        const employeeChanged = params.primaryEmployeeId !== undefined || params.secondaryEmployeeId !== undefined;

        if (employeeChanged) {
            // Get current schedule for this client
            const currentSchedule = await this.prismaService.employee_schedule.findFirst({
                where: { client_id: id, replaced: false },
                orderBy: { id: 'desc' },
            });

            const currentPrimaryEmployeeId = currentSchedule?.primary_employee_id ?? null;
            const currentSecondaryEmployeeId = currentSchedule?.secondary_employee_id ?? null;

            // Determine new employee values
            const newPrimaryEmployeeId = params.primaryEmployeeId !== undefined 
                ? params.primaryEmployeeId 
                : currentPrimaryEmployeeId;
            const newSecondaryEmployeeId = params.secondaryEmployeeId !== undefined 
                ? params.secondaryEmployeeId 
                : currentSecondaryEmployeeId;

            // Only create new schedule if employees actually changed
            const actuallyChanged = newPrimaryEmployeeId !== currentPrimaryEmployeeId || 
                                   newSecondaryEmployeeId !== currentSecondaryEmployeeId;

            if (actuallyChanged && newPrimaryEmployeeId !== null) {
                // Mark old schedule as replaced if exists
                if (currentSchedule) {
                    await this.prismaService.employee_schedule.update({
                        where: { id: currentSchedule.id },
                        data: { replaced: true, end_date: new Date() },
                    });
                }

                // Create new schedule
                await this.prismaService.employee_schedule.create({
                    data: {
                        client_id: id,
                        primary_employee_id: newPrimaryEmployeeId,
                        secondary_employee_id: newSecondaryEmployeeId,
                        work_address: params.address ?? existingClient.address ?? "",
                        start_date: startDate,
                        end_date: endDate,
                        replaced: false,
                    },
                });
            }
        }

        return this.updateClientUsecase.execute(id, {
            name: params.name,
            address: params.address,
            phone: params.phone,
            type: params.type,
            duration: params.duration,
            fullPrice: params.fullPrice,
            grant: params.grant,
            actualPrice: params.actualPrice,
            startDate: params.startDate === undefined ? undefined : params.startDate ? new Date(params.startDate) : null,
            endDate: params.endDate === undefined ? undefined : params.endDate ? new Date(params.endDate) : null,
            careCenter: params.careCenter,
            voucherClient: params.voucherClient,
            birthday: params.birthday,
            serviceStatus: params.serviceStatus,
            breastPump: params.breastPump,
            eDocId: params.eDocId,
        });
    }

    /**
     * Terminate a client's service (manual status change)
     * Sets serviceStatus to 'terminated' and ends the service immediately
     * @param clientId - The client ID
     * @param reason - Optional termination reason for logging
     */
    async terminateService(clientId: number, reason?: string): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(clientId);
        if (!client) {
            throw new NotFoundException(`Client with id ${clientId} not found`);
        }

        this.logger.log(
            `Terminating service for client ${clientId}` +
            (reason ? `: ${reason}` : "")
        );

        // Update client with terminated status and set end_date to today
        const updatedClient = await this.updateClientUsecase.execute(clientId, {
            serviceStatus: SERVICE_STATUS.TERMINATED,
            endDate: new Date(),
        });

        // Also mark the current schedule as ended
        await this.prismaService.employee_schedule.updateMany({
            where: { client_id: clientId, replaced: false },
            data: { end_date: new Date() },
        });

        return updatedClient;
    }

    /**
     * Request a provider replacement for a client
     * Sets serviceStatus to 'replacement_requested' to indicate pending change
     * @param clientId - The client ID
     * @param newPrimaryEmployeeId - The new primary employee to assign
     * @param newSecondaryEmployeeId - Optional new secondary employee
     */
    async requestReplacement(
        clientId: number,
        newPrimaryEmployeeId: number,
        newSecondaryEmployeeId?: number | null,
    ): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(clientId);
        if (!client) {
            throw new NotFoundException(`Client with id ${clientId} not found`);
        }

        this.logger.log(
            `Replacement requested for client ${clientId}: ` +
            `new primary=${newPrimaryEmployeeId}, secondary=${newSecondaryEmployeeId ?? "none"}`
        );

        // Update client status to replacement_requested
        const updatedClient = await this.updateClientUsecase.execute(clientId, {
            serviceStatus: SERVICE_STATUS.REPLACEMENT_REQUESTED,
        });

        // Get current schedule and mark as replaced
        const currentSchedule = await this.prismaService.employee_schedule.findFirst({
            where: { client_id: clientId, replaced: false },
            orderBy: { id: "desc" },
        });

        if (currentSchedule) {
            await this.prismaService.employee_schedule.update({
                where: { id: currentSchedule.id },
                data: { replaced: true, end_date: new Date() },
            });
        }

        // Create new schedule with new employees
        await this.prismaService.employee_schedule.create({
            data: {
                client_id: clientId,
                primary_employee_id: newPrimaryEmployeeId,
                secondary_employee_id: newSecondaryEmployeeId ?? null,
                work_address: client.address ?? "",
                start_date: new Date(),
                end_date: client.endDate ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                replaced: false,
            },
        });

        return updatedClient;
    }

    /**
     * Complete a replacement and restore service to active status
     * Call this after the replacement has been processed
     * @param clientId - The client ID
     */
    async completeReplacement(clientId: number): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(clientId);
        if (!client) {
            throw new NotFoundException(`Client with id ${clientId} not found`);
        }

        if (client.serviceStatus !== SERVICE_STATUS.REPLACEMENT_REQUESTED) {
            this.logger.warn(
                `Client ${clientId} is not in replacement_requested status, ` +
                `current status: ${client.serviceStatus}`
            );
        }

        this.logger.log(`Completing replacement for client ${clientId}`);

        // Compute what the status should be based on dates (usually 'active')
        const computedStatus = computeServiceStatus(
            null, // Ignore current status, compute fresh
            client.startDate,
            client.endDate,
        );

        return this.updateClientUsecase.execute(clientId, {
            serviceStatus: computedStatus,
        });
    }

    delete(id: number): Promise<void> {
        return this.deleteClientUsecase.execute(id);
    }
}
