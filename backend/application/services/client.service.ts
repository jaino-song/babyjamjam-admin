import { Injectable, Inject, Logger, NotFoundException, Optional } from "@nestjs/common";
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
import { AlimtalkTriggerService } from "./alimtalk-trigger.service";

const FILTER_DAYS_THRESHOLD = 7;

// Document status type for eformsign documents
// Maps to eformsign_doc.statusType values:
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
    createdAt: Date | null;
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
    dueDate: Date | null;
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
        @Optional() private readonly triggerService?: AlimtalkTriggerService,
    ) {}

    async create(branchid: string, params: {
        name: string;
        primaryEmployeeId?: number | null;
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
        dueDate?: string | null;
        serviceStatus?: string | null;
        breastPump: boolean;
        eDocId?: string | null;
    }): Promise<ClientEntity> {
        const startDate = params.startDate ? new Date(params.startDate) : new Date();
        const endDate = params.endDate ? new Date(params.endDate) : new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);
        const dueDate = params.dueDate ? new Date(params.dueDate) : null;

        // First create the client
        const client = await this.createClientUsecase.execute(branchid, {
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
            dueDate,
            serviceStatus: params.serviceStatus ?? null,
            breastPump: params.breastPump,
            eDocId: params.eDocId ?? null,
        });

        // Then create employee_schedule (optional - only when primary employee is assigned)
        let createdScheduleId: number | null = null;
        if (params.primaryEmployeeId !== undefined && params.primaryEmployeeId !== null) {
            const schedule = await this.prismaService.employee_schedule.create({
                data: {
                    clientId: client.id,
                    branchId: branchid,
                    primaryEmployeeId: params.primaryEmployeeId,
                    secondaryEmployeeId: params.secondaryEmployeeId ?? null,
                    workAddress: params.address ?? "",
                    startDate: startDate,
                    endDate: endDate,
                    replaced: false,
                },
            });
            createdScheduleId = schedule.id;
        }

        this.alimtalkService.sendClientCreatedAlimtalk(client).catch((error) => {
            this.logger.error(`Failed to send client created alimtalk: ${error}`);
        });
        if (this.triggerService) {
            this.triggerService.syncClientRulesForClient(branchid, client.id, true).catch((error) => {
                this.logger.error(`Failed to sync client trigger rules: ${error}`);
            });
        }
        if (createdScheduleId !== null) {
            this.triggerService
                ?.syncEmployeeAssignmentRulesForSchedule(branchid, createdScheduleId, true)
                ?.catch((error) => {
                    this.logger.error(`Failed to sync employee assignment triggers: ${error}`);
                });
        }

        return client;
    }

    async findAll(branchid: string): Promise<ClientWithEmployees[]> {
        const clients = await this.listClientsUsecase.execute(branchid);
        return this.attachEmployeesToClients(clients);
    }

    async findAllPaginated(
        branchid: string,
        page: number,
        limit: number,
        search?: string
    ): Promise<PaginatedClientWithEmployees> {
        const result = await this.listClientsPaginatedUsecase.execute(
            branchid,
            page,
            limit,
            search
        );
        const clientsWithEmployees = await this.attachEmployeesToClients(result.data);
        return {
            data: clientsWithEmployees,
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
        };
    }

    async findById(branchid: string, id: number): Promise<ClientWithEmployees | null> {
        const client = await this.findClientByIdUsecase.execute(branchid, id);
        if (!client) return null;

        const [withEmployees] = await this.attachEmployeesToClients([client]);
        return withEmployees ?? null;
    }

    async findByFilter(branchid: string, filter: string): Promise<ClientWithEmployees[]> {
        let clients: ClientEntity[];

        switch (filter) {
            case 'starting-soon':
                clients = await this.clientRepository.findStartingWithinDays(
                    branchid,
                    FILTER_DAYS_THRESHOLD
                );
                break;
            case 'ending-soon':
                clients = await this.clientRepository.findEndingWithinDays(
                    branchid,
                    FILTER_DAYS_THRESHOLD
                );
                break;
            case 'incomplete-contracts':
                clients = await this.clientRepository.findWithIncompleteContractsStartingWithinDays(
                    branchid,
                    FILTER_DAYS_THRESHOLD
                );
                break;
            case 'no-contract':
                clients = await this.clientRepository.findWithoutContractSentStartingWithinDays(
                    branchid,
                    FILTER_DAYS_THRESHOLD
                );
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
                clientId: { in: clientIds },
                replaced: false,
            },
            include: {
                primaryEmployee: true,
                secondaryEmployee: true,
            },
        });

        // Create a map of clientId to schedule
        const scheduleMap = new Map(schedules.map(s => [s.clientId, s]));

        // Batch fetch eformsign_docs for all clients with eDocId
        const eDocIds = clients.map(c => c.eDocId).filter((id): id is string => id !== null);
        const docs = eDocIds.length > 0
            ? await this.prismaService.eformsign_doc.findMany({
                where: { documentId: { in: eDocIds } },
                select: { documentId: true, statusType: true },
            })
            : [];
        const docStatusMap = new Map(docs.map(d => [d.documentId, d.statusType]));

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
                    createdAt: client.createdAt,
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
                    dueDate: client.dueDate,
                    serviceStatus: computedStatus, // Return computed status, not stored one
                    breastPump: client.breastPump,
                    eDocId: client.eDocId,
                    hasSigned: client.eDocId !== null,
                    documentStatus: this.mapStatusTypeToDocumentStatus(docStatusMap.get(client.eDocId ?? '')),
                    primaryEmployee: schedule?.primaryEmployee
                        ? { id: schedule.primaryEmployee.id, name: schedule.primaryEmployee.name }
                        : null,
                    secondaryEmployee: schedule?.secondaryEmployee
                        ? { id: schedule.secondaryEmployee.id, name: schedule.secondaryEmployee.name }
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
                        data: { serviceStatus: newStatus },
                        select: { id: true },
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

    async update(branchid: string, id: number, params: {
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
        dueDate?: string | null;
        serviceStatus?: string | null;
        breastPump?: boolean;
        eDocId?: string | null;
    }): Promise<ClientEntity> {
        // Get existing client
        const existingClient = await this.findClientByIdUsecase.execute(branchid, id);
        if (!existingClient) {
            throw new Error(`Client with id ${id} not found`);
        }

        const startDate = params.startDate ? new Date(params.startDate) : existingClient.startDate ?? new Date();
        const endDate = params.endDate ? new Date(params.endDate) : existingClient.endDate ?? new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);

        // Check if employee assignment is being changed
        const employeeChanged = params.primaryEmployeeId !== undefined || params.secondaryEmployeeId !== undefined;

        let createdScheduleId: number | null = null;
        if (employeeChanged) {
            // Get current schedule for this client
            const currentSchedule = await this.prismaService.employee_schedule.findFirst({
                where: { clientId: id, branchId: branchid, replaced: false },
                orderBy: { id: 'desc' },
            });

            const currentPrimaryEmployeeId = currentSchedule?.primaryEmployeeId ?? null;
            const currentSecondaryEmployeeId = currentSchedule?.secondaryEmployeeId ?? null;

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
                        data: { replaced: true, endDate: new Date() },
                    });
                }

                // Create new schedule
                const newSchedule = await this.prismaService.employee_schedule.create({
                    data: {
                        clientId: id,
                        branchId: branchid,
                        primaryEmployeeId: newPrimaryEmployeeId,
                        secondaryEmployeeId: newSecondaryEmployeeId,
                        workAddress: params.address ?? existingClient.address ?? "",
                        startDate: startDate,
                        endDate: endDate,
                        replaced: false,
                    },
                });
                createdScheduleId = newSchedule.id;
            }
        }

        const updatedClient = await this.updateClientUsecase.execute(branchid, id, {
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
            dueDate: params.dueDate === undefined ? undefined : params.dueDate ? new Date(params.dueDate) : null,
            serviceStatus: params.serviceStatus,
            breastPump: params.breastPump,
            eDocId: params.eDocId,
        });
        if (this.triggerService) {
            this.triggerService.syncClientRulesForClient(branchid, id, false).catch((error) => {
                this.logger.error(`Failed to sync client trigger rules: ${error}`);
            });
        }
        if (createdScheduleId !== null) {
            this.triggerService
                ?.syncEmployeeAssignmentRulesForSchedule(branchid, createdScheduleId, true)
                ?.catch((error) => {
                    this.logger.error(`Failed to sync employee assignment triggers: ${error}`);
                });
        }
        return updatedClient;
    }

    /**
     * Terminate a client's service (manual status change)
     * Sets serviceStatus to 'terminated' and ends the service immediately
     * @param clientId - The client ID
     * @param reason - Optional termination reason for logging
     */
    async terminateService(
        branchid: string,
        clientId: number,
        reason?: string
    ): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(branchid, clientId);
        if (!client) {
            throw new NotFoundException(`Client with id ${clientId} not found`);
        }

        this.logger.log(
            `Terminating service for client ${clientId}` +
            (reason ? `: ${reason}` : "")
        );

        // Update client with terminated status and set endDate to today
        const updatedClient = await this.updateClientUsecase.execute(branchid, clientId, {
            serviceStatus: SERVICE_STATUS.TERMINATED,
            endDate: new Date(),
        });

        // Also mark the current schedule as ended
        await this.prismaService.employee_schedule.updateMany({
            where: { clientId: clientId, replaced: false },
            data: { endDate: new Date() },
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
        branchid: string,
        clientId: number,
        newPrimaryEmployeeId: number,
        newSecondaryEmployeeId?: number | null,
    ): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(branchid, clientId);
        if (!client) {
            throw new NotFoundException(`Client with id ${clientId} not found`);
        }

        this.logger.log(
            `Replacement requested for client ${clientId}: ` +
            `new primary=${newPrimaryEmployeeId}, secondary=${newSecondaryEmployeeId ?? "none"}`
        );

        // Update client status to replacement_requested
        const updatedClient = await this.updateClientUsecase.execute(branchid, clientId, {
            serviceStatus: SERVICE_STATUS.REPLACEMENT_REQUESTED,
        });

        // Get current schedule and mark as replaced
        const currentSchedule = await this.prismaService.employee_schedule.findFirst({
            where: { clientId: clientId, branchId: branchid, replaced: false },
            orderBy: { id: "desc" },
        });

        if (currentSchedule) {
            await this.prismaService.employee_schedule.update({
                where: { id: currentSchedule.id },
                data: { replaced: true, endDate: new Date() },
            });
        }

        // Create new schedule with new employees
        const replacementSchedule = await this.prismaService.employee_schedule.create({
            data: {
                clientId: clientId,
                branchId: branchid,
                primaryEmployeeId: newPrimaryEmployeeId,
                secondaryEmployeeId: newSecondaryEmployeeId ?? null,
                workAddress: client.address ?? "",
                startDate: new Date(),
                endDate: client.endDate ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                replaced: false,
            },
        });
        this.triggerService
            ?.syncEmployeeAssignmentRulesForSchedule(branchid, replacementSchedule.id, true)
            ?.catch((error) => {
                this.logger.error(`Failed to sync replacement assignment triggers: ${error}`);
            });

        return updatedClient;
    }

    /**
     * Complete a replacement and restore service to active status
     * Call this after the replacement has been processed
     * @param clientId - The client ID
     */
    async completeReplacement(branchid: string, clientId: number): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(branchid, clientId);
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

        return this.updateClientUsecase.execute(branchid, clientId, {
            serviceStatus: computedStatus,
        });
    }

    delete(branchid: string, id: number): Promise<void> {
        return this.deleteClientUsecase.execute(branchid, id);
    }

    async getStats(branchid: string): Promise<{
        activeClients: number;
        contractsNotSent: number;
        contractsPendingSignature: number;
        upcomingThisMonth: number;
        upcomingNextMonth: number;
    }> {
        const now = new Date();
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);

        const [activeClients, contractsNotSent, contractsPendingSignature, upcomingThisMonth, upcomingNextMonth] = 
            await Promise.all([
                this.prismaService.client.count({
                    where: { serviceStatus: SERVICE_STATUS.ACTIVE, branchId: branchid },
                }),
                this.prismaService.client.count({
                    where: {
                        eDocId: null,
                        serviceStatus: SERVICE_STATUS.WAITING,
                        branchId: branchid,
                    },
                }),
                this.prismaService.client.count({
                    where: {
                        eDocId: { not: null },
                        eformsignDocByEDocId: { statusType: { not: '050' } },
                        branchId: branchid,
                    },
                }),
                this.prismaService.client.count({
                    where: {
                        serviceStatus: SERVICE_STATUS.WAITING,
                        startDate: { gte: thisMonthStart, lte: thisMonthEnd },
                        branchId: branchid,
                    },
                }),
                this.prismaService.client.count({
                    where: {
                        serviceStatus: SERVICE_STATUS.WAITING,
                        startDate: { gte: nextMonthStart, lte: nextMonthEnd },
                        branchId: branchid,
                    },
                }),
            ]);

        return { activeClients, contractsNotSent, contractsPendingSignature, upcomingThisMonth, upcomingNextMonth };
    }
}
